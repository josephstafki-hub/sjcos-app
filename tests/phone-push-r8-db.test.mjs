// Expectations written FIRST in phone-push-r8-expectations.md.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { setup } from './_harness/phone-r1.mjs';

let f, providers;
const refusal={ok:false,message:'No active owner account. Nothing was changed.',outcome:'unauthorized'};
before(async()=>{
  f=await setup();providers=await import('../lib/providers/types.ts');
  process.env.GMAIL_CLIENT_ID='qa';process.env.GMAIL_CLIENT_SECRET='qa';process.env.GMAIL_REFRESH_TOKEN='qa';
});
after(async()=>{(await import('../lib/providers/apns.ts')).closeApnsSessions();await f?.db.pool.end();});
beforeEach(async()=>{
  providers.resetFakeOutbox();globalThis.phoneTelegramCalls=[];
  await f.run(`UPDATE users SET role='owner',active=true WHERE id=$1`,[f.owner.id]);
  await f.run(`TRUNCATE work_items,decisions,owner_push_messages RESTART IDENTITY CASCADE`);
});
async function fixture(kind) {
  if(kind==='decision')return f.decision();
  if(kind==='grant'){
    const [g]=await f.run(`INSERT INTO owner_grants(actions,reason,requested_by) VALUES('{send_email}','QA permission','qa') RETURNING *`);
    const {stageGrantDecision}=await import('../lib/decisions/grants.ts');
    const {decision:d}=await stageGrantDecision(f.run,{...g,expires_at:g.expires_at.toISOString()},{kind:'agent',agent:'qa',onBehalfOf:null});
    return {d,g,m:await f.recordAppMessage({kind:'grant',title:'Permission',telegram:{decisionId:d.id}})};
  }
  const [p]=await f.run(`INSERT INTO projects(slug,name,client_email) VALUES($1,'Oak kitchen','client@example.test') RETURNING *`,[`zz-${crypto.randomUUID()}`]);
  if(kind==='portal')return {m:await f.recordAppMessage({kind:'portal_message',title:'Tom wrote',body:'Oak?',telegram:{portalChannelKey:`portal:${p.slug}`}})};
  const [w]=await f.run(`INSERT INTO work_items(title,body,project_id,approval_status,status,source_kind,created_by) VALUES('Email quote','Quote',$1,'requested','approval_needed','agent','qa') RETURNING *`,[p.id]);
  const [k]=await f.run(`INSERT INTO knowledge_items(content,kind,source,project_id,created_by) VALUES('To: client@example.test\nSubject: Displayed quote\n\nDisplayed $100.','draft','agent',$1,'qa') RETURNING id`,[p.id]);
  await f.run(`INSERT INTO agent_receipts(work_item_id,receipt_kind,uri,label) VALUES($1,'draft',$2,'Quote')`,[w.id,`knowledge_items/${k.id}`]);
  return {w,m:await f.recordAppMessage({kind:'decision',title:'Quote',telegram:{workItemId:w.id}})};
}
async function evidence(c){
  const row=c.d?(await f.run(`SELECT * FROM decisions WHERE id=$1`,[c.d.id]))[0]:c.w?(await f.run(`SELECT * FROM work_items WHERE id=$1`,[c.w.id]))[0]:null;
  const grant=c.g?(await f.run(`SELECT * FROM owner_grants WHERE id=$1`,[c.g.id]))[0]:null;
  const tables=['approved_work_item_drafts','agent_receipts','decision_events','action_intents','owner_replies','agent_triggers','chat_messages','client_activity','owner_push_messages'];
  const records={};for(const t of tables)records[t]=await f.run(`SELECT * FROM ${t} ORDER BY id`);
  return {row,grant,records,outbox:[...providers.fakeOutbox],telegram:[...globalThis.phoneTelegramCalls]};
}
async function blockedBy(pid){
  const until=Date.now()+5000;
  while(Date.now()<until){
    if((await f.run(`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))`,[pid])).length)return;
    await delay(10);
  }
  assert.fail('phone action never reached the held target lock');
}
const targets={approve:['decision','grant','draft'],decline:['draft'],changes:['decision','grant','draft'],hold:['decision','grant'],reply:['decision','grant','draft','portal']};
for(const verb of Object.keys(targets))for(const state of ['inactive','demoted'])test(`phone ${verb}: ${state} during target-lock wait refuses every supported target`,async()=>{
  // Reply-only children inherit their target but carry no approval category.
  for(const kind of targets[verb])for(const child of verb==='reply'?[false,true]:[false]){
    const c=await fixture(kind);
    if(child)c.m=await f.recordAppMessage({kind:'ack',title:'Reply here',replyToId:c.m.id});
    const [other]=await f.run(`INSERT INTO users(email,password_hash,name,role,initials) VALUES($1,'x','Other','owner','O') RETURNING id`,[`zz-${crypto.randomUUID()}@example.test`]);
    const before=await evidence(c),id=crypto.randomUUID(),text=['reply','changes'].includes(verb)?'Use oak please.':undefined;
    const blocker=await f.db.pool.connect(),updater=await f.db.pool.connect();let pending;
    try{
      await blocker.query('BEGIN');
      const {rows:[{pid}]}=await blocker.query('SELECT pg_backend_pid() AS pid');
      if(kind==='portal')await blocker.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`owner-portal-reply:${c.m.portal_channel_key}`]);
      else await blocker.query(c.d?`SELECT id FROM decisions WHERE id=$1 FOR UPDATE`:`SELECT id FROM work_items WHERE id=$1 FOR UPDATE`,[c.d?.id??c.w.id]);
      pending=f.action(c.m,verb,text,id);
      await blockedBy(pid);
      await updater.query(`SET lock_timeout='2s'`);
      await updater.query(state==='inactive'?`UPDATE users SET active=false WHERE id=$1`:`UPDATE users SET role='staff' WHERE id=$1`,[f.owner.id]);
      await blocker.query('COMMIT');
      const result=await pending;
      assert.equal(result.status,200,`${kind} child=${child}`);assert.deepEqual(result.body,refusal);
      assert.deepEqual(await evidence(c),before,'refusal preserves all domain evidence and effects');
      const [a]=await f.run(`SELECT phase,evidence,result FROM push_actions WHERE id=$1`,[id]);
      assert.equal(a.phase,'completed');assert.deepEqual(a.result,refusal);assert.equal(a.evidence,null);
      await f.run(`UPDATE users SET active=true,role='owner' WHERE id=$1`,[f.owner.id]);
      assert.deepEqual((await f.action(c.m,verb,text,id)).body,refusal,'same UUID replays refusal after owner restoration');
      const valid=await f.action(c.m,verb,text);assert.equal(valid.body.ok,true,JSON.stringify(valid));
      if(verb==='approve'){
        if(c.d)assert.equal((await f.run(`SELECT status FROM decisions WHERE id=$1`,[c.d.id]))[0].status,'approved');
        if(c.g)assert.equal((await f.run(`SELECT status FROM owner_grants WHERE id=$1`,[c.g.id]))[0].status,'approved');
        if(c.w){const sends=providers.fakeOutbox.filter(x=>x.provider==='email');assert.equal(sends.at(-1).payload.subject,'Displayed quote');assert.equal(sends.at(-1).payload.bodyText,'Displayed $100.');}
      } else if(verb==='decline')assert.equal((await f.run(`SELECT approval_status FROM work_items WHERE id=$1`,[c.w.id]))[0].approval_status,'rejected');
      else if(verb==='hold')assert.ok((await f.run(`SELECT held_until FROM decisions WHERE id=$1`,[c.d.id]))[0].held_until);
      else if(kind==='portal')assert.equal((await f.run(`SELECT count(*)::int AS n FROM chat_messages WHERE channel_key=$1 AND body=$2`,[c.m.portal_channel_key,text]))[0].n,1);
      else assert.equal((await f.run(c.d?`SELECT count(*)::int AS n FROM owner_replies WHERE decision_id=$1`:`SELECT count(*)::int AS n FROM owner_replies WHERE work_item_id=$1`,[c.d?.id??c.w.id]))[0].n,1);
    }finally{
      await blocker.query('ROLLBACK');blocker.release();
      await updater.query('RESET lock_timeout');updater.release();
      if(pending)await pending;
      await f.run(`UPDATE users SET active=true,role='owner' WHERE id=$1`,[f.owner.id]);
      await f.run(`DELETE FROM users WHERE id=$1`,[other.id]);
    }
  }
  if(verb==='decline')assert.equal((await f.action((await f.decision()).m,verb)).body.outcome,'not_allowed');
});

test('phone approval holds the real owner lock through commit, then account update finishes',async()=>{
  const c=await fixture('draft'),pool=f.db.pool,connect=pool.connect;
  let reached,release;const atOwner=new Promise(r=>reached=r),resume=new Promise(r=>release=r);
  let intercepted=false,ownerPid,pending,update;
  const updater=await pool.connect();
  // Await only AFTER the production SELECT completed: real query and verdict.
  pool.connect=function(...args){
    if(args.length)return connect.apply(this,args);
    return connect.call(this).then(client=>{
      const query=client.query,done=client.release;
      client.query=function(sql,...params){
        const result=query.call(this,sql,...params);
        if(!intercepted && typeof sql==='string' && /SELECT active, role FROM users.*FOR SHARE/.test(sql)){
          intercepted=true;
          return result.then(async result=>{ownerPid=client.processID;reached();await resume;return result;});
        }
        return result;
      };
      client.release=function(...a){client.query=query;client.release=done;return done.apply(this,a);};
      return client;
    });
  };
  try{
    pending=f.action(c.m,'approve');
    await Promise.race([atOwner,delay(5000).then(()=>{throw new Error('actual phone owner lock was not reached');})]);
    update=updater.query(`UPDATE users SET active=false,role='staff' WHERE id=$1`,[f.owner.id]);
    await blockedBy(ownerPid);
    assert.equal((await f.run(`SELECT approval_status FROM work_items WHERE id=$1`,[c.w.id]))[0].approval_status,'requested');
    release();assert.equal((await pending).body.ok,true);await update;
    assert.equal((await f.run(`SELECT active FROM users WHERE id=$1`,[f.owner.id]))[0].active,false);
    assert.equal((await f.run(`SELECT count(*)::int AS n FROM approved_work_item_drafts WHERE work_item_id=$1`,[c.w.id]))[0].n,1);
    assert.equal(providers.fakeOutbox.filter(x=>x.provider==='email').length,1);
  }finally{release();pool.connect=connect;if(pending)await pending;if(update)await update;updater.release();}
});

test('phone and Telegram approvals use target then owner in either arrival order',async()=>{
  const {POST}=await import('../app/api/telegram/webhook/route.ts');
  for(const kind of ['decision','draft'])for(const first of ['phone','telegram']){
    providers.resetFakeOutbox();const c=await fixture(kind),mid=++globalThis.phoneTelegramSeq,uid=++globalThis.phoneTelegramSeq,chat=process.env.TELEGRAM_OWNER_CHAT_ID;
    await f.run(`UPDATE owner_push_messages SET telegram_message_id=$2 WHERE id=$1`,[c.m.id,String(mid)]);
    const phone=()=>f.action(c.m,'approve');
    const telegram=()=>POST(new Request('http://local/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'test-secret'},body:JSON.stringify({update_id:uid,callback_query:{id:`r8-${uid}`,from:{id:chat},message:{message_id:mid,chat:{id:chat}},data:c.d?`d|${c.d.id}|${c.d.content_hash.slice(0,12)}|a`:`w|${c.w.id}|a`}})}));
    const blocker=await f.db.pool.connect();let one,two;
    try{
      await blocker.query('BEGIN');const {rows:[{pid}]}=await blocker.query('SELECT pg_backend_pid() AS pid');
      await blocker.query(c.d?`SELECT id FROM decisions WHERE id=$1 FOR UPDATE`:`SELECT id FROM work_items WHERE id=$1 FOR UPDATE`,[c.d?.id??c.w.id]);
      one=(first==='phone'?phone:telegram)();await blockedBy(pid);
      two=(first==='phone'?telegram:phone)();
      const until=Date.now()+5000;let count=0;
      while(Date.now()<until){
        [{n:count}]=await f.run(`WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid)) WHERE a.datname=current_database()) SELECT count(*)::int AS n FROM waiting`,[pid]);
        if(count>=2)break;await delay(10);
      }
      assert.ok(count>=2,'both channels reached the target lock');await blocker.query('COMMIT');
      const results=await Promise.all([one,two]);assert.ok(results.every(r=>r.status===200));
      if(c.d)assert.equal((await f.run(`SELECT count(*)::int AS n FROM decision_events WHERE decision_id=$1 AND kind='approved'`,[c.d.id]))[0].n,1);
      else{
        assert.equal((await f.run(`SELECT count(*)::int AS n FROM approved_work_item_drafts WHERE work_item_id=$1`,[c.w.id]))[0].n,1);
        assert.equal(providers.fakeOutbox.filter(x=>x.provider==='email').length,1);
      }
    }finally{await blocker.query('ROLLBACK');blocker.release();if(one)await one;if(two)await two;}
  }
});

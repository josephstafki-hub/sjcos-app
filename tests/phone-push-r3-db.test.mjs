// Expectations recorded first in phone-push-r3-expectations.md. Real routes,
// transactions and dispatcher; a separate SQL connection makes each edit.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {transport} from './_harness/apns-http2.mjs';
import {setup} from './_harness/phone-r1.mjs';
let f,approve,sender,providers,notify,drain;
before(async()=>{
 f=await setup();({approveWorkItemById:approve}=await import('../lib/approve-work-item.ts'));
 ({sendApprovedClientDraft:sender}=await import('../lib/approved-draft-send.ts'));
 providers=await import('../lib/providers/types.ts');
 ({notifyApprovalNeeded:notify,runPushDrain:drain}=await import('../lib/notify-owner.ts'));
 process.env.GMAIL_CLIENT_ID='qa';process.env.GMAIL_CLIENT_SECRET='qa';process.env.GMAIL_REFRESH_TOKEN='qa';
});
after(async()=>{(await import('../lib/providers/apns.ts')).closeApnsSessions();await f?.db.pool.end();});
beforeEach(async()=>{
 process.env.SJC_OUTBOUND_DISABLED='1';providers.resetFakeOutbox();transport.response=()=>({status:200});
 await f.run(`TRUNCATE push_actions,push_device_deliveries,owner_push_messages,push_outbox RESTART IDENTITY CASCADE`);
 await f.savePushSettings({app:true,telegram:true});globalThis.phoneTelegramCalls=[];
});
const sends=()=>providers.fakeOutbox.filter(x=>x.provider==='email');
async function draft(){
 const [p]=await f.run(`INSERT INTO projects(slug,name,client_email) VALUES($1,'Oak kitchen','client@example.test') RETURNING id`,[`zz-${crypto.randomUUID()}`]);
 const [w]=await f.run(`INSERT INTO work_items(title,body,project_id,approval_status,status,source_kind,created_by) VALUES('Email quote','Quote',$1,'requested','approval_needed','agent','qa') RETURNING id`,[p.id]);
 const [k]=await f.run(`INSERT INTO knowledge_items(content,kind,source,project_id,created_by) VALUES('To: client@example.test\nSubject: Original $100\n\nOriginal $100.','draft','agent',$1,'qa') RETURNING id`,[p.id]);
 await f.run(`INSERT INTO agent_receipts(work_item_id,receipt_kind,uri,label) VALUES($1,'draft',$2,'Quote')`,[w.id,`knowledge_items/${k.id}`]);
 const m=await f.recordAppMessage({kind:'decision',title:'Original $100',telegram:{workItemId:w.id}});
 const [v]=await f.run(`SELECT phone_push_draft_binding($1) AS binding`,[w.id]);
 return {p,w,k,m,binding:v.binding};
}
async function edit(c,kind,connection){
 const editor=connection??await f.db.pool.connect();
 try{
  if(kind==='content')await editor.query(`UPDATE knowledge_items SET content='To: client@example.test\nSubject: Unauthorized $9900\n\nUnauthorized $9900.' WHERE id=$1`,[c.k.id]);
  else if(kind==='receipt'){
   const {rows:[k]}=await editor.query(`INSERT INTO knowledge_items(content,kind,source,created_by) VALUES('To: client@example.test\nSubject: Unauthorized $9900\n\nUnauthorized $9900.','draft','agent','qa') RETURNING id`);
   await editor.query(`INSERT INTO agent_receipts(work_item_id,receipt_kind,uri,label) VALUES($1,'draft',$2,'Replacement')`,[c.w.id,`knowledge_items/${k.id}`]);
  }else await editor.query(`UPDATE projects SET client_email='other@example.test' WHERE id=$1`,[c.p.id]);
 }finally{if(!connection)editor.release();}
}
async function telegram(c){
 const mid=++globalThis.phoneTelegramSeq,chat=process.env.TELEGRAM_OWNER_CHAT_ID;
 await f.run(`UPDATE owner_push_messages SET telegram_message_id=$2 WHERE id=$1`,[c.m.id,String(mid)]);
 const {POST}=await import('../app/api/telegram/webhook/route.ts');
 const response=await POST(new Request('http://local/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'test-secret'},body:JSON.stringify({update_id:++globalThis.phoneTelegramSeq,callback_query:{id:`qa-${mid}`,from:{id:chat},message:{message_id:mid,chat:{id:chat}},data:`w|${c.w.id}|a`}})}));
 assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
}
const act=(path,c)=>path==='phone'?f.action(c.m,'approve'):path==='web'?approve(c.w.id,c.binding):telegram(c);

// Phone: exact judge checkpoint after the real effects_running query returns.
// Web/Telegram: pause the approval COMMIT before returning to the caller.
async function atApprovedBoundary(path,c,change){
 const pool=f.db.pool,originalQuery=pool.query,originalConnect=pool.connect;
 let edited=false;
 const mutate=async()=>{assert.equal((await f.run(`SELECT approval_status FROM work_items WHERE id=$1`,[c.w.id]))[0].approval_status,'approved');await edit(c,change);edited=true;};
 if(path==='phone')pool.query=function(sql,...args){const result=originalQuery.call(this,sql,...args);return typeof sql==='string'&&sql.includes("SET phase='effects_running'")?result.then(async r=>{await mutate();return r;}):result;};
 else pool.connect=function(...args){
  if(args.length)return originalConnect.apply(this,args);
  return originalConnect.call(this).then(client=>{
   const q=client.query,release=client.release;let approved=false;
   client.query=function(sql,...params){const result=q.call(this,sql,...params);
    if(typeof sql==='string'&&sql.includes("SET approval_status='approved'"))approved=true;
    return sql==='COMMIT'&&approved?result.then(async r=>{await mutate();return r;}):result;
   };
   client.release=function(...a){client.query=q;client.release=release;return release.apply(this,a);};
   return client;
  });
 };
 try{await act(path,c);assert.equal(edited,true,'regression reached the committed approval boundary');}
 finally{pool.query=originalQuery;pool.connect=originalConnect;}
}
for(const path of ['phone','telegram','web'])for(const change of ['content','receipt','recipient'])test(`${path}: concurrent ${change} edit AFTER approval dispatches only immutable $100 snapshot`,async()=>{
 const c=await draft();await atApprovedBoundary(path,c,change);
 assert.equal(sends().length,1);assert.equal(sends()[0].payload.to,'client@example.test');assert.equal(sends()[0].payload.subject,'Original $100');assert.equal(sends()[0].payload.bodyText,'Original $100.');
 // Match the unauthorized price, not a coincidental '9900' in a UUID/slug.
 const [saved]=await f.run(`SELECT snapshot FROM approved_work_item_drafts WHERE work_item_id=$1`,[c.w.id]);assert.match(saved.snapshot.content,/Original \$100/);assert.doesNotMatch(JSON.stringify(saved.snapshot),/\$9900|other@example/);
});
async function editWhileApprovalWaits(path,c,change){
 const editor=await f.db.pool.connect();let pending;
 try{
  await editor.query('BEGIN');await editor.query(`SELECT id FROM work_items WHERE id=$1 FOR UPDATE`,[c.w.id]);
  pending=act(path,c);
  let waiting=false;
  for(let i=0;i<300;i++){
   if((await f.run(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM work_items WHERE id=$1 FOR UPDATE%'`)).length){waiting=true;break;}
   await editor.query('SELECT pg_sleep(0.005)');
  }
  assert.equal(waiting,true,'approval is waiting on the separate connection');
  await edit(c,change,editor);await editor.query('COMMIT');
 }finally{await editor.query('ROLLBACK');editor.release();if(pending)await pending;}
 return pending;
}
for(const path of ['phone','telegram','web'])for(const change of ['content','receipt'])test(`${path}: ${change} edit BEFORE approval refuses with zero send`,async()=>{
 const c=await draft();const r=await editWhileApprovalWaits(path,c,change);
 if(path==='phone')assert.equal(r.body.outcome,'stale');if(path==='web'){assert.equal(r.ok,false);assert.match(r.error,/draft changed/);}
 assert.equal(sends().length,0);assert.equal((await f.run(`SELECT approval_status FROM work_items WHERE id=$1`,[c.w.id]))[0].approval_status,'requested');assert.equal((await f.run(`SELECT * FROM approved_work_item_drafts WHERE work_item_id=$1`,[c.w.id])).length,0);
});
test('two phone approvals dispatch one frozen revision once',async()=>{const c=await draft();const results=await Promise.all([f.action(c.m,'approve'),f.action(c.m,'approve')]);assert.equal(results.filter(r=>r.body.ok).length,1);assert.equal(sends().length,1);assert.equal((await f.run(`SELECT * FROM approved_work_item_drafts WHERE work_item_id=$1`,[c.w.id])).length,1);});
test('sender missing approved evidence fails closed',async()=>{const c=await draft();assert.equal((await sender(c.w.id,crypto.randomUUID())).outcome,'failed');await f.run(`UPDATE owner_push_messages SET draft_binding=NULL WHERE id=$1`,[c.m.id]);assert.equal((await approve(c.w.id)).ok,false);assert.equal(sends().length,0);});
test('narrow roles cannot create or mutate frozen approval evidence',async()=>{
 const c=await draft();await approve(c.w.id,c.binding);
 for(const role of ['sjcos_agent','sjcos_worker']){const connection=await f.db.pool.connect();try{await connection.query(`SET ROLE ${role}`);for(const sql of [`INSERT INTO approved_work_item_drafts(work_item_id,binding,snapshot) VALUES('${c.w.id}','bad','{}')`,`UPDATE approved_work_item_drafts SET snapshot='{}'`,`DELETE FROM approved_work_item_drafts`])await assert.rejects(()=>connection.query(sql),/permission denied/);}finally{await connection.query('RESET ROLE');connection.release();}}
});
for(const today of [true,false])test(`hold copy uses Central ${today?'time alone today':'date at time on another day'}`,async()=>{
 const {d,m}=await f.decision();
 // The last instant of today is in the future (without a wall-clock-hour assumption).
 const [date]=await f.run(`SELECT (((now() AT TIME ZONE 'America/Chicago')::date + $1::int)+time '23:59:59.999') AT TIME ZONE 'America/Chicago' AS held`,[today?0:1]);
 await f.run(`UPDATE decisions SET held_until=$2,expires_at=$2::timestamptz+interval '1 day' WHERE id=$1`,[d.id,date.held]);
 const out=(await f.call('GET',`messages/${m.id}`)).body.message.outcome;
 if(today)assert.equal(out,'On hold until 11:59 pm Central');else {const [want]=await f.run(`SELECT to_char($1::timestamptz AT TIME ZONE 'America/Chicago','Mon FMDD "at" FMHH12:MI am') AS t`,[date.held]);assert.equal(out,`On hold until ${want.t} Central`);}
});
test('expiry app meridiem is lowercase while Telegram remains unchanged',async()=>{const {cardText}=await import('../lib/decisions/cards.ts');const {d}=await f.decision();d.expires_at='2026-11-12T18:49:00Z';assert.match(cardText(d,{app:true}),/Expires Thu, Nov 12, 12:49 pm Central/);assert.match(cardText(d),/Expires: 2026-11-12 18:49/);});
test('stale permission nudge names the decision and uses its app card; Telegram unchanged',async()=>{
 const {d}=await f.decision(),target=crypto.randomUUID();
 await f.run(`UPDATE decisions SET title='Send the oak quote',summary=$2::jsonb WHERE id=$1`,[d.id,JSON.stringify({assumptions:["Agent's reason: Confirm layout"],subject:'Oak quote',message:'Original $100',grantId:target})]);
 await f.run(`INSERT INTO owner_grants(actions,reason,requested_by,target_id,decision_id,created_at,expires_at) VALUES('{send_email}','Confirm layout','claude',$1,$2,now()-interval '6 hours 1 minute',now()+interval '1 day')`,[target,d.id]);
 await drain({now:new Date()});const [n]=await f.run(`SELECT * FROM push_outbox WHERE kind='stale_approval' AND payload->>'decisionId'=$1`,[d.id]);assert.ok(n);
 assert.equal(n.payload.appText.title,'Still waiting 6h: Send the oak quote');assert.match(n.payload.appText.body,/Why: Confirm layout/);assert.doesNotMatch(JSON.stringify(n.payload.appText),new RegExp(`${target}|Reason:|Grant id|send_email`));assert.match(n.title,/Grant request waiting 6h: claude asks to send_email/);assert.equal(n.body,'Reason: Confirm layout');assert.ok(n.payload.buttons[0].some(b=>b.text==='Hold 4h'));
});
test('internal draft has no leading blank line; email retains header separator',async()=>{
 const c=await draft();await f.run(`UPDATE knowledge_items SET content='Review the internal checklist.' WHERE id=$1`,[c.k.id]);await notify(c.w.id,'Checklist');
 const [internal]=await f.run(`SELECT body FROM push_outbox WHERE payload->>'workItemId'=$1`,[c.w.id]);assert.match(internal.body,/^Review the internal checklist\./);
 const email=await draft();await notify(email.w.id,'Email quote');const [row]=await f.run(`SELECT body FROM push_outbox WHERE payload->>'workItemId'=$1`,[email.w.id]);assert.match(row.body,/^To: client@example.test\nSubject: Original \$100\n\nOriginal \$100\./);
});
test('failed frozen send reopens and retries one durable intent on same revision',async()=>{
 const c=await draft();providers.setFakeOutcome(p=>p==='email'?{responseClass:'retryable',error:'QA pretransmit',transmitted:false,retryInSeconds:0}:undefined);
 assert.equal((await f.action(c.m,'approve')).body.ok,false);assert.equal((await f.run(`SELECT approval_status FROM work_items WHERE id=$1`,[c.w.id]))[0].approval_status,'requested');
 await f.run(`UPDATE action_intents SET next_attempt_at=now()-interval '1 second' WHERE payload->>'work_item_id'=$1`,[c.w.id]);providers.setFakeOutcome(null);
 assert.equal((await f.action(c.m,'approve')).body.ok,true);assert.equal(sends().filter(s=>s.result.responseClass==='accepted').length,1);assert.equal((await f.run(`SELECT * FROM action_intents WHERE payload->>'work_item_id'=$1`,[c.w.id])).length,1);
});

test('approved snapshot content is immutable even to an accidental owner UPDATE',async()=>{
 const c=await draft();await approve(c.w.id,c.binding);
 await assert.rejects(()=>f.run(`UPDATE approved_work_item_drafts SET snapshot='{}' WHERE work_item_id=$1`,[c.w.id]),/Approved draft snapshots are immutable/);
});

// Expectations written FIRST in phone-push-r7-expectations.md, cases 1–13.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { setup } from './_harness/phone-r1.mjs';

// Only request adapters; real DAL, JWT, accounts, transactions and dispatch.
registerHooks({
  resolve(s,c,next) {
    if(['next/headers','next/navigation'].includes(s)) return {url:`r7:${s}`,shortCircuit:true};
    return next(s,c);
  },
  load(u,c,next) {
    const source={
      'r7:next/headers':'export const cookies=async()=>({get:()=>globalThis.r7Session?{value:globalThis.r7Session}:undefined});export const headers=async()=>new Headers();',
      'r7:next/navigation':'export function redirect(path){throw new Error("redirect:"+path)}',
    }[u];
    return source?{format:'module',source,shortCircuit:true}:next(u,c);
  },
});
let f, providers, previews, waiting, engine, ops, pending, staff, staffToken, lockActiveOwner, POST;
const changed='This draft changed since you opened it. Nothing was sent. Read the new version and approve again.';
before(async()=>{
  f=await setup();
  providers=await import('../lib/providers/types.ts');
  ({workItemDraftPreviews:previews}=await import('../lib/work-item-draft.ts'));
  waiting=await import('../lib/actions/approvals.ts');
  engine=await import('../lib/actions/engine.ts');
  ops=await import('../lib/actions/record-ops.ts');
  ({listPendingApprovals:pending}=await import('../lib/approvals.ts'));
  ({lockActiveOwner}=await import('../lib/commands/owner-authorization.ts'));
  ({POST}=await import('../app/api/telegram/webhook/route.ts'));
  [staff]=await f.run(`INSERT INTO users(email,password_hash,name,role,initials,permissions) VALUES($1,'x','Staff','staff','S','{}') RETURNING *`,[`zz-${crypto.randomUUID()}@example.test`]);
  const {encrypt}=await import('../lib/session.ts');
  staffToken=await encrypt({userId:staff.id,role:'staff',perms:[],authAt:Math.floor(Date.now()/1000)});
  process.env.GMAIL_CLIENT_ID='qa';process.env.GMAIL_CLIENT_SECRET='qa';process.env.GMAIL_REFRESH_TOKEN='qa';
});
after(async()=>{(await import('../lib/providers/apns.ts')).closeApnsSessions();await f?.db.pool.end();});
beforeEach(async()=>{
  process.env.SJC_OUTBOUND_DISABLED='1';providers.resetFakeOutbox();globalThis.phoneTelegramCalls=[];
  await f.run(`UPDATE users SET role='owner',active=true WHERE id=$1`,[f.owner.id]);
  await f.run(`TRUNCATE work_items,decisions,owner_push_messages RESTART IDENTITY CASCADE`);
  globalThis.r7Session=f.bearer;
});
const sends=()=>providers.fakeOutbox.filter(x=>x.provider==='email');
async function draft(kind='project') {
  const slug=`zz-${crypto.randomUUID()}`,col=kind==='project'?'project_id':'lead_id';
  const [p]=await f.run(kind==='project'?`INSERT INTO projects(slug,name,client_email) VALUES($1,'Oak kitchen','client@example.test') RETURNING id`:`INSERT INTO leads(slug,name,email) VALUES($1,'Oak kitchen','client@example.test') RETURNING id`,[slug]);
  const [w]=await f.run(`INSERT INTO work_items(title,body,${col},approval_status,status,source_kind,created_by) VALUES('Email quote','Quote',$1,'requested','approval_needed','agent','qa') RETURNING id`,[p.id]);
  const [k]=await f.run(`INSERT INTO knowledge_items(content,kind,source,${col},created_by) VALUES('To: client@example.test\nSubject: Displayed quote\n\nDisplayed $100.','draft','agent',$1,'qa') RETURNING id`,[p.id]);
  await f.run(`INSERT INTO agent_receipts(work_item_id,receipt_kind,uri,label) VALUES($1,'draft',$2,'Quote')`,[w.id,`knowledge_items/${k.id}`]);
  const [v]=await previews({ids:[w.id]});
  return {w,k,v,kind,slug};
}
async function evidence(c) {
  const row=(await f.run(c.d?`SELECT * FROM decisions WHERE id=$1`:`SELECT * FROM work_items WHERE id=$1`,[c.d?.id??c.w.id]))[0];
  const [counts]=await f.run(`SELECT (SELECT count(*) FROM approved_work_item_drafts)::int AS snapshots,(SELECT count(*) FROM agent_receipts)::int AS receipts,(SELECT count(*) FROM decision_events WHERE kind IN ('approved','rejected','held','changes_requested'))::int AS resolutions,(SELECT count(*) FROM action_intents)::int AS intents`);
  return {row,counts,sends:sends().length};
}
async function denied(c,call) {
  const before=await evidence(c);
  try {assert.equal((await call(c)).ok,false);} catch(e) {assert.match(e.message,/^redirect:/);}
  assert.deepEqual(await evidence(c),before,'refusal preserves all approval evidence and sends');
}
async function callback(c,verb,mapped,isDecision) {
  const mid=++globalThis.phoneTelegramSeq,uid=++globalThis.phoneTelegramSeq,chat=process.env.TELEGRAM_OWNER_CHAT_ID;
  if(mapped&&!isDecision) {
    const m=await f.recordAppMessage({kind:'decision',title:'Quote',telegram:{workItemId:c.w.id}});
    await f.run(`UPDATE owner_push_messages SET telegram_message_id=$2 WHERE id=$1`,[m.id,String(mid)]);
  }
  return {uid,start:()=>POST(new Request('http://local/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'test-secret'},body:JSON.stringify({update_id:uid,callback_query:{id:`r7-${uid}`,from:{id:chat},message:{message_id:mid,chat:{id:chat}},data:isDecision?`d|${c.d.id}|${c.d.content_hash.slice(0,12)}|${verb}`:`w|${c.w.id}|${verb}`}})}))};
}
async function blockedBy(pid) {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline) {
    const rows=await f.run(`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))`,[pid]);
    if(rows.length)return;
    await delay(10);
  }
  assert.fail('webhook never reached the held record lock');
}
for(const [label,verb,mapped,isDecision] of [
  ['bound draft Approve','a',true,false],
  ['bound draft Reject','r',true,false],
  ['legacy draft Reject','r',false,false],
  ['decision Approve','a',false,true],
  ['decision Hold','h',false,true],
]) for(const state of ['inactive','demoted']) test(`Telegram ${label}: ${state} committed during target-lock wait refuses`,async()=>{
  const c=isDecision?await f.decision():await draft();
  const cb=await callback(c,verb,mapped,isDecision),before=await evidence(c);
  const blocker=await f.db.pool.connect(),updater=await f.db.pool.connect();
  let response;
  try {
    await blocker.query('BEGIN');
    const {rows:[{pid}]}=await blocker.query('SELECT pg_backend_pid() AS pid');
    await blocker.query(isDecision?`SELECT id FROM decisions WHERE id=$1 FOR UPDATE`:`SELECT id FROM work_items WHERE id=$1 FOR UPDATE`,[c.d?.id??c.w.id]);
    response=cb.start();
    await blockedBy(pid); // proves initial owner discovery already finished
    await updater.query(`SET lock_timeout='2s'`);
    await updater.query(state==='inactive'?`UPDATE users SET active=false WHERE id=$1`:`UPDATE users SET role='staff' WHERE id=$1`,[f.owner.id]);
    await blocker.query('COMMIT');
    const r=await response;
    assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
    assert.deepEqual(await evidence(c),before);
    const [recorded]=await f.run(`SELECT outcome FROM telegram_updates WHERE update_id=$1`,[cb.uid]);
    assert.match(recorded.outcome,isDecision?/refused: no owner principal/:/No active owner account/);
    // Cosmetic callback toasts are deliberately suppressed by outbound-disabled
    // mode; the real webhook's durable outcome above must record the refusal.
  } finally {
    await blocker.query('ROLLBACK');blocker.release();
    await updater.query('RESET lock_timeout');updater.release();
    if(response)await response;
  }
});
test('owner lock serializes active/role updates and cannot substitute another owner',async()=>{
  const holder=await f.db.pool.connect(),updater=await f.db.pool.connect();
  const principal={kind:'user',userId:f.owner.id,role:'owner',name:'Joe',permissions:[]};
  let update,other;
  try {
    [other]=await f.run(`INSERT INTO users(email,password_hash,name,role,initials) VALUES($1,'x','Other','owner','O') RETURNING id`,[`zz-${crypto.randomUUID()}@example.test`]);
    await holder.query('BEGIN');
    assert.equal(await lockActiveOwner(async(s,p)=>(await holder.query(s,p)).rows,principal),true);
    const {rows:[{pid}]}=await holder.query('SELECT pg_backend_pid() AS pid');
    update=updater.query(`UPDATE users SET active=false,role='staff' WHERE id=$1`,[f.owner.id]);
    await blockedBy(pid);
    await holder.query('COMMIT');await update;
    await holder.query('BEGIN');
    assert.equal(await lockActiveOwner(async(s,p)=>(await holder.query(s,p)).rows,principal),false);
    await holder.query('COMMIT');
  } finally {
    await holder.query('ROLLBACK');holder.release();if(update)await update;updater.release();
    if(other)await f.run(`DELETE FROM users WHERE id=$1`,[other.id]);
  }
});
const paths=[
  ['Engine Approve','engine','project',true,c=>engine.approveWorkItem(c.w.id,c.v.binding)],
  ['Engine Reject','engine','project',false,c=>engine.rejectWorkItem(c.w.id)],
  ['shared Today/notification/popup Approve','today','project',true,c=>waiting.approveWaiting(`work_item:${c.w.id}`,c.v.binding)],
  ['shared Today/notification/popup Decline','today','project',false,c=>waiting.declineWaiting(`work_item:${c.w.id}`,c.v.binding)],
  ...['lead','project'].flatMap(kind=>[
    [`${kind} Ops Approve`,'today',kind,true,c=>ops.approveRecordWorkItem(c.w.id,kind,c.slug,c.v.binding)],
    [`${kind} Ops Reject`,'today',kind,false,c=>ops.rejectRecordWorkItem(c.w.id,kind,c.slug)],
  ]),
];
async function visibility(c,area) {
  const principal={kind:'user',userId:staff.id,role:'staff',name:'Staff',permissions:area?[area]:[]};
  const list=await pending({principal,limit:100}),poll=await waiting.pollNotificationCenter(null);
  for(const cards of [list,poll.approvals]) {
    const shown=cards.find(x=>x.id===c.w.id);
    if(area==='today')assert.equal(shown?.contentHash,c.v.binding);
    else assert.ok(!cards.some(x=>x.kind==='work_item'));
  }
}
for(const area of ['today','engine']) test(`${area}-only staff: displayed card visibility matches action area and preserves sends/bindings`,async()=>{
  globalThis.r7Session=staffToken;
  await f.run(`UPDATE users SET permissions=$2 WHERE id=$1`,[staff.id,[area]]);
  for(const [name,required,kind,approve,call] of paths) {
    providers.resetFakeOutbox();
    const c=await draft(kind);
    await visibility(c,area);
    if(area!==required){await denied(c,call);continue;}
    assert.equal((await call(c)).ok,true,name);
    assert.equal((await evidence(c)).row.approval_status,approve?'approved':'rejected');
    assert.equal(sends().length,approve?1:0);
    if(approve) {
      assert.equal(sends()[0].payload.subject,c.v.subject);assert.equal(sends()[0].payload.bodyText,c.v.body);
      assert.equal((await call(c)).ok,false);assert.equal(sends().length,1);
      const stale=await draft(kind);
      await f.run(`UPDATE knowledge_items SET content='Subject: Changed\n\nChanged $9900.' WHERE id=$1`,[stale.k.id]);
      const before=await evidence(stale);
      assert.deepEqual(await call(stale),{ok:false,error:changed});
      assert.deepEqual(await evidence(stale),before);
    }
  }
  if(area==='engine') {
    await f.run(`UPDATE users SET permissions='{}' WHERE id=$1`,[staff.id]);
    for(const [, ,kind,,call] of paths) {const c=await draft(kind);await visibility(c,null);await denied(c,call);}
  }
});

// Expectations written first in phone-push-r4-expectations.md.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { transport } from './_harness/apns-http2.mjs';
import { setup } from './_harness/phone-r1.mjs';
registerHooks({resolve(s,c,next){if(s==='@/lib/dal')return {url:'r4:dal',shortCircuit:true};return next(s,c);},load(u,c,next){if(u==='r4:dal')return {format:'module',shortCircuit:true,source:'export const getCurrentUser=async()=>globalThis.r4Owner;export const requireAccess=getCurrentUser;export const requireRole=getCurrentUser;'};return next(u,c);}});
let f, approve, preview, pending, engine, record, web, ops, waiting, providers;
const changed='This draft changed since you opened it. Nothing was sent. Read the new version and approve again.';
before(async()=>{
 f=await setup();globalThis.r4Owner=f.owner;
 ({approveWorkItemById:approve}=await import('../lib/approve-work-item.ts'));
 ({workItemDraftPreviews:preview}=await import('../lib/work-item-draft.ts'));
 ({listPendingApprovals:pending}=await import('../lib/approvals.ts'));
 ({getEngineWorkItem:engine}=await import('../lib/engine.ts'));
 ({getRecordOps:record}=await import('../lib/record-ops.ts'));
 ({approveWorkItem:web}=await import('../lib/actions/engine.ts'));
 ({approveRecordWorkItem:ops}=await import('../lib/actions/record-ops.ts'));
 ({approveWaiting:waiting}=await import('../lib/actions/approvals.ts'));
 providers=await import('../lib/providers/types.ts');
 process.env.GMAIL_CLIENT_ID='qa';process.env.GMAIL_CLIENT_SECRET='qa';process.env.GMAIL_REFRESH_TOKEN='qa';
});
after(async()=>{(await import('../lib/providers/apns.ts')).closeApnsSessions();await f?.db.pool.end();});
beforeEach(async()=>{
 process.env.SJC_OUTBOUND_DISABLED='1';providers.resetFakeOutbox();transport.response=()=>({status:200});
 await f.run(`TRUNCATE push_actions,push_device_deliveries,owner_push_messages,push_outbox RESTART IDENTITY CASCADE`);
 await f.savePushSettings({app:true,telegram:true});globalThis.phoneTelegramCalls=[];
});
const sends=()=>providers.fakeOutbox.filter(x=>x.provider==='email');
async function draft(card=true,kind='project'){
 const slug=`zz-${crypto.randomUUID()}`;
 const [p]=await f.run(kind==='project'?`INSERT INTO projects(slug,name,client_email) VALUES($1,'Oak kitchen','client@example.test') RETURNING id`:`INSERT INTO leads(slug,name,email) VALUES($1,'Oak kitchen','client@example.test') RETURNING id`,[slug]);
 const col=kind==='project'?'project_id':'lead_id';
 const [w]=await f.run(`INSERT INTO work_items(title,body,${col},approval_status,status,source_kind,created_by) VALUES('Email quote','Quote',$1,'requested','approval_needed','agent','qa') RETURNING id`,[p.id]);
 const [k]=await f.run(`INSERT INTO knowledge_items(content,kind,source,${col},created_by) VALUES('To: client@example.test\nSubject: Old $100\n\nOld $100.','draft','agent',$1,'qa') RETURNING id`,[p.id]);
 await f.run(`INSERT INTO agent_receipts(work_item_id,receipt_kind,uri,label) VALUES($1,'draft',$2,'Quote')`,[w.id,`knowledge_items/${k.id}`]);
 const m=card?await replacement(w.id):null;
 return {p,w,k,m,slug};
}
const replacement=id=>f.recordAppMessage({kind:'decision',title:'Quote',telegram:{workItemId:id}});
const viewed=async c=>(await preview({ids:[c.w.id]}))[0];
const edit=async(c,connection)=>{const sql=`UPDATE knowledge_items SET content='To: client@example.test\nSubject: New $9900\n\nNew $9900.' WHERE id=$1`;return connection?connection.query(sql,[c.k.id]):f.run(sql,[c.k.id]);};
async function refused(c,r){
 assert.equal(r.ok,false);assert.equal(r.error,changed);
 assert.equal(sends().length,0);
 assert.equal((await f.run(`SELECT approval_status FROM work_items WHERE id=$1`,[c.w.id]))[0].approval_status,'requested');
 assert.equal((await f.run(`SELECT * FROM approved_work_item_drafts WHERE work_item_id=$1`,[c.w.id])).length,0);
}
async function telegram(c,mid){
 const chat=process.env.TELEGRAM_OWNER_CHAT_ID;
 const {POST}=await import('../app/api/telegram/webhook/route.ts');
 const updateId=++globalThis.phoneTelegramSeq;
 const r=await POST(new Request('http://local/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'test-secret'},body:JSON.stringify({update_id:updateId,callback_query:{id:`qa-${mid}`,from:{id:chat},message:{message_id:mid,chat:{id:chat}},data:`w|${c.w.id}|a`}})}));
 assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
 return (await f.run(`SELECT outcome FROM telegram_updates WHERE update_id=$1`,[updateId]))[0].outcome;
}
test('judge repro: old phone and web refuse replacement content',async()=>{
 const c=await draft(),v=await viewed(c);await edit(c);await replacement(c.w.id);
 assert.equal((await f.action(c.m,'approve')).body.outcome,'stale');await refused(c,await approve(c.w.id,v.binding));
});
test('opening replacement approves its displayed payload exactly once',async()=>{
 const c=await draft();await edit(c);await replacement(c.w.id);const v=await viewed(c);
 assert.equal((await approve(c.w.id,v.binding)).ok,true);assert.equal((await approve(c.w.id,v.binding)).ok,false);
 assert.equal(sends().length,1);assert.equal(sends()[0].payload.subject,'New $9900');
});
test('no phone card: stale web draft refuses',async()=>{const c=await draft(false),v=await viewed(c);await edit(c);await refused(c,await approve(c.w.id,v.binding));});
test('no phone card: fresh web draft sends displayed content',async()=>{const c=await draft(false),v=await viewed(c);assert.equal((await approve(c.w.id,v.binding)).ok,true);assert.equal(sends().length,1);assert.equal(sends()[0].payload.subject,v.subject);assert.equal(sends()[0].payload.bodyText,v.body);});
test('missing evidence never adopts newest card',async()=>{const c=await draft();await edit(c);await replacement(c.w.id);await refused(c,await approve(c.w.id));});
test('empty and forged evidence refuse with no cards',async()=>{const c=await draft(false);for(const b of ['', 'forged', null])await refused(c,await approve(c.w.id,b));});
test('Engine board and work-item view bind the displayed draft',async()=>{const c=await draft(),v=await engine(c.w.id);assert.equal(v.draft.body,'Old $100.');assert.equal(v.draft.binding,(await viewed(c)).binding);await edit(c);await replacement(c.w.id);await refused(c,await web(c.w.id,v.draft.binding));});
for(const kind of ['project','lead'])test(`${kind} Ops binds displayed draft and refuses replacement`,async()=>{const c=await draft(true,kind),v=(await record(kind,c.slug)).items.find(i=>i.id===c.w.id);assert.equal(v.draft.subject,'Old $100');await edit(c);await replacement(c.w.id);await refused(c,await ops(c.w.id,kind,c.slug,v.draft.binding));});
test('Today/notifications/popup carry displayed binding through approveWaiting',async()=>{const c=await draft(),v=(await pending()).find(i=>i.id===c.w.id);assert.equal(v.body,'Old $100.');assert.equal(v.contentHash,(await viewed(c)).binding);await edit(c);await replacement(c.w.id);await refused(c,await waiting(v.key,v.contentHash));});
test('fresh pending approval sends displayed draft once',async()=>{const c=await draft(),v=(await pending()).find(i=>i.id===c.w.id);assert.equal((await waiting(v.key,v.contentHash)).ok,true);assert.equal(sends().length,1);assert.equal(sends()[0].payload.subject,v.subject);});
test('concurrent edit plus replacement while web waits on lock refuses',async()=>{
 const c=await draft(),v=await viewed(c),editor=await f.db.pool.connect();let action;
 try{
  await editor.query('BEGIN');await editor.query(`SELECT id FROM work_items WHERE id=$1 FOR UPDATE`,[c.w.id]);action=web(c.w.id,v.binding);
  let blocked=false;for(let i=0;i<300;i++){if((await f.run(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM work_items WHERE id=$1 FOR UPDATE%'`)).length){blocked=true;break;}await editor.query('SELECT pg_sleep(0.005)');}assert.equal(blocked,true);
  await edit(c,editor);await editor.query('COMMIT');await replacement(c.w.id);
  await refused(c,await action);
 }finally{await editor.query('ROLLBACK');editor.release();if(action)await action;}
});
test('recipient-only edit refuses displayed binding',async()=>{const c=await draft(),v=await viewed(c);await f.run(`UPDATE projects SET client_email='other@example.test' WHERE id=$1`,[c.p.id]);await refused(c,await approve(c.w.id,v.binding));});
test('replacement receipt refuses displayed binding',async()=>{const c=await draft(),v=await viewed(c);await f.run(`INSERT INTO agent_receipts(work_item_id,receipt_kind,uri,label) VALUES($1,'draft',$2,'Replacement')`,[c.w.id,`knowledge_items/${c.k.id}`]);await replacement(c.w.id);await refused(c,await approve(c.w.id,v.binding));});
for(const stale of [true,false])test(`unmapped legacy Telegram ${stale?'edited':'unchanged'} draft refuses`,async()=>{const c=await draft();if(stale){await edit(c);await replacement(c.w.id);}const text=await telegram(c,++globalThis.phoneTelegramSeq);assert.match(text,/old card.*Open Today/);assert.equal(sends().length,0);assert.equal((await f.run(`SELECT approval_status FROM work_items WHERE id=$1`,[c.w.id]))[0].approval_status,'requested');});
test('mapped Telegram without binding refuses unchanged content',async()=>{const c=await draft(),mid=++globalThis.phoneTelegramSeq;await f.run(`UPDATE owner_push_messages SET draft_binding=NULL,telegram_message_id=$2 WHERE id=$1`,[c.m.id,String(mid)]);assert.match(await telegram(c,mid),/draft has changed/);assert.equal(sends().length,0);});
test('bound Telegram dispatch freezes viewed content across post-commit edit',async()=>{
 const c=await draft(),mid=++globalThis.phoneTelegramSeq;await f.run(`UPDATE owner_push_messages SET telegram_message_id=$2 WHERE id=$1`,[c.m.id,String(mid)]);
 const pool=f.db.pool,connect=pool.connect;let edited=false;
 pool.connect=function(...args){if(args.length)return connect.apply(this,args);return connect.call(this).then(client=>{const q=client.query,release=client.release;let approved=false;client.query=function(sql,...p){const r=q.call(this,sql,...p);if(typeof sql==='string'&&sql.includes("SET approval_status='approved'"))approved=true;return sql==='COMMIT'&&approved?r.then(async r=>{await edit(c);edited=true;return r;}):r;};client.release=function(...a){client.query=q;client.release=release;return release.apply(this,a);};return client;});};
 try{await telegram(c,mid);}finally{pool.connect=connect;}
 assert.equal(edited,true);assert.equal(sends().length,1);assert.equal(sends()[0].payload.subject,'Old $100');assert.equal(sends()[0].payload.bodyText,'Old $100.');
});

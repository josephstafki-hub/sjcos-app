import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {transport} from './_harness/apns-http2.mjs';
import {setup} from './_harness/phone-r1.mjs';
import {pushClock} from './_harness/push-clock.mjs';
let f,notify,drain,sendNow,defaultTransport,clock;
before(async()=>{f=await setup();({notifyOwner:notify,runPushDrain:drain,sendOwnerPushesNow:sendNow}=await import('../lib/notify-owner.ts'));({defaultTransport}=await import('../lib/providers/telegram.ts'));clock=await pushClock(f);notify=clock.notify(notify);drain=clock.drain(drain);await f.call('POST','devices',{token:'c'.repeat(64),platform:'ios',environment:'sandbox'});});
after(async()=>{(await import('../lib/providers/apns.ts')).closeApnsSessions();await f?.db.pool.end();});
beforeEach(async()=>{process.env.SJC_OUTBOUND_DISABLED='0';process.env.APNS_API_BASE='http://apns.test';transport.response=()=>({status:200});transport.block=null;globalThis.phoneTelegramCalls=[];defaultTransport.call=async(method,body)=>{globalThis.phoneTelegramCalls.push({method,body});return {ok:true,status:200,result:{message_id:++globalThis.phoneTelegramSeq}};};await f.savePushSettings({app:true,telegram:true});await f.run(`TRUNCATE push_actions,push_device_deliveries,owner_push_messages,push_outbox RESTART IDENTITY CASCADE`);});
const awake=()=>clock.awake;
for(const failed of ['app','telegram'])test(`${failed} outage cannot erase hourly throttle accounting`,async()=>{
 if(failed==='app')transport.response=()=>({status:503});else defaultTransport.call=async()=>({ok:false,status:503});
 for(let i=0;i<6;i++)await notify({kind:'comms',title:'Outage cap '+i},awake());
 const [row]=await f.run(`SELECT count(*) FILTER(WHERE counted_at IS NOT NULL)::int AS counted,count(*) FILTER(WHERE sent_at IS NULL)::int AS pending FROM push_outbox`);assert.equal(row.counted,4);assert.equal(row.pending,6);
 if(failed==='app')assert.equal(globalThis.phoneTelegramCalls.filter(r=>r.method==='sendMessage').length,4);else assert.equal(transport.requests.filter(r=>r.payload.aps?.alert).slice(-4).length,4);
});
test('failure on one owner device does not prevent the other; retry skips successful recipients',async()=>{
 const t='d'.repeat(64);await f.call('POST','devices',{token:t,platform:'ios',environment:'sandbox'});transport.response=e=>e.headers[':path'].endsWith(t)?{status:503}:{status:200};const base=transport.requests.length;
 await notify({kind:'payment',title:'Fanout'},awake());assert.equal(transport.requests.length-base,2);const [row]=await f.run(`SELECT id FROM push_outbox`);transport.response=()=>({status:200});await sendNow([row.id],await clock.retry());assert.equal(transport.requests.length-base,3);await f.call('DELETE','devices',{token:t});
});
test('410 disables the device and test endpoint refuses success',async()=>{const token='e'.repeat(64);await f.call('POST','devices',{token,platform:'ios',environment:'sandbox'});transport.response=e=>e.headers[':path'].endsWith(token)?{status:410,reason:'Unregistered'}:{status:200};const result=await f.call('POST','test',{token});assert.equal(result.body.ok,undefined);assert.ok((await f.run(`SELECT disabled_at FROM push_devices WHERE token=$1`,[token]))[0].disabled_at);});
test('immediate delivery lease excludes overlapping drain while transport is blocked',async()=>{
 let unblock;transport.block=new Promise(r=>unblock=r);let started;const start=new Promise(r=>started=r);const first=notify({kind:'payment',title:'Blocked immediate'},awake());
 // A deterministic database checkpoint, without a timer or a second sender.
 for(let i=0;i<200;i++){if(transport.requests.some(r=>r.payload.sjc?.kind==='payment')){started();break;}await f.run('SELECT 1');}await start;
 await drain({now:awake()});unblock();await first;assert.equal((await f.run(`SELECT count(*)::int AS n FROM push_outbox WHERE title='Blocked immediate' AND sent_at IS NOT NULL`))[0].n,1);assert.equal(globalThis.phoneTelegramCalls.filter(r=>r.method==='sendMessage').length,1);
});
test('App-only answer failure is queued, reports sent=false, drains without losing answer',async()=>{
 await f.savePushSettings({app:true,telegram:false});const {m,d}=await f.decision();process.env.SJC_OUTBOUND_DISABLED='1';await f.action(m,'reply','Confirm');process.env.SJC_OUTBOUND_DISABLED='0';const [reply]=await f.run(`SELECT id FROM owner_replies WHERE decision_id=$1`,[d.id]);transport.response=()=>({status:503});const {replyToOwner}=await import('../lib/owner-reply-delivery.ts');const result=await replyToOwner({ownerReplyId:reply.id,text:'Confirmed',outcome:'done',agent:'Claude'});assert.equal(result.sent,false);assert.equal(result.queued,true);assert.equal((await f.run(`SELECT state FROM owner_replies WHERE id=$1`,[reply.id]))[0].state,'answered');assert.ok((await f.run(`SELECT id FROM push_outbox WHERE sent_at IS NULL`)).length);transport.response=()=>({status:200});await drain({now:await clock.retry()});assert.equal((await f.run(`SELECT count(*)::int AS n FROM push_outbox WHERE sent_at IS NULL`))[0].n,0);
});
test('quiet-hours parking snapshots channels and closed draft drains with no approval actions',async()=>{
 await f.savePushSettings({app:true,telegram:false});const {w}=await f.draft();await notify({kind:'decision',title:'Parked draft',telegram:{workItemId:w.id}},clock.quiet);await f.run(`UPDATE work_items SET approval_status='approved' WHERE id=$1`,[w.id]);await f.savePushSettings({app:false,telegram:true});await drain({now:awake()});const [row]=await f.run(`SELECT * FROM owner_push_messages WHERE title='Parked draft'`);assert.equal(row.state,'decided');assert.ok(!f.shapePushMessage(row).allowedActions.includes('approve'));assert.equal(globalThis.phoneTelegramCalls.length,0);
});
test('conversation delivery retries at night and never folds acknowledgments',async()=>{
 await f.savePushSettings({app:true,telegram:false});const {sendOwnerTelegram}=await import('../lib/owner-reply-delivery.ts');transport.response=()=>({status:503});await sendOwnerTelegram('Hello owner');transport.response=()=>({status:200});await drain({now:clock.night});const [r]=await f.run(`SELECT sent_at FROM push_outbox WHERE body='Hello owner'`);assert.ok(r.sent_at);
});
test('web work-item approve/failed-send reopening restores only latest card',async()=>{
 const {w,m}=await f.draft();const revised=await f.recordAppMessage({kind:'decision',title:'Revised',replyToId:m.id,telegram:{workItemId:w.id}});await f.run(`UPDATE work_items SET approval_status='approved' WHERE id=$1`,[w.id]);await f.run(`UPDATE work_items SET approval_status='requested' WHERE id=$1`,[w.id]);assert.equal((await f.call('GET',`messages/${revised.id}`)).body.message.state,'open');assert.equal((await f.call('GET',`messages/${m.id}`)).body.message.state,'decided');
});
test('elapsed hold re-alerts once through the shared gate',async()=>{const {d,m}=await f.decision();await f.action(m,'hold');await f.run(`UPDATE decisions SET held_until=now()-interval '1 second' WHERE id=$1`,[d.id]);await drain({now:awake()});await drain({now:awake()});const [row]=await f.run(`SELECT count(*)::int AS n FROM push_outbox WHERE body='The hold ended. This is waiting for your answer.'`);assert.equal(row.n,1);});
test('phone work-item decision edits the existing Telegram card',async()=>{const {w,m}=await f.draft();await f.run(`INSERT INTO telegram_reply_targets(chat_id,message_id,work_item_id,kind) VALUES($1,991234,$2,'card')`,[process.env.TELEGRAM_OWNER_CHAT_ID,w.id]);assert.equal((await f.action(m,'approve')).body.ok,true);assert.ok(globalThis.phoneTelegramCalls.some(c=>c.method==='editMessageText'&&c.body.message_id===991234&&!c.body.reply_markup));});
test('an App-only answer with no authorized receiver does not report sent',async()=>{await f.savePushSettings({app:true,telegram:false});await f.run(`UPDATE push_devices SET disabled_at=now() WHERE user_id=$1`,[f.owner.id]);const {replyToOwner}=await import('../lib/owner-reply-delivery.ts');const result=await replyToOwner({text:'No receiver test',outcome:'done',agent:'Claude'});assert.equal(result.sent,false);});

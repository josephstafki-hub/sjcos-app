// Expectations were recorded first in phone-push-r2-expectations.md.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {SignJWT} from 'jose';
import {transport} from './_harness/apns-http2.mjs';
import {setup} from './_harness/phone-r1.mjs';
import {pushClock} from './_harness/push-clock.mjs';
let f,notify,drain,push,provider,clock,awake;
before(async()=>{f=await setup();({notifyOwner:notify,runPushDrain:drain}=await import('../lib/notify-owner.ts'));push=await import('../lib/phone-push.ts');provider=await import('../lib/providers/apns.ts');clock=await pushClock(f);awake=clock.awake;notify=clock.notify(notify);drain=clock.drain(drain);});
after(async()=>{provider?.closeApnsSessions();await f?.db.pool.end();});
beforeEach(async()=>{
 process.env.SJC_OUTBOUND_DISABLED='1';transport.response=()=>({status:200});transport.block=null;
 await f.run(`TRUNCATE push_actions,push_device_deliveries,owner_push_messages,push_outbox RESTART IDENTITY CASCADE`);
 await f.run(`DELETE FROM session_revocations WHERE user_id=$1`,[f.owner.id]);
 await f.run(`DELETE FROM push_devices`);
 await f.call('POST','devices',{token:'a'.repeat(64),platform:'ios',environment:'sandbox'});
 await f.savePushSettings({app:true,telegram:false});globalThis.phoneTelegramCalls=[];
});
async function until(check){for(let i=0;i<300;i++){if(await check())return;await f.run('SELECT pg_sleep(0.005)');}throw new Error('Expected database wait was not reached');}
async function portal(){const [p]=await f.run(`INSERT INTO projects(slug,name) VALUES($1,'Oak kitchen') RETURNING slug`,[`zz-${crypto.randomUUID()}`]);return f.recordAppMessage({kind:'portal_message',title:'Tom wrote',body:'Oak?',telegram:{portalChannelKey:`portal:${p.slug}`}});}
async function overlap(kind,expired){
 const m=kind==='portal'?await portal():(await f.decision()).m;
 const table=kind==='portal'?'chat_messages':'owner_replies';
 const lock=await f.db.pool.connect();await lock.query('BEGIN');await lock.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
 if(expired){await f.run(`CREATE FUNCTION qa_expire_claim() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN NEW.lease_until=now()-interval '1 second'; RETURN NEW; END $$`);await f.run(`CREATE TRIGGER qa_expire_claim BEFORE INSERT ON push_actions FOR EACH ROW EXECUTE FUNCTION qa_expire_claim()`);}
 const id=crypto.randomUUID();let one,two,advance;
 try{
  one=f.action(m,'reply','One exact answer',id);
  await until(async()=>!!(await f.run(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE $1`,[`%${kind==='portal'?'INSERT INTO chat_messages':'INSERT INTO owner_replies'}%`])).length);
  if(!expired){advance=f.run(`UPDATE push_actions SET lease_until=now()-interval '1 second' WHERE id=$1`,[id]);await until(async()=>!!(await f.run(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'UPDATE push_actions SET lease_until=%'`)).length);}
  two=await f.action(m,'reply','One exact answer',id);assert.equal(two.status,202);
 }finally{await lock.query('COMMIT');lock.release();if(expired){await f.run(`DROP TRIGGER qa_expire_claim ON push_actions`);await f.run(`DROP FUNCTION qa_expire_claim()`);}}
 const result=await one;await advance;assert.equal(result.body.ok,true);if(kind==='portal')assert.equal((await f.call('GET',`messages/${m.id}`)).body.message.outcome,'answered');assert.deepEqual((await f.action(m,'reply','One exact answer',id)).body,result.body);
 const [n]=await f.run(`SELECT count(*)::int AS n FROM ${table} WHERE ${kind==='portal'?'channel_key=$1':'decision_id=$1'} AND body='One exact answer'`,[kind==='portal'?m.portal_channel_key:m.decision_id]);assert.equal(n.n,1);
}
test('exact judge repro: blocked portal INSERT, timestamp advance, duplicate UUID, release',()=>overlap('portal',false));
test('already expired lease cannot take over blocked portal mutation',()=>overlap('portal',true));
test('already expired lease cannot take over blocked owner-note mutation',()=>overlap('note',true));
test('terminal first result cannot be overwritten by a stale generation',async()=>{
 const {m}=await f.decision(),id=crypto.randomUUID();const result=await f.action(m,'approve',undefined,id);
 const {resolvePhoneAction}=await import('../lib/owner-actions.ts');
 await f.run(`UPDATE push_actions SET generation=2 WHERE id=$1`,[id]);
 await assert.rejects(()=>resolvePhoneAction({messageId:m.id,action:'reply',text:'stale',actionId:id,generation:1},{kind:'user',userId:f.owner.id,role:'owner',name:'Joe',permissions:[]}),/already being handled/);
 assert.deepEqual((await f.action(m,'approve',undefined,id)).body,result.body);
 assert.equal((await f.run(`SELECT count(*)::int AS n FROM owner_replies WHERE decision_id=$1`,[m.decision_id]))[0].n,0);
});
async function emailDraft(){
 const [p]=await f.run(`INSERT INTO projects(slug,name,client_email) VALUES($1,'Oak kitchen','client@example.test') RETURNING id`,[`zz-${crypto.randomUUID()}`]);
 const [w]=await f.run(`INSERT INTO work_items(title,body,project_id,approval_status,status,source_kind,created_by) VALUES('Email the quote','Quote',$1,'requested','approval_needed','agent','qa') RETURNING id`,[p.id]);
 const [k]=await f.run(`INSERT INTO knowledge_items(content,kind,source,project_id,created_by) VALUES('To: client@example.test\nSubject: Original $100 quote\n\nOriginal $100.','draft','agent',$1,'qa') RETURNING id`,[p.id]);
 await f.run(`INSERT INTO agent_receipts(work_item_id,receipt_kind,uri,label) VALUES($1,'draft',$2,'Quote')`,[w.id,`knowledge_items/${k.id}`]);
 const m=await f.recordAppMessage({kind:'decision',title:'Original $100 quote',telegram:{workItemId:w.id}});
 return {w,k,m};
}
async function revise(c){await f.run(`UPDATE work_items SET approval_status='not_requested' WHERE id=$1`,[c.w.id]);await f.run(`UPDATE knowledge_items SET content='To: client@example.test\nSubject: Revised $900 quote\n\nRevised $900.' WHERE id=$1`,[c.k.id]);await f.run(`UPDATE work_items SET approval_status='requested' WHERE id=$1`,[c.w.id]);return f.recordAppMessage({kind:'decision',title:'Revised $900 quote',replyToId:c.m.id,telegram:{workItemId:c.w.id}});}
test('park $100, pull, revise $900, resubmit, old drain refuses old and new sends once',async()=>{
 const c=await emailDraft();await notify({kind:'decision',title:'Original $100 quote',telegram:{workItemId:c.w.id}},clock.quiet);
 const current=await revise(c);await drain({now:awake});
 const [old]=await f.run(`SELECT * FROM owner_push_messages WHERE push_outbox_id IS NOT NULL AND work_item_id=$1 ORDER BY created_at DESC LIMIT 1`,[c.w.id]);
 assert.equal(old.state,'decided');assert.equal((await f.call('GET',`messages/${current.id}`)).body.message.state,'open');assert.equal((await f.action(old,'approve')).body.outcome,'stale');
 process.env.GMAIL_CLIENT_ID='qa';process.env.GMAIL_CLIENT_SECRET='qa';process.env.GMAIL_REFRESH_TOKEN='qa';
 const {fakeOutbox}=await import('../lib/providers/types.ts');const count=()=>fakeOutbox.filter(x=>x.provider==='email').length;const before=count();
 assert.equal((await f.action(current,'approve')).body.ok,true);assert.equal(count(),before+1);assert.equal((await f.action(current,'approve')).body.ok,false);assert.equal(count(),before+1);
 assert.match(JSON.stringify(fakeOutbox.filter(x=>x.provider==='email').at(-1)),/Revised \$900/);
});
for(const verb of ['decline','changes'])test(`old revision refuses ${verb} without touching new draft`,async()=>{const c=await emailDraft();await revise(c);assert.equal((await f.action(c.m,verb,verb==='changes'?'Lower price':undefined)).body.outcome,'stale');assert.equal((await f.run(`SELECT approval_status FROM work_items WHERE id=$1`,[c.w.id]))[0].approval_status,'requested');});
test('editing staged content without resubmission invalidates old card',async()=>{const c=await emailDraft();await f.run(`UPDATE knowledge_items SET content=content||' Changed' WHERE id=$1`,[c.k.id]);assert.equal((await f.action(c.m,'approve')).body.outcome,'stale');});
async function parked(channels=['app'],n=6){for(let i=0;i<n;i++)await f.run(`INSERT INTO push_outbox(kind,title,send_after,channels) VALUES('comms',$1,$2,$3)`,[`Parked ${i}`,awake,channels]);}
test('folds preserve App-only snapshots after Telegram-only settings change',async()=>{await parked();await f.savePushSettings({app:false,telegram:true});const before=provider.fakeApnsDeliveries.length;await drain({now:awake});assert.equal(provider.fakeApnsDeliveries.length-before,4);assert.equal(globalThis.phoneTelegramCalls.length,0);const [job]=await f.run(`SELECT * FROM push_outbox WHERE payload->>'isSummary'='true'`);assert.deepEqual(job.channels,['app']);assert.ok(job.sent_at);});
test('failed summary retries durably without repeating first three direct deliveries',async()=>{
 await parked();process.env.SJC_OUTBOUND_DISABLED='0';process.env.APNS_API_BASE='http://apns.test';transport.response=r=>r.payload.aps?.alert?.title.startsWith('…')?{status:503}:{status:200};const start=transport.requests.length;
 await drain({now:awake});const [job]=await f.run(`SELECT * FROM push_outbox WHERE payload->>'isSummary'='true'`);assert.equal(job.sent_at,null);assert.equal((await f.run(`SELECT count(*)::int AS n FROM push_outbox WHERE summary_id=$1`,[job.id]))[0].n,3);
 transport.response=()=>({status:200});await drain({now:await clock.retry()});assert.ok((await f.run(`SELECT sent_at FROM push_outbox WHERE id=$1`,[job.id]))[0].sent_at);assert.equal(transport.requests.length-start,5);
});
test('summary partial fanout retries failed device only',async()=>{
 await f.call('POST','devices',{token:'b'.repeat(64),platform:'ios',environment:'sandbox'});await parked();process.env.SJC_OUTBOUND_DISABLED='0';process.env.APNS_API_BASE='http://apns.test';transport.response=r=>r.payload.aps?.alert?.title.startsWith('…')&&r.headers[':path'].endsWith('b'.repeat(64))?{status:503}:{status:200};
 await drain({now:awake});const before=transport.requests.length;transport.response=()=>({status:200});await drain({now:await clock.retry()});assert.equal(transport.requests.length-before,1);
});
test('summary INSERT failure rolls back delegation and can recover next drain',async()=>{
 await parked();await f.run(`CREATE FUNCTION qa_summary_fail() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN IF NEW.payload->>'isSummary'='true' THEN RAISE EXCEPTION 'summary unavailable'; END IF; RETURN NEW; END $$`);await f.run(`CREATE TRIGGER qa_summary_fail BEFORE INSERT ON push_outbox FOR EACH ROW EXECUTE FUNCTION qa_summary_fail()`);
 try{await drain({now:awake});assert.equal((await f.run(`SELECT count(*)::int AS n FROM push_outbox WHERE sent_at IS NULL`))[0].n,3);assert.equal((await f.run(`SELECT count(*)::int AS n FROM push_outbox WHERE summary_id IS NOT NULL`))[0].n,0);}finally{await f.run(`DROP TRIGGER qa_summary_fail ON push_outbox`);await f.run(`DROP FUNCTION qa_summary_fail()`);}
 await drain({now:await clock.retry()});assert.equal((await f.run(`SELECT count(*)::int AS n FROM push_outbox WHERE sent_at IS NULL`))[0].n,0);
});
test('summary respects exhausted hourly room and waits durably',async()=>{await f.run(`INSERT INTO push_outbox(kind,title,send_after,sent_at,counted_at) VALUES('comms','Earlier',$1,$1,$1)`,[awake]);await parked();const before=provider.fakeApnsDeliveries.length;await drain({now:awake});assert.equal(provider.fakeApnsDeliveries.length-before,3);const [job]=await f.run(`SELECT * FROM push_outbox WHERE payload->>'isSummary'='true'`);assert.equal(job.sent_at,null);assert.ok(job.send_after>awake);});
test('incompatible snapshots create independent summary jobs',async()=>{await parked(['app'],6);await parked(['telegram'],3);await drain({now:awake});const jobs=await f.run(`SELECT channels FROM push_outbox WHERE payload->>'isSummary'='true' ORDER BY channels`);assert.deepEqual(jobs.map(x=>x.channels),[['app'],['telegram']]);});
async function webhookReply(card,text){
 const chat=process.env.TELEGRAM_OWNER_CHAT_ID;const mid=++globalThis.phoneTelegramSeq;const {rememberReplyTarget}=await import('../lib/decisions/owner-replies.ts');await rememberReplyTarget(async(s,p)=>(await f.db.query(s,p)).rows,{chatId:chat,messageId:mid,decisionId:card.d.id,kind:'card'});
 const {POST}=await import('../app/api/telegram/webhook/route.ts');return POST(new Request('http://local/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'test-secret'},body:JSON.stringify({update_id:++globalThis.phoneTelegramSeq,message:{message_id:++globalThis.phoneTelegramSeq,chat:{id:chat},from:{id:chat},text,reply_to_message:{message_id:mid}}})}));
}
test('actual Telegram webhook ack survives conversation-outbox INSERT failure',async()=>{
 const c=await f.decision();await f.run(`CREATE FUNCTION qa_outbox_fail() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'outbox unavailable'; END $$`);await f.run(`CREATE TRIGGER qa_outbox_fail BEFORE INSERT ON push_outbox FOR EACH ROW EXECUTE FUNCTION qa_outbox_fail()`);process.env.SJC_OUTBOUND_DISABLED='0';
 try{assert.equal((await (await webhookReply(c,'Please revise')).json()).ok,true);assert.equal((await f.run(`SELECT state FROM owner_replies WHERE decision_id=$1`,[c.d.id]))[0].state,'delivered');assert.equal(globalThis.phoneTelegramCalls.filter(x=>x.method==='sendMessage').length,1);assert.ok((await f.run(`SELECT 1 FROM telegram_reply_targets WHERE decision_id=$1 AND kind='ack'`,[c.d.id])).length);}finally{await f.run(`DROP TRIGGER qa_outbox_fail ON push_outbox`);await f.run(`DROP FUNCTION qa_outbox_fail()`);}
});
test('uncertain Telegram delivery never falls back to a second transport call',async()=>{
 await f.savePushSettings({app:false,telegram:true});process.env.SJC_OUTBOUND_DISABLED='0';const {defaultTransport}=await import('../lib/providers/telegram.ts');const original=defaultTransport.call;let calls=0;defaultTransport.call=async()=>{calls++;throw new Error('uncertain');};
 try{const {sendOwnerTelegram}=await import('../lib/owner-reply-delivery.ts');await sendOwnerTelegram('One ack',{legacyFallback:true});assert.equal(calls,1);}finally{defaultTransport.call=original;}
});
async function shortSession(exp){return new SignJWT({userId:f.owner.id,role:'owner',authAt:Math.floor(Date.now()/1000)}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime(exp).sign(new TextEncoder().encode(process.env.SESSION_SECRET??'dev-insecure-secret-change-me'));}
test('offline logout across real JWT expiry receives no more alerts and keeps cleanup retryable',async()=>{
 const token='c'.repeat(64),bearer=await shortSession(Math.floor(Date.now()/1000)+1);assert.equal((await f.call('POST','devices',{token,platform:'ios',environment:'sandbox'},bearer)).status,200);
 await until(async()=>Date.now()/1000>=(await import('jose')).decodeJwt(bearer).exp);
 const result=await f.call('DELETE','devices',{token},bearer);assert.equal(result.status,401);assert.equal(result.body.code,'session_expired_or_invalid');assert.equal(result.body.deliveryStopped,false);assert.equal(result.body.retryable,true);
 const before=provider.fakeApnsDeliveries.length;await assert.rejects(()=>push.sendAppPayload({}, {token}),/Register this phone/);
 assert.equal(provider.fakeApnsDeliveries.length,before);
});
test('foreground expiry stops untargeted fanout; registering again renews expiry',async()=>{
 await f.run(`UPDATE push_devices SET session_expires_at=now()-interval '1 second'`);const before=provider.fakeApnsDeliveries.length;await push.sendAppPayload({});assert.equal(provider.fakeApnsDeliveries.length,before);
 await f.call('POST','devices',{token:'a'.repeat(64),platform:'ios',environment:'sandbox'});await push.sendAppPayload({});assert.equal(provider.fakeApnsDeliveries.length,before+1);
});
test('new account cannot inherit an expired previous account registration',async()=>{const [other]=await f.run(`INSERT INTO users(email,password_hash,name,role,initials) VALUES($1,'x','Other owner','owner','OO') RETURNING id`,[`zz-${crypto.randomUUID()}@example.test`]);const {encrypt}=await import('../lib/session.ts');await f.run(`UPDATE push_devices SET session_expires_at=now()-interval '1 second'`);assert.equal((await f.call('POST','devices',{token:'a'.repeat(64),platform:'ios',environment:'sandbox'},await encrypt({userId:other.id,role:'owner'}))).status,409);});
for(const title of ['…and 3 more waiting in the app','Approved. Email sent.'])test(`title-only payload is useful: ${title}`,()=>{const p=provider.buildPushPayload({id:crypto.randomUUID(),kind:'ack',title,thread_key:'qa',category:'SJC_INFO',sends:false},0);assert.equal(p.aps.alert.title,title);});
test('financial titles name the job; portal app text excludes Telegram-only hints',async()=>{const [p]=await f.run(`INSERT INTO projects(slug,name) VALUES($1,'Oak kitchen') RETURNING slug`,[`zz-${crypto.randomUUID()}`]);for(const kind of ['payment','contract_signed']){const m=await f.recordAppMessage({kind,title:kind==='payment'?'Payment received':'Contract signed',href:`/projects/${p.slug}`});assert.match(m.title,/Oak kitchen/);assert.ok(!provider.buildPushPayload(m,0).aps.alert.body.includes('https://'));}const m=await f.recordAppMessage({kind:'portal_message',title:'Tom wrote',body:'Oak?\n\nReply to this message to answer Tom in the portal.'});assert.equal(m.body,'Oak?');});
test('app grant text drops bookkeeping, duplicate recipients and boilerplate; Telegram unchanged',async()=>{
 const {cardText}=await import('../lib/decisions/cards.ts');const d={id:crypto.randomUUID(),title:'Send the plan',summary:{recipients:[{name:'Laurel',address:'laurel@example.test'}],inclusions:['To: laurel@example.test; Subject: Plan'],grantId:crypto.randomUUID(),assumptions:["Agent's reason: Confirm layout"],effect:'Approving does it now: Sends the email. Nothing else is needed from the agent.'},status:'pending',expires_at:'2026-11-12T18:49:00Z'};
 const app=cardText(d,{app:true}),telegram=cardText(d);assert.doesNotMatch(app,/Grant id|Includes: To:|Agent's reason:|Approving does it now|Nothing else|2026-11-12/);assert.match(app,/Why: Confirm layout/);assert.match(app,/Central/);assert.match(telegram,/Grant id:|Includes: To:/);
});
test('decision app outcomes are status-first, without status bookkeeping in body',async()=>{const {d,m}=await f.decision();await f.run(`UPDATE decisions SET status='approved',decision_note='Email sent' WHERE id=$1`,[d.id]);const r=await f.call('GET',`messages/${m.id}`);assert.match(r.body.message.outcome,/^approved — Email sent/);const {cardText}=await import('../lib/decisions/cards.ts');assert.doesNotMatch(cardText({...d,status:'rejected',decided_via:'app'},{app:true}),/Status:/);});
test('owner, agent and system authors survive feed/detail shape',async()=>{const {d,m}=await f.decision();await f.action(m,'changes','Use oak');const [r]=await f.run(`SELECT id FROM owner_replies WHERE decision_id=$1`,[d.id]);const {replyToOwner}=await import('../lib/owner-reply-delivery.ts');await replyToOwner({ownerReplyId:r.id,text:'Which oak?',agent:'claude',outcome:'question'});const detail=await f.call('GET',`messages/${m.id}`);assert.ok(detail.body.thread.some(x=>x.from==='owner'));assert.ok(detail.body.thread.some(x=>x.from==='system'&&/Your note/.test(x.title)));assert.ok(detail.body.thread.some(x=>x.from==='agent'&&x.agentName==='Claude'&&x.title==='Claude has a question'&&x.body==='Which oak?'));});
test('stale draft nudge includes preview and sends category, decision/grant send categories are additive',async()=>{
 const c=await emailDraft();await f.run(`ALTER TABLE work_items DISABLE TRIGGER trg_work_items_updated_at`);try{await f.run(`UPDATE work_items SET updated_at=$2::timestamptz-interval '5 hours' WHERE id=$1`,[c.w.id,awake]);}finally{await f.run(`ALTER TABLE work_items ENABLE TRIGGER trg_work_items_updated_at`);}await drain({now:awake});const [nudge]=await f.run(`SELECT * FROM owner_push_messages WHERE work_item_id=$1 AND kind='stale_approval'`,[c.w.id]);assert.ok(nudge);assert.match(nudge.body,/Original \$100/);assert.match(nudge.body,/Approve sends this email now/);assert.equal(nudge.category,'SJC_DRAFT_SEND');for(const kind of ['decision','grant'])assert.equal(provider.categoryFor({kind,decision_id:crypto.randomUUID(),sends:true}),kind==='decision'?'SJC_DECISION_SEND':'SJC_GRANT_SEND');
});

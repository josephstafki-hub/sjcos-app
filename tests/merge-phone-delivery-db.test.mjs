import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './_harness/phone-r1.mjs';
const secret='MERGE_PRIVATE_PHONE_DELIVERY_d938';
test('real phone history, APNs, Telegram, outbox and notification boundaries redact private sources',async()=>{
 const h=await setup();
 try{
  await h.run('UPDATE ask_canvas_maintenance SET recovery_ready=true');
  const [c]=await h.run(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude',$1,$2) RETURNING id`,[secret,h.owner.id]);
  const [r]=await h.run(`INSERT INTO owner_replies(body,route,conversation_id) VALUES($1,'session',$2) RETURNING id`,[secret,c.id]);
  const [device]=await h.run(`INSERT INTO push_devices(user_id,token,platform,environment,session_auth_at,session_expires_at) VALUES($1,$2,'ios','sandbox',now(),now()+interval '1 day') RETURNING *`,[h.owner.id,'d'.repeat(64)]);
  const m=await h.recordAppMessage({kind:'reply',title:secret,body:secret,telegram:{ownerReplyId:r.id,appText:{title:secret,body:secret}}});
  assert.equal(m.ask_reply_erased,true);assert.ok(!JSON.stringify(m).includes(secret));
  const child=await h.recordAppMessage({kind:'ack',title:secret,body:secret,replyToId:m.id});assert.ok(!JSON.stringify(child).includes(secret));
  await h.deliverAppMessage({...m,title:secret,body:secret},device.token);
  const {fakeApnsDeliveries}=await import('../lib/providers/apns.ts');assert.ok(fakeApnsDeliveries.length);assert.ok(!JSON.stringify(fakeApnsDeliveries).includes(secret));
  const {sendOwnerTelegram}=await import('../lib/owner-reply-delivery.ts');
  await sendOwnerTelegram(secret,{ownerReplyId:r.id,appText:{title:secret,body:secret}});
  const notify=await import('../lib/notify-owner.ts');
  await notify.notifyOwner({kind:'reply',title:secret,body:secret,telegram:{ownerReplyId:r.id},emit:{title:secret,subline:secret}},new Date('2026-11-06T18:00:00Z'));
  for(const table of ['owner_push_messages','push_outbox','notifications'])assert.ok(!JSON.stringify(await h.run(`SELECT * FROM ${table}`)).includes(secret),table);
  assert.ok(!JSON.stringify(globalThis.phoneTelegramCalls??[]).includes(secret));
  const action=await h.action(m,'reply',secret);assert.equal(action.body.code,'THREAD_UNAVAILABLE');assert.equal((await h.run('SELECT * FROM push_actions')).length,0);
  const business=await h.recordAppMessage({kind:'ack',title:'Shared business',body:'Keep this business answer'});assert.equal(business.body,'Keep this business answer');
 }finally{await h.db.pool.end();}
});

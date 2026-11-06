// Expectations: private phone history/outbox/action copies are fixed status,
// immutable after purge and safe under actual narrow logins and stale delivery.
// Main's live-shaped migration order must coexist with earlier Phase 0/Canvas.
import test from 'node:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import {withMigrationSubset,withSessionIdentity} from './_harness/testdb.mjs';
import {listMigrationFiles,migrate} from '../db/migrate.mjs';
import {randomUUID} from 'node:crypto';
const secret='MERGE_PRIVATE_ASK_TITLE_ANSWER_FILE_6c88';
test('main-first live-shaped ledger accepts Phase 0/Canvas, and private phone copies are erased',async()=>withMigrationSubset('merge_phone',[100,105,106,107,108,109],async({url,db,apply})=>{
 const files=listMigrationFiles();assert.equal(new Set(files.map(f=>f.id)).size,files.length);
 await apply([110,111]); // Real ledger, before pending 0100/0105–0109.
 const u=(await db.query(`INSERT INTO users(email,name,role,password_hash,initials) VALUES($1,'Owner','owner','x','O') RETURNING id`,[randomUUID()+'@example.test'])).rows[0].id;
 const c=(await db.query(`INSERT INTO ai_conversations(agent,title) VALUES('claude',$1) RETURNING id`,[secret])).rows[0].id;
 const d=(await db.query(`INSERT INTO decisions(kind,title,action) VALUES('grant','Business','send_email') RETURNING id`)).rows[0].id;
 const r=(await db.query(`INSERT INTO owner_replies(decision_id,body,route,conversation_id) VALUES($1,$2,'session',$3) RETURNING id`,[d,secret,c])).rows[0].id;
 const root=(await db.query(`INSERT INTO owner_push_messages(kind,title,body,owner_reply_id,thread_key,category,state) VALUES('reply',$1,$1,$2,$1,'SJC_REPLY','info') RETURNING id`,[secret,r])).rows[0].id;
 const child=(await db.query(`INSERT INTO owner_push_messages(kind,title,body,reply_to_id,thread_key,category,state) VALUES('ack',$1,$1,$2,$1,'SJC_REPLY','info') RETURNING id`,[secret,root])).rows[0].id;
 await db.query(`INSERT INTO push_actions(id,message_id,user_id,action,text,evidence,result) VALUES($1,$2,$3,'reply',$4,$5,$5)`,[randomUUID(),child,u,secret,JSON.stringify({body:secret})]);
 await db.query(`INSERT INTO push_outbox(kind,title,body,payload,send_after) VALUES('reply',$1,$1,$2,now())`,[secret,JSON.stringify({existingMessageId:child,ownerReplyId:r,appText:{title:secret,body:secret}})]);
 await db.query(`UPDATE push_outbox SET conversation_key=$1`,['historical-private-text-digest']);
 const [part]=(await db.query(`SELECT id FROM push_outbox ORDER BY id LIMIT 1`)).rows;
 const [summary]=(await db.query(`INSERT INTO push_outbox(kind,title,body,send_after) VALUES('urgent_item',$1,$1,now()) RETURNING id`,[secret])).rows;
 await db.query(`UPDATE push_outbox SET summary_id=$2 WHERE id=$1`,[part.id,summary.id]);
 await db.query(`INSERT INTO owner_push_messages(kind,title,body,push_outbox_id,thread_key,category,state) VALUES('ack',$1,$1,$2,'old-summary','SJC_INFO','info')`,[secret,summary.id]);
 await migrate({url,quiet:true});
 assert.equal((await db.query('SELECT count(*)::int AS n FROM push_outbox WHERE ask_reply_erased AND conversation_key IS NOT NULL')).rows[0].n,0);
 assert.deepEqual((await migrate({url,quiet:true,status:true})).pending,[]);
 const clean=async (client,narrow=false)=>{for(const table of ['owner_push_messages','push_actions','push_outbox']){if(narrow&&table==='push_actions'){await assert.rejects(client.query(`SELECT * FROM ${table}`),e=>e.code==='42501');continue;}assert.ok(!JSON.stringify((await client.query(`SELECT * FROM ${table}`)).rows).includes(secret),table);}};
 await clean(db);
 for(const role of ['sjcos_agent','sjcos_worker','sjcos_readonly'])await withSessionIdentity(url,role,async client=>{
  assert.equal((await client.query(`SELECT * FROM owner_replies`)).rowCount,0);await clean(client,true);
  await assert.rejects(client.query('SELECT erase_ask_phone_copies()'),e=>e.code==='42501');
  if(role!=='sjcos_readonly'){
   await client.query(`UPDATE owner_push_messages SET ask_reply_erased=false,title=$2,body=$2,outcome=$2 WHERE id=$1`,[root,secret]);await clean(client,true);
   await client.query(`INSERT INTO owner_push_messages(kind,title,body,reply_to_id,thread_key,category,state) VALUES('reply',$1,$1,$2,$1,'SJC_REPLY','info')`,[secret,child]);await clean(client,true);
  }
 });
 // Exercise the actual legacy fallback with a failing history dependency.
 const sent=[],exports={};let dbDown=false;
 const deps={'./phone-push':{recordAppMessage:async()=>{throw Error('history unavailable');}},'./notify-owner':{},
  '@/lib/db':{queryOne:async(sql,args)=>{if(dbDown)throw Error('classification unavailable');return (await db.query(sql,args)).rows[0];}},
  '@/lib/providers/types':{outboundDisabled:()=>false},'@/lib/providers/telegram':{defaultTransport:{configured:()=>true,call:async(_method,payload)=>{sent.push(payload);return {ok:true,result:{message_id:99}};}}}};
 runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/owner-reply-delivery.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports,process,console,require:s=>deps[s]??{}});
 const priorChat=process.env.TELEGRAM_OWNER_CHAT_ID;process.env.TELEGRAM_OWNER_CHAT_ID='fixture';
 try{
  assert.equal(await exports.sendOwnerTelegram(secret,{ownerReplyId:r,legacyFallback:true}),null);assert.equal(sent.length,0);
  assert.equal(await exports.sendOwnerTelegram('Business status',{legacyFallback:true}),99);assert.equal(sent.length,1);
  dbDown=true;await assert.rejects(exports.sendOwnerTelegram(secret,{ownerReplyId:r,legacyFallback:true}),/classification unavailable/);assert.equal(sent.length,1);
 }finally{if(priorChat===undefined)delete process.env.TELEGRAM_OWNER_CHAT_ID;else process.env.TELEGRAM_OWNER_CHAT_ID=priorChat;}
 await withSessionIdentity(url,'sjcos_test_website',async client=>{
  await client.query('SELECT erase_ask_reply_copies($1)',[c]);await client.query('SELECT erase_ask_reply_copies($1)',[c]);await clean(client);
  const business=(await client.query(`INSERT INTO owner_push_messages(kind,title,body,thread_key,category,state) VALUES('reply','Shared business','Business body','business','SJC_REPLY','info') RETURNING *`)).rows[0];assert.equal(business.body,'Business body');assert.equal(business.ask_reply_erased,false);
 });
}));

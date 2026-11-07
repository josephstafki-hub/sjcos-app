import test from 'node:test';
import assert from 'node:assert/strict';
import {withTestDb,withLogin,assertNotProduction} from './_harness/testdb.mjs';
import {phase1Fixture,hash} from './browser-schema-fixtures.mjs';
import {browserRunEnd,browserAuthorize,browserCommandBegin} from '../lib/browser/repository.mjs';
import {appendBrowserMessage,filterModelHistory,assertOrdinaryConversation} from '../lib/browser/model-history.mjs';
for(const disposition of ['waiting','completed','crashed'])test('turn '+disposition+' revokes old capability and preserves immutable run',()=>withTestDb(async(url,db)=>{
 assertNotProduction(url);await phase1Fixture(url,db,async({c,task,run,thread,boot})=>{
  const old=(await c.query('SELECT * FROM browser_task_runs WHERE run_id=$1',[run])).rows[0];
  await withLogin(url,'sjcos_browser',async service=>{
   await browserAuthorize(service,{tid:task.id,rid:run,k:hash});
   await browserRunEnd(service,{tid:task.id,rid:run,disposition,boot});
   await assert.rejects(browserAuthorize(service,{tid:task.id,rid:run,k:hash}));
   await assert.rejects(browserCommandBegin(service,{tid:task.id,rid:run,k:hash,i:crypto.randomUUID(),epoch:0,seq:1,op:'prepare',d:hash}));
  });
  const after=(await c.query('SELECT * FROM browser_task_runs WHERE run_id=$1',[run])).rows[0];assert.equal(after.task_id,old.task_id);assert.equal(after.conversation_id,thread);assert.ok(after.ended_at);assert.ok(after.capability_revoked_at);
 });
}));
test('browser messages and attachments never cross the ordinary context or provider session boundary',()=>withTestDb(async(url,db)=>phase1Fixture(url,db,async({c,task,thread,run})=>{
 const row=await appendBrowserMessage(c,{conversationId:thread,taskId:task.id,runId:run,role:'assistant',body:'UNTRUSTED_PAGE_CANARY'});
 const messages=(await c.query('SELECT * FROM ai_messages WHERE conversation_id=$1',[thread])).rows;
 assert.deepEqual(filterModelHistory(messages),[]);assert.equal(filterModelHistory(messages,{profile:'browser',taskId:task.id}).length,1);
 await assert.rejects(assertOrdinaryConversation(c,thread),/BROWSER_NEW_CONVERSATION_REQUIRED/);
 await assert.rejects(c.query("UPDATE ai_messages SET trust_profile='ordinary',browser_task_id=NULL WHERE id=$1",[row.id]));
})));
test('narrow agent cannot label browser history ordinary or forge provenance',()=>withTestDb(async(url,db)=>phase1Fixture(url,db,async({task,thread,run})=>{
 await withLogin(url,'sjcos_agent',async c=>{
  await assert.rejects(c.query("INSERT INTO ai_messages(conversation_id,run_id,role,body) VALUES($1,$2,'assistant','tainted')",[thread,run]));
  await assert.rejects(appendBrowserMessage(c,{conversationId:thread,taskId:task.id,runId:run,role:'user',body:'forged'}));
 });
})));

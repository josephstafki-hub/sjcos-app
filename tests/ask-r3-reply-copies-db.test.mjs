// Expectations first: session replies remain person-private in owner_replies.
// No automatic copy may reach shared card/event/error/trigger/work-item fields.
// Historical copies (including truncated notes and hook fan-out) are scrubbed
// by 0105, and replay scrubs again before destroying the source body. Raw actual
// narrow logins may still read business metadata, never the private sentinel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {withMigrationSubset,withSessionIdentity} from './_harness/testdb.mjs';
const require=createRequire(import.meta.url),sentinel='R3_PRIVATE_TELEGRAM_91c2';
function load(file,deps={}){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports,process,Buffer,console,URL,require:s=>Object.hasOwn(deps,s)?deps[s]:s.startsWith('node:')?require(s):{}});return exports;}
const principal=load('lib/commands/principal.ts');
test('historical, recording and replay private reply copy boundaries',async t=>withMigrationSubset('r3_copies',[100,105],async({url,db,apply})=>{
 await apply([100]);
 const person=(await db.query(`INSERT INTO users(email,name,role,password_hash,initials) VALUES($1,'Owner','owner','x','O') RETURNING id`,[randomUUID()+'@example.test'])).rows[0].id;
 const thread=(await db.query(`INSERT INTO ai_conversations(agent,title) VALUES('claude','Private title') RETURNING id`)).rows[0].id;
 const decision=(await db.query(`INSERT INTO decisions(kind,title,action,status,decision_note) VALUES('grant','Business card','send_email','pending',$1) RETURNING id`,[sentinel])).rows[0].id;
 const work=(await db.query(`INSERT INTO work_items(title,status,approval_status,blocked_reason) VALUES('Business draft','approval_needed','requested',$1) RETURNING id`,['Joe asked for changes on Telegram: '+sentinel])).rows[0].id;
 const grant=(await db.query(`INSERT INTO owner_grants(actions,reason,expires_at,conversation_id,decision_id) VALUES(ARRAY['send_email'],'Business grant',now()+interval '1 hour',$1,$2) RETURNING id`,[thread,decision])).rows[0].id;
 await db.query(`INSERT INTO owner_replies(decision_id,grant_id,body,route,conversation_id) VALUES($1,$2,$3,'session',$4)`,[decision,grant,sentinel,thread]);
 await db.query(`INSERT INTO owner_replies(work_item_id,body,route,conversation_id) VALUES($1,$2,'session',$3)`,[work,sentinel,thread]);
 await db.query(`INSERT INTO decision_events(decision_id,kind,actor,detail) VALUES($1,'changes_requested','owner',$2)`,[decision,JSON.stringify({note:sentinel})]);
 const intent=(await db.query(`INSERT INTO action_intents(operation_key,kind,target_kind,target_id,payload,payload_hash,decision_id,grant_id,state,last_error) VALUES($1,'send_email','email_draft','fixture','{}','hash',$2,$3,'held',$4) RETURNING id`,[randomUUID(),decision,grant,sentinel])).rows[0].id;
 const trigger=(await db.query(`INSERT INTO agent_triggers(kind,ref,enqueued_by,payload) VALUES('approval',$1,'hook:decision',$2) RETURNING id`,[`decision:${decision}:rejected`,JSON.stringify({decision_id:decision,note:sentinel})])).rows[0].id;
 const legacyRun=(await db.query(`INSERT INTO dev_agent_runs(prompt,answer,profile,launch_source) VALUES($1,$1,'business','background') RETURNING id`,[sentinel])).rows[0].id;
 await db.query(`INSERT INTO agent_executions(trigger_id,trigger_kind,trigger_ref,result_summary,tool_trace,dev_agent_run_id) VALUES($1,'approval',$2,$3,$4,$5)`,[trigger,`decision:${decision}:rejected`,sentinel,JSON.stringify([{result:sentinel}]),legacyRun]);
 await db.query(`INSERT INTO agent_executions(trigger_ref,result_summary) VALUES($1,$2)`,[`decision:${decision}:rejected`,sentinel]);
 await apply();
 const assertScrubbed=async c=>{
  for(const table of ['decisions','decision_events','action_intents','work_items','agent_triggers','agent_executions','dev_agent_runs'])assert.ok(!JSON.stringify((await c.query(`SELECT * FROM ${table}`)).rows).includes(sentinel),table);
 };
 await t.test('0105 removes historical copies and hook execution fan-out; keeps shared business metadata',async()=>{
  await assertScrubbed(db);
  await assert.rejects(db.query('UPDATE agent_executions SET result_summary=$2 WHERE trigger_id=$1',[trigger,sentinel]),e=>e.code==='42501');
  assert.equal((await db.query('SELECT body FROM owner_replies LIMIT 1')).rows[0].body,sentinel);
  for(const login of ['sjcos_agent','sjcos_worker','sjcos_readonly'])await withSessionIdentity(url,login,async c=>{await c.query(`SELECT set_config('sjcos.ask_actor',$1,false)`,[person]);await assertScrubbed(c);assert.equal((await c.query('SELECT body FROM owner_replies')).rowCount,0);if(login==='sjcos_worker')await assert.rejects(c.query('UPDATE dev_agent_runs SET answer=$2 WHERE id=$1',[legacyRun,sentinel]),e=>e.code==='42501');if(login==='sjcos_agent')await assert.rejects(c.query('INSERT INTO agent_executions(trigger_id,result_summary) VALUES($1,$2)',[trigger,sentinel]),e=>e.code==='42501');assert.equal((await c.query('SELECT title FROM decisions WHERE id=$1',[decision])).rows[0].title,'Business card');});
 });
 await withSessionIdentity(url,'sjcos_test_website',async c=>{
  const run=async(sql,args)=>(await c.query(sql,args)).rows;
  await c.query('UPDATE ask_canvas_maintenance SET recovery_ready=true');
  const commands=load('lib/commands/decisions.ts',{'./principal.ts':principal,'./core.ts':load('lib/commands/core.ts')});
  const hooks=load('lib/agent-runtime/hooks.ts',{'./triggers.ts':{enqueueAgentTrigger:async(_run,input)=>{await run(`INSERT INTO agent_triggers(kind,ref,enqueued_by,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[input.kind,input.ref,input.enqueuedBy,JSON.stringify(input.payload)]);return {trigger:{id:randomUUID()}};}}});
  const resolve=load('lib/decisions/resolve.ts',{'../commands/decisions.ts':commands,'../commands/principal.ts':principal,'./grants.ts':{settleGrantFromDecision:async()=>grant},'../agent-runtime/hooks.ts':hooks});
  const replies=load('lib/decisions/owner-replies.ts',{'../commands/principal.ts':principal,'./resolve.ts':resolve});
  const input={principal:{kind:'user',userId:person,role:'owner',name:'Owner',permissions:[]},text:sentinel,chatId:'fixture',messageId:10};
  await t.test('actual recordOwnerReply/resolveDecision cancel intent without publishing private note',async()=>{
   const result=await replies.recordOwnerReply(run,{...input,decisionId:decision});assert.equal(result.route,'session');assert.equal(result.pulled,true);
   await assertScrubbed(c);assert.equal((await c.query('SELECT state FROM action_intents WHERE id=$1',[intent])).rows[0].state,'cancelled');
   assert.equal((await c.query('SELECT body FROM owner_replies WHERE id=$1',[result.id])).rows[0].body,sentinel);
  });
  await c.query(`INSERT INTO agent_receipts(work_item_id,receipt_kind,label,metadata) VALUES($1,'draft','Business draft',$2)`,[work,JSON.stringify({conversation_id:thread})]);
  await t.test('actual staged draft reply pulls approval without copying private text to blocked_reason',async()=>{
   const result=await replies.recordOwnerReply(run,{...input,workItemId:work,messageId:11});assert.equal(result.route,'session');assert.equal(result.pulled,true);await assertScrubbed(c);
  });
  await t.test('replay erasure helper is website-only and idempotently scrubs reintroduced legacy copies',async()=>{
   await c.query('UPDATE decisions SET decision_note=$2 WHERE id=$1',[decision,sentinel]);
   await c.query('SELECT erase_ask_reply_copies($1)',[thread]);await c.query('SELECT erase_ask_reply_copies($1)',[thread]);await assertScrubbed(c);
   for(const login of ['sjcos_agent','sjcos_worker','sjcos_readonly'])await withSessionIdentity(url,login,async n=>{await assert.rejects(n.query('SELECT erase_ask_reply_copies($1)',[thread]),e=>e.code==='42501');});
  });
 });
}));

// Run-linked automatic copies need SQL enforcement too, not just a guarded UI.
test('runtime copies have FORCE RLS, immutable source, real-login denial and own-person positive control',async()=>withMigrationSubset('r3_runtime',[100,105],async({url,db,apply})=>{
 await apply();
 const people=[];for(const role of ['owner','staff'])people.push((await db.query(`INSERT INTO users(email,name,role,permissions,password_hash,initials) VALUES($1,'Person',$2,ARRAY['ai'],'x','P') RETURNING id`,[randomUUID()+'@example.test',role])).rows[0].id);
 const thread=(await db.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','Private',$1) RETURNING id`,[people[0]])).rows[0].id;
 await withSessionIdentity(url,'sjcos_test_website',async c=>{
  await c.query('UPDATE ask_canvas_maintenance SET recovery_ready=true');
  const run=(await c.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source) VALUES('private','operator',$1,$2,'panel_web') RETURNING id`,[people[0],thread])).rows[0].id;
  const task=(await c.query(`INSERT INTO orchestration_tasks(conversation_id,task_prompt) VALUES($1,$2) RETURNING id`,[thread,sentinel])).rows[0].id;
  await c.query(`INSERT INTO orchestration_events(task_id,actor,kind,run_id,note) VALUES($1,'claude','answered',$2,$3)`,[task,run,sentinel]);
  await c.query(`INSERT INTO run_effects(run_id,entity_kind,detail) VALUES($1,'private',$2)`,[run,JSON.stringify({name:sentinel})]);
  await c.query(`INSERT INTO agent_pending_actions(run_id,conversation_id,kind,payload) VALUES($1,$2,'private',$3)`,[run,thread,JSON.stringify({prompt:sentinel})]);
  const execution=(await c.query(`INSERT INTO agent_executions(dev_agent_run_id,tool_trace,result_summary) VALUES($1,$2,$3) RETURNING id`,[run,JSON.stringify([{result:sentinel}]),sentinel])).rows[0].id;
  const tables=['run_effects','agent_pending_actions','orchestration_tasks','orchestration_events','agent_executions'];
  for(const login of ['sjcos_agent','sjcos_worker','sjcos_readonly'])await withSessionIdentity(url,login,async n=>{
   await n.query(`SELECT set_config('sjcos.ask_actor',$1,false)`,[people[0]]);
   for(const table of tables)assert.equal((await n.query(`SELECT * FROM ${table}`)).rowCount,0,login+' '+table);
  });
  await c.query(`SELECT set_config('sjcos.ask_actor',$1,false)`,[people[1]]);
  for(const table of tables)assert.equal((await c.query(`SELECT * FROM ${table}`)).rowCount,0,'foreign website '+table);
  await c.query(`SELECT set_config('sjcos.ask_actor',$1,false)`,[people[0]]);
  for(const table of tables)assert.ok(JSON.stringify((await c.query(`SELECT * FROM ${table}`)).rows).includes(sentinel),'own '+table);
  await assert.rejects(c.query('UPDATE agent_executions SET dev_agent_run_id=NULL WHERE id=$1',[execution]),e=>e.code==='42501');
  await c.query(`SELECT set_config('sjcos.ask_actor','',false)`);
  const executions=load('lib/agent-runtime/executions.ts');
  const businessRun=async(sql,args)=>(await c.query(sql,args)).rows;
  assert.equal(await executions.getExecution(businessRun,execution),null,'shared history cannot use the trusted raw website path to read private execution');
  assert.equal((await executions.listExecutions(businessRun)).length,0);
  const background=(await c.query(`INSERT INTO dev_agent_runs(prompt,profile,launch_source) VALUES('Business','business','background') RETURNING id`)).rows[0].id;
  const shared=(await c.query(`INSERT INTO agent_executions(dev_agent_run_id,result_summary) VALUES($1,'Business result') RETURNING id`,[background])).rows[0].id;
  assert.equal((await executions.listExecutions(businessRun)).length,1);
  await withSessionIdentity(url,'sjcos_worker',async n=>{
   assert.equal((await n.query('UPDATE agent_executions SET result_summary=$2 WHERE id=$1',[execution,'tampered'])).rowCount,0);
   assert.equal((await n.query('UPDATE agent_executions SET result_summary=$2 WHERE id=$1',[shared,'Business updated'])).rowCount,1);
   await assert.rejects(n.query('UPDATE agent_executions SET dev_agent_run_id=$2 WHERE id=$1',[shared,run]),e=>e.code==='42501');
  });
  // A tombstone scrub erases runtime contents before the source disappears.
  await c.query('SELECT erase_ask_reply_copies($1)',[thread]);
  for(const table of tables)assert.ok(!JSON.stringify((await c.query(`SELECT * FROM ${table}`)).rows).includes(sentinel),'erased '+table);
 });
}));

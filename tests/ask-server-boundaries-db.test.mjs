// R5 expectation: real health diagnosis and isolated, explicitly bootstrapped
// deployment identity; retain the original status/deletion/recovery matrix.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {withMigrationSubset,withSessionIdentity} from './_harness/testdb.mjs';
import * as journal from '../lib/ask-thread-journal.mjs';
import * as health from '../lib/ask-health.mjs';
import {bootstrapDeployment} from '../lib/ask-deployment-state.mjs';
import {makeIntent,readLocal,appendLocal,withLedgerLock,validateChain} from '../lib/canvas-deletion-ledger.mjs';
const require=createRequire(import.meta.url);
// Controlled request/provider seams, actual caller implementations and SQL.
function load(file,deps={}){
 const exports={};const source=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 runInNewContext(source,{exports,process,Buffer,console,URL,Request,Response,FormData,File,setTimeout,clearTimeout,require:s=>s==='@/lib/ask-health.mjs'?health:s==='@/lib/ask-result-codes'?load('lib/ask-result-codes.ts',{}):Object.hasOwn(deps,s)?deps[s]:s.startsWith('node:')?require(s):{}});return exports;
}
const plain=x=>JSON.parse(JSON.stringify(x));
test('A1 real callers: virgin availability, typed closed boundaries, self-only mutations and durable delete retry',async t=>withMigrationSubset('server_boundaries',[100,105],async({url,db,apply})=>{
 await apply();
 const root=await mkdtemp(path.join(tmpdir(),'p0fix-boundary-')),dir=path.join(root,'journal');const saved={...process.env};
 delete process.env.SJC_ASK_THREAD_DELETE_ACCEPTED;delete process.env.SJC_CANVAS_AUTHORITY_URL;process.env.SJC_CANVAS_DELETION_LEDGER_DIR=dir;
 try{
 process.env.SJC_ASK_DEPLOYMENT_STATE_DIR=path.join(root,'deployment');
 await bootstrapDeployment(process.env.SJC_ASK_DEPLOYMENT_STATE_DIR);
 const people=[];for(const role of ['owner','staff','staff'])people.push((await db.query(`INSERT INTO users(email,name,role,permissions,password_hash,initials) VALUES($1,'Caller',$2,ARRAY['ai'],'x','C') RETURNING id`,[randomUUID()+'@example.test',role])).rows[0].id);
 const ids=[];for(const person of people)ids.push((await db.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','secret other title',$1) RETURNING id`,[person])).rows[0].id);
 await withSessionIdentity(url,'sjcos_test_website',async c=>{
  const pool={query:(...a)=>c.query(...a),connect:async()=>({query:(...a)=>c.query(...a),release(){}})};
  let session={userId:people[1],authAt:Math.floor(Date.now()/1000)},options;
  const access=load('lib/thread-access.ts',{'@/lib/db':{pool},'@/lib/session':{readSession:async()=>session},'@/lib/ask-thread-journal.mjs':{...journal,withAskJournal:(p,fn)=>journal.withAskJournal(p,fn,options),deleteThread:(p,id,op,_opts,principal)=>journal.deleteThread(p,id,op,options,principal)}});
  const guards={'@/lib/thread-access':access};
  const folders=load('lib/thread-folders.ts',guards),chatData=load('lib/ai-chat.ts',guards);
  let downstream=0;
  const runApi={getDevAgentRun:async()=>{downstream++;return null;},failStaleRuns:async()=>{downstream++;},stopDevAgentRun:async()=>{downstream++;return {ok:true};}};
  const actions=load('lib/actions/ai-chat.ts',{...guards,'@/lib/ai-chat':chatData,'@/lib/thread-folders':folders,'@/lib/orchestrator/proposals':{setEscalateHook(){}},'@/lib/dal':{requireAccess:async()=>({id:session.userId,role:'staff'}),requireRole:async()=>{}},'@/lib/panel-context':{loadPanelContext:async()=>{downstream++;return '';}}});
  const runs=load('lib/actions/dev-agents.ts',{...guards,'@/lib/dev-agents':runApi,'@/lib/run-steers':{enqueueSteer:async()=>{downstream++;return {ok:true,runId:'run',steerId:'steer'};}},'@/lib/agent-interactions':{answerInteraction:async()=>{downstream++;return {};}}});
  const review=load('lib/actions/panel-review.ts',{...guards,'@/lib/dal':{requireAccess:async()=>({id:session.userId,role:'staff'})}});
  const contract=load('lib/ask-result-codes.ts');
  const status=load('app/api/ai/status/route.ts',{'@/lib/thread-access':access,'@/lib/dal':{getCurrentUser:async()=>({id:session?.userId,role:session?.userId===people[0]?'owner':'staff'})},'@/lib/db':{pool},'@/lib/ask-thread-journal.mjs':{...journal,withAskJournal:(p,fn)=>journal.withAskJournal(p,fn,options)}});
  const dictation=load('app/api/transcribe/route.ts',{...guards,'@/lib/ask-result-codes':contract,'next/server':{NextResponse:Response},'@/lib/dal':{getCurrentUser:async()=>({id:session.userId,role:'staff'})},'@/lib/transcribe':{transcribeAudio:async()=>{downstream++;return {ok:true,text:'dictated'};},whisperAvailable:()=>true}});

  const speech=load('app/api/tts/route.ts',{...guards,'@/lib/ask-result-codes':contract,'next/server':{NextResponse:Response},'@/lib/dal':{getCurrentUser:async()=>({id:session.userId,role:'staff'})},'@/lib/api-auth':{hasAccess:()=>true},'@/lib/tts':{synthesizeSpeech:async()=>{downstream++;return {ok:true,wav:Buffer.alloc(0)};},piperAvailable:()=>true},'@/lib/orchestrator/voice':{spokenUpdateForRun:async()=>{downstream++;return 'spoken';}}});
  const ownerReplies=load('lib/owner-reply-delivery.ts',{...guards,'@/lib/db':{pool,query:async()=>({rows:[]})},'@/lib/ask-thread-journal.mjs':{withAskJournal:(p,fn)=>journal.withAskJournal(p,fn,options)}});

  const mobile=load('lib/mobile-rpc/operator.ts',{'zod':require('zod'),'@/lib/thread-access':access,'./dispatch':{defineAction:x=>({invoke:async(body,user)=>x.run(x.input.parse(body),user)}),MobileInputError:class MobileInputError extends Error {}},'@/lib/actions/ai-chat':actions,'@/lib/actions/dev-agents':runs,'@/lib/ask-result-codes':contract,'@/lib/dev-agents-meta':{CLAUDE_MODEL_VALUES:['opus'],CLAUDE_CONTEXT_VALUES:['default'],CLAUDE_MODE_VALUES:['plan'],CLAUDE_EFFORT_OPTIONS:[{value:'default'}]}}).createOperatorActions(actions,runs,{},async()=>{downstream++;return undefined;});
  const call=(name,input)=>mobile[name].invoke(input,{id:session.userId,role:'staff'});
  const run=(await c.query(`SELECT id FROM dev_agent_runs LIMIT 1`)).rows[0];
  await t.test('never-enabled absent authority admits self rail/read/write and exposes delete capability false',async()=>{
   const rail=await actions.listThreadRailAction();assert.equal(rail.ok,true);assert.equal(rail.capabilities.deleteAvailable,false);assert.deepEqual(Array.from(rail.rail.threads,r=>r.id),[ids[1]]);
   assert.equal((await actions.loadConversationAction(ids[1])).ok,true);
   const state=(await c.query('SELECT recovery_ready,health_code FROM ask_canvas_maintenance')).rows[0];assert.deepEqual(state,{recovery_ready:true,health_code:'JOURNAL_NOT_CONFIGURED'});
   session.userId=people[0];const health=await status.GET();assert.equal(health.status,200);assert.deepEqual(await health.json(),{ok:true,status:'warning',code:'JOURNAL_NOT_CONFIGURED',capabilities:{deleteAvailable:false}});session.userId=people[1];

   assert.deepEqual(plain(await actions.deleteConversationAction(ids[1],randomUUID())),{ok:false,code:'DELETE_NOT_READY'});
   assert.deepEqual(await journal.maintainThreads(pool),{ok:true,purged:0,warning:'JOURNAL_NOT_CONFIGURED'});
  });
  for(const id of [ids[1],ids[2]])await c.query(`INSERT INTO ai_messages(conversation_id,role,body) VALUES($1,'user','secret matching private body')`,[id]);
  const search=load('lib/panel-search.ts',{'@/lib/db':{query:(...a)=>c.query(...a)},...guards,'@/lib/permissions':load('lib/permissions.ts')});
  const foreignRun=(await c.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source) VALUES('foreign','business',$1,$2,'panel_web') RETURNING id`,[people[2],ids[2]])).rows[0].id;
  const interaction=(await c.query(`INSERT INTO agent_interactions(run_id,conversation_id,kind,payload,agent) VALUES($1,$2,'question','{}','claude') RETURNING id`,[foreignRun,ids[2]])).rows[0].id;
  await t.test('actual mobile foreign rename/archive/reset/poll/stop/steer/answer and review never run downstream',async()=>{
   for(const [name,input] of [['operator.rename',{id:ids[2],title:'stolen'}],['operator.archive',{id:ids[2],archived:true}],['operator.resetSession',{id:ids[2]}],['operator.poll',{runId:foreignRun}],['operator.stop',{runId:foreignRun}],['operator.steer',{runId:foreignRun,text:'attack'}],['operator.answer',{id:interaction,response:{kind:'question',answers:[]}}]])assert.deepEqual(plain(await call(name,input)),{ok:false,code:'THREAD_UNAVAILABLE'},name);
   assert.deepEqual(plain(await review.loadRunReview(foreignRun)),{ok:false,code:'THREAD_UNAVAILABLE'});
   const response=await speech.POST(new Request('http://local/tts',{method:'POST',body:JSON.stringify({runId:foreignRun})}));assert.equal(response.status,404);assert.deepEqual(await response.json(),{ok:false,code:'THREAD_UNAVAILABLE'});
   session.userId=people[0];assert.deepEqual(plain(await ownerReplies.deliverOwnerReply({id:randomUUID(),route:'session',conversationId:ids[2],chatId:'owner',messageId:1},'reply')),{ok:false,code:'THREAD_UNAVAILABLE'});session.userId=people[1];assert.equal(downstream,0);
   assert.equal((await c.query('SELECT title FROM ai_conversations WHERE id=$1',[ids[2]])).rows[0].title,'secret other title');
   const hits=await search.searchPanelForUser({id:people[1],role:'staff',permissions:['ai']},'secret');assert.deepEqual(Array.from(hits.filter(r=>r.kind==='thread'),r=>r.recordId),[ids[1]]);

   session.userId=people[0];assert.deepEqual(plain(await actions.loadConversationAction(ids[2])),{ok:false,code:'THREAD_UNAVAILABLE'});session.userId=people[1];
   session.userId=people[0];assert.equal((await access.threadQuery('SELECT body FROM ai_messages WHERE conversation_id=$1',[ids[2]])).rows.length,0);session.userId=people[1];
  });
  await t.test('self mobile mutation works; injected launch identity rejected before execution',async()=>{
   const ownRun=(await c.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source) VALUES('own','business',$1,$2,'panel_web') RETURNING id`,[people[1],ids[1]])).rows[0].id;
   const ownQuestion=(await c.query(`INSERT INTO agent_interactions(run_id,conversation_id,kind,payload,agent) VALUES($1,$2,'question','{}','claude') RETURNING id`,[ownRun,ids[1]])).rows[0].id;
   assert.equal((await call('operator.stop',{runId:ownRun})).ok,true);assert.equal((await call('operator.steer',{runId:ownRun,text:'own steer'})).ok,true);assert.equal((await call('operator.answer',{id:ownQuestion,response:{kind:'question',answers:[]}})).ok,true);
   assert.equal((await review.loadRunReview(ownRun)).ok,true);assert.equal(downstream,3);downstream=0;

   assert.equal((await call('operator.rename',{id:ids[1],title:'owned'})).ok,true);
   await assert.rejects(call('operator.send',{id:ids[1],prompt:'x',launch_source:'panel_web'}));assert.equal(downstream,0);
  });
  const paused=async()=>{
   for(const result of [await actions.listThreadRailAction(),await actions.listArchivedThreadsAction(),await actions.newConversationAction('claude'),await actions.loadConversationAction(ids[1]),await actions.sendMessageAction(ids[1],'private'),await actions.uploadChatFilesAction(new FormData()),await runs.pollAgentRun(foreignRun),await runs.stopAgentRun(foreignRun),await runs.steerAgentRun(foreignRun,'x'),await review.loadRunReview(foreignRun),await call('operator.send',{id:ids[1],prompt:'closed'}),await call('operator.new',{agent:'claude'})])assert.deepEqual(plain(result),{ok:false,code:'ASK_PAUSED'});
   const response=await speech.POST(new Request('http://local/tts',{method:'POST',body:JSON.stringify({text:'do not synthesize'})}));assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false,code:'ASK_PAUSED'});
   assert.deepEqual(plain(await ownerReplies.deliverOwnerReply({id:randomUUID(),route:'session',conversationId:ids[2],chatId:'owner',messageId:1},'reply')),{ok:false,code:'ASK_PAUSED'});

   for(const route of [speech,dictation]){const probe=await route.GET();assert.equal(probe.status,200);assert.deepEqual(await probe.json(),{available:false,code:'ASK_PAUSED'});assert.equal(probe.headers.get('cache-control'),'no-store');}
   const dictationResponse=await dictation.POST(new Request('http://local/transcribe',{method:'POST',body:'audio'}));assert.equal(dictationResponse.status,503);assert.deepEqual(await dictationResponse.json(),{ok:false,code:'ASK_PAUSED'});
   session.userId=people[0];const health=await status.GET();assert.equal(health.status,503);assert.equal((await health.json()).status,'paused');session.userId=people[1];
   assert.equal(downstream,0);
  };
  await t.test('enabling without verified authority pauses all callers and cannot set latch',async()=>{process.env.SJC_ASK_THREAD_DELETE_ACCEPTED='1';await paused();assert.equal((await c.query('SELECT deletion_enabled FROM ask_canvas_maintenance')).rows[0].deletion_enabled,false);delete process.env.SJC_ASK_THREAD_DELETE_ACCEPTED;});
  await t.test('local intent evidence survives removed flag/latch; no private callback runs',async()=>{
   await withLedgerLock(dir,()=>appendLocal(dir,makeIntent([],ids[1],randomUUID())));await paused();await rm(path.join(dir,'intents.jsonl'));
  });
  await t.test('signed live authority evidence catches pre-latch restored DB and failures are title-free',async()=>{
   let entries=[],failRead=false,failAdvance=false;const authority={id:randomUUID(),read:async()=>{if(failRead)throw Error('SECRET authority failure');return {ledger_id:authority.id,...validateChain(entries),entries};},advance:async(_old,next)=>{if(failAdvance)throw Error('SECRET replication failure');entries=next;return authority.read();}};
   options={dir,authority};process.env.SJC_ASK_THREAD_DELETE_ACCEPTED='1';
   failRead=true;assert.deepEqual(plain(await actions.listThreadRailAction()),{ok:false,code:'ASK_PAUSED'});
   // Failed enable left a binding, but no deletion state. Turning the
   // unverified request off must restore virgin Ask availability.
   options=undefined;delete process.env.SJC_ASK_THREAD_DELETE_ACCEPTED;assert.equal((await actions.listThreadRailAction()).ok,true);
   options={dir,authority};process.env.SJC_ASK_THREAD_DELETE_ACCEPTED='1';failRead=false;

   assert.equal((await actions.listThreadRailAction()).capabilities.deleteAvailable,true);
   await assert.rejects(c.query('UPDATE ask_canvas_maintenance SET deletion_enabled=false'),/permanent/);
   const op=randomUUID();
   // Fail only after local intent append, not the initial verification.
   failAdvance=true;const first=await actions.deleteConversationAction(ids[1],op);assert.deepEqual(plain(first),{ok:true,state:'pending'});
   assert.equal((await readLocal(dir)).length,1);failRead=true;
   assert.deepEqual(plain(await call('operator.delete',{id:ids[1],operationId:op})),{ok:true,state:'pending'});
   session.userId=people[2];assert.deepEqual(plain(await call('operator.delete',{id:ids[1],operationId:op})),{ok:false,code:'THREAD_UNAVAILABLE'});session.userId=people[1];
   failRead=false;failAdvance=false;
   assert.deepEqual(plain(await call('operator.delete',{id:ids[1],operationId:op})),{ok:true,state:'deleted'});
   failRead=true;delete process.env.SJC_ASK_THREAD_DELETE_ACCEPTED;
   assert.deepEqual(plain(await actions.deleteConversationAction(ids[1],op)),{ok:true,state:'deleted'});assert.equal((await readLocal(dir)).length,1);
   await paused();failRead=false;assert.equal((await actions.listThreadRailAction()).ok,true);
   await rm(dir,{recursive:true,force:true});
   assert.deepEqual(plain(await actions.deleteConversationAction(ids[1],op)),{ok:true,state:'deleted'});assert.equal((await readLocal(dir)).length,1);

   assert.deepEqual(plain(await actions.loadConversationAction(ids[1])),{ok:false,code:'THREAD_UNAVAILABLE'});
   // Simulate a restored pre-latch maintenance row; retained evidence still gates.
   await c.query('ALTER TABLE ask_canvas_maintenance DISABLE TRIGGER guard_ask_deletion_latch');await c.query('UPDATE ask_canvas_maintenance SET deletion_enabled=false,checkpoint_sequence=0,checkpoint_hash=NULL');await c.query('ALTER TABLE ask_canvas_maintenance ENABLE TRIGGER guard_ask_deletion_latch');
   await rm(dir,{recursive:true,force:true});options=undefined;await paused();
   // Retained DB deletion evidence alone cannot be bypassed by clearing latch
   // and losing all local files. Authority restoration reconstructs the fence.
   options={dir,authority};assert.equal((await actions.listThreadRailAction()).ok,true);
   session=null;assert.deepEqual(plain(await actions.listThreadRailAction()),{ok:false,code:'SIGN_IN_AGAIN'});
   session={userId:people[1],authAt:Math.floor(Date.now()/1000)};
   await c.query('UPDATE users SET permissions=ARRAY[]::text[] WHERE id=$1',[people[1]]);assert.deepEqual(plain(await actions.listThreadRailAction()),{ok:false,code:'CHAT_OFF'});

  });
 });
 }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);await rm(root,{recursive:true,force:true});}
}));

test('missing privacy schema yields a fixed paused result before any private callback',()=>withMigrationSubset('missing_privacy',[100],async({db,apply})=>{
 await apply();const person=(await db.query(`INSERT INTO users(email,name,role,password_hash,initials) VALUES($1,'Missing schema','owner','x','M') RETURNING id`,[randomUUID()+'@example.test'])).rows[0].id;
 const root=await mkdtemp(path.join(tmpdir(),'p0fix-missing-')),dir=path.join(root,'journal'),before=process.env.SJC_CANVAS_DELETION_LEDGER_DIR,priorDeployment=process.env.SJC_ASK_DEPLOYMENT_STATE_DIR;process.env.SJC_CANVAS_DELETION_LEDGER_DIR=dir;
 try{
  process.env.SJC_ASK_DEPLOYMENT_STATE_DIR=path.join(root,'deployment');
  await bootstrapDeployment(process.env.SJC_ASK_DEPLOYMENT_STATE_DIR);
  const access=load('lib/thread-access.ts',{'@/lib/db':{pool:db},'@/lib/session':{readSession:async()=>({userId:person,authAt:Math.floor(Date.now()/1000)})},'@/lib/ask-thread-journal.mjs':journal});
  assert.deepEqual(plain(await access.askBoundary(async()=>assert.fail('private callback ran'))),{ok:false,code:'ASK_PAUSED'});
 }finally{if(before===undefined)delete process.env.SJC_CANVAS_DELETION_LEDGER_DIR;else process.env.SJC_CANVAS_DELETION_LEDGER_DIR=before;if(priorDeployment===undefined)delete process.env.SJC_ASK_DEPLOYMENT_STATE_DIR;else process.env.SJC_ASK_DEPLOYMENT_STATE_DIR=priorDeployment;await rm(root,{recursive:true,force:true});}
}));

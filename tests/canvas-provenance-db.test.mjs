import test from 'node:test';
import assert from 'node:assert/strict';
import {withTestDb,withSessionIdentity} from './_harness/testdb.mjs';
import {seedPeople} from './phase0a-fixtures.mjs';
import {conversationProvenance} from '../lib/ask-context-provenance.mjs';
import {beginInput,completeInput,admitEpoch,hashBytes} from '../lib/ask-context-inputs.mjs';
// Expectations precede implementation: legacy, unknown and pending stay closed;
// no actor-area fallback; exact hashes, monotonic revisions and real DB roles.
test('0107 provenance boundaries',()=>withTestDb(async(url,db)=>{
 const p=await seedPeople(db),id=p.thread;
 await db.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('Show permit steps.','business',$1,$2,'panel_web',true) RETURNING id`,[p.owner.id,id]).then(r=>p.run=r.rows[0].id);
 const facts={client:db,threadId:id,runId:p.run};
 await admitEpoch({...facts,policyHash:hashBytes('policy'),valid:true,resumed:false});
 assert.equal((await conversationProvenance({client:db,threadId:id})).complete,true);
 const first=await beginInput({...facts,kind:'tool',ref:'get_project'});
 assert.equal((await conversationProvenance({client:db,threadId:id})).complete,false);
 await completeInput({...facts,id:first,bytes:'exact delivered bytes',areas:['money','invoices'],complete:true});
 const a=await conversationProvenance({client:db,threadId:id});assert.deepEqual(a.areas,['invoices','money']);assert.equal(a.inputs[0].hash,hashBytes('exact delivered bytes'));
 await completeInput({...facts,id:first,bytes:'exact delivered bytes',areas:['money','invoices'],complete:true});
 assert.equal((await conversationProvenance({client:db,threadId:id})).revision,a.revision);
 await assert.rejects(completeInput({...facts,id:first,bytes:'changed',areas:[],complete:true}),/INPUT_CONFLICT/);
 for(const role of ['sjcos_agent','sjcos_worker','sjcos_readonly'])await withSessionIdentity(url,role,async c=>{for(const table of ['ask_context_provenance','ask_context_inputs'])await assert.rejects(c.query(`SELECT * FROM ${table}`),e=>e.code==='42501');});
 const pending=await beginInput({...facts,kind:'reader',ref:'bad-doc'});
 await completeInput({...facts,id:pending,bytes:'fixed refusal',areas:null,complete:false});
 assert.equal((await conversationProvenance({client:db,threadId:id})).areas,null);
 await admitEpoch({...facts,policyHash:hashBytes('policy'),valid:true,resumed:false});
 assert.equal((await conversationProvenance({client:db,threadId:id})).complete,false);
}));

test('legacy, resumed, operator, page context, uploads and steers cannot regain completeness',()=>withTestDb(async(url,db)=>{
 const p=await seedPeople(db);
 await withSessionIdentity(url,'sjcos_test_website',async db=>{
 for(const cause of ['legacy','resumed','operator','message','attachment','steer']){
  const thread=(await db.query(`INSERT INTO ai_conversations(agent,owner_user_id) VALUES('claude',$1) RETURNING id`,[p.owner.id])).rows[0].id;
  const run=(await db.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('steps',$1,$2,$3,'panel_web',true) RETURNING id`,[cause==='operator'?'operator':'business',p.owner.id,thread])).rows[0].id;
  const facts={client:db,threadId:thread,runId:run};
  if(cause==='legacy')await db.query('UPDATE ask_context_provenance SET unknown=true WHERE conversation_id=$1',[thread]);
  await admitEpoch({...facts,policyHash:hashBytes('policy'),valid:cause!=='operator',resumed:cause==='resumed'});
  if(cause==='message')await db.query(`INSERT INTO ai_messages(conversation_id,role,body,page_context) VALUES($1,'user','unclassified business facts','/projects/example')`,[thread]);
  if(cause==='attachment')await db.query(`INSERT INTO ai_messages(conversation_id,role,body,attachments) VALUES($1,'user','Show permit steps.','[{"name":"old","path":"/unknown"}]')`,[thread]);
  if(cause==='steer')await db.query(`INSERT INTO run_steers(run_id,body) VALUES($1,'arbitrary follow-up facts')`,[run]);
  assert.equal((await conversationProvenance({client:db,threadId:thread})).complete,false,cause);
  await admitEpoch({...facts,policyHash:hashBytes('new policy'),valid:true,resumed:false});
  assert.equal((await conversationProvenance({client:db,threadId:thread})).complete,false,cause+' is sticky');
 }
 });
}));

test('real detached panel runner admits and hashes a fake CLI delivery under website session identity',()=>withTestDb(async(url,admin)=>{
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');const path=await import('node:path');const {tmpdir}=await import('node:os');
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const p=await seedPeople(admin),dir=await mkdtemp(path.join(tmpdir(),'c1prov-panel-'));
 try{
  await withSessionIdentity(url,'sjcos_test_website',async db=>{
   const thread=(await db.query(`INSERT INTO ai_conversations(agent,owner_user_id) VALUES('claude',$1) RETURNING id`,[p.staff.id])).rows[0].id;
   await db.query(`INSERT INTO ai_messages(conversation_id,role,body) VALUES($1,'user','Show permit steps.')`,[thread]);
   const run=(await db.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('Show permit steps.','business',$1,$2,'panel_web',true) RETURNING id`,[p.staff.id,thread])).rows[0].id;
   // Disposable fixture owner can log in solely for this child-process test.
   await admin.query('ALTER ROLE sjcos_test_website LOGIN');
   const database=new URL(url);database.username='sjcos_test_website';
   const fake=path.join(dir,'fake-cli'),argv=path.join(dir,'argv.json');
   await writeFile(fake,`#!/usr/bin/env node\nconst fs=require('node:fs');\nif(process.argv.includes('--help')){console.log('--tools --restricted --strict-mcp-config --safe-mode --setting-sources --settings --disable-slash-commands');process.exit(0);}\nfs.writeFileSync(${JSON.stringify(argv)},JSON.stringify(process.argv.slice(2)));\nlet received=false;process.stdin.on('data',chunk=>{if(received)return;received=true;console.log(JSON.stringify({type:'user',isReplay:true}));console.log(JSON.stringify({type:'result',subtype:'success',result:'Completed fake turn',session_id:'11111111-1111-4111-8111-111111111111',total_cost_usd:0,num_turns:1}));});\nprocess.stdin.on('end',()=>process.exit(0));\n`,{mode:0o700});
   await promisify(execFile)(process.execPath,['scripts/run-claude-agent.mjs',run],{cwd:process.cwd(),timeout:20000,env:{...process.env,DATABASE_URL:database.toString(),DATABASE_URL_AGENT:database.toString(),CLAUDE_BIN:fake,SJC_CANVAS_DELETION_LEDGER_DIR:path.join(dir,'journal'),CRON_SECRET:'test-only',APP_INTERNAL_URL:'http://127.0.0.1:1'}});
   const result=(await db.query('SELECT status,answer FROM dev_agent_runs WHERE id=$1',[run])).rows[0];assert.equal(result.status,'done',result.answer);
   const args=JSON.parse(await readFile(argv,'utf8'));assert.equal(args[args.indexOf('--tools')+1],'ToolSearch');assert.equal(args.includes('--add-dir'),false);
   const provenance=await conversationProvenance({client:db,threadId:thread});assert.equal(provenance.complete,true);assert.ok(provenance.inputs.some(i=>i.ref.startsWith('delivery:')));
   const epoch=(await db.query('SELECT policy_hash FROM ask_context_provenance WHERE conversation_id=$1',[thread])).rows[0];assert.equal(epoch.policy_hash.length,64);
  });
 }finally{await rm(dir,{recursive:true,force:true});}
}));

test('thread serialization exposes pending before a competing policy snapshot; rolled-back completion stays pending',()=>withTestDb(async(url,admin)=>{
 const p=await seedPeople(admin);
 await withSessionIdentity(url,'sjcos_test_website',async a=>{
  const thread=(await a.query(`INSERT INTO ai_conversations(agent,owner_user_id) VALUES('claude',$1) RETURNING id`,[p.owner.id])).rows[0].id;
  const run=(await a.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('Show permit steps.','business',$1,$2,'panel_web',true) RETURNING id`,[p.owner.id,thread])).rows[0].id;
  await a.query('BEGIN');await admitEpoch({client:a,threadId:thread,runId:run,policyHash:hashBytes('policy'),valid:true,resumed:false});await a.query('COMMIT');
  let id;
  await withSessionIdentity(url,'sjcos_test_website',async b=>{
   await a.query('BEGIN');id=await beginInput({client:a,threadId:thread,runId:run,kind:'tool',ref:'concurrent-reader'});
   let entered=false;
   const snapshot=(async()=>{
    await b.query('BEGIN');await b.query('SELECT id FROM ai_conversations WHERE id=$1 FOR UPDATE',[thread]);entered=true;
    const p=await conversationProvenance({client:b,threadId:thread});await b.query('COMMIT');return p;
   })();
   await new Promise(resolve=>setTimeout(resolve,30));assert.equal(entered,false);
   await a.query('COMMIT');assert.equal((await snapshot).complete,false);
  });
  await a.query('BEGIN');await assert.rejects(completeInput({client:a,threadId:thread,runId:run,id,bytes:'withheld result',areas:['money'],complete:true,sourceHash:'bad hash'}));await a.query('ROLLBACK');
  assert.equal((await conversationProvenance({client:a,threadId:thread})).complete,false);
  await a.query('BEGIN');await completeInput({client:a,threadId:thread,runId:run,id,bytes:'recorded result',areas:['money'],complete:true});await a.query('COMMIT');
  assert.deepEqual((await conversationProvenance({client:a,threadId:thread})).areas,['money']);
 });
}));

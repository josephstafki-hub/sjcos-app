import test from 'node:test';
import assert from 'node:assert/strict';
import {withTestDb,withSessionIdentity} from './_harness/testdb.mjs';
import {appHooks,seedPeople} from './phase0a-fixtures.mjs';
appHooks();
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
 const first=await beginInput({...facts,kind:'tool',ref:'delete_expense'});
 assert.equal((await conversationProvenance({client:db,threadId:id})).complete,false);
 await completeInput({...facts,id:first,bytes:'exact delivered bytes',areas:['money','invoices'],complete:true});
 const a=await conversationProvenance({client:db,threadId:id});assert.deepEqual(a.areas,['invoices','money']);assert.equal(a.inputs.find(i=>i.ref.startsWith('tool:')).hash,hashBytes('exact delivered bytes'));
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
   // A normal second UI turn uses a fresh CLI, verified complete lineage and
   // the empty-state control envelope. It must keep staff Save available.
   await db.query(`INSERT INTO ai_messages(conversation_id,role,body) VALUES($1,'user','Draw the permit steps for this job as a diagram.')`,[thread]);
   const second=(await db.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('Draw the permit steps for this job as a diagram.','business',$1,$2,'panel_web',true) RETURNING id`,[p.staff.id,thread])).rows[0].id;
   await promisify(execFile)(process.execPath,['scripts/run-claude-agent.mjs',second],{cwd:process.cwd(),timeout:20000,env:{...process.env,DATABASE_URL:database.toString(),DATABASE_URL_AGENT:database.toString(),CLAUDE_BIN:fake,SJC_CANVAS_DELETION_LEDGER_DIR:path.join(dir,'journal'),CRON_SECRET:'test-only',APP_INTERNAL_URL:'http://127.0.0.1:1'}});
   const secondResult=(await db.query('SELECT status,answer FROM dev_agent_runs WHERE id=$1',[second])).rows[0];assert.equal(secondResult.status,'done',secondResult.answer);
   assert.equal((await conversationProvenance({client:db,threadId:thread})).complete,true);
   assert.equal(JSON.parse(await readFile(argv,'utf8')).includes('--resume'),false);
   await db.query("DELETE FROM ask_context_inputs WHERE run_id=$1 AND kind='delivery'",[run]);
   const missing=(await db.query("INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('Show permit steps.','business',$1,$2,'panel_web',true) RETURNING id",[p.staff.id,thread])).rows[0].id;
   await admitEpoch({client:db,threadId:thread,runId:missing,policyHash:hashBytes('verified-new-policy'),valid:true,resumed:false});
   assert.equal((await conversationProvenance({client:db,threadId:thread})).complete,false,'missing prior delivery fails closed');

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

// Real registration -> wrapper -> website completion classifier -> immutable
// Canvas -> 0108 Save. Extra actor permissions must never label the saved copy.
test('staff project geometry and schedule results create and save with only content-derived money access',()=>withTestDb(async(url,admin)=>{
 const {mkdtemp,rm,readFile}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const {registerHooks}=await import('node:module');
 const dir=await mkdtemp(path.join(tmpdir(),'c1cls-save-'));globalThis.__c1clsUploadDir=dir;
 registerHooks({resolve(s,c,next){if((s==='./db'||s==='./db.ts')&&c.parentURL?.includes('/lib/'))return {url:'phase0a:db',shortCircuit:true};if(['next/navigation','next/cache'].includes(s))return next(s+'.js',c);if(s==='./uploads'&&c.parentURL?.endsWith('/lib/canvas-exports.ts'))return {url:'c1cls:uploads',shortCircuit:true};return next(s,c);},load(u,c,next){if(u==='phase0a:db'){const r=next(u,c);return {...r,source:r.source+'\nexport const query=(...a)=>globalThis.__phase0aDb.query(...a); export const queryOne=async(...a)=>(await query(...a)).rows[0]??null;'};}if(u==='c1cls:uploads')return {format:'module',source:'export const UPLOAD_DIR=globalThis.__c1clsUploadDir;',shortCircuit:true};return next(u,c);}});
 const p=await seedPeople(admin),beforeEnv={...process.env},realFetch=globalThis.fetch;
 let server;
 try{await withSessionIdentity(url,'sjcos_test_website',async db=>{
  globalThis.__phase0aDb=db;
  const grants=['ai','projects','money','vendors','newsletter'];
  await db.query('UPDATE users SET permissions=$2 WHERE id=$1',[p.staff.id,grants]);
  const slug='zz-c1cls-'+crypto.randomUUID();
  const project=(await db.query(`INSERT INTO projects(slug,name,status,client_name) VALUES($1,'ZZ schedule','precon_signed','ZZ client') RETURNING id`,[slug])).rows[0].id;
  const {emptyDoc}=await import('../lib/plan-doc.ts');
  const design=(await db.query(`INSERT INTO plan_designs(project_id,name,doc) VALUES($1,'Permit layout',$2) RETURNING id`,[project,JSON.stringify(emptyDoc())])).rows[0].id;
  const {prepareTentativeSchedule,listPlans}=await import('../lib/field/schedule-plans.ts');
  const runSql=async(s,a)=>(await db.query(s,a)).rows;
  await prepareTentativeSchedule(runSql,{kind:'service',name:'classification test'},{projectId:project,phases:[],startDate:'2026-11-05'},{fundingAvailable:async()=>({ok:true,availableCents:12345,reason:'test fixture cash'})});
  const thread=(await db.query(`INSERT INTO ai_conversations(agent,owner_user_id) VALUES('claude',$1) RETURNING id`,[p.staff.id])).rows[0].id;
  const run=(await db.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('Show permit steps.','business',$1,$2,'panel_web',true) RETURNING *,extract(epoch FROM created_at)::bigint AS started`,[p.staff.id,thread])).rows[0];
  await admitEpoch({client:db,threadId:thread,runId:run.id,policyHash:hashBytes('narrow-result-contracts'),valid:true,resumed:false});
  Object.assign(process.env,{SJC_CANVAS_ENABLED:'1',CRON_SECRET:'c1cls-test-only',SESSION_SECRET:'c1cls-test-secret-at-least-32-characters',DATABASE_URL_AGENT:url,SJC_DB_LOGIN:'agent',SJC_RUN_ID:run.id,SJC_CONVERSATION_ID:thread,SJC_PRINCIPAL_USER_ID:p.staff.id,SJC_RUN_PROFILE:'business',SJC_RUN_STARTED_S:String(run.started)});
  await db.query(`INSERT INTO app_settings(key,value) VALUES('canvas.diagrams_enabled','true'),('canvas.staff_enabled','true'),('canvas.exports_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'`);
  const provenanceRoute=await import('../app/api/internal/ask-context-provenance/route.ts');
  const canvasRoute=await import('../app/api/internal/canvas/route.ts');
  globalThis.fetch=async(url,opts)=>{
   const req=new Request(url,opts),pathname=new URL(url).pathname;
   if(pathname==='/api/internal/ask-context-provenance')return provenanceRoute.POST(req);
   if(pathname==='/api/internal/canvas')return canvasRoute.POST(req);
   if(pathname==='/api/internal/field'){const b=JSON.parse(opts.body);assert.equal(b.action,'list_plans');return Response.json({ok:true,plans:await listPlans(runSql,b.project_id)});}
   throw Error('Unexpected outbound request');
  };
  const {buildServer}=await import('../mcp/sjcos-mcp.mjs');server=buildServer({transportKind:'stdio'});
  const call=async(name,args)=>{const r=await server._registeredTools[name].handler(args,{});assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
  assert.equal((await call('get_plan_measures',{design_id:Number(design)})).ok,true);
  assert.deepEqual((await conversationProvenance({client:db,threadId:thread})).areas,[]);
  const schedule=await call('list_schedule_plans',{project_slug:slug});assert.equal(schedule.plans[0].funding_readiness.availableCents,12345);
  const prov=await conversationProvenance({client:db,threadId:thread});assert.equal(prov.complete,true);assert.deepEqual(prov.areas,['money']);
  const made=await call('show_canvas',{request_id:crypto.randomUUID(),title:'Permit',summary:'Permit steps and funding check',required_areas:[],project_slug:slug,content:{kind:'diagram',source:'flowchart TD\n A-->B'}});
  const id=made.canvas.id;
  const version=(await db.query('SELECT baseline_areas,provenance_complete FROM ask_canvas_versions WHERE canvas_id=$1',[id])).rows[0];assert.equal(version.provenance_complete,true);assert.deepEqual(version.baseline_areas,['money']);
  const {encrypt}=await import('../lib/session.ts');const token=await encrypt({userId:p.staff.id,role:'staff',authAt:Math.floor(Date.now()/1000)});globalThis.__phase0aCookies={get:()=>({value:token})};
  const {canvasRender,canvasSavePolicy,canvasSave}=await import('../lib/canvas-exports.ts');
  await canvasRender(id,1,{svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text x="10" y="20">Permit</text></svg>'});
  const policy=await canvasSavePolicy(id,1,slug);assert.deepEqual(policy.baseline_areas,['money']);
  const saved=await canvasSave(id,1,{project_slug:slug,expected_policy_revision:policy.policy_revision,request_id:crypto.randomUUID()});
  assert.equal(saved.ok,true);assert.deepEqual(saved.effective_policy,{kind:'staff',required_areas:['money'],owner_user_id:p.staff.id});
  const file=(await db.query('SELECT canvas_policy,storage_path FROM files WHERE id=$1',[saved.file.id])).rows[0];assert.deepEqual(file.canvas_policy.required_areas,['money']);assert.match(await readFile(path.join(dir,file.storage_path),'utf8'),/Permit/);
  const {resolveCanvasFilePolicy}=await import('../lib/canvas-file-access.ts');
  // A different project-file reader needs neither ai nor the saver's extra areas.
  await db.query("UPDATE users SET permissions=ARRAY['projects','money'] WHERE id=$1",[p.noAi.id]);
  assert.ok(await resolveCanvasFilePolicy({principal:{id:p.noAi.id},fileId:saved.file.id,operation:'read'}));
  await db.query("UPDATE users SET permissions=ARRAY['projects'] WHERE id=$1",[p.noAi.id]);
  assert.equal(await resolveCanvasFilePolicy({principal:{id:p.noAi.id},fileId:saved.file.id,operation:'read'}),null);
  // Security R1: the ACTUAL broad handler -> tracked result -> version -> Save
  // must carry both contact and subcontractor restrictions to another reader.
  const broad=['estimates','invoices','change_orders','money','leads','subs'];
  await db.query('UPDATE users SET permissions=$2 WHERE id=$1',[p.staff.id,['ai','projects',...broad]]);
  await db.query("UPDATE projects SET client_email='private@example.test' WHERE slug=$1",[slug]);
  const projectResult=await call('get_project',{slug});assert.equal(projectResult.project.client_email,'private@example.test');
  assert.equal((await conversationProvenance({client:db,threadId:thread})).complete,true);
  const copy=await call('show_canvas',{request_id:crypto.randomUUID(),title:'Contacts',summary:'Project contacts',required_areas:[],project_slug:slug,content:{kind:'diagram',source:'flowchart TD\n A-->B'}});
  await canvasRender(copy.canvas.id,1,{svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text x="10" y="20">Contact</text></svg>'});
  const cp=await canvasSavePolicy(copy.canvas.id,1,slug);assert.deepEqual([...cp.baseline_areas].sort(),[...broad].sort());
  const savedContact=await canvasSave(copy.canvas.id,1,{project_slug:slug,expected_policy_revision:cp.policy_revision,request_id:crypto.randomUUID()});
  for(const missing of ['leads','subs']){
   await db.query('UPDATE users SET permissions=$2 WHERE id=$1',[p.noAi.id,['projects',...broad.filter(a=>a!==missing)]]);
   assert.equal(await resolveCanvasFilePolicy({principal:{id:p.noAi.id},fileId:savedContact.file.id,operation:'read'}),null,missing);
  }
  await db.query('UPDATE users SET permissions=$2 WHERE id=$1',[p.noAi.id,['projects',...broad]]);
  assert.ok(await resolveCanvasFilePolicy({principal:{id:p.noAi.id},fileId:savedContact.file.id,operation:'read'}));
  const fixPrompt='Fix the "Contacts" diagram (version 1). The error was: The diagram could not be drawn.';
  await db.query("INSERT INTO ai_messages(conversation_id,role,body) VALUES($1,'user',$2)",[thread,fixPrompt]);
  assert.equal((await conversationProvenance({client:db,threadId:thread})).complete,true);
  const updated=await call('update_canvas',{request_id:crypto.randomUUID(),canvas_id:copy.canvas.id,base_version:1,change_note:'Fixed contacts',summary:'Fixed contacts',content:{kind:'diagram',source:'flowchart TD\n A-->C'}});
  assert.equal(updated.selected.version,2);
  await canvasRender(copy.canvas.id,2,{svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text x="10" y="20">Fixed</text></svg>'});
  const changedPolicy=await canvasSavePolicy(copy.canvas.id,2,slug);
  assert.equal((await canvasSave(copy.canvas.id,2,{project_slug:slug,expected_policy_revision:changedPolicy.policy_revision,request_id:crypto.randomUUID()})).ok,true);
  // A rejected tool stores ONLY a fixed reason. Successful retry clears it.
  const unsafe={request_id:crypto.randomUUID(),title:'Refused',summary:'Refused',required_areas:[],content:{kind:'diagram',source:'flowchart TD\n A[<script>bad</script>]'}};
  let refusal=await server._registeredTools.show_canvas.handler(unsafe,{});assert.equal(refusal.isError,true);
  assert.equal((await db.query('SELECT reason FROM ask_canvas_attempts WHERE run_id=$1',[run.id])).rows.length,1);
  assert.equal((await db.query("SELECT count(*)::int n FROM ask_canvas_events WHERE run_id=$1 AND kind='rejected'",[run.id])).rows[0].n,0);
  await call('show_canvas',{request_id:crypto.randomUUID(),title:'Retry',summary:'Safe retry',required_areas:[],content:{kind:'diagram',source:'flowchart TD\n A-->B'}});
  assert.equal((await db.query('SELECT reason FROM ask_canvas_attempts WHERE run_id=$1',[run.id])).rows.length,0);
  refusal=await server._registeredTools.show_canvas.handler({...unsafe,request_id:crypto.randomUUID()},{});assert.equal(refusal.isError,true);
  const {instructionEnvelope}=await import('../lib/ask-context-inputs.mjs');
  for(const prompt of ['Fix the "Contacts" diagram (version 1). The error was: The diagram could not be drawn.','Simplify the "Contacts" diagram (version 1) so it can be shown here.','Change the "Contacts" diagram (version 1): ']){
   const envelope=await instructionEnvelope(db,thread,prompt);assert.equal(envelope.complete,true);assert.deepEqual([...envelope.areas].sort(),[...broad].sort());
  }
  for(const prompt of ['Change the "Contacts" diagram (version 1): private arbitrary facts','Fix the "Foreign" diagram (version 1). The error was: The diagram could not be drawn.'])assert.equal((await instructionEnvelope(db,thread,prompt)).complete,false);
  // Terminal recovery, including no-assistant/crash, is an atomic website command
  // trigger; it survives runner restarts and deduplicates terminal retries.
  const {writeFile}=await import('node:fs/promises');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
  await admin.query('ALTER ROLE sjcos_test_website LOGIN');const runnerDatabase=new URL(url);runnerDatabase.username='sjcos_test_website';
  const terminalCli=path.join(dir,'terminal-cli');
  await writeFile(terminalCli,`#!/usr/bin/env node\nif(process.argv.includes('--help')){console.log('--tools --restricted --strict-mcp-config --safe-mode --setting-sources --settings --disable-slash-commands');process.exit(0);}process.stdin.once('data',()=>{console.log(JSON.stringify({type:'user',isReplay:true}));console.log(JSON.stringify({type:'result',subtype:'success',result:'',num_turns:1}));});process.stdin.on('end',()=>process.exit(0));\n`,{mode:0o700});
  await promisify(execFile)(process.execPath,['scripts/run-claude-agent.mjs',run.id],{timeout:20000,env:{...process.env,DATABASE_URL:runnerDatabase.toString(),DATABASE_URL_AGENT:runnerDatabase.toString(),CLAUDE_BIN:terminalCli,SJC_CANVAS_DELETION_LEDGER_DIR:path.join(dir,'terminal-journal'),APP_INTERNAL_URL:'http://127.0.0.1:1'}});

  const terminal=(await db.query('SELECT answer FROM dev_agent_runs WHERE id=$1',[run.id])).rows[0];assert.match(terminal.answer,/Canvas could not be created \(not allowed\)/);
  await db.query("UPDATE dev_agent_runs SET status='error' WHERE id=$1",[run.id]);
  const {canvasEvents}=await import('../lib/ask-canvases.ts');const history=await canvasEvents(thread,{});
  const rejects=history.events.filter(e=>e.kind==='rejected');assert.equal(rejects.length,1);assert.equal(rejects[0].canvas_id,null);assert.doesNotMatch(JSON.stringify(rejects),/script|Refused|source/);
  const {mobileCanvasFallback,appendCanvasLines}=await import('../lib/mobile-rpc/canvas-fallback.ts');
  const fallback=appendCanvasLines('',mobileCanvasFallback(history));assert.match(fallback,/Canvas could not be created/);assert.equal(appendCanvasLines(fallback,mobileCanvasFallback(history)),fallback);
  const canceled=(await db.query("INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('Show permit steps.','business',$1,$2,'panel_web',true) RETURNING id,extract(epoch FROM created_at)::bigint AS started",[p.staff.id,thread])).rows[0];
  const {canvasInternal}=await import('../lib/ask-canvases.ts');
  await assert.rejects(canvasInternal('show',{...unsafe,request_id:crypto.randomUUID()},{run_id:canceled.id,principal_user_id:p.staff.id,run_profile:'business',run_started_s:Number(canceled.started),transport:'runner_stdio'}));
  await db.query("UPDATE dev_agent_runs SET cancellation_requested=true WHERE id=$1",[canceled.id]);
  await db.query("UPDATE dev_agent_runs SET status='error' WHERE id=$1",[canceled.id]);
  assert.equal((await db.query("SELECT count(*)::int n FROM ask_canvas_events WHERE run_id=$1 AND kind='rejected'",[canceled.id])).rows[0].n,1);


 });}finally{globalThis.fetch=realFetch;await server?.close();for(const k of Object.keys(process.env))if(!(k in beforeEnv))delete process.env[k];Object.assign(process.env,beforeEnv);delete globalThis.__c1clsUploadDir;await rm(dir,{recursive:true,force:true});}
}));

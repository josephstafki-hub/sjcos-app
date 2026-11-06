import test from 'node:test';
import assert from 'node:assert/strict';
import {withTestDb,withSessionIdentity} from './_harness/testdb.mjs';
import {appHooks,seedPeople} from './phase0a-fixtures.mjs';
// Contract expectations: atomic full snapshots, CAS, replay, private thread person,
// fail-closed staff provenance, immutable identity, quota/rate, no raw narrow access.
appHooks();
const core=await import('../lib/ask-canvases.ts');
const req=()=>crypto.randomUUID();
const input=()=>({request_id:req(),title:'Permit',summary:'Permit steps',required_areas:[],content:{kind:'diagram',source:'flowchart TD\n A-->B'}});
test('Canvas commands and SQL adversarial contract',()=>withTestDb(async(url,c)=>{
 const people=await seedPeople(c);process.env.SJC_CANVAS_ENABLED='1';process.env.SESSION_SECRET='canvas-contract-secret-at-least-32-characters';
 const {encrypt}=await import('../lib/session.ts');
 await withSessionIdentity(url,'sjcos_test_website',async(db)=>{
  globalThis.__phase0aDb=db;let token=await encrypt({userId:people.owner.id,role:'owner',authAt:Math.floor(Date.now()/1000)});globalThis.__phase0aCookies={get:()=>({value:token})};
  await db.query(`INSERT INTO app_settings(key,value) VALUES('canvas.diagrams_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'`);
  const run=(await db.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('canvas','operator',$1,$2,'panel_web',true) RETURNING *,extract(epoch FROM created_at)::bigint AS started`,[people.owner.id,people.thread])).rows[0];
  const context={run_id:run.id,principal_user_id:people.owner.id,run_profile:'operator',run_started_s:Number(run.started),transport:'runner_stdio'};
  const {createCanvasCall}=await import('../mcp/canvas-tools.mjs');
  const capturedEnv={SJC_RUN_ID:run.id,SJC_CONVERSATION_ID:people.thread,SJC_PRINCIPAL_USER_ID:people.owner.id,SJC_RUN_PROFILE:'operator',SJC_RUN_STARTED_S:String(run.started)};
  const call=createCanvasCall({transportKind:'stdio',env:capturedEnv,internalCall:async(path,b)=>{assert.equal(path,'/api/internal/canvas');return core.canvasInternal(b.action,b.input,b.context);}});
  capturedEnv.SJC_RUN_ID=req(); // captured once; a later env change cannot retarget identity.
  const first=input();const made=await call('show',first);assert.equal(made.selected.version,1);
  const id=made.canvas.id;for(let n=0;n<10;n++)assert.deepEqual(await core.canvasInternal('show',first,context),made);
  const update={request_id:req(),canvas_id:id,base_version:1,summary:'Changed',change_note:'Added step',content:{kind:'diagram',source:'flowchart TD\n A-->C'}};
  const changed=await core.canvasInternal('update',update,context);assert.equal(changed.selected.version,2);
  assert.equal((await core.canvasInternal('show',first,context)).selected.version,1);
  await assert.rejects(core.canvasInternal('show',{...first,title:'Different'},context),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(core.canvasInternal('update',{...update,request_id:req()},context),/VERSION_CONFLICT/);
  const restored=await core.canvasRestore(id,{request_id:req(),base_version:2,restore_version:1});assert.equal(restored.selected.version,3);assert.equal(restored.selected.run_id,null);
  assert.equal((await core.canvasGet(id,{version:1,include_source:true})).code.code,first.content.source);
  assert.equal((await core.canvasVersions(id,{})).versions.length,3);
  assert.equal((await core.canvasList(people.thread,{})).canvases.length,1);
  assert.equal((await core.canvasEvents(people.thread,{})).events.length,3);
  for(const sql of [`UPDATE ask_canvases SET kind='page' WHERE id=$1`,`UPDATE ask_canvas_versions SET title='tampered' WHERE canvas_id=$1`,`DELETE FROM ask_canvas_versions WHERE canvas_id=$1`])await assert.rejects(db.query(sql,[id]));
  for(const field of ['run_id','principal_user_id'])await assert.rejects(core.canvasInternal('get',{canvas_id:id},{...context,[field]:req()}),/RUN_CONTEXT_REQUIRED/);
  await db.query(`UPDATE dev_agent_runs SET status='done' WHERE id=$1`,[run.id]);await assert.rejects(core.canvasInternal('get',{canvas_id:id},context),/RUN_CONTEXT_REQUIRED/);
  assert.equal((await core.canvasGet(id,{})).selected.version,3);
  await db.query(`INSERT INTO app_settings(key,value) VALUES('canvas.staff_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'`);
  token=await encrypt({userId:people.staff.id,role:'staff',authAt:Math.floor(Date.now()/1000)});await assert.rejects(core.canvasGet(id,{}),/CANVAS_UNAVAILABLE/);
 });
 for(const role of ['sjcos_agent','sjcos_worker','sjcos_readonly'])await withSessionIdentity(url,role,async(db)=>{
  for(const table of ['ask_canvases','ask_canvas_versions','ask_canvas_requests','ask_canvas_events','ask_canvas_usage','ask_canvas_rate_windows'])await assert.rejects(db.query(`SELECT * FROM ${table}`),e=>e.code==='42501');
 });
}));

test('concurrency, budgets, rollback, staff provenance, and selected history',async t=>withTestDb(async(url,c)=>{
 const people=await seedPeople(c);process.env.SJC_CANVAS_ENABLED='1';
 const {registerHooks}=await import('node:module');const {default:pg}=await import('pg');
 // Dedicated session identities on every connection: neither SET ROLE nor a shared client.
 globalThis.__canvasPool={async connect(){const db=new pg.Client({connectionString:url});await db.connect();await db.query('SET SESSION AUTHORIZATION sjcos_test_website');db.release=()=>db.end();return db;},async query(...args){const db=await this.connect();try{return await db.query(...args);}finally{await db.end();}}};
 // ESM modules already imported retain the original seam; it now distributes queries.
 const old=globalThis.__phase0aDb;globalThis.__phase0aDb=globalThis.__canvasPool;
 // appHooks' connect wrapper has no connection acquisition; replace pool methods themselves for this isolated test.
 const {pool:appPool}=await import('@/lib/db');
 const originalQuery=appPool.query,originalConnect=appPool.connect;
 appPool.query=(...a)=>globalThis.__canvasPool.query(...a);appPool.connect=()=>globalThis.__canvasPool.connect();
 try{
 await withSessionIdentity(url,'sjcos_test_website',async db=>{
  await db.query(`INSERT INTO app_settings(key,value) VALUES('canvas.diagrams_enabled','true'),('canvas.staff_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'`);
  const {encrypt}=await import('../lib/session.ts');let token=await encrypt({userId:people.owner.id,role:'owner',authAt:Math.floor(Date.now()/1000)});globalThis.__phase0aCookies={get:()=>({value:token})};
  const run=(await db.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('canvas','operator',$1,$2,'panel_web',true) RETURNING *,extract(epoch FROM created_at)::bigint AS started`,[people.owner.id,people.thread])).rows[0];
  const context={run_id:run.id,principal_user_id:people.owner.id,run_profile:'operator',run_started_s:Number(run.started),transport:'runner_stdio'};
  const show=input();let id;
  await t.test('10 simultaneous same-key calls commit exactly one version and event',async()=>{const results=await Promise.all(Array.from({length:10},()=>core.canvasInternal('show',show,context)));id=results[0].canvas.id;assert.ok(results.every(r=>r.canvas.id===id&&r.selected.version===1));assert.equal((await db.query('SELECT count(*)::int AS n FROM ask_canvas_events WHERE canvas_id=$1',[id])).rows[0].n,1);});
  await t.test('two concurrent CAS updates have one winner',async()=>{const base={canvas_id:id,base_version:1,summary:'CAS',change_note:'Moved step',content:show.content};const r=await Promise.allSettled([core.canvasInternal('update',{...base,request_id:req()},context),core.canvasInternal('update',{...base,request_id:req()},context)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.message,'VERSION_CONFLICT');});
  await t.test('equal source with new request counts as a new whole version',async()=>{const r=await core.canvasInternal('update',{request_id:req(),canvas_id:id,base_version:2,summary:'same source',change_note:'Kept steps',content:show.content},context);assert.equal(r.selected.version,3);assert.equal((await core.canvasGet(id,{version:1,include_source:true})).code.sha256,(await core.canvasGet(id,{version:3,include_source:true})).code.sha256);});
  await t.test('provenance unknown persists full 21 areas and manifest hash without FK',async()=>{const row=(await db.query('SELECT * FROM ask_canvas_versions WHERE canvas_id=$1 AND version=1',[id])).rows[0];assert.equal(row.provenance_complete,false);assert.equal(row.provenance_revision,'0');assert.equal(row.provenance_manifest_hash.length,64);assert.equal(row.baseline_areas.length,21);assert.ok(!row.baseline_areas.includes('ai'));assert.ok(!row.baseline_areas.includes('projects'));});
  await t.test('request, event, pointer and version roll back on rate cap',async()=>{await db.query(`UPDATE ask_canvas_rate_windows SET accepted_count=10`);const before=(await db.query('SELECT count(*)::int AS n FROM ask_canvas_requests')).rows[0].n;await assert.rejects(core.canvasRestore(id,{request_id:req(),base_version:3,restore_version:1}),/QUOTA_EXCEEDED/);assert.equal((await core.canvasGet(id,{})).selected.version,3);assert.equal((await db.query('SELECT count(*)::int AS n FROM ask_canvas_requests')).rows[0].n,before);await db.query('DELETE FROM ask_canvas_rate_windows');});
  await t.test('corrupt global accounting blocks positive writes',async()=>{await db.query(`UPDATE ask_canvas_usage SET bytes=bytes+1 WHERE scope_type='global'`);await assert.rejects(core.canvasRestore(id,{request_id:req(),base_version:3,restore_version:1}),/ASK_PAUSED/);await db.query(`UPDATE ask_canvas_usage SET bytes=bytes-1 WHERE scope_type='global'`);});
  await t.test('per-thread quota checks retained bytes atomically',async()=>{await db.query(`UPDATE ask_canvas_usage SET bytes=20971519 WHERE scope_type='thread' AND scope_id=$1`,[people.thread]);await assert.rejects(core.canvasRestore(id,{request_id:req(),base_version:3,restore_version:1}),/QUOTA_EXCEEDED/);await db.query(`UPDATE ask_canvas_usage SET bytes=(SELECT sum(accounted_bytes) FROM ask_canvas_versions WHERE conversation_id=$1::uuid) WHERE scope_type='thread' AND scope_id=$1`,[people.thread]);});
  await t.test('per-person and run caps cannot be bypassed by retries',async()=>{for(const [scope,scopeId,field,value] of [['owner',people.owner.id,'bytes',209715199],['run',run.id,'version_count',100]]){const previous=(await db.query(`SELECT ${field} AS val FROM ask_canvas_usage WHERE scope_type=$1 AND scope_id=$2`,[scope,scopeId])).rows[0].val;await db.query(`UPDATE ask_canvas_usage SET ${field}=$3 WHERE scope_type=$1 AND scope_id=$2`,[scope,scopeId,value]);await assert.rejects(core.canvasInternal('update',{request_id:req(),canvas_id:id,base_version:3,summary:'cap',change_note:'Cap',content:show.content},context),/QUOTA_EXCEEDED/);await db.query(`UPDATE ask_canvas_usage SET ${field}=$3 WHERE scope_type=$1 AND scope_id=$2`,[scope,scopeId,previous]);}});
  await t.test('staff all-areas still cannot write incomplete context',async()=>{await db.query(`UPDATE users SET permissions=$2 WHERE id=$1`,[people.staff.id,['ai','projects','today','inbox','comms','chat','leads','subs','vendors','site','newsletter','catalog','compliance','warranty','marketing','engine','estimates','invoices','purchase_orders','change_orders','bidding','cost_book','money']]);const thread=(await db.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','Staff',$1) RETURNING id`,[people.staff.id])).rows[0].id;const r=(await db.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('staff','business',$1,$2,'panel_web',true) RETURNING *,extract(epoch FROM created_at)::bigint AS started`,[people.staff.id,thread])).rows[0];await assert.rejects(core.canvasInternal('show',input(),{...context,run_id:r.id,principal_user_id:people.staff.id,run_profile:'business',run_started_s:Number(r.started)}),/CONTEXT_PROVENANCE_INCOMPLETE/);});
  await t.test('invalid start/profile/transport tags never read canvas',async()=>{for(const patch of [{run_started_s:context.run_started_s+1},{run_profile:'business'},{transport:'http'},{conversation_id:people.thread}])await assert.rejects(core.canvasInternal('get',{canvas_id:id},{...context,...patch}),/RUN_CONTEXT_REQUIRED/);});
  await t.test('revocation denies admitted run and old web token',async()=>{await db.query('INSERT INTO session_revocations(user_id,revoked_before) VALUES($1,now()+interval \'1 second\')',[people.owner.id]);await assert.rejects(core.canvasInternal('get',{canvas_id:id},context),/RUN_CONTEXT_REQUIRED/);await assert.rejects(core.canvasGet(id,{}),/ASK_SESSION_REVOKED/);});
 });
 }finally{appPool.query=originalQuery;appPool.connect=originalConnect;globalThis.__phase0aDb=old;}
}));

test('0106 shares durable deletion replay, holds, purge counters and frozen repair',async t=>withTestDb(async(url,c)=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const {bootstrapDeployment}=await import('../lib/ask-deployment-state.mjs');const ledger=await import('../lib/canvas-deletion-ledger.mjs');const journal=await import('../lib/ask-thread-journal.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'c1core-journal-'));const dir=path.join(root,'journal'),deploymentDir=path.join(root,'deployment');await bootstrapDeployment(deploymentDir);
 let entries=[],failed=false;const authority={id:crypto.randomUUID(),async read(){if(failed)throw Error('authority unavailable');return {ledger_id:this.id,...ledger.validateChain(entries),entries};},async advance(expected,next){assert.equal(expected.sequence,entries.length);if(failed)throw Error('authority unavailable');entries=structuredClone(next);return this.read();}};
 const options={dir,deploymentDir,authority};const p=await seedPeople(c);process.env.SJC_ASK_THREAD_DELETE_ACCEPTED='1';
 try{await withSessionIdentity(url,'sjcos_test_website',async db=>{
  const pool={query:(...a)=>db.query(...a)};await ledger.withLedgerLock(dir,()=>journal.recoverThreads(pool,options));
  const run=(await db.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('journal','operator',$1,$2,'panel_web',true) RETURNING id`,[p.owner.id,p.thread])).rows[0].id;
  const make=async()=>{await db.query('BEGIN');try{const id=(await db.query(`INSERT INTO ask_canvases(conversation_id,owner_user_id,created_run_id,kind,baseline_hash) VALUES($1,$2,$3,'diagram',$4) RETURNING id`,[p.thread,p.owner.id,run,'0'.repeat(64)])).rows[0].id;await db.query(`INSERT INTO ask_canvas_versions(canvas_id,version,conversation_id,owner_user_id,actor_user_id,run_id,title,summary,change_note,source_text,source_bytes,source_sha256,provenance_revision,provenance_complete,provenance_manifest_hash,provenance_inputs,baseline_areas,baseline_hash) VALUES($1,1,$2,$3,$3,$4,'Secret','Steps','','flowchart TD',12,$5,0,false,$5,'[]','{}',$5)`,[id,p.thread,p.owner.id,run,'0'.repeat(64)]);await db.query('COMMIT');return id;}catch(e){await db.query('ROLLBACK');throw e;}};
  const id=await make(),op=crypto.randomUUID();
  await t.test('new canvas deletion acknowledges independent high-water plus tombstone',async()=>{assert.deepEqual(await journal.deleteCanvas(pool,id,op,options,p.owner.id),{ok:true,state:'deleted'});assert.equal(entries[0].entity_type,'canvas');assert.equal((await db.query('SELECT deleted_at FROM ask_canvases WHERE id=$1',[id])).rows[0].deleted_at!==null,true);assert.equal((await db.query(`SELECT count(*)::int AS n FROM ask_canvas_events WHERE canvas_id=$1 AND kind='deleted'`,[id])).rows[0].n,1);});
  await t.test('opaque operation replay is idempotent and cannot move to another entity',async()=>{await journal.deleteCanvas(pool,id,op,options,p.owner.id);assert.equal(entries.length,1);await assert.rejects(journal.deleteCanvas(pool,await make(),op,options,p.owner.id),/UNAVAILABLE/);});
  const old=await make(),oldOp=crypto.randomUUID();
  await t.test('dated canvas intent replay and hold keep private bytes counted',async()=>{await ledger.withLedgerLock(dir,async()=>{await ledger.appendLocal(dir,ledger.makeIntent(entries,old,oldOp,new Date(Date.now()-31*86400000),'canvas'));await journal.recoverThreads(pool,options);});await db.query('UPDATE ask_canvases SET hold_until=now()+interval \'1 day\' WHERE id=$1',[old]);await journal.maintainThreads(pool,options);assert.notEqual((await db.query('SELECT source_text FROM ask_canvas_versions WHERE canvas_id=$1',[old])).rows[0].source_text,null);});
  await t.test('purge removes payload once and retains immutable shells/hash/identity',async()=>{await db.query('UPDATE ask_canvases SET hold_until=NULL WHERE id=$1',[old]);const before=Number((await db.query(`SELECT bytes FROM ask_canvas_usage WHERE scope_type='global'`)).rows[0].bytes);await journal.maintainThreads(pool,options);const row=(await db.query('SELECT * FROM ask_canvas_versions WHERE canvas_id=$1',[old])).rows[0];assert.equal(row.source_text,null);assert.equal(row.title,null);assert.ok(row.purged_at);assert.equal(row.source_sha256,'0'.repeat(64));const after=Number((await db.query(`SELECT bytes FROM ask_canvas_usage WHERE scope_type='global'`)).rows[0].bytes);assert.ok(after<before);await journal.maintainThreads(pool,options);assert.equal(Number((await db.query(`SELECT bytes FROM ask_canvas_usage WHERE scope_type='global'`)).rows[0].bytes),after);});
  await t.test('thread replay tombstones canvases through the 0105 transaction',async()=>{const tId=(await db.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','empty',$1) RETURNING id`,[p.owner.id])).rows[0].id;await journal.deleteThread(pool,tId,crypto.randomUUID(),options,p.owner.id);assert.equal(entries.at(-1).entity_type,'thread');});
  await t.test('corrupt counter is repaired under existing lease with no new table',async()=>{await db.query(`UPDATE ask_canvas_usage SET bytes=bytes+42 WHERE scope_type='global'`);await journal.maintainThreads(pool,options);const actual=(await db.query('SELECT COALESCE(sum(accounted_bytes),0)::text AS n FROM ask_canvas_versions')).rows[0].n;assert.equal((await db.query(`SELECT bytes::text AS n FROM ask_canvas_usage WHERE scope_type='global'`)).rows[0].n,actual);});
  await t.test('canvas authority loss and primary-volume reconstruction fail closed then replay',async()=>{failed=true;await assert.rejects(ledger.withLedgerLock(dir,()=>journal.recoverThreads(pool,options)),/unavailable/);assert.equal((await db.query('SELECT recovery_ready FROM ask_canvas_maintenance')).rows[0].recovery_ready,false);failed=false;await rm(dir,{recursive:true,force:true});await ledger.withLedgerLock(dir,()=>journal.recoverThreads(pool,options));assert.equal((await ledger.readLocal(dir)).length,entries.length);});
 });}finally{delete process.env.SJC_ASK_THREAD_DELETE_ACCEPTED;await rm(root,{recursive:true,force:true});}
}));


// Round 2 expectation FIRST: all metadata paths use the authorized design's
// current name, including immutable historical Canvas versions and replay.
test('round 2 floor metadata carries current design_name across API paths',()=>withTestDb(async(url,c)=>{
 const people=await seedPeople(c);process.env.SJC_CANVAS_ENABLED='1';process.env.SESSION_SECRET='canvas-r2-secret-at-least-32-characters';
 const {encrypt}=await import('../lib/session.ts');const {emptyDoc}=await import('../lib/plan-doc.ts');
 await withSessionIdentity(url,'sjcos_test_website',async db=>{
  globalThis.__phase0aDb=db;globalThis.__phase0aCookies={get:()=>({value:token})};const token=await encrypt({userId:people.owner.id,role:'owner',authAt:Math.floor(Date.now()/1000)});
  for(const key of ['canvas.floor_enabled','canvas.diagrams_enabled'])await db.query(`INSERT INTO app_settings(key,value) VALUES($1,'true') ON CONFLICT(key) DO UPDATE SET value='true'`,[key]);
  const project=(await db.query(`INSERT INTO projects(slug,name) VALUES('zz-r2-names','Floor names') RETURNING id`)).rows[0];
  const design=(await db.query(`INSERT INTO plan_designs(project_id,name,doc) VALUES($1,'Kitchen layout',$2) RETURNING *`,[project.id,emptyDoc()])).rows[0];
  const run=(await db.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('names','operator',$1,$2,'panel_web',true) RETURNING *,extract(epoch FROM created_at)::bigint AS started`,[people.owner.id,people.thread])).rows[0];
  const context={run_id:run.id,principal_user_id:people.owner.id,run_profile:'operator',run_started_s:Number(run.started),transport:'runner_stdio'};
  const input={request_id:req(),title:'Canvas title',summary:'Kitchen',required_areas:[],content:{kind:'floor_plan',design_id:design.id,expected_design_rev:0}};
  const made=await core.canvasInternal('show',input,context),id=made.canvas.id;assert.equal(made.selected.design_name,'Kitchen layout');
  await db.query(`UPDATE plan_designs SET name='Renamed kitchen' WHERE id=$1`,[design.id]);
  const check=v=>{assert.equal(v.design_name,'Renamed kitchen');assert.equal(v.title,'Canvas title');assert.equal(v.design.number,1);};
  check((await core.canvasGet(id,{})).selected);check((await core.canvasList(people.thread,{})).canvases[0].latest);check((await core.canvasVersions(id,{})).versions[0]);check((await core.canvasEvents(people.thread,{})).events[0].version);
  check((await core.canvasInternal('show',input,context)).selected);check((await core.canvasRestore(id,{request_id:req(),base_version:1,restore_version:1})).selected);
 });
},{fresh:true}));

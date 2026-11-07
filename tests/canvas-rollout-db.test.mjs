import test from 'node:test';
import assert from 'node:assert/strict';
import {withMigrationSubset} from './_harness/testdb.mjs';
import {listMigrationFiles} from '../db/migrate.mjs';
import {capabilities} from '../lib/ask-thread-journal.mjs';
for(const [name,ids] of [['shared_canvas_phase0',[100,105]]])test(`Phase 0 ${name}: real ordered ledger, flags off, no later Canvas relations`,()=>withMigrationSubset(name,ids,async({db,apply})=>{
 for(const k of ['SJC_CANVAS_ENABLED'])process.env[k]='0';
 await apply();
 assert.deepEqual(await capabilities(db),{thread:true,canvas:false,files:false});
 for(const table of ['ask_canvases','ask_canvas_versions','ask_canvas_saves','ask_context_provenance'])assert.equal((await db.query('SELECT to_regclass($1) AS name',[table])).rows[0].name,null);
 const recorded=(await db.query('SELECT id,checksum FROM schema_migrations WHERE id>=100 ORDER BY id')).rows;
 const expected=listMigrationFiles().filter(f=>ids.includes(f.id));
 assert.deepEqual(recorded.map(r=>[r.id,r.checksum]),expected.map(f=>[f.id,f.checksum]));
 await apply(); // checksum replay, not duplicate DDL
 assert.equal((await db.query('SELECT recovery_ready FROM ask_canvas_maintenance')).rows[0].recovery_ready,false);
}));
test('0105 without 0100 rolls back atomically, then additive 0100+0105 succeeds',()=>withMigrationSubset('missing_shared',[105],async({db,apply})=>{
 await assert.rejects(apply(),/requires shared migration 0100/);
 assert.equal((await db.query(`SELECT to_regclass('ask_canvas_maintenance') AS name`)).rows[0].name,null);
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='ai_conversations' AND column_name='owner_user_id'`)).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM schema_migrations WHERE id=105')).rows[0].n,0);
 await apply([100,105]);assert.equal((await capabilities(db)).thread,true);
 // Add every presently available Browser/Canvas migration, checksummed normally.
 await apply(listMigrationFiles().filter(f=>f.id>=100&&f.id<=109).map(f=>f.id));
}));

test('combined Browser + Phase 0 matrix applies 0100-0105 together and is idempotent',()=>withMigrationSubset('combined_browser',[100,101,102,103,104,105],async({db,apply})=>{
 await apply();
 assert.equal((await db.query('SELECT count(*)::int AS n FROM schema_migrations WHERE id BETWEEN 100 AND 105')).rows[0].n,6);
 for(const t of ['browser_logins','browser_handoffs','browser_actions'])assert.equal((await db.query('SELECT to_regclass($1)::text AS name',[t])).rows[0].name,t);
 await apply();
}));

test('0106 core applies on Canvas-only prerequisites, page predeclared, no provenance FK or narrow grants',()=>withMigrationSubset('canvas_core_only',[100,105,106],async({db,apply,url})=>{
 await apply();assert.deepEqual(await capabilities(db),{thread:true,canvas:true,files:false});
 for(const t of ['ask_canvases','ask_canvas_versions','ask_canvas_requests','ask_canvas_events','ask_canvas_usage','ask_canvas_rate_windows'])assert.equal((await db.query('SELECT to_regclass($1)::text AS name',[t])).rows[0].name,t);
 for(const t of ['ask_context_provenance','ask_canvas_file_saves','ask_canvas_renders'])assert.equal((await db.query('SELECT to_regclass($1) AS name',[t])).rows[0].name,null);
 const refs=(await db.query(`SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conrelid='ask_canvas_versions'::regclass AND contype='f'`)).rows.map(r=>r.target);assert.ok(!refs.some(r=>/provenance/.test(r)));
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_class WHERE relname='ask_canvas_maintenance'`)).rows[0].n,1);
 await apply();
}));

test('Phase 0-only event endpoint stays schema-aware even with Canvas env enabled',()=>withMigrationSubset('canvas_core_not_installed',[100,105],async({db,apply,url})=>{
 await apply();const {appHooks,seedPeople}=await import('./phase0a-fixtures.mjs');appHooks();const p=await seedPeople(db);
 const {withSessionIdentity}=await import('./_harness/testdb.mjs');const core=await import('../lib/ask-canvases.ts');const {encrypt}=await import('../lib/session.ts');
 process.env.SJC_CANVAS_ENABLED='1';process.env.SESSION_SECRET='rollout-cursor-key-at-least-32-characters';const token=await encrypt({userId:p.owner.id,role:'owner',authAt:Math.floor(Date.now()/1000)});globalThis.__phase0aCookies={get:()=>({value:token})};
 await withSessionIdentity(url,'sjcos_test_website',async c=>{globalThis.__phase0aDb=c;const page=await core.canvasEvents(p.thread,{});assert.deepEqual(page.events,[]);assert.equal(page.availability.master,false);await assert.rejects(core.canvasGet(crypto.randomUUID(),{}),/CANVAS_DISABLED/);});
}));

// Expectations: actual Phase-0-only staff runner/tool/question paths work with
// Canvas off; capability changes only after additive production migrations.
test('Phase 0 staff runner, MCP wrapper and question retain legacy operation before additive upgrade',()=>withMigrationSubset('server_legacy',[100,105],async({db,apply,url})=>{
 await apply();
 const {appHooks,seedPeople}=await import('./phase0a-fixtures.mjs');appHooks();const p=await seedPeople(db);
 const {withSessionIdentity}=await import('./_harness/testdb.mjs');
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const path=await import('node:path');const {tmpdir}=await import('node:os');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const {trackingAvailable,trackedInteractions,createContextAdapter}=await import('../lib/ask-context-inputs.mjs');
 const {createInteractionAdapter}=await import('../lib/ask-thread-journal-transport.mjs');const {interactionCommand}=await import('../lib/ask-thread-journal-interactions.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'c1-legacy-')),before={...process.env},fetch=globalThis.fetch;let server;
 try{await withSessionIdentity(url,'sjcos_test_website',async c=>{
  globalThis.__phase0aDb=c;assert.equal(await trackingAvailable(c),false);
  const thread=(await c.query(`INSERT INTO ai_conversations(agent,owner_user_id) VALUES('claude',$1) RETURNING id`,[p.staff.id])).rows[0].id;
  const run=(await c.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('ordinary staff question','business',$1,$2,'panel_web',true) RETURNING id,extract(epoch FROM created_at)::bigint AS started`,[p.staff.id,thread])).rows[0];
  Object.assign(process.env,{SJC_CANVAS_ENABLED:'0',DATABASE_URL_AGENT:url,SJC_RUN_ID:run.id,SJC_CONVERSATION_ID:thread,SJC_PRINCIPAL_USER_ID:p.staff.id,SJC_RUN_PROFILE:'business',SJC_RUN_STARTED_S:String(run.started),CRON_SECRET:'legacy-test',APP_INTERNAL_URL:'http://127.0.0.1:1'});
  const {buildServer}=await import('../mcp/sjcos-mcp.mjs');server=buildServer({transportKind:'stdio'});
  const result=await server._registeredTools.list_projects.handler({},{});assert.ok(!result.isError,JSON.stringify(result));
  const slug='zz-phase0-files';await c.query("INSERT INTO projects(slug,name,status) VALUES($1,'Phase 0 files','floor_plan')",[slug]);
  const files=await server._registeredTools.list_project_files.handler({project_slug:slug},{});assert.ok(!files.isError,JSON.stringify(files));
  const {canvasFilePredicate,resolveCanvasFilePolicy}=await import('../lib/canvas-file-access.ts');
  assert.equal(await canvasFilePredicate('f',p.staff),'true');assert.deepEqual(await resolveCanvasFilePolicy({principal:p.staff,fileId:'missing',operation:'read'}),{ordinary:true});
  globalThis.fetch=async(u,opts)=>{assert.equal(new URL(u).pathname,'/api/internal/ask-interactions');const b=JSON.parse(opts.body);return Response.json(await interactionCommand({query:(...a)=>c.query(...a)},b.action,b.input,b.context));};
  const adapter=trackedInteractions(createInteractionAdapter({transportKind:'stdio'}),createContextAdapter({transportKind:'stdio',trackingAvailable:()=>trackingAvailable(c),internalCall(){assert.fail('Phase 0 must never call provenance route');}}));
  const id=await adapter.create('question',{questions:[{question:'Which finish?',options:[{label:'Oak'},{label:'Paint'}],multiSelect:false,allowOther:true}]});
  await c.query(`UPDATE agent_interactions SET status='answered',response=$2 WHERE id=$1`,[id,{kind:'question',answers:[{question:'Which finish?',choices:['Oak']}]}]);
  assert.match((await adapter.beforeDeliver(id)).answer,/Joe's answer: Oak/);
  await db.query('ALTER ROLE sjcos_test_website LOGIN');const database=new URL(url);database.username='sjcos_test_website';
  const fake=path.join(dir,'cli');await writeFile(fake,`#!/usr/bin/env node\nprocess.stdin.once('data',()=>{console.log(JSON.stringify({type:'user',isReplay:true}));console.log(JSON.stringify({type:'result',subtype:'success',result:'Ordinary Phase 0 answer',num_turns:1}));});process.stdin.on('end',()=>process.exit(0));\n`,{mode:0o700});
  await promisify(execFile)(process.execPath,['scripts/run-claude-agent.mjs',run.id],{timeout:20000,env:{...process.env,DATABASE_URL:database.toString(),DATABASE_URL_AGENT:database.toString(),CLAUDE_BIN:fake,SJC_CANVAS_DELETION_LEDGER_DIR:path.join(dir,'journal')}});
  const finished=(await c.query('SELECT status,answer FROM dev_agent_runs WHERE id=$1',[run.id])).rows[0];assert.equal(finished.status,'done',finished.answer);
  assert.equal(await trackingAvailable(c),false);
 });
 await apply([106,107,108]);assert.equal(await trackingAvailable(db),true);
 await db.query('BEGIN');try{await db.query('ALTER TABLE ask_context_provenance RENAME TO temporarily_missing_provenance');await assert.rejects(trackingAvailable(db),/CONTEXT_PROVENANCE_INCOMPLETE/);}finally{await db.query('ROLLBACK');}
 let installed=true;const latched=createContextAdapter({transportKind:'stdio',trackingAvailable:async()=>installed,internalCall(){assert.fail('capability only');}});
 assert.equal(await latched.enabled(),true);installed=false;await assert.rejects(latched.enabled(),/CONTEXT_PROVENANCE_INCOMPLETE/);
 }finally{globalThis.fetch=fetch;await server?.close();for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
}));

test('0109 upgrades the recorded 0107 control helper without checksum changes or narrow grants',()=>withMigrationSubset('canvas_control_upgrade',[100,105,106,107,108],async({db,apply,url})=>{
 await apply();
 const recorded=(await db.query('SELECT id,checksum FROM schema_migrations WHERE id>=100 ORDER BY id')).rows;
 assert.deepEqual(recorded.map(r=>[r.id,r.checksum]),listMigrationFiles().filter(f=>[100,105,106,107,108].includes(f.id)).map(f=>[f.id,f.checksum]));
 const before=(await db.query("SELECT pg_get_functiondef('ask_canvas_instruction(uuid,text)'::regprocedure) AS body")).rows[0].body;
 assert.doesNotMatch(before,/Mermaid could not parse/);
 await apply([100,105,106,107,108,109]);
 const after=(await db.query("SELECT pg_get_functiondef('ask_canvas_instruction(uuid,text)'::regprocedure) AS body")).rows[0].body;
 assert.match(after,/Mermaid could not parse/);assert.match(after,/SECURITY DEFINER/);assert.match(after,/search_path TO 'public', 'pg_temp'/);
 assert.deepEqual((await db.query('SELECT id,checksum FROM schema_migrations WHERE id>=100 AND id<109 ORDER BY id')).rows,recorded);
 const {withSessionIdentity}=await import('./_harness/testdb.mjs');
 for(const role of ['sjcos_agent','sjcos_worker','sjcos_readonly'])await withSessionIdentity(url,role,async narrow=>{
  await assert.rejects(narrow.query("SELECT * FROM ask_canvas_instruction($1,'Show permit steps.')",[crypto.randomUUID()]),e=>e.code==='42501');
 });
 await apply([100,105,106,107,108,109]); // exact checksum replay
}));

// Round 1 expectations FIRST: declared 0114 support, real ordered/checksummed
// Canvas-only replay, no Browser relations, page/floor command lifecycle, and
// atomic failure when 0114's core dependency is missing.
const canvas23Ids=[100,105,106,107,108,109,114];
async function noBrowser(db){
 // Shared prerequisite 0100 intentionally creates inert Browser core tables.
 // Only the relations belonging to omitted 0101–0104 must remain absent.
 for(const table of ['browser_logins','browser_login_access','browser_profiles','browser_file_links','browser_handoff_attempts','browser_handoff_outcomes','browser_notification_deliveries','browser_actions','browser_artifacts','browser_handoffs','browser_handoff_effects','browser_handoff_reconciliations'])assert.equal((await db.query('SELECT to_regclass($1) name',[table])).rows[0].name,null,table);
 assert.equal((await db.query('SELECT count(*)::int n FROM schema_migrations WHERE id BETWEEN 101 AND 104')).rows[0].n,0);
}
test('0114 without Canvas core fails atomically without DDL or a ledger row',()=>withMigrationSubset('canvas23_dependency',[100,105,114],async({db,apply})=>{
 await apply([100,105]);await noBrowser(db);
 await assert.rejects(apply([114]),/0114 requires 0106/);
 for(const table of ['ask_canvas_floor_refs','ask_canvas_versions'])assert.equal((await db.query('SELECT to_regclass($1) name',[table])).rows[0].name,null);
 assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='plan_design_versions' AND column_name IN ('doc_sha256','source_rev')")).rows[0].n,0);
 assert.equal((await db.query("SELECT to_regprocedure('plan_snapshot_hash(jsonb)') name")).rows[0].name,null);
 assert.equal((await db.query('SELECT count(*)::int n FROM schema_migrations WHERE id=114')).rows[0].n,0);
 await apply(canvas23Ids);await noBrowser(db);
}));
test('Canvas-only 2+3 matrix: pages/floors show update no-op replay restore and exact migration ledger',()=>withMigrationSubset('canvas23_lifecycle',canvas23Ids,async({db,apply,url})=>{
 await apply();await noBrowser(db);
 const ledger=async()=>(await db.query('SELECT id,name,checksum,applied_at FROM schema_migrations ORDER BY id')).rows;
 const before=await ledger();const feature=before.filter(r=>r.id>=100);
 assert.deepEqual(feature.map(r=>[r.id,r.checksum]),listMigrationFiles().filter(f=>canvas23Ids.includes(f.id)).map(f=>[f.id,f.checksum]));
 await apply();assert.deepEqual(await ledger(),before);
 const {appHooks,seedPeople}=await import('./phase0a-fixtures.mjs');appHooks();const people=await seedPeople(db);
 const {withSessionIdentity}=await import('./_harness/testdb.mjs'),core=await import('../lib/ask-canvases.ts'),{encrypt}=await import('../lib/session.ts');
 const {emptyDoc}=await import('../lib/plan-doc.ts'),{applyOps}=await import('../lib/plan-ops.ts');
 process.env.SJC_CANVAS_ENABLED='1';process.env.SESSION_SECRET='canvas23-rollout-secret-at-least-32-characters';
 await withSessionIdentity(url,'sjcos_test_website',async c=>{
  globalThis.__phase0aDb=c;const token=await encrypt({userId:people.owner.id,role:'owner',authAt:Math.floor(Date.now()/1000)});globalThis.__phase0aCookies={get:()=>({value:token})};
  await c.query("INSERT INTO app_settings(key,value) VALUES('canvas.pages_enabled','true'),('canvas.floor_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'");
  const run=(await c.query("INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('rollout','operator',$1,$2,'panel_web',true) RETURNING id,extract(epoch FROM created_at)::bigint started",[people.owner.id,people.thread])).rows[0];
  const ctx={run_id:run.id,principal_user_id:people.owner.id,run_profile:'operator',run_started_s:Number(run.started),transport:'runner_stdio'},request=()=>crypto.randomUUID();
  const show={request_id:request(),title:'Weekly board',summary:'Work this week',required_areas:[],content:{kind:'page',source:'<h1>Weekly board</h1><p>Inspect the kitchen.</p>'}};
  const page=await core.canvasInternal('show',show,ctx);assert.deepEqual(await core.canvasInternal('show',show,ctx),page);
  const update={request_id:request(),canvas_id:page.canvas.id,base_version:1,summary:'Updated board',change_note:'Added inspection',content:{kind:'page',source:'<h1>Weekly board</h1><p>Inspection complete.</p>'}};
  const page2=await core.canvasInternal('update',update,ctx);assert.equal(page2.selected.version,2);assert.deepEqual(await core.canvasInternal('update',update,ctx),page2);
  // Pages intentionally keep a new whole version even when bytes are equal.
  const equal={...update,request_id:request(),base_version:2};const page3=await core.canvasInternal('update',equal,ctx);assert.equal(page3.changed,true);assert.equal(page3.selected.version,3);
  const restore={request_id:request(),base_version:3,restore_version:1};const page4=await core.canvasRestore(page.canvas.id,restore);assert.equal(page4.selected.version,4);assert.deepEqual(await core.canvasRestore(page.canvas.id,restore),page4);
  const pageRead=await core.canvasGet(page.canvas.id,{include_source:true});assert.equal(pageRead.code.code,show.content.source);assert.equal(pageRead.preview.mode,'static_page');
  const project=(await c.query("INSERT INTO projects(slug,name) VALUES('zz-canvas23-rollout','Rollout') RETURNING id")).rows[0];
  const doc=applyOps(emptyDoc(),[{op:'addRoomRect',p:{x:0,y:0},q:{x:156,y:132},name:'Kitchen'}]);
  const design=(await c.query("INSERT INTO plan_designs(project_id,name,doc) VALUES($1,'Kitchen',$2) RETURNING id",[project.id,doc])).rows[0];
  const floorInput={request_id:request(),title:'Kitchen plan',summary:'Kitchen layout',required_areas:[],content:{kind:'floor_plan',design_id:String(design.id),expected_design_rev:0}};
  const floor=await core.canvasInternal('show',floorInput,ctx);assert.deepEqual(await core.canvasInternal('show',floorInput,ctx),floor);
  const same={request_id:request(),base_version:1,expected_design_rev:0};const noop=await core.canvasFloorLatest(floor.canvas.id,same);assert.equal(noop.changed,false);assert.equal(noop.selected.version,1);assert.deepEqual(await core.canvasFloorLatest(floor.canvas.id,same),noop);
  const changed=applyOps(doc,[{op:'addNote',at:{x:10,y:10},text:'Inspection complete'}]);await c.query('UPDATE plan_designs SET doc=$2,rev=rev+1 WHERE id=$1',[design.id,changed]);
  const load={request_id:request(),base_version:1,expected_design_rev:1};const floor2=await core.canvasFloorLatest(floor.canvas.id,load);assert.equal(floor2.changed,true);assert.equal(floor2.selected.version,2);assert.deepEqual(await core.canvasFloorLatest(floor.canvas.id,load),floor2);
  const revert={request_id:request(),base_version:2,restore_version:1};const floor3=await core.canvasRestore(floor.canvas.id,revert);assert.equal(floor3.selected.version,3);assert.equal(floor3.selected.design.snapshot_id,floor.selected.design.snapshot_id);assert.deepEqual(await core.canvasRestore(floor.canvas.id,revert),floor3);
  assert.deepEqual((await c.query('SELECT doc FROM plan_designs WHERE id=$1',[design.id])).rows[0].doc,changed);
  const read=await core.canvasGet(floor.canvas.id,{});assert.equal(read.floor.number,floor.selected.design.number);assert.equal(read.floor.can_edit,true);assert.equal(read.floor.changed,true);
  assert.equal((await c.query('SELECT count(*)::int n FROM ask_canvas_versions WHERE canvas_id=$1',[floor.canvas.id])).rows[0].n,3);
  assert.equal((await c.query('SELECT count(*)::int n FROM plan_design_versions WHERE design_id=$1',[design.id])).rows[0].n,2);
 });
 await apply();assert.deepEqual(await ledger(),before);await noBrowser(db);
}));

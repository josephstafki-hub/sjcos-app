import test from 'node:test';
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import path from 'node:path';
import {withTestDb,withSessionIdentity} from './_harness/testdb.mjs';
import {appHooks,seedPeople} from './phase0a-fixtures.mjs';
appHooks();
const core=await import('../lib/ask-canvases.ts'),exports=await import('../lib/canvas-exports.ts');
const uuid=()=>crypto.randomUUID(),svg='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="10" y="20">Permit</text></svg>';
test('immutable SVG and saved snapshot policy, real session identities',()=>withTestDb(async(url,admin)=>{
 const people=await seedPeople(admin);process.env.SJC_CANVAS_ENABLED='1';process.env.SESSION_SECRET='canvas-files-test-secret-32-characters';
 const {encrypt}=await import('../lib/session.ts');let file,crashFile;
 try{await withSessionIdentity(url,'sjcos_test_website',async db=>{
 globalThis.__phase0aDb=db;const authAt=Math.floor(Date.now()/1000);const token=await encrypt({userId:people.owner.id,role:'owner',authAt});globalThis.__phase0aCookies={get:()=>({value:token})};
 await db.query(`INSERT INTO app_settings(key,value) VALUES('canvas.diagrams_enabled','true'),('canvas.exports_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'`);
 const project=(await db.query("INSERT INTO projects(slug,name) VALUES('zz-canvas-files','Canvas files') RETURNING id,slug")).rows[0];assert.ok(project);
 const run=(await db.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('canvas','operator',$1,$2,'panel_web',true) RETURNING *,extract(epoch FROM created_at)::bigint AS started`,[people.owner.id,people.thread])).rows[0];
 const context={run_id:run.id,principal_user_id:people.owner.id,run_profile:'operator',run_started_s:Number(run.started),transport:'runner_stdio'};
 const made=await core.canvasInternal('show',{request_id:uuid(),project_slug:project.slug,title:'Permit',required_areas:[],summary:'Permit steps',content:{kind:'diagram',source:'flowchart TD\n A-->B'}},context),id=made.canvas.id;
 assert.equal((await core.canvasGet(id)).availability.exports,true);
 await assert.rejects(exports.canvasDrawing(id,1),/EXPORT_NOT_READY/);
 const d=await exports.canvasRender(id,1,{svg});assert.match(d.sha256,/^[a-f0-9]{64}$/);assert.deepEqual(await exports.canvasRender(id,1,{svg}),d);
 await assert.rejects(exports.canvasRender(id,1,{svg:svg.replace('Permit','Changed')}),/RENDERER_HASH_CONFLICT/);
 await assert.rejects(exports.canvasRender(id,1,{svg:'<svg onload="alert(1)"/>'}));
 assert.equal((await db.query('SELECT count(*)::int AS n FROM ask_canvas_derivatives')).rows[0].n,1);
 const p=await exports.canvasSavePolicy(id,1,project.slug);assert.equal(p.baseline_source,'unknown_context');assert.equal(p.baseline_areas.length,21);
 const body={request_id:uuid(),project_slug:project.slug,expected_policy_revision:p.policy_revision};
 await assert.rejects(exports.canvasSave(id,1,{...body,audience:{kind:'staff',required_areas:[]}}),/SAVE_FAILED/);
 const ack=await exports.canvasAcknowledge(id,1,{project_slug:project.slug,expected_policy_revision:p.policy_revision,removed_areas:p.baseline_areas});
 await assert.rejects(exports.canvasSave(id,1,{...body,audience:{kind:'staff',required_areas:[p.baseline_areas[0]]},declassification_ack:ack.token}),/SAVE_FAILED/);
 const saved=await exports.canvasSave(id,1,{...body,audience:{kind:'staff',required_areas:[]},declassification_ack:ack.token});file=saved.file.id;assert.equal(saved.effective_policy.kind,'staff');assert.equal(saved.generation,1);
 const replay=await exports.canvasSave(id,1,{...body,audience:{kind:'staff',required_areas:[]},declassification_ack:ack.token});assert.equal(replay.file.id,file);assert.equal(replay.replayed,true);
 await assert.rejects(exports.canvasSave(id,1,{...body,filename:'Different.html'}),/IDEMPOTENCY_CONFLICT/);
 const row=(await db.query('SELECT * FROM files WHERE id=$1',[file])).rows[0];assert.equal(row.security_profile,'canvas_static_v1');assert.equal(row.client_visible,false);
 await assert.rejects(db.query('UPDATE files SET client_visible=true WHERE id=$1',[file]));
 await assert.rejects(db.query("UPDATE files SET storage_path='bad' WHERE id=$1",[file]));
 await assert.rejects(db.query('DELETE FROM files WHERE id=$1',[file]));
 const carriers=(await db.query("SELECT DISTINCT conrelid::regclass::text AS tab FROM pg_constraint WHERE contype='f' AND confrelid='files'::regclass AND conrelid<>'ask_canvas_file_saves'::regclass")).rows;
 for(const carrier of carriers)assert.equal((await db.query("SELECT 1 FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname='guard_canvas_external_reference'",[carrier.tab])).rowCount,1);
 for(const role of ['sjcos_agent','sjcos_worker','sjcos_readonly'])await withSessionIdentity(url,role,async narrow=>{
  for(const table of ['ask_canvas_derivatives','ask_canvas_file_saves','ask_canvas_derivative_usage'])await assert.rejects(narrow.query(`SELECT * FROM ${table}`),e=>e.code==='42501');
  assert.equal((await narrow.query('SELECT id FROM files WHERE id=$1',[file])).rowCount,0);
 });


 const changed=(await db.query('SELECT classification_revision FROM ask_canvases WHERE id=$1',[id])).rows[0].classification_revision;
 await db.query('UPDATE ask_canvases SET classification_revision=classification_revision+1 WHERE id=$1',[id]);
 await assert.rejects(exports.canvasSave(id,1,{...body,request_id:uuid(),audience:{kind:'staff',required_areas:[]},declassification_ack:ack.token}),/SAVE_POLICY_CHANGED/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM files WHERE security_profile IS NOT NULL')).rows[0].n,1);
 const other=(await db.query("INSERT INTO projects(slug,name) VALUES('zz-other-canvas','Other') RETURNING slug")).rows[0];
 await assert.rejects(exports.canvasSavePolicy(id,1,other.slug),/CANVAS_UNAVAILABLE/);
 const access=await import('../lib/canvas-file-access.ts');
 assert.equal((await access.resolveCanvasFilePolicy({principal:{id:people.noAi.id},fileId:file,operation:'read'})),null);
 await db.query("UPDATE users SET permissions=ARRAY['projects'] WHERE id=$1",[people.noAi.id]);
 assert.equal((await access.resolveCanvasFilePolicy({principal:{id:people.noAi.id},fileId:file,operation:'read'})).profile,'canvas_static_v1');
 assert.equal(await access.resolveCanvasFilePolicy({principal:null,fileId:file,operation:'read'}),null);
 assert.equal(await access.resolveCanvasFilePolicy({principal:{id:people.owner.id},fileId:file,operation:'delivery'}),null);
 await access.canvasFileLifecycle({id:people.owner.id},file,'trash');
 assert.equal((await db.query('SELECT state FROM ask_canvas_file_saves WHERE reserved_file_id=$1',[file])).rows[0].state,'trashed');
 await access.canvasFileLifecycle({id:people.noAi.id},file,'restore');
 assert.equal((await db.query('SELECT file_id FROM ask_canvas_file_saves WHERE reserved_file_id=$1',[file])).rows[0].file_id,file);

 // Crash after immutable blob publication but before ready transaction; timer resumes it.
 const c2=(await core.canvasInternal('show',{request_id:uuid(),project_slug:project.slug,title:'Recovery',summary:'Steps',required_areas:[],content:{kind:'diagram',source:'flowchart TD\n A-->C'}},context)).canvas.id;
 await exports.canvasRender(c2,1,{svg});const p2=await exports.canvasSavePolicy(c2,1,project.slug);
 let crash=true;globalThis.__phase0aDb={query:async(sql,args)=>{if(crash&&/INSERT INTO files\(/.test(sql)){crash=false;throw Error('SIMULATED_READY_CRASH');}return db.query(sql,args);}};
 await assert.rejects(exports.canvasSave(c2,1,{request_id:uuid(),project_slug:project.slug,expected_policy_revision:p2.policy_revision}),/SIMULATED_READY_CRASH/);
 globalThis.__phase0aDb=db;
 const pending=(await db.query('SELECT * FROM ask_canvas_file_saves WHERE canvas_id=$1',[c2])).rows[0];crashFile=pending.reserved_file_id;assert.equal(pending.state,'pending');assert.equal(pending.file_id,null);
 const {acquireLease,checkLease}=await import('../lib/ask-thread-journal.mjs');const lease=await acquireLease(db);
 await exports.canvasFileMaintenance({connect:async()=>({query:(...args)=>db.query(...args),release(){}})},lease,checkLease,Date.now()+10000);
 assert.equal((await db.query('SELECT state FROM ask_canvas_file_saves WHERE canvas_id=$1',[c2])).rows[0].state,'ready');
 await db.query('UPDATE ask_canvas_maintenance SET recovery_ready=true,lease_expires_at=NULL WHERE singleton');
 const quotaId=(await core.canvasInternal('show',{request_id:uuid(),project_slug:project.slug,title:'Quota',summary:'Steps',required_areas:[],content:{kind:'diagram',source:'flowchart TD\n A-->D'}},context)).canvas.id;
 await db.query("UPDATE ask_canvas_rate_windows SET accepted_count=10 WHERE actor_user_id=$1 AND action_bucket='render'",[people.owner.id]);
 await assert.rejects(exports.canvasRender(quotaId,1,{svg}),e=>core.canvasFailure(e).code==='QUOTA_EXCEEDED');
 assert.equal((await db.query('SELECT 1 FROM ask_canvas_derivatives WHERE canvas_id=$1',[quotaId])).rowCount,0);

 await db.query("INSERT INTO session_revocations(user_id,revoked_before) VALUES($1,now()+interval '1 minute')",[people.owner.id]);
 await assert.rejects(exports.canvasDrawing(id,1),/ASK_SESSION_REVOKED/);
 });}finally{for(const id of [file,crashFile].filter(Boolean))await unlink(path.join(process.cwd(),'uploads',id+'.html')).catch(()=>{});}
}));

test('tracked staff save derives only content areas, never held areas or owner controls',()=>withTestDb(async(url,admin)=>{
 const people=await seedPeople(admin);const {admitEpoch,hashBytes}=await import('../lib/ask-context-inputs.mjs');const {encrypt}=await import('../lib/session.ts');let file;
 try{await withSessionIdentity(url,'sjcos_test_website',async db=>{
 globalThis.__phase0aDb=db;await db.query("UPDATE users SET permissions=ARRAY['ai','projects','bidding','money'] WHERE id=$1",[people.staff.id]);
 const thread=(await db.query("INSERT INTO ai_conversations(agent,owner_user_id) VALUES('claude',$1) RETURNING id",[people.staff.id])).rows[0].id;
 const project=(await db.query("INSERT INTO projects(slug,name) VALUES('zz-staff-files','Staff files') RETURNING *")).rows[0];
 await db.query("INSERT INTO app_settings(key,value) VALUES('canvas.staff_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'");
 const run=(await db.query("INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('Show permit steps.','business',$1,$2,'panel_web',true) RETURNING *,extract(epoch FROM created_at)::bigint AS started",[people.staff.id,thread])).rows[0];
 await admitEpoch({client:db,threadId:thread,runId:run.id,policyHash:hashBytes('policy'),valid:true,resumed:false});
 const ctx={run_id:run.id,principal_user_id:people.staff.id,run_profile:'business',run_started_s:Number(run.started),transport:'runner_stdio'};
 const id=(await core.canvasInternal('show',{request_id:uuid(),project_slug:project.slug,title:'Permit',summary:'Steps',required_areas:[],content:{kind:'diagram',source:'flowchart TD\n A-->B'}},ctx)).canvas.id;
 const token=await encrypt({userId:people.staff.id,role:'staff',authAt:Math.floor(Date.now()/1000)});globalThis.__phase0aCookies={get:()=>({value:token})};
 await exports.canvasRender(id,1,{svg});const p=await exports.canvasSavePolicy(id,1,project.slug);assert.deepEqual(p.baseline_areas,[]);assert.equal(p.owner,false);
 const body={request_id:uuid(),project_slug:project.slug,expected_policy_revision:p.policy_revision};
 await assert.rejects(exports.canvasSave(id,1,{...body,audience:{kind:'owner_only'}}),/INVALID_INPUT/);
 await assert.rejects(exports.canvasSave(id,1,{...body,declassification_ack:'fake'}),/INVALID_INPUT/);
 await assert.rejects(exports.canvasAcknowledge(id,1,{project_slug:project.slug,expected_policy_revision:p.policy_revision,removed_areas:[]}),/CANVAS_UNAVAILABLE/);
 const saved=await exports.canvasSave(id,1,body);file=saved.file.id;assert.deepEqual(saved.effective_policy.required_areas,[]);assert.equal(saved.effective_policy.kind,'staff');
 await db.query("UPDATE users SET permissions=ARRAY['projects'] WHERE id=$1",[people.noAi.id]);const {resolveCanvasFilePolicy,canvasFilePredicate}=await import('../lib/canvas-file-access.ts');
 assert.equal((await db.query(`SELECT id FROM files f WHERE id=$1 AND ${await canvasFilePredicate('f',people.owner)}`,[file])).rowCount,1);
 assert.equal((await resolveCanvasFilePolicy({principal:people.noAi,fileId:file,operation:'read'})).profile,'canvas_static_v1');
 });}finally{if(file)await unlink(path.join(process.cwd(),'uploads',file+'.html')).catch(()=>{});}
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import {unlink,readFile} from 'node:fs/promises';
import {withTestDb,withSessionIdentity} from './_harness/testdb.mjs';
import {appHooks,seedPeople} from './phase0a-fixtures.mjs';
appHooks();
const core=await import('../lib/ask-canvases.ts'),out=await import('../lib/canvas-exports.ts'),access=await import('../lib/canvas-file-access.ts');
const uuid=()=>crypto.randomUUID();
test('saved copies survive source purge; retained policies and conflicting restores',()=>withTestDb(async(url,admin)=>{
 const people=await seedPeople(admin);process.env.SJC_CANVAS_ENABLED='1';process.env.SESSION_SECRET='canvas-retention-32-character-secret';const files=[];
 try{await withSessionIdentity(url,'sjcos_test_website',async db=>{
 globalThis.__phase0aDb=db;const {encrypt}=await import('../lib/session.ts');let token=await encrypt({userId:people.owner.id,role:'owner',authAt:Math.floor(Date.now()/1000)});globalThis.__phase0aCookies={get:()=>({value:token})};
 await db.query(`INSERT INTO app_settings(key,value) VALUES('canvas.diagrams_enabled','true'),('canvas.exports_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'`);
 const project=(await db.query("INSERT INTO projects(slug,name) VALUES('zz-retention','Retention') RETURNING *")).rows[0];
 const run=(await db.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('canvas','operator',$1,$2,'panel_web',true) RETURNING *,extract(epoch FROM created_at)::bigint AS started`,[people.owner.id,people.thread])).rows[0];
 const ctx={run_id:run.id,principal_user_id:people.owner.id,run_profile:'operator',run_started_s:Number(run.started),transport:'runner_stdio'};
 const id=(await core.canvasInternal('show',{request_id:uuid(),title:'Permit',summary:'Steps',project_slug:project.slug,required_areas:[],content:{kind:'diagram',source:'flowchart TD\n A-->B'}},ctx)).canvas.id;
 await out.canvasRender(id,1,{svg:'<svg width="10" height="10"><path d="M0 0 L10 10"/></svg>'});
 const p=await out.canvasSavePolicy(id,1,project.slug),body={request_id:uuid(),project_slug:project.slug,expected_policy_revision:p.policy_revision};
 const first=await out.canvasSave(id,1,body);files.push(first.file.id);assert.equal(first.effective_policy.kind,'owner_only');
 await access.canvasFileLifecycle({id:people.owner.id},first.file.id,'trash');
 await assert.rejects(out.canvasSave(id,1,{...body,request_id:uuid()}),/SAVE_POLICY_CONFLICT/);
 const second=await out.canvasSave(id,1,{...body,request_id:uuid(),save_another_copy:true});files.push(second.file.id);assert.equal(second.generation,2);
 await assert.rejects(access.canvasFileLifecycle({id:people.owner.id},first.file.id,'restore'),/FILE_RESTORE_CONFLICT/);
 assert.equal((await db.query('SELECT state FROM ask_canvas_file_saves WHERE reserved_file_id=$1',[first.file.id])).rows[0].state,'trashed');
 await db.query('BEGIN');await db.query("SELECT set_config('sjcos.ask_purge','yes',true)");
 await db.query("UPDATE ask_canvases SET deleted_at=now()-interval '744 hours',purge_after=now()-interval '24 hours',deletion_sequence=1 WHERE id=$1",[id]);
 await db.query("UPDATE ask_canvas_versions SET title=NULL,summary=NULL,change_note=NULL,source_text=NULL,canonical_content=NULL,purged_at=now() WHERE canvas_id=$1",[id]);
 await db.query('COMMIT');
 const derivative=(await db.query('SELECT svg,purged_at FROM ask_canvas_derivatives WHERE canvas_id=$1',[id])).rows[0];assert.equal(derivative.svg,null);assert.ok(derivative.purged_at);
 assert.equal(Number((await db.query("SELECT bytes FROM ask_canvas_derivative_usage WHERE scope_type='global'")).rows[0].bytes),0);
 assert.equal((await access.resolveCanvasFilePolicy({principal:{id:people.owner.id},fileId:second.file.id,operation:'read'})).profile,'canvas_static_v1');
 assert.match(await readFile('uploads/'+second.file.id+'.html','utf8'),/Internal draft/);
 await assert.rejects(out.canvasDrawing(id,1),/CANVAS_UNAVAILABLE/);
 });}finally{await Promise.all(files.map(id=>unlink('uploads/'+id+'.html').catch(()=>{})));}
}));

#!/usr/bin/env node
// Never resolve .env.local: the only target is the explicit positional URL.
const target = process.argv[2];
let parsed;
try { parsed = new URL(target); } catch { throw Error('Usage: node scripts/qa-seed-canvas.mjs <DATABASE_URL> (sjcos_qa_* only)'); }
const database = decodeURIComponent(parsed.pathname.slice(1));
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !/^sjcos_qa_[a-z0-9_]+$/.test(database)) throw Error('QA_ONLY: database name must start with sjcos_qa_');
// Safety check above precedes even the test fixture imports or a pg constructor.
const {mkdtempSync,rmSync} = await import('node:fs');
const {tmpdir} = await import('node:os');
const path = await import('node:path');
const journalDir=mkdtempSync(path.join(tmpdir(),'sjcos-qa-canvas-journal-'));
process.env.SJC_CANVAS_DELETION_LEDGER_DIR=journalDir;
process.once('exit',()=>rmSync(journalDir,{recursive:true,force:true}));
// Never inherit a live deletion authority endpoint from the launching shell.
for(const key of Object.keys(process.env))if(/^SJC_CANVAS_(?:AUTHORITY_|LEDGER_ID|JOURNAL_KEY)/.test(key))delete process.env[key];
delete process.env.SJC_ASK_THREAD_DELETE_ACCEPTED;
process.env.SJC_OUTBOUND_DISABLED = '1';
process.env.SJC_CANVAS_ENABLED = '1';
const {appHooks} = await import('../tests/phase0a-fixtures.mjs');
appHooks(); // Same native TS + alias + DB seam as canvas-commands-db.test.mjs.
const {default:pg} = await import('../lib/guarded-pg.mjs');
const {randomUUID} = await import('node:crypto');
const {beginInput,completeInput,admitEpoch,hashBytes} = await import('../lib/ask-context-inputs.mjs');
const {classifyToolAreas,CLASSIFICATION_REGISTRY} = await import('../lib/canvas-classification.mjs');
const {canvasInternal} = await import('../lib/ask-canvases.ts');
const db = new pg.Client({connectionString:target});
const states = {};
const output = (key, threadId, result) => {
 const canvasId=result.canvas.id, version=result.selected.version;
 states[key]={threadId,canvasId,version,urls:{panel:`/panel?c=${threadId}`,wrapper:`/panel/canvas/${canvasId}?v=${version}`}};
};
await db.connect();
try {
 // Use the existing website table-owner identity, as the DB contract requires.
 // A superuser QA restore may SET SESSION AUTHORIZATION to it; no ownership,
 // grants, roles, or objects are changed (unlike the fresh-DB test fixture).
 const identity=(await db.query(`SELECT current_database() AS db,session_user,pg_get_userbyid(relowner) AS website FROM pg_class WHERE oid='public.dev_agent_runs'::regclass`)).rows[0];
 if(identity.db!==database)throw Error('QA_ONLY: connected database mismatch');
 if(identity.session_user!==identity.website)await db.query(`SET SESSION AUTHORIZATION "${identity.website.replaceAll('"','""')}"`);
 globalThis.__phase0aDb=db;
 const {withAskJournal}=await import('../lib/ask-thread-journal.mjs');
 const {pool}=await import('@/lib/db');
 await withAskJournal(pool,async()=>{});
 await db.query(`INSERT INTO app_settings(key,value) VALUES ('canvas.pages_enabled','true'),('canvas.diagrams_enabled','true'),('canvas.staff_enabled','true'),('canvas.exports_enabled','true'),('canvas.source_enabled','true'),('canvas.floor_enabled','true') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
 const people=[['joe','c03946ca-cfbb-4e21-83de-a277b6334045','Joe','owner'],['abigail','4fc912de-1aa6-4a55-a555-ae163c9dc42e','Abigail','staff']];
 for(const [key,id,name,role] of people){
  // Preserve existing QA users, credentials and permissions. Fresh harness DBs
  // get inert fixture accounts; never login credentials or a real model call.
  await db.query(`INSERT INTO users(id,email,name,role,permissions,password_hash,initials) VALUES($1,$2,$3,$4,$5,'qa-no-login',$6) ON CONFLICT(id) DO NOTHING`,[id,`qa-canvas-${key}@example.test`,name,role,['ai','projects'],name.slice(0,2)]);
  const person=(await db.query('SELECT role,active,permissions FROM users WHERE id=$1',[id])).rows[0];
  if(person.role!==role||!person.active||(role==='staff'&&!['ai','projects'].every(p=>person.permissions.includes(p))))throw Error(`QA user ${name} must be active ${role} with ai/projects access`);
  const threadId=(await db.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude',$1,$2) RETURNING id`,[`QA Canvas · ${name}`,id])).rows[0].id;
  const profile=role==='owner'?'operator':'business';
  const run=(await db.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('QA seed only; no model invoked',$1,$2,$3,'panel_web',true) RETURNING id,extract(epoch FROM created_at)::bigint AS started`,[profile,id,threadId])).rows[0];
  const facts={client:db,threadId,runId:run.id};
  // Operator deliberately UNKNOWN; staff is COMPLETE with only a narrow
  // project tool result (list_project_files has no content-area requirements).
  await admitEpoch({...facts,policyHash:hashBytes('qa-canvas-seed-v1'),valid:role==='staff',resumed:false});
  if(role==='staff'){
   const tool='list_project_files';
   const classification=classifyToolAreas(tool,CLASSIFICATION_REGISTRY);
   if(!classification.complete||classification.areas.length)throw Error('Narrow QA tool contract changed');
   const inputId=await beginInput({...facts,kind:'tool',ref:tool});
   await completeInput({...facts,id:inputId,bytes:JSON.stringify({files:[]}),...classification});
  }
  const context={run_id:run.id,principal_user_id:id,run_profile:profile,run_started_s:Number(run.started),transport:'runner_stdio'};
  const show=async(title,source)=>canvasInternal('show',{request_id:randomUUID(),title:`QA ${name} · ${title}`,summary:title,required_areas:[],content:{kind:'diagram',source}},context);
  const {layouts}=await import('../tests/fixtures/canvas-page-layouts.mjs');
  let page=await canvasInternal('show',{request_id:randomUUID(),title:`QA ${name} · Weekly board`,summary:'Responsive cards and a work table.',required_areas:[],content:{kind:'page',source:layouts[0]}},context);
  output(`${key}_page_v1`,threadId,page);
  page=await canvasInternal('update',{request_id:randomUUID(),canvas_id:page.canvas.id,base_version:1,summary:'A process drawing beside the job notes.',change_note:'Added inline SVG',content:{kind:'page',source:layouts[1]}},context);
  output(`${key}_page_v2`,threadId,page);
  let flow=await show('Flowchart history','flowchart TD\n A[Plan]-->B[Build]');
  output(`${key}_flow_v1`,threadId,flow);
  for(const [version,source,note] of [[2,'flowchart TD\n A[Plan]-->B[Build]\n B-->C[Inspect]','Added inspection'],[3,'flowchart TD\n A[Plan]-->B[Build]\n B-->C[Inspect]\n C-->D[Handover]','Added handover']]){
   flow=await canvasInternal('update',{request_id:randomUUID(),canvas_id:flow.canvas.id,base_version:version-1,summary:`Workflow version ${version}`,change_note:note,content:{kind:'diagram',source}},context);
   output(`${key}_flow_v${version}`,threadId,flow);
  }
  output(`${key}_sequence`,threadId,await show('Sequence','sequenceDiagram\n participant Joe\n participant Crew\n Joe->>Crew: Approve plan\n Crew-->>Joe: Work complete'));
  // The bounded source grammar accepts an identifier named end; Mermaid's
  // flowchart parser reserves lowercase end and rejects this at render time.
  output(`${key}_render_error`,threadId,await show('Render error and source','flowchart TD\n A[Start]-->end'));
  const large='flowchart LR\n'+Array.from({length:99},(_,n)=>` N${n}[Step ${n+1}]-->N${n+1}[Step ${n+2}]`).join('\n');
  output(`${key}_large`,threadId,await show('100 nodes at complexity limit',large));
  output(`${key}_${role==='owner'?'unknown_operator':'complete_narrow'}`,threadId,await show(role==='owner'?'UNKNOWN operator Save policy':'COMPLETE narrow Save policy','flowchart TD\n A[Review]-->B[Save to project]'));
  // Floor (Phase 3): real geometry through the real MCP floor tools, then pin it.
  {
   const {registerFloorTools}=await import('../mcp/floor-tools.mjs');const {pool}=await import('@/lib/db');
   const tools={};const json=data=>({content:[{type:'text',text:JSON.stringify(data)}]});
   registerFloorTools({registerTool:(n,_s,h)=>{tools[n]=h;}},{rows:async(sql,params=[])=>(await db.query(sql,params)).rows,json,pool,currentPrincipal:async()=>({userId:id,runId:run.id}),saveSnapshot:input=>canvasInternal('floor_save',input,context)});
   const call=async(n,a)=>{const r=JSON.parse((await tools[n](a)).content[0].text);if(r.ok===false)throw Error(`${n}: ${r.error}`);return r;};
   const fslug=`qa-canvas-floor-${key}-${randomUUID().slice(0,6)}`;
   await db.query(`INSERT INTO projects(slug,name,client_name,status) VALUES($1,$2,'QA only','floor_plan')`,[fslug,`QA ${name} floor project`]);
   const d=await call('create_plan_design',{project_slug:fslug,name:`QA ${name} kitchen`});
   const r1=await call('apply_plan_ops',{design_id:d.id,expected_rev:d.rev??0,ops:[{op:'addRoomRect',p:{x:0,y:0},q:{x:148.5,y:172.5},name:'Kitchen'}]});
   const [top,,bottom]=r1.created.walls;
   const r2=await call('apply_plan_ops',{design_id:d.id,expected_rev:r1.rev,ops:[{op:'addOpening',wallId:bottom,atIn:56,kind:'door'},{op:'placeRun',wallId:top,side:'right',startIn:0,keys:['base-SB36','appl-dw-24','base-B24']}]});
   const floor=await canvasInternal('show',{request_id:randomUUID(),title:`QA ${name} · Kitchen floor plan`,summary:'Kitchen with sink base, dishwasher and door.',required_areas:[],content:{kind:'floor_plan',design_id:String(d.id),expected_design_rev:r2.rev}},context);
   output(`${key}_floor_v1`,threadId,floor);
   // Live design moves on after pinning: canvas must keep the pinned snapshot and offer Load latest.
   await call('apply_plan_ops',{design_id:d.id,expected_rev:r2.rev,ops:[{op:'placeRun',wallId:top,side:'right',startIn:84,keys:['base-B24']}]});
   states[`${key}_floor_v1`].designId=d.id;states[`${key}_floor_v1`].urls.floor=`/floor/${d.id}`;
  }
  await db.query(`UPDATE dev_agent_runs SET status='done' WHERE id=$1`,[run.id]);
 }
 const slug=`qa-canvas-empty-${randomUUID().slice(0,8)}`;
 const project=(await db.query(`INSERT INTO projects(slug,name,client_name,status) VALUES($1,'QA Canvas empty project','QA only','floor_plan') RETURNING id`,[slug])).rows[0];
 const folder=(await db.query(`INSERT INTO ai_folders(name,entity_kind,entity_id,owner_user_id) VALUES('QA empty project folder','project',$1,$2) RETURNING id`,[slug,people[0][1]])).rows[0];
 await db.query(`INSERT INTO files(id,project_key,type,name,tag,modified_label,size_label) VALUES($1,$2,'folder','QA empty folder','QA','just now','—')`,[`qa-folder-${randomUUID()}`,slug]);
 states.joe_empty_project={projectId:project.id,projectSlug:slug,folderId:folder.id,urls:{panel:`/panel?folder=${folder.id}`,project:`/projects/${slug}`,files:`/files`}};
 console.log(JSON.stringify(states,null,2));
} finally {
 delete globalThis.__phase0aDb;
 await db.end();
}

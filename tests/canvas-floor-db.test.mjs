// Expectations FIRST: real op fixtures; snapshot reuse, transaction rollback,
// rev CAS, immutable bytes, cross-design/scope refusal, retained refs and purge,
// canonical identity, bigint serialization, denied projects/leads and races.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {registerFloorTools} from '../mcp/floor-tools.mjs';
import {withTestDb,withSessionIdentity} from './_harness/testdb.mjs';
import {seedPeople} from './phase0a-fixtures.mjs';
import {emptyDoc} from '../lib/plan-doc.ts';
import {applyOps} from '../lib/plan-ops.ts';
import {ensurePlanSnapshot, savePlanSnapshot, restorePlanSnapshot} from '../lib/plan-version-writes.ts';
import {prepareFloorCanvas, attachFloorCanvas, readFloorCanvas, restoreFloorCanvas, floorDeletionBlock} from '../lib/canvas-floor.ts';
const geometry=()=>applyOps(emptyDoc(),[{op:'addRoomRect',p:{x:0,y:0},q:{x:156,y:132},name:'Kitchen'},{op:'placeItem',libraryKey:'base-SB36',at:{x:48,y:12}}]);
const one=async(db,s,p=[])=>(await db.query(s,p)).rows[0];
const transaction=async(db,fn)=>{await db.query('BEGIN');try{const x=await fn();await db.query('COMMIT');return x;}catch(e){await db.query('ROLLBACK');throw e;}};
test('floor canonical snapshots, reference lifecycle, scope and atomicity',async t=>withTestDb(async(url,c)=>{
 const people=await seedPeople(c);
 await withSessionIdentity(url,'sjcos_test_website',async db=>{
 const person={...people.owner,permissions:[]};const actor={person};
 const p=await one(db,`INSERT INTO projects(slug,name) VALUES('zz-floor','Kitchen') RETURNING id`);
 const q=await one(db,`INSERT INTO projects(slug,name) VALUES('zz-floor-other','Other') RETURNING id`);
 const l=await one(db,`INSERT INTO leads(slug,name) VALUES('zz-floor-lead','Lead') RETURNING id`);
 const d=await one(db,`INSERT INTO plan_designs(project_id,name,doc) VALUES($1,'Kitchen',$2) RETURNING *`,[p.id,geometry()]);
 const other=await one(db,`INSERT INTO plan_designs(project_id,name,doc) VALUES($1,'Other',$2) RETURNING *`,[q.id,geometry()]);
 const lead=await one(db,`INSERT INTO plan_designs(lead_slug,name,doc) VALUES('zz-floor-lead','Lead',$1) RETURNING *`,[geometry()]);
 const content={kind:'floor_plan',design_id:d.id,expected_design_rev:0};
 await t.test('missing design',async()=>{await assert.rejects(transaction(db,()=>prepareFloorCanvas(db,actor,{...content,design_id:'999999'})),/CANVAS_UNAVAILABLE/);});
 await t.test('projects denied',async()=>{await assert.rejects(transaction(db,()=>prepareFloorCanvas(db,{person:{...person,role:'staff',permissions:['ai']}},content)),/CANVAS_UNAVAILABLE/);});
 await t.test('leads denied',async()=>{await assert.rejects(transaction(db,()=>prepareFloorCanvas(db,{person:{...person,role:'staff',permissions:['ai','projects']}},{...content,design_id:lead.id})),/CANVAS_UNAVAILABLE/);});
 await t.test('wrong project scope',async()=>{await assert.rejects(transaction(db,()=>prepareFloorCanvas(db,actor,content,{project_id:q.id,lead_id:null})),/CANVAS_UNAVAILABLE/);});
 await t.test('stale expected rev',async()=>{await assert.rejects(transaction(db,()=>prepareFloorCanvas(db,actor,{...content,expected_design_rev:1})),/VERSION_CONFLICT/);});
 const a=await transaction(db,()=>prepareFloorCanvas(db,actor,content));
 const b=await transaction(db,()=>prepareFloorCanvas(db,actor,content));assert.equal(a.snapshot.id,b.snapshot.id);
 assert.equal((await one(db,'SELECT count(*)::int n FROM plan_designs')).n,3);
 const run=await one(db,`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('floor','operator',$1,$2,'panel_web',true) RETURNING id`,[person.id,people.thread]);
 await db.query('BEGIN');
 const canvas=await one(db,`INSERT INTO ask_canvases(conversation_id,owner_user_id,created_run_id,kind,project_id,baseline_hash) VALUES($1,$2,$3,'floor_plan',$4,repeat('a',64)) RETURNING *`,[people.thread,person.id,run.id,p.id]);
 await db.query(`SELECT set_config('sjcos.ask_actor',$1,false)`,[person.id]);
 const version=async n=>one(db,`INSERT INTO ask_canvas_versions(canvas_id,version,conversation_id,owner_user_id,actor_user_id,run_id,title,summary,change_note,source_text,source_bytes,source_sha256,provenance_revision,provenance_complete,provenance_manifest_hash,provenance_inputs,baseline_areas,baseline_hash) VALUES($1,$2,$3,$4,$4,$5,'Kitchen','Real geometry','',$6,$7,repeat('a',64),0,false,repeat('a',64),'[]','{}',repeat('a',64)) RETURNING *`,[canvas.id,n,people.thread,person.id,run.id,a.source,Buffer.byteLength(a.source)]);
 await version(1);await attachFloorCanvas(db,canvas,1,a.snapshot);await db.query('COMMIT');
 const load=()=>readFloorCanvas(db,actor,canvas,1);
 await t.test('preview edit capability follows the full designer gate',async()=>{
  assert.equal((await load()).canEdit,true);
  const staff={...person,role:'staff',permissions:['projects']};
  assert.equal((await readFloorCanvas(db,{person:staff},canvas,1)).canEdit,true);
  await assert.rejects(readFloorCanvas(db,{person:{...staff,active:false}},canvas,1),/CANVAS_UNAVAILABLE/);
  await assert.rejects(readFloorCanvas(db,{person:{...staff,permissions:[]}},canvas,1),/CANVAS_UNAVAILABLE/);
 });
 assert.equal((await load()).props.design.doc.walls.length,4);
 await t.test('referenced snapshot deletion',async()=>{await assert.rejects(db.query('DELETE FROM plan_design_versions WHERE id=$1',[a.snapshot.id]));});
 await t.test('referenced design deletion',async()=>{await assert.rejects(db.query('DELETE FROM plan_designs WHERE id=$1',[d.id]));});
 await t.test('immutable snapshot geometry',async()=>{await assert.rejects(db.query(`UPDATE plan_design_versions SET doc='{}' WHERE id=$1`,[a.snapshot.id]));});
 await t.test('immutable design numbering',async()=>{await assert.rejects(db.query(`UPDATE plan_design_versions SET number=90 WHERE id=$1`,[a.snapshot.id]));});
 await t.test('retained scope cannot move',async()=>{await assert.rejects(db.query(`UPDATE plan_designs SET project_id=$2 WHERE id=$1`,[d.id,q.id]));});
 const o=await transaction(db,()=>ensurePlanSnapshot(db,other.id,0,person.id));
 await assert.rejects(transaction(db,async()=>{await version(2);await attachFloorCanvas(db,canvas,2,{...o,design_id:d.id});}));
 await assert.rejects(transaction(db,async()=>{await version(2);await attachFloorCanvas(db,canvas,2,o);}));
 const changed=applyOps(d.doc,[{op:'addNote',at:{x:12,y:12},text:'New layout'}]);
 assert.equal((await db.query('UPDATE plan_designs SET doc=$2,rev=rev+1 WHERE id=$1 AND rev=0 RETURNING rev',[d.id,changed])).rows[0].rev,1);
 assert.equal((await db.query('UPDATE plan_designs SET doc=$2,rev=rev+1 WHERE id=$1 AND rev=0 RETURNING rev',[d.id,d.doc])).rowCount,0);
 assert.equal((await load()).latestRev,1);assert.equal((await load()).props.design.doc.notes.length,0);
 await transaction(db,async()=>{await version(2);await restoreFloorCanvas(db,actor,canvas,1,2);await db.query('UPDATE ask_canvases SET latest_version=2 WHERE id=$1',[canvas.id]);});assert.deepEqual((await one(db,'SELECT doc FROM plan_designs WHERE id=$1',[d.id])).doc,changed);
 assert.equal((await readFloorCanvas(db,actor,canvas,2)).snapshotId,a.snapshot.id);
 assert.match((await floorDeletionBlock(db,person,d.id)).message,/used by your canvas/);
 assert.equal((await floorDeletionBlock(db,{...person,role:'staff',permissions:[]},d.id)).links.length,0);
 assert.equal((await floorDeletionBlock(db,{...person,id:people.staff.id},d.id)).links.length,0);
 // All allocators use the same live-design lock, on actual separate sessions.
 const clients=await Promise.all([1,2,3].map(async()=>{const x=new pg.Client({connectionString:url});await x.connect();await x.query('SET SESSION AUTHORIZATION sjcos_test_website');return x;}));
 try{
  const tools=new Map();registerFloorTools({registerTool:(name,spec,fn)=>tools.set(name,fn)},{rows:async(s,p)=>(await clients[2].query(s,p)).rows,json:x=>x,pool:{connect:async()=>Object.assign(clients[2],{release(){}})}});
  const results=await Promise.all([
   transaction(clients[0],()=>ensurePlanSnapshot(clients[0],d.id,1,person.id)),
   transaction(clients[1],()=>savePlanSnapshot(clients[1],d.id,person.id,'Named web command')),
   tools.get('save_plan_version')({design_id:Number(d.id),label:'MCP save'}),
  ]);
  assert.equal(results[2].ok,true);assert.notEqual(results[1].id,String(results[2].version_id));
  assert.ok(results[0].number>0);assert.equal((await one(db,'SELECT count(*)::int n FROM plan_design_versions WHERE design_id=$1 AND doc=$2',[d.id,changed])).n>=2,true);
 }finally{await Promise.all(clients.map(x=>x.end()));}
 const before=await one(db,'SELECT count(*)::int n FROM plan_design_versions');
 await assert.rejects(transaction(db,async()=>{await savePlanSnapshot(db,d.id,person.id,'Rollback');throw Error('abort');}),/abort/);
 assert.equal((await one(db,'SELECT count(*)::int n FROM plan_design_versions')).n,before.n);
 const restored=await transaction(db,()=>restorePlanSnapshot(db,a.snapshot.id,1,person.id));assert.equal(restored.rev,2);
 await t.test('stale restore CAS',async()=>{await assert.rejects(transaction(db,()=>restorePlanSnapshot(db,a.snapshot.id,1,person.id)),/VERSION_CONFLICT/);});
 // A current snapshot reused after restore is identity/hash based, not rev based.
 assert.equal((await transaction(db,()=>ensurePlanSnapshot(db,d.id,2,person.id))).id,a.snapshot.id);
 await transaction(db,()=>savePlanSnapshot(db,d.id,person.id,'Identical explicit save'));
 assert.equal((await transaction(db,()=>prepareFloorCanvas(db,actor,{...content,expected_design_rev:2},{...canvas,latest_version:2}))).snapshot.id,a.snapshot.id);

 // A version without a reference cannot commit; neither can geometry be
 // attached to the wrong version identity or the ref be changed/deleted.
 await assert.rejects(transaction(db,async()=>{await version(3);await db.query('UPDATE ask_canvases SET latest_version=3 WHERE id=$1',[canvas.id]);}),/reference required/);
 await t.test('reference identity cannot change',async()=>{await assert.rejects(db.query('UPDATE ask_canvas_floor_refs SET snapshot_id=$2 WHERE canvas_id=$1',[canvas.id,o.id]));});
 await t.test('retained reference cannot detach',async()=>{await assert.rejects(db.query('DELETE FROM ask_canvas_floor_refs WHERE canvas_id=$1',[canvas.id]));});
 await t.test('other private owner denied',async()=>{await assert.rejects(readFloorCanvas(db,{person:{...person,id:people.staff.id}},canvas,1),/CANVAS_UNAVAILABLE/);});
 // Retention: deletion alone keeps the FK; legal hold blocks payload purge.
 await db.query("SELECT set_config('sjcos.ask_purge','yes',false)");
 const deleted=new Date(Date.now()-31*86400000);
 await db.query("UPDATE ask_canvases SET deleted_at=$2,purge_after=$2::timestamptz+interval '720 hours',deletion_sequence=1,hold_until=now()+interval '1 day' WHERE id=$1",[canvas.id,deleted]);
 assert.equal((await floorDeletionBlock(db,person,d.id)).links.length,0);
 await assert.rejects(db.query('DELETE FROM plan_design_versions WHERE id=$1',[a.snapshot.id]));
 const purge="UPDATE ask_canvas_versions SET title=NULL,summary=NULL,change_note=NULL,source_text=NULL,canonical_content=NULL,purged_at=now() WHERE canvas_id=$1";
 await assert.rejects(db.query(purge,[canvas.id]),/purge not due/);
 await db.query('UPDATE ask_canvases SET hold_until=NULL WHERE id=$1',[canvas.id]);
 await db.query(purge,[canvas.id]);
 assert.equal((await one(db,'SELECT count(*)::int n FROM ask_canvas_floor_refs')).n,0);
 assert.equal(await floorDeletionBlock(db,person,d.id),null);
 await db.query('DELETE FROM plan_design_versions WHERE id=$1',[a.snapshot.id]);
 assert.deepEqual((await one(db,'SELECT doc FROM plan_designs WHERE id=$1',[d.id])).doc,d.doc);

 });
 for(const role of ['sjcos_agent','sjcos_worker','sjcos_readonly'])await withSessionIdentity(url,role,async db=>{
  await assert.rejects(db.query('SELECT * FROM ask_canvas_floor_refs'),e=>e.code==='42501');
 });
},{fresh:true}));

import {readFileSync} from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
// Exercise the real web action source with ONLY the exact handoff diff applied
// in memory. This neither edits a coordinator-owned file nor pretends that the
// integration is deployed. Once merged, use the already-patched actual source.
function handoffWebActionsSource(){
 const file='lib/actions/plan-designs.ts',original=readFileSync(file,'utf8');
 if(original.includes('savePlanSnapshot(tx,'))return original;
 const text=readFileSync('docs/plans/build/canvas-phase3-HANDOFF.md','utf8');
 const section=text.split('--- a/'+file+'\n')[1]?.split('\n```')[0];
 assert.ok(section,'exact web action handoff patch exists');
 const src=original.split('\n'),out=[];let pos=0,active=false;
 for(const line of section.split('\n')){
  const h=/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
  if(h){const start=Number(h[1])-1;out.push(...src.slice(pos,start));pos=start;active=true;continue;}
  if(!active)continue;
  if(line===''&&src[pos]===''){out.push(src[pos++]);continue;}
  if(line.startsWith(' ')||line.startsWith('-')){assert.equal(src[pos],line.slice(1),'handoff matches current web action source');if(line[0]===' ')out.push(src[pos]);pos++;}
  else if(line.startsWith('+'))out.push(line.slice(1));
 }
 out.push(...src.slice(pos));return out.join('\n');
}

test('actual handoff-patched web save AND restore race actual registered MCP save and Canvas ensure',()=>withTestDb(async(url,c)=>{
 const people=await seedPeople(c),person={...people.owner,permissions:[]};
 await withSessionIdentity(url,'sjcos_test_website',async db=>{
 const project=await one(db,`INSERT INTO projects(slug,name) VALUES($1,'Web race') RETURNING id`,['zz-floor-web-'+crypto.randomUUID()]);
 const d=await one(db,`INSERT INTO plan_designs(project_id,name,doc) VALUES($1,'Web race',$2) RETURNING *`,[project.id,geometry()]);
 const seed=await transaction(db,()=>savePlanSnapshot(db,d.id,person.id,'Before'));
 const clients=await Promise.all([1,2,3].map(async()=>{const x=new pg.Client({connectionString:url});await x.connect();await x.query('SET SESSION AUTHORIZATION sjcos_test_website');return x;}));
 try{
  const x=clients[1];
  const imports={
   'next/cache':{revalidatePath(){}},'@/lib/db':{pool:{connect:async()=>Object.assign(x,{release(){}})},query:(...a)=>x.query(...a),queryOne:async(...a)=>(await x.query(...a)).rows[0]??null},
   '@/lib/dal':{requireAccess:async()=>person},'@/lib/plan-designs':{getDesignerDefaults:async()=>({})},
   '@/lib/plan-version-writes':await import('../lib/plan-version-writes.ts'),'@/lib/canvas-floor':await import('../lib/canvas-floor.ts'),
   '@/lib/plan-doc':await import('../lib/plan-doc.ts'),'@/lib/plan-geometry':await import('../lib/plan-geometry.ts'),'@/lib/plan-library':await import('../lib/plan-library.ts'),
  };
  const module={exports:{}};
  const code=ts.transpileModule(handoffWebActionsSource(),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:key=>{assert.ok(key in imports,key);return imports[key];},console});
  const web=module.exports,tools=new Map();
  registerFloorTools({registerTool:(name,spec,handler)=>tools.set(name,handler)},{rows:async(s,p)=>(await clients[2].query(s,p)).rows,json:x=>x,pool:{connect:async()=>Object.assign(clients[2],{release(){}})}});
  let r=await Promise.all([transaction(clients[0],()=>ensurePlanSnapshot(clients[0],d.id,0,person.id)),web.savePlanVersion(Number(d.id),'Actual web save'),tools.get('save_plan_version')({design_id:Number(d.id),label:'Actual MCP save'})]);
  assert.equal(r[1].ok,true);assert.equal(r[2].ok,true);assert.notEqual(r[1].versionId,r[2].version_id);
  const changed=applyOps(d.doc,[{op:'addNote',at:{x:12,y:12},text:'Before restore race'}]);
  await db.query('UPDATE plan_designs SET doc=$2,rev=rev+1 WHERE id=$1',[d.id,changed]);
  r=await Promise.allSettled([transaction(clients[0],()=>ensurePlanSnapshot(clients[0],d.id,1,person.id)),web.restorePlanVersion(Number(seed.id)),tools.get('save_plan_version')({design_id:Number(d.id),label:'MCP during web restore'})]);
  if(r[0].status==='rejected')assert.match(r[0].reason.message,/VERSION_CONFLICT/);
  assert.equal(r[1].status,'fulfilled');assert.equal(r[1].value.ok,true);assert.equal(r[2].status,'fulfilled');assert.equal(r[2].value.ok,true);
  const live=await one(db,'SELECT doc,rev FROM plan_designs WHERE id=$1',[d.id]);assert.equal(live.rev,2);assert.deepEqual(live.doc,d.doc);
  const before=await one(db,"SELECT doc FROM plan_design_versions WHERE design_id=$1 AND label LIKE 'Before restoring%' ORDER BY number DESC LIMIT 1",[d.id]);assert.deepEqual(before.doc,changed);
 }finally{await Promise.all(clients.map(x=>x.end()));}
 });
}));

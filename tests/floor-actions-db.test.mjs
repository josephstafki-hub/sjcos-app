// Expectations written before fixes: web deletion authorizes lead scope before
// reference/publication reads; denied/missing targets have one opaque result;
// template save/restore works for owner and Projects staff, never Canvas pins;
// authorized deletes work; own-live links survive typed actions, private/held/
// deleted/revoked refs stay generic; publish/estimate pin the locked live doc,
// including when Canvas ensure or web restore wins the lock first. Stop before
// PDF/file/publication and estimate line side effects in writer race tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import pg from 'pg';
import {withTestDb,withSessionIdentity} from './_harness/testdb.mjs';
import {seedPeople} from './phase0a-fixtures.mjs';
import {applyOps} from '../lib/plan-ops.ts';
import {emptyDoc} from '../lib/plan-doc.ts';
import * as writes from '../lib/plan-version-writes.ts';
import * as floor from '../lib/canvas-floor.ts';
const one=async(db,s,p=[])=>(await db.query(s,p)).rows[0];
function load(file,imports){const module={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module,exports:module.exports,require:k=>{assert.ok(k in imports,`unmocked ${k}`);return imports[k];},console,Intl,Error});return module.exports;}
const tx=async(db,fn)=>{await db.query('BEGIN');try{const r=await fn();await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}};
test('real floor web actions: authorization, templates, links and locked writers',()=>withTestDb(async(url,admin)=>{
 const people=await seedPeople(admin);
 await withSessionIdentity(url,'sjcos_test_website',async db=>{
  let person={...people.owner,permissions:[]},seen=[];
  const client={query:async(s,p)=>{seen.push(s);return db.query(s,p);},release(){}};
  const dbImports={pool:{connect:async()=>client},query:(s,p)=>client.query(s,p),queryOne:async(s,p)=>(await client.query(s,p)).rows[0]??null};
  const common={'next/cache':{revalidatePath(){}},'@/lib/db':dbImports,'@/lib/dal':{requireAccess:async()=>person},'@/lib/plan-version-writes':writes,'@/lib/canvas-floor':floor,'@/lib/plan-doc':await import('../lib/plan-doc.ts')};
  const web=load('lib/actions/plan-designs.ts',{...common,'@/lib/plan-designs':{getDesignerDefaults:async()=>({})},'@/lib/plan-geometry':await import('../lib/plan-geometry.ts'),'@/lib/plan-library':await import('../lib/plan-library.ts')});
  const p=await one(db,`INSERT INTO projects(slug,name) VALUES($1,'Action project') RETURNING id`,['floor-action-'+crypto.randomUUID()]);
  const lead=await one(db,`INSERT INTO leads(slug,name) VALUES($1,'Action lead') RETURNING *`,['floor-action-'+crypto.randomUUID()]);
  const design=async(kind='project')=>one(db,`INSERT INTO plan_designs(project_id,lead_slug,is_template,name,doc) VALUES($1,$2,$3,'Design name',$4) RETURNING *`,[kind==='project'?p.id:null,kind==='lead'?lead.slug:null,kind==='template',emptyDoc()]);
  const snapshot=d=>tx(db,()=>writes.savePlanSnapshot(db,d.id,people.owner.id,'Saved'));
  const file=crypto.randomUUID();await db.query(`INSERT INTO files(id,name) VALUES($1,'Test PDF')`,[file]);
  const run=await one(db,`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('floor','operator',$1,$2,'panel_web',true) RETURNING id`,[people.owner.id,people.thread]);
  async function ref(d,v){return tx(db,async()=>{
   const c=await one(db,`INSERT INTO ask_canvases(conversation_id,owner_user_id,created_run_id,kind,project_id,lead_id,baseline_hash) VALUES($1,$2,$3,'floor_plan',$4,$5,repeat('a',64)) RETURNING *`,[people.thread,people.owner.id,run.id,d.project_id,d.lead_slug?lead.id:null]);
   await db.query(`SELECT set_config('sjcos.ask_actor',$1,false)`,[people.owner.id]);
   const source=JSON.stringify({kind:'floor_plan',design_id:d.id,snapshot_id:v.id});
   await db.query(`INSERT INTO ask_canvas_versions(canvas_id,version,conversation_id,owner_user_id,actor_user_id,run_id,title,summary,change_note,source_text,source_bytes,source_sha256,provenance_revision,provenance_complete,provenance_manifest_hash,provenance_inputs,baseline_areas,baseline_hash) VALUES($1,1,$2,$3,$3,$4,'Private canvas title','Geometry','',$5,$6,repeat('a',64),0,false,repeat('a',64),'[]','{}',repeat('a',64))`,[c.id,people.thread,people.owner.id,run.id,source,Buffer.byteLength(source)]);
   await floor.attachFloorCanvas(db,c,1,v);return c;
  });}
  for(const state of ['unreferenced','referenced','published'])for(const target of ['design','snapshot'])await test(`Projects-only staff cannot delete lead ${target}: ${state}`,async()=>{
   person={...people.staff,permissions:['projects']};const d=await design('lead'),v=await snapshot(d);
   if(state==='referenced')await ref(d,v);
   if(state==='published')await db.query(`INSERT INTO project_floorplans(project_id,version,design_id,design_version_id,file_id) VALUES($1,(SELECT coalesce(max(version),0)+1 FROM project_floorplans WHERE project_id=$1),$2,$3,$4)`,[p.id,d.id,v.id,file]);
   seen=[];const r=await (target==='design'?web.deletePlanDesign(Number(d.id)):web.deletePlanVersion(Number(v.id)));
   assert.equal(r.ok,false);assert.equal(r.error,'CANVAS_UNAVAILABLE');assert.equal(r.block,undefined);
   assert.ok(!seen.some(s=>/ask_canvas_floor_refs|project_floorplans|^DELETE/.test(s)),'no private/publication diagnostics or delete before authorization');
   assert.ok(await one(db,'SELECT id FROM plan_designs WHERE id=$1',[d.id]));assert.ok(await one(db,'SELECT id FROM plan_design_versions WHERE id=$1',[v.id]));
  });
  for(const role of ['owner','staff']){
   person={...people[role],permissions:role==='staff'?['projects','leads']:[]};
   await test(`${role} template save and restore use full-designer policy`,async()=>{
    const d=await design('template'),saved=await web.savePlanVersion(Number(d.id),'Template');assert.equal(saved.ok,true);
    const r=await web.restorePlanVersion(saved.versionId);assert.equal(r.ok,true);assert.equal(r.rev,1);
    await assert.rejects(tx(db,()=>floor.prepareFloorCanvas(db,{person},{kind:'floor_plan',design_id:d.id,expected_design_rev:1})),/CANVAS_UNAVAILABLE/);
   });
   for(const kind of ['project','lead','template'])await test(`${role} authorized ${kind} snapshot/design deletes`,async()=>{const d=await design(kind),v=await snapshot(d);assert.equal((await web.deletePlanVersion(Number(v.id))).ok,true);assert.equal((await web.deletePlanDesign(Number(d.id))).ok,true);});
   await test(`${role} normal designer save/restore`,async()=>{const d=await design();const v=await web.savePlanVersion(Number(d.id),'Normal');assert.equal(v.ok,true);assert.equal((await web.restorePlanVersion(v.versionId)).ok,true);});
  }
  for(const state of ['own','foreign','held','deleted','revoked'])await test(`typed deletion refusal: ${state}`,async()=>{
   const d=await design(),v=await snapshot(d),c=await ref(d,v);person={...people.owner,permissions:[]};
   if(state==='foreign')person={...people.staff,permissions:['projects']};
   if(state==='held')await db.query("UPDATE ask_canvases SET hold_until=now()+interval '1 day' WHERE id=$1",[c.id]);
   if(state==='deleted'){await db.query("SELECT set_config('sjcos.ask_purge','yes',false)");await db.query("UPDATE ask_canvases SET deleted_at=now(),purge_after=now()+interval '720 hours',deletion_sequence=1 WHERE id=$1",[c.id]);}
   if(state==='revoked'){person={...people.staff,permissions:[]};}
   for(const result of [await web.deletePlanDesign(Number(d.id)),await web.deletePlanVersion(Number(v.id))]){
    assert.equal(result.ok,false);
    if(state==='revoked'){assert.equal(result.error,'CANVAS_UNAVAILABLE');continue;}
    assert.ok(result.block);assert.equal(result.error,result.block.message);
    if(state==='own'){assert.equal(result.block.links.length,1);assert.equal(result.block.links[0].title,'Private canvas title');assert.match(result.block.links[0].href,new RegExp(c.id));}
    else{assert.equal(result.block.message,floor.FLOOR_DELETE_MESSAGE);assert.equal(result.block.links.length,0);}
   }
  });
  // Round 2 expectations FIRST: deny source access before all target diagnostics,
  // captures/PDF/storage/file/publication effects; failed generation rolls back
  // the draft, snapshot, provenance and lines, including failure after insertion.
  const sheetRequest={versionId:null,sheets:['new'],paper:'letter',orientation:'landscape',captureFileIds:['private-capture'],notes:''};
  function publishActions(effects){const forbidden=()=>{effects.push('effect');throw Error('UNEXPECTED_OUTPUT');};return load('lib/actions/plan-publish.ts',{...common,'node:fs/promises':{readFile:forbidden},'node:path':{},'@/lib/documents':{getCompanyDocInfo:forbidden},'@/lib/plan-designs':{getPlanDesign:forbidden,getPlanDesignVersion:forbidden},'@/lib/plan-print':{renderPlanSheets:forbidden},'@/lib/plan-print-types':{SHEET_KEYS:['new']},'@/lib/upload-store':{storeBuffer:forbidden},'@/lib/uploads':{UPLOAD_DIR:'/unused'}});}
  for(const scenario of ['lead current','lead history','foreign history','revoked staff','inactive staff'])await test(`r2 publication refuses ${scenario} before all output`,async()=>{
   const d=await design(scenario.startsWith('lead')?'lead':'project'),v=await snapshot(scenario==='foreign history'?await design():d);
   person={...people.staff,permissions:scenario==='revoked staff'?[]:['projects'],active:scenario!=='inactive staff'};
   const effects=[],actions=publishActions(effects);seen=[];
   const r=await actions.publishPlanVersion(Number(d.id),{...sheetRequest,versionId:scenario==='lead current'?null:Number(v.id)});
   assert.equal(r.ok,false);assert.equal(r.error,'CANVAS_UNAVAILABLE');assert.equal(effects.length,0);
   assert.ok(!seen.some(s=>/FROM leads WHERE|plan_design_files|INSERT INTO files|INSERT INTO project_floorplans|INSERT INTO plan_design_versions/.test(s)));
  });
  await test('r2 render-only refuses denied current/history snapshots without effects',async()=>{
   const d=await design('lead'),v=await snapshot(d);person={...people.staff,permissions:['projects']};const effects=[],actions=publishActions(effects);
   for(const versionId of [null,Number(v.id)]){seen=[];const r=await actions.renderPlanSheetsPdf(Number(d.id),{...sheetRequest,versionId});assert.equal(r.error,'CANVAS_UNAVAILABLE');assert.equal(effects.length,0);assert.ok(!seen.some(s=>/plan_design_files|FROM leads WHERE/.test(s)));}
  });
  const estimateActions=(overrides={})=>load('lib/actions/plan-estimate.ts',{...common,'@/lib/cost-book':{getDefaultMarkup:async()=>0},'@/lib/actions/estimates':{addTakeoffLines:async()=>{throw Error('Unexpected detached writer');}},'@/lib/plan-measures':awaitedMeasures,'@/lib/designer-contract':awaitedContract,...overrides});
  const awaitedMeasures=await import('../lib/plan-measures.ts'),awaitedContract=await import('../lib/designer-contract.ts');
  for(const scope of ['lead','project'])await test(`r2 estimate source ${scope} denied before draft or target diagnostics`,async()=>{
   const d=await design(scope);person={...people.staff,permissions:scope==='lead'?['estimates','projects']:['estimates']};const actions=estimateActions();
   for(const target of [{newTitle:'Denied draft'},{estimateId:999999}]){seen=[];const r=await actions.generateEstimateFromDesign(Number(d.id),target);assert.equal(r.ok,false);assert.equal(r.error,'CANVAS_UNAVAILABLE');assert.ok(!seen.some(s=>/FROM estimates|INSERT INTO estimates|estimate_lines|plan_design_versions|document_revisions/.test(s)));}
  });
  for(const failure of ['snapshot','pin','product line'])await test(`r2 estimate ${failure} failure rolls back draft, snapshot and lines`,async()=>{
   person={...people.owner,permissions:[]};const d=await design();const catalog=await one(db,`INSERT INTO catalog_items(name,price_cents) VALUES('Rollback product',200) RETURNING id`);
   const doc=applyOps(emptyDoc(),[{op:'placeItem',libraryKey:'base-SB36',at:{x:4,y:4}}]);doc.items[0].catalogId=Number(catalog.id);await db.query('UPDATE plan_designs SET doc=$2 WHERE id=$1',[d.id,doc]);
   const counts=async()=>one(db,`SELECT (SELECT count(*) FROM estimates)::int estimates,(SELECT count(*) FROM plan_design_versions)::int snapshots,(SELECT count(*) FROM estimate_lines)::int lines,(SELECT count(*) FROM document_revisions)::int revisions`);
   const before=await counts(),original=client.query;
   client.query=async(s,p)=>{const r=await original(s,p);if((failure==='snapshot'&&/^INSERT INTO plan_design_versions/.test(s))||(failure==='product line'&&/INSERT INTO estimate_lines/.test(s)))throw Error('INJECTED_FAILURE');return r;};
   const actions=estimateActions(failure==='pin'?{'@/lib/designer-contract':{pinDesignVersion:async()=>({error:'INJECTED_FAILURE'})}}:{});
   try{const r=await actions.generateEstimateFromDesign(Number(d.id),{newTitle:'Rollback draft'});assert.equal(r.ok,false);assert.equal(r.error,'INJECTED_FAILURE');assert.deepEqual(await counts(),before);}finally{client.query=original;}
  });
  for(const role of ['owner','staff'])for(const scope of ['project','lead','template'])await test(`${role} ${scope} full save/restore/publish/selected-history/estimate web workflow (PDF seam mocked)`,async()=>{
   person={...people[role],permissions:role==='staff'?['projects','leads','estimates']:[]};const d=await design(scope);
   const saved=await web.savePlanVersion(Number(d.id),'Saved workflow');assert.equal(saved.ok,true);assert.equal((await web.restorePlanVersion(saved.versionId)).ok,true);
   const catalog=await one(db,`INSERT INTO catalog_items(name,price_cents) VALUES('Test cabinet',12345) RETURNING id`);
   const geometry=applyOps(emptyDoc(),[{op:'addRoomRect',p:{x:0,y:0},q:{x:156,y:132},name:'Kitchen'},{op:'placeItem',libraryKey:'base-SB36',at:{x:48,y:12}}]);geometry.items[0].catalogId=Number(catalog.id);
   await db.query('UPDATE plan_designs SET doc=$2,rev=rev+1 WHERE id=$1',[d.id,geometry]);
   const designReads={getPlanDesign:async id=>{const r=await one(db,'SELECT * FROM plan_designs WHERE id=$1',[id]);return {...r,id:Number(r.id),projectId:r.project_id,leadSlug:r.lead_slug,doc:r.doc};},getPlanDesignVersion:async id=>{const r=await one(db,'SELECT * FROM plan_design_versions WHERE id=$1',[id]);return {...r,id:Number(r.id),designId:Number(r.design_id)};}};
   const rendered=[];
   const publish=load('lib/actions/plan-publish.ts',{...common,'node:fs/promises':{},'node:path':{},'@/lib/documents':{getCompanyDocInfo:async()=>({company:{}})},'@/lib/plan-designs':designReads,'@/lib/plan-print':{renderPlanSheets:async args=>{rendered.push(args);return new Uint8Array();}},'@/lib/plan-print-types':{SHEET_KEYS:['new']},'@/lib/upload-store':{storeBuffer:async()=>{const id=crypto.randomUUID();await db.query(`INSERT INTO files(id,name) VALUES($1,'PDF seam')`,[id]);return {ok:true,id};}},'@/lib/uploads':{UPLOAD_DIR:'/unused'}});
   const req={versionId:null,sheets:['new'],paper:'letter',orientation:'landscape',captureFileIds:[],notes:''};
   const pub=await publish.publishPlanVersion(Number(d.id),req);assert.equal(pub.ok,true);assert.equal(Boolean(pub.floorplanId),scope==='project');assert.deepEqual(JSON.parse(JSON.stringify(rendered[0].doc)),geometry);
   const edit=applyOps(geometry,[{op:'addNote',at:{x:1,y:1},text:'Later working doc'}]);await db.query('UPDATE plan_designs SET doc=$2,rev=rev+1 WHERE id=$1',[d.id,edit]);
   assert.equal((await publish.publishPlanVersion(Number(d.id),{...req,versionId:pub.versionId})).ok,true);assert.deepEqual(JSON.parse(JSON.stringify(rendered[1].doc)),geometry);
   const estimate=load('lib/actions/plan-estimate.ts',{...common,'@/lib/cost-book':{getDefaultMarkup:async()=>0},'@/lib/actions/estimates':{addTakeoffLines:async()=>{throw Error('No cost rules expected');}},'@/lib/plan-measures':await import('../lib/plan-measures.ts'),'@/lib/commands/core':await import('../lib/commands/core.ts'),'@/lib/designer-contract':await import('../lib/designer-contract.ts')});
   const generated=await estimate.generateEstimateFromDesign(Number(d.id),{newTitle:'From drawing'});assert.equal(generated.ok,true);assert.equal(generated.result.linesAdded,1);assert.match(generated.result.revision,/^design:/);
   const line=await one(db,'SELECT extended FROM estimate_lines WHERE estimate_id=$1',[generated.result.estimateId]);assert.equal(Number(line.extended),12345);
   assert.equal((await publish.renderPlanSheetsPdf(Number(d.id),req)).ok,true);assert.deepEqual(JSON.parse(JSON.stringify(rendered.at(-1).doc)),edit);
   assert.equal((await publish.renderPlanSheetsPdf(Number(d.id),{...req,versionId:pub.versionId})).ok,true);assert.deepEqual(JSON.parse(JSON.stringify(rendered.at(-1).doc)),geometry);
   const versionCount=await one(db,'SELECT count(*)::int n FROM plan_design_versions WHERE design_id=$1',[d.id]);
   assert.equal((await estimate.generateEstimateFromDesign(Number(d.id),{estimateId:generated.result.estimateId})).ok,true);assert.equal((await one(db,'SELECT count(*)::int n FROM plan_design_versions WHERE design_id=$1',[d.id])).n,versionCount.n);
  });
  // Pricing parity and late-failure expectations: cost rules and install lines
  // use the same markup snapshots as takeoff, and failed regeneration preserves
  // all old generated/manual lines and totals rather than clearing them.
  for(const role of ['owner','staff'])await test(`r2 ${role} measure/product/install pricing and failed regeneration are atomic`,async()=>{
   person={...people[role],permissions:role==='staff'?['projects','estimates']:[]};const d=await design();
   const cost=await one(db,`INSERT INTO cost_items(name,unit,unit_cost,default_markup) VALUES('Cabinet install','ea',1000,25) RETURNING id`);
   const catalog=await one(db,`INSERT INTO catalog_items(name,price_cents,cost_item_id) VALUES('Cabinet',2000,$1) RETURNING id`,[cost.id]);
   const doc=applyOps(emptyDoc(),[{op:'placeItem',libraryKey:'base-SB36',at:{x:4,y:4}}]);doc.items[0].catalogId=Number(catalog.id);await db.query('UPDATE plan_designs SET doc=$2 WHERE id=$1',[d.id,doc]);
   await db.query(`INSERT INTO plan_cost_rules(measure,material_tag,cost_item_id,enabled) VALUES('cab_base_ea','',$1,true) ON CONFLICT(measure,material_tag) DO UPDATE SET cost_item_id=$1,enabled=true`,[cost.id]);
   try{
    const actions=estimateActions();const success=await actions.generateEstimateFromDesign(Number(d.id),{newTitle:'Priced plan'});assert.equal(success.ok,true);assert.equal(success.result.linesAdded,3);
    const estimateId=success.result.estimateId;
    const lines=(await db.query('SELECT * FROM estimate_lines WHERE estimate_id=$1 ORDER BY sort_order',[estimateId])).rows;
    assert.deepEqual(lines.map(l=>Number(l.extended)),[1250,2000,1250]);assert.deepEqual(lines.map(l=>Number(l.markup)),[25,0,25]);
    await db.query(`INSERT INTO estimate_lines(estimate_id,description,section,qty,unit_cost,extended) VALUES($1,'Manual scope','Manual',1,99,99)`,[estimateId]);
    const before=await one(db,'SELECT subtotal,total,markup_total FROM estimates WHERE id=$1',[estimateId]);
    const oldLines=(await db.query('SELECT * FROM estimate_lines WHERE estimate_id=$1 ORDER BY id',[estimateId])).rows;
    const n=(await one(db,'SELECT count(*)::int n FROM plan_design_versions WHERE design_id=$1',[d.id])).n;
    await db.query('UPDATE plan_designs SET doc=$2,rev=rev+1 WHERE id=$1',[d.id,applyOps(doc,[{op:'addNote',at:{x:1,y:1},text:'Changed'}])]);
    const original=client.query;client.query=async(s,p)=>{const result=await original(s,p);if(/INSERT INTO estimate_lines/.test(s))throw Error('REGEN_FAILURE');return result;};
    try{const failed=await actions.generateEstimateFromDesign(Number(d.id),{estimateId});assert.equal(failed.ok,false);assert.equal(failed.error,'REGEN_FAILURE');}finally{client.query=original;}
    assert.deepEqual((await db.query('SELECT * FROM estimate_lines WHERE estimate_id=$1 ORDER BY id',[estimateId])).rows,oldLines);assert.deepEqual(await one(db,'SELECT subtotal,total,markup_total FROM estimates WHERE id=$1',[estimateId]),before);assert.equal((await one(db,'SELECT count(*)::int n FROM plan_design_versions WHERE design_id=$1',[d.id])).n,n);
   }finally{await db.query("DELETE FROM plan_cost_rules WHERE measure='cab_base_ea' AND material_tag=''");}
  });
  for(const action of ['publish','estimate'])for(const role of ['owner','staff'])for(const contender of ['edit','canvas','restore'])await test(`${role} ${action} pins locked geometry after ${contender}, no output side effects`,async()=>{
   person={...people[role],permissions:role==='staff'?['projects','estimates']:[]};const d=await design();
   const other=new pg.Client({connectionString:url});await other.connect();await other.query('SET SESSION AUTHORIZATION sjcos_test_website');
   const seed=await snapshot(d);
   const changed=applyOps(emptyDoc(),[{op:'addNote',at:{x:10,y:10},text:'Concurrent edit'}]);
   if(contender==='restore')await db.query('UPDATE plan_designs SET doc=$2,rev=rev+1 WHERE id=$1',[d.id,changed]);
   const otherDb={pool:{connect:async()=>({query:(...a)=>other.query(...a),release(){}})},query:(...a)=>other.query(...a),queryOne:async(...a)=>(await other.query(...a)).rows[0]};
   const otherWeb=load('lib/actions/plan-designs.ts',{...common,'@/lib/db':otherDb,'@/lib/plan-designs':{getDesignerDefaults(){}},'@/lib/plan-geometry':{},'@/lib/plan-library':{}});
   let interleaved=false;const original=client.query;
   client.query=async(s,p)=>{
    // Judge case 31: a concurrent edit wins just before the snapshot lock/read.
    // The old detached SELECT path is intercepted after its stale read instead.
    if(!interleaved&&/FROM plan_designs/.test(s)&&(/FOR UPDATE OF d/.test(s)||/^SELECT doc FROM/.test(s))){
     interleaved=true;
     if(contender==='restore'){assert.equal((await otherWeb.restorePlanVersion(Number(seed.id))).ok,true);return original(s,p);}
     if(contender==='canvas'){await tx(other,()=>writes.ensurePlanSnapshot(other,d.id,0,person.id));return original(s,p);}
     if(/^SELECT doc FROM/.test(s)){const stale=await original(s,p);await other.query('UPDATE plan_designs SET doc=$2,rev=rev+1 WHERE id=$1',[d.id,changed]);return stale;}
     await other.query('UPDATE plan_designs SET doc=$2,rev=rev+1 WHERE id=$1',[d.id,changed]);
    }
    return original(s,p);
   };
   let pinned;const stop=()=>{throw Error('STOP_BEFORE_OUTPUT');};const stopPin=async(_run,id)=>{pinned=await one(db,'SELECT * FROM plan_design_versions WHERE id=$1',[id]);stop();};
   try{
    if(action==='publish'){
     const a=load('lib/actions/plan-publish.ts',{...common,'node:fs/promises':{},'node:path':{},'@/lib/documents':{getCompanyDocInfo:stop},'@/lib/plan-designs':{},'@/lib/plan-print':{},'@/lib/plan-print-types':{SHEET_KEYS:['plan']},'@/lib/upload-store':{storeBuffer:stop},'@/lib/uploads':{UPLOAD_DIR:'/unused'}});
     await assert.rejects(a.publishPlanVersion(Number(d.id),{versionId:null,sheets:['plan'],paper:'letter',orientation:'landscape',captureFileIds:[],notes:''}),/STOP_BEFORE_OUTPUT/);
    }else{
     const est=await one(db,`INSERT INTO estimates(project_id,title,rail,status) VALUES($1,'Race estimate','design_build','draft') RETURNING id`,[p.id]);
     const a=load('lib/actions/plan-estimate.ts',{...common,'@/lib/cost-book':{},'@/lib/actions/estimates':{addTakeoffLines:stop},'@/lib/plan-measures':{},'@/lib/commands/core':{hashInput:JSON.stringify},'@/lib/designer-contract':{pinDesignVersion:stopPin}});
     const r=await a.generateEstimateFromDesign(Number(d.id),{estimateId:Number(est.id)});assert.equal(r.ok,false);assert.equal(r.error,'STOP_BEFORE_OUTPUT');
    }
    const live=await one(db,'SELECT doc,rev FROM plan_designs WHERE id=$1',[d.id]),v=await one(db,'SELECT * FROM plan_design_versions WHERE design_id=$1 ORDER BY number DESC LIMIT 1',[d.id]);
    assert.equal(interleaved,true);
    if(action==='publish')pinned=v;
    else assert.equal((await one(db,'SELECT count(*)::int n FROM plan_design_versions WHERE id=$1',[pinned.id])).n,contender==='edit'?0:1,'failed initial pin rolls back any new snapshot');
    if(contender!=='restore'||action==='publish')assert.equal(pinned.source_rev,live.rev);
    assert.deepEqual(pinned.doc,live.doc);
    const numbers=(await db.query('SELECT number FROM plan_design_versions WHERE design_id=$1',[d.id])).rows.map(v=>v.number);assert.equal(new Set(numbers).size,numbers.length);
    assert.equal((await one(db,'SELECT count(*)::int n FROM project_floorplans WHERE design_id=$1',[d.id])).n,0);
   }finally{client.query=original;await other.end();}
  });
 });
}));

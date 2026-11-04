import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {seedModules,templates} from '../lib/consult/forms/seed.ts';
import {pinnedDerivations} from '../lib/consult/derive.ts';
import {withTestDb} from './_harness/testdb.mjs';
import {findingsFixture} from './_harness/consult-findings.mjs';
import {reconcileConsultFindings} from '../lib/consult/findings.ts';
test('combined rooms stay in their template; single kitchen counts adjoining hall; range wall adds only extra height',()=>{
 const instances=[{id:'bath',module_key:'room'},{id:'kitchen',module_key:'room'},{id:'scope',module_key:'kitchen_scope'},{id:'wall',module_key:'kitchen_wall'},{id:'bs',module_key:'bath_scope'}];
 const values={bs:{tub_shower_plan:'Keep tub',existing_length:54,existing_width:24,vanity_width:36,wall_tile_height:'Wainscot'},bath:{length:60,width:96,shape:'Rectangle',part_of:['Bathroom']},kitchen:{length:144,width:168,shape:'Rectangle',part_of:['Kitchen']},scope:{backsplash_height:'Full wall at range',backsplash_measured_height:18,range_wall_tile:[36,60]},wall:{base_run:264}};
 const answers=Object.entries(values).flatMap(([instance_id,v])=>Object.entries(v).map(([field_key,value])=>({id:randomUUID(),instance_id,field_key,value,status:'answered',server_revision:'1'})));
 const selected=templates.filter(t=>['bath','kitchen'].includes(t.key)).map(t=>({...t,derived:[{key:'area',label:'area',formula:'room.floor_area'},...(t.key==='kitchen'?t.derived.filter(d=>d.key==='backsplash_area'):[])]}));
 const result=pinnedDerivations(seedModules,selected,instances,answers);
 assert.equal(result.derived[0].result.value,40);assert.equal(result.derived[1].result.value,168);assert.equal(result.derived[2].result.value,43.5);
 const full=pinnedDerivations(seedModules,templates.filter(t=>['bath','kitchen'].includes(t.key)),instances,answers);assert.equal(full.derived.find(d=>d.definition.key==='floor_tile_area').result.value,25.75);assert.equal(full.field(instances.find(i=>i.id==='bs'),'wall_tile_area').value,78);
 assert.equal(pinnedDerivations(seedModules,[selected[1]],instances,answers).derived[0].result.value,208);
});
test('HTTP and direct service allow assigned visitor and owner; reject other staff without writes',async()=>withTestDb(async(_url,c)=>{
 const f=await findingsFixture(c);await f.save();assert.equal((await f.close()).complete,true);
 const input={consult_id:f.consult,expected_generation:1,operation_id:randomUUID()};
 await assert.rejects(reconcileConsultFindings(c,f.context('apply',f.other),input),/consult access denied/);
 assert.equal((await c.query('SELECT count(*)::int n FROM consult_finding_applications WHERE consult_id=$1',[f.consult])).rows[0].n,0);
 await assert.rejects(f.run('apply_findings',{expected_generation:1,operation_id:randomUUID()},f.other),/consult access denied/);
 for(const actor of [f.staff,f.owner]){
  const r=await f.run('apply_findings',{expected_generation:1,operation_id:randomUUID()},actor);assert.equal(r.ok,true);
  assert.equal((await reconcileConsultFindings(c,f.context('apply',actor),input)).results[0].status,'applied');
 }
},{fresh:true}));
test('mail margin reopens on earlier start, hand delivery does not, and dates read plainly',async()=>withTestDb(async(_url,c)=>{
 const f=await findingsFixture(c);
 await c.query("UPDATE projects SET start_date='2027-01-10' WHERE id=$1",[f.project]);
 for(const [suffix,method] of [['delivery','mail'],['redelivery','hand']])await c.query("INSERT INTO work_items(title,project_id,source_kind,source_id,status,completed_at,rrp_delivery_method) VALUES('RRP',$1,'consult',$2,'done','2027-01-01 12:00:00-06',$3)",[f.project,f.consult+':rrp:'+suffix,method]);
 await c.query("UPDATE projects SET start_date='2027-01-05' WHERE id=$1",[f.project]);await c.query('SELECT consult_reconcile_rrp($1)',[f.project]);
 let rows=(await c.query("SELECT source_id,status,body FROM work_items WHERE project_id=$1 AND source_kind='consult' AND source_id LIKE '%:rrp:%' ORDER BY source_id",[f.project])).rows;
 assert.equal(rows.find(r=>r.source_id.endsWith(':delivery')).status,'queued');assert.equal(rows.find(r=>r.source_id.endsWith(':redelivery')).status,'done');
 await c.query("UPDATE projects SET start_date='2027-04-15' WHERE id=$1",[f.project]);await c.query('SELECT consult_reconcile_rrp($1)',[f.project]);
 rows=(await c.query("SELECT body FROM work_items WHERE source_id=$1",[f.consult+':rrp:redelivery'])).rows;
 assert.match(rows[0].body,/the new start Apr 15, 2027/);
},{fresh:true}));
test('multi-template rooms need membership; a single template hides it; advisories have no decision',async()=>{
 const {buildModel,emptyDraft}=await import('../lib/consult/ui/model.ts');
 const selected=templates.filter(t=>['bath','kitchen'].includes(t.key));
 const s={consult:{id:'visit',status:'in_progress',revision:1,completion_generation:1},pins:[...seedModules.map(definition=>({kind:'module',definition})),...selected.map(definition=>({kind:'template',definition}))],instances:[{id:'room',module_key:'room',parent_id:null},{id:'house',module_key:'house',parent_id:null}],heads:[{instance_id:'house',field_key:'radon_level',status:'answered',value:5.2,server_revision:1}],conflicts:[]};
 let model=buildModel(s,[],[],emptyDraft());const room=model.sections.find(s=>s.module.key==='room');const part=room.fields.find(f=>f.key==='part_of');
 assert.equal(part.required,true);assert.equal(part.mark,'open');assert.deepEqual(part.def.options,['Bathroom','Kitchen']);assert.ok(model.open.some(r=>r.item.key==='part_of'));assert.equal(model.flags[0].decisionAllowed,false);
 s.pins=s.pins.filter(p=>!(p.kind==='template'&&p.definition.key==='bath'));model=buildModel(s,[],[],emptyDraft());assert.equal(model.sections.find(s=>s.module.key==='room').fields.some(f=>f.key==='part_of'),false);
});

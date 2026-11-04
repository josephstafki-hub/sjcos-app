import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {seedModules,templates} from '../lib/consult/forms/seed.ts';
import {pinnedDerivations} from '../lib/consult/derive.ts';
import {evaluatedFlags} from '../lib/consult/flags.ts';
const instances=[{id:'k',module_key:'kitchen_scope'},{id:'w',module_key:'kitchen_wall'}];
function projection(fields,modules=seedModules){
 const answers=Object.entries({k:fields,w:{base_run:264,new_base_run:120}}).flatMap(([instance_id,v])=>Object.entries(v).map(([field_key,value])=>({id:randomUUID(),instance_id,field_key,value,status:'answered',server_revision:'1'})));
 return pinnedDerivations(modules,templates.filter(t=>t.key==='kitchen'),instances,answers);
}
for(const [choice,on,pair,expected] of [['To the uppers',false,null,33],['Full wall at range',true,[36,60],48],['To the uppers',true,[30,18],36.75],['4″',true,null,7.3333]])test('backsplash '+choice+' wall '+on,()=>{
 const p=projection({backsplash_height:choice,range_on_wall:on,range_wall_tile:pair,backsplash_measured_height:18});
 assert.equal(p.derived.find(d=>d.definition.key==='backsplash_area').result.value,expected);
});
for(const [cabinets,run] of [['Replace all',72],['Reface',72],['Paint',72],['Some new',0]])test('kept island '+cabinets,()=>{
 const p=projection({island:'Keep',island_new_top:true,island_length:72,island_depth:36,cabinets});
 assert.equal(p.field(instances[0],'island_top_area').value,18);
 assert.equal(p.field(instances[0],'island_run').value,run);
 assert.equal(264*25.5/144+p.field(instances[0],'island_top_area').value,64.75);
 assert.equal((264+run)/12,run?28:22);
});
test('legacy island pin keeps its recorded derivation',()=>{
 const modules=seedModules.map(m=>m.key==='kitchen_scope'?{...m,fields:m.fields.map(f=>['island_run','island_top_area'].includes(f.key)?{...f,derive_cases:[{when:{field:'island',op:'eq',value:'New'},formula:f.key==='island_run'?'island_length':'island_length * island_depth / 144'},{when:{field:'island',op:'answered'},formula:'0'}]}:f)}:m);
 assert.equal(projection({island:'Keep'},modules).field(instances[0],'island_top_area').value,0);
});
test('lead plan advisory follows disturbance and window replacement',()=>{
 const f=seedModules.find(m=>m.key==='era').fields.find(f=>f.key==='lead_plan');
 for(const [disturbs,windows,count] of [[true,false,1],[false,false,0],[false,true,1]]){
 const flags=evaluatedFlags(f,'era.lead_plan',{'era.before_1978':true,'era.disturbs_paint':disturbs,'era.window_door_replacement':windows,lead_plan:'Not needed','era.lead_plan':'Not needed'});
 assert.equal(evaluatedFlags(f,'era.lead_plan',{'era.before_1978':true,'era.disturbs_paint':true,lead_plan:'Not needed',lead_test_negative:true}).length,0);
 assert.equal(flags.length,count);if(count)assert.equal(flags[0].kind,'advisory');
 }
});

for(const top of [true,false])test('kept island countertop '+top,()=>{
 const p=projection({island:'Keep',island_new_top:top,island_length:72,island_depth:36,cabinets:'Replace all'});
 assert.equal(p.derived.find(d=>d.definition.key==='countertop_area').result.value,top?64.75:46.75);
 assert.equal(p.derived.find(d=>d.definition.key==='cabinet_run').result.value,28);
});
test('Some new prices 120 inches of cabinets but 264 inches of countertop',()=>{
 const p=projection({island:'None',cabinets:'Some new'});
 assert.equal(p.derived.find(d=>d.definition.key==='cabinet_run').result.value,10);
 assert.equal(p.derived.find(d=>d.definition.key==='countertop_area').result.value,46.75);
});
test('legacy template keeps the whole cabinet run',()=>{
 const old=templates.filter(t=>t.key==='kitchen').map(t=>({...t,derived:t.derived.map(d=>d.key==='cabinet_run'?{...d,formula:'kitchen_wall.base_run / 12 + kitchen_scope.island_run / 12'}:d)}));
 const answers=Object.entries({k:{island:'None',cabinets:'Some new'},w:{base_run:264}}).flatMap(([instance_id,v])=>Object.entries(v).map(([field_key,value])=>({id:randomUUID(),instance_id,field_key,value,status:'answered',server_revision:'1'})));
 const legacy=seedModules.map(m=>({...m,fields:m.fields.filter(f=>!['new_base_run','cabinet_base_run','island_new_top'].includes(f.key))}));
 const p=pinnedDerivations(legacy,old,instances,answers);
 assert.equal(p.derived.find(d=>d.definition.key==='cabinet_run').result.value,22);
});
test('lead-test question follows Not needed and hides for Assume lead present',async()=>{
 const {compileCondition}=await import('../lib/consult/forms/conditions.ts');
 const era=seedModules.find(m=>m.key==='era');
 const question=era.fields.find(f=>f.key==='lead_test_negative');
 const plan=era.fields.find(f=>f.key==='lead_plan');
 assert.equal(era.fields.indexOf(question),era.fields.indexOf(plan)+1);
 const visible=compileCondition(question.required,new Set(['era.before_1978','house.year_built','lead_plan']));
 for(const [choice,tested,shown,count] of [['Assume lead present',undefined,false,0],['Not needed',undefined,true,1],['Not needed',true,true,0]]){
  assert.equal(visible({'era.before_1978':true,lead_plan:choice}),shown);
  assert.equal(evaluatedFlags(plan,'era.lead_plan',{'era.before_1978':true,'era.window_door_replacement':true,'era.disturbs_paint':false,lead_plan:choice,lead_test_negative:tested}).length,count);
 }
 assert.match(question.hint,/every painted surface/);
 assert.match(question.hint,/inspector’s or risk assessor’s report/);
 assert.match(question.hint,/kit used by a certified renovator/);
 assert.match(question.hint,/paint chips a certified renovator took/);
 assert.match(question.hint,/homeowner used doesn’t count/);
});

test('Some new with a kept island retaining its top excludes island cabinets and top',()=>{
 const p=projection({island:'Keep',island_new_top:false,island_length:72,island_depth:36,cabinets:'Some new'});
 assert.equal(p.derived.find(d=>d.definition.key==='cabinet_run').result.value,10);
 assert.equal(p.derived.find(d=>d.definition.key==='countertop_area').result.value,46.75);
});
test('new island always contributes its top',()=>{
 const p=projection({island:'New',island_length:72,island_depth:36,cabinets:'Replace all'});
 assert.equal(p.derived.find(d=>d.definition.key==='countertop_area').result.value,64.75);
});
test('pre-R17 kept-island pin retains its unconditional top area',()=>{
 const legacy=seedModules.map(m=>m.key==='kitchen_scope'?{...m,fields:m.fields.filter(f=>f.key!=='island_new_top').map(f=>f.key==='island_top_area'?{...f,derive_cases:[{when:{field:'island',op:'in',value:['Keep','New']},formula:'island_length * island_depth / 144'},{when:{field:'island',op:'answered'},formula:'0'}]}:f)}:m);
 const p=projection({island:'Keep',island_length:72,island_depth:36,cabinets:'Replace all'},legacy);
 assert.equal(p.derived.find(d=>d.definition.key==='countertop_area').result.value,64.75);
});

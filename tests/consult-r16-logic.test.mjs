import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {seedModules,templates} from '../lib/consult/forms/seed.ts';
import {pinnedDerivations} from '../lib/consult/derive.ts';
import {evaluatedFlags} from '../lib/consult/flags.ts';
import {withTestDb} from './_harness/testdb.mjs';
import {findingsFixture} from './_harness/consult-findings.mjs';
const instances=[{id:'k',module_key:'kitchen_scope'},{id:'w',module_key:'kitchen_wall'}];
function projection(fields,modules=seedModules){
 const answers=Object.entries({k:fields,w:{base_run:264}}).flatMap(([instance_id,v])=>Object.entries(v).map(([field_key,value])=>({id:randomUUID(),instance_id,field_key,value,status:'answered',server_revision:'1'})));
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
test('project trigger reconciles both suffixes using delivery day and remains idempotent',async()=>withTestDb(async(_url,c)=>{
 const f=await findingsFixture(c);
 const {publish}=await import('../lib/consult/protocol.ts');
 const definition={key:'era',version:1,title:'Era',repeatable:false,say:[],fields:['pamphlet_given','before_1978'].map(key=>({key,label:key,type:'yesno',required:false,tier:'record'})),shots:[],coverage:[]};
 const form=(await c.query("INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES('module','era',1,$1,'',$2) RETURNING id",[definition,f.owner])).rows[0].id;
 await publish(c,f.context('publish_form',f.owner,null),{form_id:form,registry_id:f.registry});
 await c.query('INSERT INTO consult_form_pins SELECT $1,id,kind,key,version,checksum FROM consult_form_versions WHERE id=$2',[f.consult,form]);
 const era=randomUUID();await f.send([f.op('create_instance',{},await f.revision(),{instance_id:era,module_key:'era',label:'Era'})]);
 for(const key of ['pamphlet_given','before_1978'])await f.send([f.op('answer',{status:'answered',value:true},0,{instance_id:era,field_key:key})]);
 await c.query("UPDATE consults SET scheduled_at='2026-10-15T18:00Z' WHERE id=$1",[f.consult]);

 for(const suffix of ['delivery','redelivery'])for(const [method,day,expected] of [['hand','2026-10-31','done'],['hand','2026-11-01','done'],['hand','2026-11-02','queued'],['mail','2026-10-25','done'],['mail','2026-10-26','queued']]){
 await c.query("DELETE FROM work_items WHERE source_kind='consult' AND source_id=$1",[f.consult+':rrp:'+suffix]);
 await c.query("UPDATE projects SET start_date='2026-11-20' WHERE id=$1",[f.project]);
 await c.query("INSERT INTO work_items(title,project_id,source_kind,source_id,status,completed_at,rrp_delivery_method,rrp_delivered_on) VALUES('RRP',$1,'consult',$2,'done','2026-11-02 12:00:00-06',$3,$4)",[f.project,f.consult+':rrp:'+suffix,method,day]);
 await c.query("UPDATE projects SET start_date='2026-11-01' WHERE id=$1",[f.project]);
 const read=async()=>(await c.query('SELECT status,body,completed_at,rrp_delivered_on,due_at FROM work_items WHERE source_id=$1',[f.consult+':rrp:'+suffix])).rows[0];
 const first=await read();assert.equal(first.status,expected);assert.equal(first.rrp_delivered_on.toISOString().slice(0,10),day);
 await c.query('SELECT consult_reconcile_rrp($1)',[f.project]);assert.deepEqual(await read(),first);
 }
},{fresh:true}));

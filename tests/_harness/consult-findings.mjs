import {randomUUID} from 'node:crypto';
import {fixture} from './consult.mjs';
import {publish} from '../../lib/consult/protocol.ts';
export async function findingsFixture(c){
 const f=await fixture(c);const definition={key:'measure',version:1,title:'Measure',repeatable:true,say:[],fields:[
  {key:'length',label:'Length',type:'length',unit:'in',required:true,tier:'price_critical'},
  {key:'width',label:'Width',type:'length',unit:'in',required:true,tier:'price_critical'},
  {key:'floor_area',label:'Floor area',type:'number',unit:'sf',derive:'length*width/144',required:false,tier:'price_critical',maps_to:{kind:'measurement',scope_key:'flooring.install',quantity_label:'Floor area'}}],shots:[],coverage:[]};
 const registry=(await c.query(`INSERT INTO consult_mapping_registries(version,mappings,author) VALUES(2,$1,$2) RETURNING id`,[{'flooring.install':['Floor area']},f.owner])).rows[0].id;
 const form=(await c.query("INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES('module','measure',1,$1,'',$2) RETURNING id",[definition,f.owner])).rows[0].id;
 await publish(c,f.context('publish_form',f.owner,null),{form_id:form,registry_id:registry});
 await c.query('INSERT INTO consult_form_pins SELECT $1,id,kind,key,version,checksum FROM consult_form_versions WHERE id=$2',[f.consult,form]);
 const instances=[randomUUID(),randomUUID()];await f.send([f.op()]);
 for(const id of instances){await f.send([f.op('create_instance',{},await f.revision(),{instance_id:id,module_key:'measure',label:'Room'})]);for(const key of ['length','width'])await f.send([f.op('answer',{status:'answered',value:120,unit:'in'},0,{instance_id:id,field_key:key})]);}
 await c.query("INSERT INTO scope_items(project_id,key,title,trade) VALUES($1,'flooring.install','Flooring','Flooring')",[f.project]);
 return {...f,instances};
}

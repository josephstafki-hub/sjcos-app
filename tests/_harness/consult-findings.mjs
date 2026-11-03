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

/** A second real captured visit on the same project, sharing immutable forms. */
export async function secondFindingsVisit(c,f){
 const {schedule,command,hash}=await import('../../lib/consult/protocol.ts');
 const forms=(await c.query('SELECT form_id FROM consult_form_pins WHERE consult_id=$1',[f.consult])).rows.map(r=>r.form_id);
 const {id}=await schedule(c,f.context('schedule',f.owner,null),{project:f.project,visitor:f.staff,visit_time:'2026-12-20T15:00:00Z',forms});
 const device=randomUUID();let seq=0;
 const revision=async()=>Number((await c.query('SELECT revision FROM consults WHERE id=$1',[id])).rows[0].revision);
 const run=async(kind,input)=>{await c.query('BEGIN');try{const r=await command(c,f.context(kind,f.staff,id,input?.nonce),id,kind,input);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}};
 await run('start',{device,expected_revision:0});
 const op=(type,payload,target,base_revision=0)=>({protocol_version:1,client_event_id:randomUUID(),device_id:device,device_epoch:1,seq:++seq,base_revision,generation:1,type,target,payload,payload_sha256:hash(payload)});
 const send=async(op)=>run('ops',{nonce:randomUUID(),ops:[op]});
 for(const module_key of ['room','measure']){
  const instance_id=randomUUID();await send(op('create_instance',{}, {instance_id,module_key,label:'Second visit room'},await revision()));
  for(const field_key of module_key==='room'?['length']:['length','width'])await send(op('answer',{status:'answered',value:120,unit:'in'},{instance_id,field_key}));
 }
 await run('evidence',{device,epoch:1,expected_revision:await revision(),evidence:f.evidence});
 const closed=await run('close',{expected_revision:await revision(),manifest:{device,epoch:1,last_seq:seq,required_blob_hashes:[],initials_hash:null,local_pending:0}});
 if(!closed.complete)throw new Error('second visit not complete');
 return {id,run,revision};
}

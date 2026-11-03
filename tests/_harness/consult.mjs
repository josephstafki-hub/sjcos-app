import {randomUUID,createHmac} from 'node:crypto';
import {publish,command,hash} from '../../lib/consult/protocol.ts';
export async function fixture(c){
 const owner=randomUUID(),staff=randomUUID(),other=randomUUID(),project=randomUUID(),consult=randomUUID(),device=randomUUID(),instance=randomUUID();
 const secret=Buffer.alloc(32,17);
 await c.query(`INSERT INTO users(id,email,password_hash,name,role,permissions) VALUES($1,$4,'x','Owner','owner','{}'),($2,$5,'x','Staff','staff','{projects}'),($3,$6,'x','Other','staff','{projects}')`,[owner,staff,other,`${owner}@test`,`${staff}@test`,`${other}@test`]);
 await c.query("INSERT INTO projects(id,slug,name) VALUES($1,$2,'Consult')",[project,project]);
 await c.query("INSERT INTO consult_context_keys VALUES('test',$1,now(),NULL)",[secret]);
 await c.query("UPDATE app_settings SET value='true' WHERE key='consult_capture'");
 const context=(operation,sub=staff,target=consult,nonce=randomUUID())=>{const payload=JSON.stringify({kind:'in_home_consult',sub,role:sub===owner?'owner':'staff',areas:['projects'],mode:'person',operation,consult_id:target,iat:Date.now()/1000,exp:Date.now()/1000+120,run_id:randomUUID(),nonce});return {key_id:'test',payload,signature:createHmac('sha256',secret).update(payload).digest('hex')};};
 const registry=(await c.query("INSERT INTO consult_mapping_registries(version,mappings,author) VALUES(1,'{}',$1) RETURNING id",[owner])).rows[0].id;
 const module={key:'room',version:1,title:'Room',repeatable:true,say:[],fields:[{key:'length',label:'Length',type:'length',unit:'in',required:true,tier:'price_critical',range:[1,600]}],shots:[],coverage:[{key:'measured',text:'Measured',satisfied_by:['length']}]};
 const template={key:'general',version:1,title:'General',opening:[],closing:[],modules:[{module:'room',required:true,min:1}],derived:[]};
 const forms=[];
 for(const [kind,definition] of [['module',module],['template',template]]){const id=(await c.query('INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES($1,$2,1,$3,\'\',$4) RETURNING id',[kind,definition.key,definition,owner])).rows[0].id;await publish(c,context('publish_form',owner,null),{form_id:id,registry_id:registry});forms.push(id);}
 await c.query("INSERT INTO consults(id,project_id,conducted_by,scheduled_at,scheduled_by,policy_version) VALUES($1,$2,$3,now(),$4,'v1')",[consult,project,staff,owner]);
 await c.query('INSERT INTO consult_assignments(consult_id,user_id,assigned_by) VALUES($1,$2,$3)',[consult,staff,owner]);
 await c.query('INSERT INTO consult_form_pins SELECT $1,id,kind,key,version,checksum FROM consult_form_versions WHERE id=ANY($2)',[consult,forms]);
 const run=async(kind,input,sub=staff)=>{const nonce=input?.nonce;await c.query('BEGIN');try{const r=await command(c,context(kind,sub,consult,nonce),consult,kind,input);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}};
 await run('start',{device,expected_revision:0});
 let seq=0;
 const op=(type='answer',payload={status:'answered',value:120,unit:'in'},base_revision=0,target={instance_id:instance,field_key:'length'},generation=1)=>({protocol_version:1,client_event_id:randomUUID(),device_id:device,device_epoch:1,seq:++seq,base_revision,generation,type,target,payload,payload_sha256:hash(payload)});
 const send=(ops,nonce=randomUUID())=>run('ops',{nonce,ops});
 await send([op('create_instance',{},1,{instance_id:instance,module_key:'room',label:'Room'})]);
 const revision=async()=>Number((await c.query('SELECT revision FROM consults WHERE id=$1',[consult])).rows[0].revision);
 const evidence={photos_ok:false,manual_confirmed:true,handed_back:true,ack_reason:'Client declined initials',promised_date:'2026-12-10',no_trades_confirmed:true,touched_trades:[],trade_walks:[],rrp:{receipt:true,firm_current:true,renovator_current:true,redelivery_required:false},flags:{},skips:{}};
 const save=async(e=evidence)=>run('evidence',{device,epoch:1,expected_revision:await revision(),evidence:e});
 const close=async(extra={})=>run('close',{expected_revision:await revision(),manifest:{device,epoch:1,last_seq:seq,required_blob_hashes:[],initials_hash:null,local_pending:0,...extra}});
 return {owner,staff,other,project,consult,device,instance,context,registry,forms,run,op,send,revision,evidence,save,close};
}

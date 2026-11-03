// Explicit target only. Each run is namespaced; no consult records bypass protocol validation.
import pg from 'pg';
import {randomUUID,createHmac,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {seedConsult} from '../db/seed-consult.mjs';
import {schedule,command,snapshot,hash} from '../lib/consult/protocol.ts';
import {buildModel,emptyDraft} from '../lib/consult/ui/model.ts';
import {initConsultUpload,putConsultPart,commitConsultBlob} from '../lib/consult/uploads.ts';
export async function seedQaConsult(c,slug,{uploadRoot}={}) {
 const project=(await c.query('SELECT id FROM projects WHERE slug=$1',[slug])).rows[0];
 if(!project)throw Error('Project slug not found');
 const owner=(await c.query("SELECT id FROM users WHERE active AND role='owner' ORDER BY created_at LIMIT 1")).rows[0];
 if(!owner)throw Error('Provision an owner first');
 const staff=(await c.query("SELECT id,name,email FROM users WHERE active AND role='staff' AND 'projects'=ANY(permissions) ORDER BY created_at LIMIT 1")).rows[0]??{...owner,name:'Owner'};
 await seedConsult(c);
 await c.query("BEGIN");
 const key=(await c.query('SELECT key_id,secret FROM consult_context_keys WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1')).rows[0];
 const ctx=(operation,id=null,asOwner=false,nonce=randomUUID())=>{const payload=JSON.stringify({kind:'in_home_consult',sub:asOwner?owner.id:staff.id,role:asOwner||staff.id===owner.id?'owner':'staff',areas:['projects'],mode:'person',operation,consult_id:id,iat:Date.now()/1000,exp:Date.now()/1000+120,run_id:randomUUID(),nonce});return {key_id:key.key_id,payload,signature:createHmac('sha256',key.secret).update(payload).digest('hex')};};
 const forms=(await c.query("SELECT id FROM consult_form_versions WHERE status='published' AND (kind='module' OR (kind='template' AND key IN ('bath','kitchen')))")).rows.map(r=>r.id);
 const namespace=`QA ${new Date().toISOString()} ${randomUUID().slice(0,8)}`;
 const visits=[];
 for(const state of ['complete','conflict']){
  const {id}=await schedule(c,ctx('schedule',null,true),{project:project.id,visitor:staff.id,visit_time:new Date().toISOString(),forms,visitor_notes:`${namespace} ${state}`});
  const device=randomUUID();let seq=0;
  const run=(kind,input)=>command(c,ctx(kind,id,false,input?.nonce),id,kind,input);
  const snap=()=>snapshot(c,ctx('read',id),id);
  const rev=async()=>Number((await snap()).consult.revision);
  await run('start',{device,expected_revision:await rev()});
  const send=async(type,target,payload,base=0,dev=device,n=++seq)=>{
   const receipts=await run('ops',{nonce:randomUUID(),ops:[{protocol_version:1,client_event_id:randomUUID(),device_id:dev,device_epoch:1,seq:n,base_revision:base,generation:1,type,target,payload,payload_sha256:hash(payload)}]});
   if(receipts.some(r=>r.status>=400&&r.status!==409))throw Error(JSON.stringify({type,target,payload,receipts}));return receipts;
  };
  const draft=emptyDraft();
  const model=async()=>buildModel(await snap(),[],[],draft);
  // Materialize the exact required module slots, including child rows and presets.
  for(let pass=0;pass<8;pass++){
   const m=await model();let added=false;
   for(const slot of m.slots.filter(s=>s.required)){
    const parents=slot.parent?m.sections.filter(s=>s.module.key===slot.parent).map(s=>s.instance.id):[null];
    for(const parent of parents){const count=m.sections.filter(s=>s.module.key===slot.module.key&&(!parent||s.instance.parent_id===parent)).length;
     for(let n=count;n<slot.minimum;n++){await send('create_instance',{instance_id:randomUUID(),module_key:slot.module.key,label:`${slot.label??slot.module.title} ${n+1}`,...(parent?{parent_id:parent}:{})},{},await rev());added=true;}
    }
   }
   if(!added)break;
  }
  if(state==='conflict'){
   const f=(await model()).sections.flatMap(s=>s.fields).find(f=>f.def.type==='length');
   if(!f)throw Error('No length field');const target={instance_id:f.addr.split(':')[0],field_key:f.key};
   const second=randomUUID();
   await send('answer',target,{status:'answered',value:f.def.range?.[0]??30,unit:'in'});
   await command(c,ctx('assign',id,true),id,'assign',{visitor:staff.id,expected_revision:await rev(),missing_device_reason:'QA: move visit to second device with stale field baseline'});
   await run('start',{device:second,expected_revision:await rev()});
   await send('answer',target,{status:'answered',value:(f.def.range?.[0]??30)+1,unit:'in'},0,second,1);
   if(!(await snap()).conflicts.length)throw Error('Conflict was not created');
   visits.push({state,id,devices:[device,second],field:f.addr});continue;
  }
  const assumption={text:'QA fixture: omitted from estimate',responsible_trade:'General contractor',verification_point:'Before pricing',adjustment_route:'precon_change',quantity:null,unit:null,exclusion:'QA only — excluded'};
  let m=await model();
  for(const s of m.sections)for(const f of [...s.fields,...s.hidden]){
   if(s.module.context_module||s.module.key==='visit'||f.def.derive||f.def.derive_cases||f.readOnly||f.def.type==='signature'||f.answer)continue;
   const target={instance_id:s.instance.id,field_key:f.key};
   if(s.module.key==='house'&&f.key==='year_built')await send('answer',target,{status:'answered',value:2000});
   else if(f.def.type==='date')await send('answer',target,{status:'answered',value:'2026-12-10'});
   else {draft.skips[f.addr]={reason:'Other',note:'QA fixture: excluded by agreement',assumption};await send('answer',target,{status:'skipped',...(f.def.unit?{unit:f.def.unit}:{}),skip_reason:'Other',skip_note:'QA fixture: excluded by agreement'});}
  }
  m=await model();for(const s of m.sections)for(const shot of [...s.shots,...s.fields.flatMap(f=>f.shots)])draft.skips[shot.addr]={reason:'Other',note:'QA fixture: client declined photo',assumption};
  for(const flag of m.flags)draft.flags[flag.key]={disposition:'not_an_issue',note:'Reviewed for QA fixture'};
  const evidence={...draft,photos_ok:true,manual_confirmed:true,handed_back:true,ack_reason:null,promised_date:'2026-12-10',no_trades_confirmed:true,touched_trades:[],trade_walks:[],rrp:{receipt:true,firm_current:true,renovator_current:true,redelivery_required:false}};
  await run('evidence',{device,epoch:1,expected_revision:await rev(),evidence});
  const closing=m.sections.find(s=>s.module.key==='closing');
  const bytes=await sharp({create:{width:16,height:16,channels:3,background:'#ffffff'}}).png().toBuffer(),sha256=createHash('sha256').update(bytes).digest('hex'),event_id=randomUUID();
  const u=await initConsultUpload(c,ctx('upload',id),id,{event_id,device_id:device,device_epoch:1,kind:'initials',mime:'image/png',size:bytes.length,sha256,instance_id:closing.instance.id,field_key:'client_initials'});
  await putConsultPart(c,ctx('upload',id),id,u.upload_id,0,bytes,sha256);
  await commitConsultBlob(c,ctx('upload',id),id,u.upload_id,{event_id,sha256,summary_text:'QA Bath + Kitchen consultation — exclusions reviewed.'},uploadRoot);
  const result=await run('close',{expected_revision:await rev(),manifest:{device,epoch:1,last_seq:seq,required_blob_hashes:[],initials_hash:sha256,local_pending:0}});
  if(!result.complete)throw Error(`Incomplete QA visit: ${JSON.stringify(result)}`);
  visits.push({state,id,devices:[device],result});
 }
 return {namespace,staff,device_pin:{pin:'123456',instruction:'PIN is device-local: choose this PIN when preparing the visit in the browser; server devices do not enroll a browser vault.'},visits:visits.map(v=>({...v,url:`/consult/${v.id}`,office_url:`/projects/${slug}/consult/${v.id}`}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [url,slug]=process.argv.slice(2);if(!url||!slug)throw Error('Usage: node scripts/qa-seed-consult.mjs <DATABASE_URL> <project-slug>');
 const c=new pg.Client({connectionString:url});await c.connect();
 try{const index=await seedQaConsult(c,slug);await c.query('COMMIT');console.log(JSON.stringify(index,null,2));}catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}
}

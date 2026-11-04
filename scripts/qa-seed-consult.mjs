// Explicit target only. Each run is namespaced; no consult records bypass protocol validation.
import pg from 'pg';
import {randomUUID,createHmac,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {seedConsult} from '../db/seed-consult.mjs';
import {schedule,command,snapshot,hash} from '../lib/consult/protocol.ts';
import {buildModel,emptyDraft} from '../lib/consult/ui/model.ts';
import {initConsultUpload,putConsultPart,commitConsultBlob} from '../lib/consult/uploads.ts';
export async function seedQaConsult(c,slug,{uploadRoot,fixtureKey='consult-r7',skipEstimateDate=false}={}) {
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
 const namespace=`QA ${fixtureKey}`;
 await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[namespace+project.id]);
 const visits=[];
 for(const state of ['complete','conflict']){
  const existing=(await c.query("SELECT v.id FROM consults v JOIN consult_events e ON e.consult_id=v.id WHERE v.project_id=$1 AND e.type='scheduled_notes' AND e.payload->>'visitor_notes' =$2",[project.id,`${namespace} ${state}`])).rows[0];
  if(existing){visits.push({state,id:existing.id,reused:true});continue;}
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
     for(let n=count;n<slot.minimum;n++){await send('create_instance',{instance_id:randomUUID(),module_key:slot.module.key,label:`${slot.module.title} ${n+1}`,...(parent?{parent_id:parent}:{})},{},await rev());added=true;}
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
  for(const key of ['hvac_vent','hvac_exhaust_fan']){const m=await model();if(!m.sections.some(s=>s.module.key===key))await send('create_instance',{instance_id:randomUUID(),module_key:key,label:key,parent_id:m.sections.find(s=>s.module.key==='hvac').instance.id},{},await rev());}
  const assumption={text:'QA fixture: omitted from estimate',responsible_trade:'General contractor',verification_point:'Before pricing',adjustment_route:'precon_change',quantity:null,unit:null,exclusion:'QA only — excluded'};
  let m=await model();
  for(const s of m.sections)for(const f of [...s.fields,...s.hidden]){
   if(s.module.context_module||s.module.key==='visit'||f.def.derive||f.def.derive_cases||f.readOnly||f.def.type==='signature'||f.answer)continue;
   const target={instance_id:s.instance.id,field_key:f.key};
   if(s.module.key==='house'&&f.key==='year_built')await send('answer',target,{status:'answered',value:2000});
   else if(f.key==='estimate_promised'&&skipEstimateDate){draft.skips[f.addr]={reason:'Joe sets the date'};await send('answer',target,{status:'skipped',skip_reason:'Joe sets the date'});}
   else if(f.def.type==='date')await send('answer',target,{status:'answered',value:'2026-12-10'});
   else if(['length','count','number','year','yesno','choice','multi','text','length_pair'].includes(f.def.type)) {
    const numbers={length:144,width:120,height:96,toilet_front_clearance:30,toilet_rough_in:12,vanity_width:48,amp:200};
    let value=f.def.type==='yesno'?true:f.def.type==='choice'?(f.def.options.includes('Keep')?'Keep':f.def.options[0]):f.def.type==='multi'?[f.def.options[0]]:f.def.type==='text'?({name:s.module.key==='room'?(m.sections.filter(x=>x.module.key==='room').findIndex(x=>x.instance.id===s.instance.id)===0?'Hall bath':'Kitchen'):s.module.key==='kitchen_scope'?'Kitchen':s.module.key==='bath_scope'?'Hall bath':({door:'Bath door',electrical_panel:'Basement panel',exhaust_fan:'Bath fan',moisture_check:'Under tub'}[s.module.key]??s.module.title),permit_city:'Woodbury',permit_authority:'Woodbury',permit_building_inspector:'City of Woodbury',location:({door:'Bath door',panel:'Basement panel',hvac_exhaust_fan:'Bath fan'}[s.module.key]??'Hall bath'),where:'Under tub',decision:s.instance.label,product:'Delta Trinsic chrome finish',direction:'Simple shaker style in warm white',budget_words:'Durable midrange finishes; prioritize easy cleaning',alarms_locations:'Hall and each bedroom',who_lives_here:'Two adults, one dog',where_during_work:'Living at home',hoa_rules:'No HOA'}[f.key]??(f.key==='name'?s.module.title:'Client confirmed '+f.def.label)):f.def.type==='length_pair'?[36,24]:f.def.type==='year'?2000:f.def.type==='count'?1:numbers[f.key]??(f.def.unit==='amp'?200:f.def.unit==='cfm'?110:f.def.unit==='sf'?120:36);
    if(s.module.key==='selections'){
     const decision=String(s.fields.find(x=>x.key==='decision')?.answer?.value??s.instance.label??'Finish');
     if(f.key==='decision')value=decision;
     if(f.key==='status')value='A direction';
     if(f.key==='direction')value=/cabinet|vanity/i.test(decision)?'Shaker doors in warm white; soft-close drawers':/floor|tile/i.test(decision)?'Matte porcelain tile in a warm gray; easy-clean grout':/faucet|fixture|sink|shower/i.test(decision)?'Simple chrome fixtures; single-lever controls':'Simple neutral finish; review samples with the client';
     if(f.key==='product')value='Product not selected; client will review samples';
    }
    if(s.module.key==='era'&&['before_1978','disturbs_paint','window_door_replacement'].includes(f.key))value=false;
    if(s.module.key==='plumb_fixture'&&f.key==='fixture'){const peers=m.sections.filter(x=>x.module.key==='plumb_fixture'&&x.instance.parent_id===s.instance.parent_id);value=['Toilet','Bath sink','Shower'][peers.findIndex(x=>x.instance.id===s.instance.id)]??'Sink';if(!f.def.options.includes(value))value=f.def.options.find(x=>x.toLowerCase().includes(value.toLowerCase().split(' ')[0]))??f.def.options.find(x=>x!=='Toilet');}
    if(f.def.maps_to?.kind==='new_work')value={origin:'client_requested_optional',text:'Add dimmable task lighting above the kitchen counter'};
    if(typeof value==='number'&&f.def.range)value=Math.max(f.def.range[0],Math.min(f.def.range[1],value));
    await send('answer',target,{status:'answered',value,...(f.def.unit?{unit:f.def.unit}:{})});
   }
   else {draft.skips[f.addr]={reason:'Other',note:'QA fixture: excluded by agreement',assumption};await send('answer',target,{status:'skipped',...(f.def.unit?{unit:f.def.unit}:{}),skip_reason:'Other',skip_note:'QA fixture: excluded by agreement'});}
  }
  m=await model();for(const s of m.sections)for(const shot of [...s.shots,...s.fields.flatMap(f=>f.shots)])draft.skips[shot.addr]={reason:'Other',note:'QA fixture: client declined photo',assumption};
  for(const flag of m.flags)draft.flags[flag.key]={disposition:'not_an_issue',note:'Reviewed for QA fixture'};
  const evidence={...draft,photos_ok:true,manual_confirmed:true,handed_back:true,ack_reason:null,promised_date:skipEstimateDate?null:'2026-12-10',no_trades_confirmed:false,touched_trades:m.touchedTrades,trade_walks:m.touchedTrades.map(trade=>({trade,needed:true,reason:trade==='Plumber'?'Confirm shower drain and sink connections':trade==='Electrician'?'Confirm kitchen circuits and bath GFCI':'Confirm bath exhaust route'})),rrp:{receipt:true,firm_current:true,renovator_current:true,redelivery_required:false}};
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

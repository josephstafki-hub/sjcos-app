#!/usr/bin/env node
/** Explicit QA URL only; never reads .env.local or defaults to a Postgres port. */
import {pathToFileURL} from 'node:url';
import {randomBytes,randomUUID,createHmac,createHash,scryptSync} from 'node:crypto';
import {mkdir,writeFile,readFile,chmod} from 'node:fs/promises';
import {qaTarget,qaGuard,qaPrivatePath,prepareQaAuditKeys,QA_PEOPLE,PUBLIC_URLS,qaProof,qaAttachRun,qaIdentity,writeScenario} from './qa-browser-fake-controller.mjs';
import {prepareQaLogins,qaLoginUrl,verifyQaLoginUrls,QA_LOGINS} from '../qa/browser/logins.mjs';
import * as repo from '../lib/browser/repository.mjs';
import {buildReadManifest} from '../lib/browser/read-manifest.mjs';

export const BASE_STATES=['empty','queue_full','queued','offer','offer_expired','queue_expired','starting','working','paused','paused_private','idle_warning','idle_closed','crashed','latched','absent','turn_ended','owner_paused','unknown','read_review','resource_review','write_blocked','final_blocked','auth_expired','access_removed','closed','service_unavailable','other_device'];
export const RECIPES={
 off:['empty','Owner: disable Browser in settings; restore after shot.'],unsupported:['empty','Select a non-Claude agent; return to Claude afterward.'],
 sites_empty:['empty','Open Browser, then Sites. Cancel without starting.'],sites_added:['working','Open Sites: city.example and county.example; exact approved addresses are listed.'],

 guarded_menu:['working','Open ⋯: Back/Reload enabled, Forward disabled; both QA windows. No real browser history.'],
 reload_confirm:['working','Open ⋯ → Reload; capture warning, Cancel and explicit Reload.'],
 exact_path_review:['read_review','Review exact same-origin /permits/details; approval does not navigate.'],
 exact_resource_review:['resource_review','Review exact document and CSS together, then explicitly Reload.'],
 watch_consent_reask:['working','Owner opens public Watch; staff takes over. Old image clears; Show the page is required again.'],
 watch_audit_pending:['paused_private','Owner explicitly Show the page: local QA checkpoint withheld; waiting placeholder, no private frames. Reseed owner_watch_after to recover.'],
 pre_frame_close:['working','No JPEG; switch Browser → Chat/Canvas and inspect exact planned-close ACK before GET abort.'],
 loading:['starting','Opening state. Earlier view requires a real previous frame and delayed reload; see limits.'],
 takeover_confirm:['working','Tap Take over; leave confirmation open. Owner also captures the own-confirm checkbox.'],
 taking_over:['working','Confirm Take over; the signed fake ACK delays one second.'],
 controlling:['working','Take over → confirm; token stays in memory. Then test Keyboard/IME/Escape, Zoom/Fit and Pause live view.'],
 done:['working','Take over → confirm → Done. Capture first prompt, then Keep paused and leave/return.'],
 fresh_confirm:['paused_private','Open menu → Fresh browser. Capture cancel, then confirm and verify private image/consent clears.'],
 leave_confirm:['working','Try leaving Browser for Chat/Canvas/app; capture confirmation and cancel.'],
 pause_failed:['working','Watch as owner → Pause agent → confirm; fake refuses the ACK.'],
 owner_watch_before:['paused_private','Sign in as owner; open watch_url. Old canned frame is available but no image may appear before Show the page.'],
 owner_watch_after:['paused_private','Sign in as owner; open watch_url, explicitly Show the page. This is a real consent POST.'],
 public_watch:['working','Sign in as owner; open watch_url. Passive close leaves staff task running.'],
 in_use:['working','Owner: open an empty own thread → In use → Watch staff.'],
 settings:['empty','Owner: /settings/browser. Later flags remain off/disabled.'],
 disconnected:['working','Stop only the fake fixture, capture connection loss, then start it again.'],
 reconnected:['working','After fixture restart, explicitly reconnect and review.'],
 resource_20:['resource_review','Twenty resources; real GET paging limit 20.'],resource_21:['resource_review','SQL caps pending candidates at 20. Unsupported adversarial screenshot; see limits.'],
 resource_expired:['resource_review','Wait 60 seconds; candidate deadlines are never extended by GET.'],
};
const idFor=text=>{const h=createHash('sha256').update('sjcos-browser-qa-v1:'+text).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
export const QA_PROJECT={id:idFor('maple-ave-kitchen'),slug:'qa-browser-maple-ave-kitchen',name:'Maple Ave kitchen'};
const hash=x=>createHash('sha256').update(x).digest();
const origins={v:1,entries:[{origin:'https://city.example',role:'document'},{origin:'https://county.example',role:'document'}]};
const setting=async(c,k,v)=>c.query(`INSERT INTO app_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp() WHERE app_settings.value IS DISTINCT FROM EXCLUDED.value`,[k,v]);

/** c must be the caller's explicit connected QA bootstrap client, never ambient. */
export async function seedBrowser(c,{state='working',refresh=false,resourceCount=1}={}){
 const dir=await prepareQaLogins(c),database=(await c.query('SELECT current_database() name')).rows[0].name;
 if(!BASE_STATES.includes(state)&&!RECIPES[state])throw Error('Unknown QA Browser state');
 const requested=state,base=RECIPES[state]?.[0]??state;if(state==='resource_20')resourceCount=20;
 await mkdir(dir,{recursive:true,mode:0o700});await qaPrivatePath(dir);
 await mkdir(dir+'/keys',{mode:0o700,recursive:true});await qaPrivatePath(dir+'/keys');
 const keys={};for(const name of ['request','response','frame']){const path=dir+'/keys/'+name+'.hex';try{await writeFile(path,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}await qaPrivatePath(path,{file:true});const value=(await readFile(path,'utf8')).trim();if(!/^[a-f0-9]{64}$/.test(value))throw Error('Invalid QA key');keys[name]=Buffer.from(value,'hex');}
 await prepareQaAuditKeys(dir);
 let previous;try{await qaPrivatePath(dir+'/scenario.json',{file:true});previous=JSON.parse(await readFile(dir+'/scenario.json','utf8'));if(previous.database!==database)throw Error('QA scenario DB mismatch');}catch(e){if(e.code!=='ENOENT')throw e;}
 const website=(await c.query("SELECT pg_get_userbyid(relowner) name FROM pg_class WHERE oid='public.browser_tasks'::regclass")).rows[0].name;
 // Serialize all seed invocations; no disabling triggers/constraints or schema changes.
 await c.query('SELECT pg_advisory_lock(1150099)');
 try{
  if(previous?.fixture_revision!==3)refresh=true;
  const scenario=previous??{v:1,database,install_id:randomUUID(),tasks:{},states:{}};scenario.install_id??=randomUUID();scenario.fixture_revision=3;
  const asWebsite=fn=>qaIdentity(c,website,fn),asService=fn=>qaIdentity(c,'sjcos_browser',fn);
  await asWebsite(async c=>{
   for(const [role,p] of Object.entries(QA_PEOPLE)){
    const passwordFile=dir+'/keys/'+role+'.password';
    try{await writeFile(passwordFile,randomBytes(24).toString('base64url')+'\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
    await qaPrivatePath(passwordFile,{file:true});const password=(await readFile(passwordFile,'utf8')).trim(),salt=randomBytes(16).toString('hex'),exists=(await c.query('SELECT id FROM users WHERE id=$1',[p.id])).rows[0],passwordHash=exists?'unused':salt+':'+scryptSync(password,salt,64).toString('hex');
    await c.query(`INSERT INTO users(id,email,name,role,permissions,password_hash,initials) VALUES($1,$2,$3,$4,ARRAY['ai','projects','compliance'],$6,$5) ON CONFLICT(id) DO NOTHING`,[p.id,p.email,p.name,role,p.name.slice(0,2),passwordHash]);
    const u=(await c.query('SELECT * FROM users WHERE id=$1',[p.id])).rows[0];if(u.role!==role||!u.active||role==='staff'&&!['ai','projects','compliance'].every(a=>u.permissions.includes(a)))throw Error('QA principal collision or missing permissions');
   }
   await c.query(`INSERT INTO projects(id,slug,name,client_name,address,status) VALUES($1,$2,$3,'Morgan Reed','124 Maple Avenue','construction') ON CONFLICT(id) DO NOTHING`,[QA_PROJECT.id,QA_PROJECT.slug,QA_PROJECT.name]);
   for(const [k,v] of Object.entries({'browser.enabled':'true','browser.staff_enabled':'true','browser.pilot_user_ids':JSON.stringify(Object.values(QA_PEOPLE).map(p=>p.id)),'browser.vault_enabled':'false','browser.files_enabled':'false','browser.final_steps_enabled':'false','browser.permit_handoff_enabled':'false'}))await setting(c,k,v);
   // Same disposable recovery readiness convention as the existing QA seeds.
   await c.query('UPDATE ask_canvas_maintenance SET recovery_ready=true WHERE NOT recovery_ready');
  });
  const make=async(role,kind,{archive=false}={})=>{
   const key=role+'_'+kind,person=QA_PEOPLE[role],thread=idFor(key);
   await asWebsite(c=>c.query(`INSERT INTO ai_conversations(id,agent,title,owner_user_id) VALUES($1,'claude',$2,$3) ON CONFLICT(id) DO NOTHING`,[thread,'QA Browser · '+person.name+' · '+kind,person.id]));
   let live=(await asWebsite(c=>c.query(`SELECT * FROM browser_tasks WHERE initiator_user_id=$1 AND state IN ('queued','starting','active','paused')`,[person.id]))).rows[0];
   if(live){
    // QA-only, slot-independent retirement. The scenario + QA principal,
    // deterministic thread and project must all agree before any mutation.
    await asWebsite(async c=>{
     await c.query('BEGIN');
     try{
      live=(await c.query('SELECT * FROM browser_tasks WHERE id=$1 FOR UPDATE',[live.id])).rows[0];
      const entry=scenario.tasks[live.id];
      if(!entry||entry.as!==role||live.initiator_user_id!==person.id||live.project_id!==QA_PROJECT.id||live.conversation_id!==idFor(role+'_'+entry.state))throw Error('QA_ONLY: refusing unrelated Browser task retirement');
      await c.query(`UPDATE browser_viewers SET left_at=clock_timestamp(),visible_until=clock_timestamp(),control_expires_at=NULL,last_frame_uuid=NULL,stream_id=gen_random_uuid(),stream_generation=stream_generation+1,owner_private_view_authorized_at=NULL,owner_private_context_generation=NULL,owner_private_authorization_revision=NULL WHERE task_id=$1 AND left_at IS NULL`,[live.id]);
      await c.query(`UPDATE browser_owner_views SET revoked_at=clock_timestamp(),revision=revision+1 WHERE task_id=$1 AND revoked_at IS NULL`,[live.id]);
      await c.query(`UPDATE browser_tasks SET controller_user_id=NULL,controller_device_hash=NULL,control_token_hash=NULL,control_expires_at=NULL,control_epoch=control_epoch+1,revision=revision+1 WHERE id=$1`,[live.id]);
      // Use the real guarded join/stop transition after the old bindings are
      // fenced, still holding the task lock. Admission limits stay unchanged.
      const device=randomBytes(32),join=await qaProof(c,live,live.initiating_web_session_id,null,'join',{}, {device_secret_hash:device.toString('hex')});
      const viewer=await repo.browserWebJoin(c,{tid:live.id,session:live.initiating_web_session_id,device_hash:device,role:'initiator',private_view:false,i:join.i,d:join.d});
      live=(await c.query('SELECT * FROM browser_tasks WHERE id=$1',[live.id])).rows[0];
      const p=await qaProof(c,live,live.initiating_web_session_id,viewer.viewer_id,'close');
      await repo.browserWebControl(c,{tid:live.id,vid:viewer.viewer_id,op:'stop',epoch:Number(live.control_epoch),i:p.i,d:p.d});
      // Preserve immutable capability evidence; finish the QA run's lifecycle
      // after guarded Stop has revoked its capability.
      await c.query("UPDATE browser_task_runs SET disposition='stopped',ended_at=coalesce(ended_at,clock_timestamp()) WHERE task_id=$1 AND disposition='running'",[live.id]);
      // The cleanup viewer is not continuing attendance after Stop either.
      await c.query('UPDATE browser_viewers SET left_at=clock_timestamp(),visible_until=clock_timestamp() WHERE id=$1',[viewer.viewer_id]);
      if(live.current_run_id)await c.query("UPDATE dev_agent_runs SET status='done' WHERE id=$1",[live.current_run_id]);
      await c.query('COMMIT');entry.active=false;
     }catch(error){await c.query('ROLLBACK');throw error;}
    });
   }
   if(kind==='empty'){scenario.states[key]={url:`/panel?c=${thread}`,as:role,thread_id:thread,notes:'Choose Browser. No task has been started.'};return;}
   const sid=(await asWebsite(c=>c.query(`INSERT INTO web_sessions(user_id,auth_at,expires_at) VALUES($1,now(),now()+interval '8 hours') RETURNING id`,[person.id]))).rows[0].id;
   const boot=randomUUID(),now=Date.now(),initial=buildReadManifest({proposal:{v:1,entries:[{url:PUBLIC_URLS[0],role:'document',source:'person'}]},expectedRevision:0,actorProof:{key:createHmac('sha256',keys.request).update('browser-phase1-read-manifest-key').digest(),task:{origins,private:false,privacy_mode:'public',document_epoch:0,read_manifest_revision:0},confirmedFacts:{values:[],classifyPublicUrl:u=>PUBLIC_URLS.includes(u)},userId:person.id,sessionId:sid,sessionExpiresAt:now+3600000,authorize:()=>true}});
   let task=await asWebsite(c=>repo.browserWebAdmit(c,{conversation:thread,project:QA_PROJECT.id,kind:'public_research',manifest:{purpose:'Check public permit requirements for a residential alteration.',origins,initial_read:initial},session:sid,i:randomUUID(),d:hash(kind+role)}));
   // The real queue offer persists the fixture kernel boot; acceptance initializes both generations.
   const device=hash('QA seed viewer '+task.id),p=await asWebsite(c=>qaProof(c,task,sid,null,'join',{}, {device_secret_hash:device.toString('hex')}));
   const joined=await asWebsite(c=>repo.browserWebJoin(c,{tid:task.id,session:sid,device_hash:device,role:'initiator',private_view:false,i:p.i,d:p.d}));const vid=joined.viewer_id;
   const get=async()=>{const t=(await asWebsite(c=>c.query('SELECT * FROM browser_tasks WHERE id=$1',[task.id]))).rows[0];return {...t,control_epoch:Number(t.control_epoch),document_epoch:Number(t.document_epoch),context_generation:Number(t.context_generation),revision:Number(t.revision)};};
   const control=async(op,extra={})=>{task=await get();const p=await asWebsite(c=>qaProof(c,task,sid,vid,({stop:'close',done:'release',take_over:'takeover'})[op]??op,{},extra));return asWebsite(c=>repo.browserWebControl(c,{tid:task.id,vid,op,epoch:task.control_epoch,i:p.i,d:p.d}));};
   const entry={task_id:task.id,project_id:QA_PROJECT.id,task_label:'Check public permit requirements',job_label:QA_PROJECT.name,as:role,state:kind,active:!archive};scenario.tasks[task.id]=entry;
   if(!['queued','offer','offer_expired','queue_expired'].includes(kind)){
    await asService(c=>repo.browserQueueOffer(c,{boot}));
    const p=await asWebsite(c=>qaProof(c,task,sid,vid,'accept_offer',{}, {boot_id:boot}));await asWebsite(c=>repo.browserWebQueue(c,{tid:task.id,vid,op:'accept',i:p.i,d:p.d}));task=await get();
    if(kind!=='starting'){
     const run=await asWebsite(c=>qaAttachRun(c,task,{id:vid},{sid}));task=await get();
     const binding={pid:1,start_ticks:'1',cgroup:'/qa-no-process',boot_id:boot};const p=await asWebsite(c=>qaProof(c,task,sid,vid,'capability',{}, {process_binding:binding}));
     const cap=await asWebsite(c=>repo.browserWebCapability(c,{tid:task.id,rid:run.run_id,vid,server_kind:'browser',process_binding:binding,i:p.i}));
     if(['read_review','resource_review','write_blocked','final_blocked'].includes(kind)){
      const command=await asService(c=>repo.browserCommandBegin(c,{tid:task.id,rid:run.run_id,k:Buffer.from(cap.capability_hash,'hex'),i:randomUUID(),epoch:task.control_epoch,seq:1,op:'prepare',d:hash('QA prepare')}));task=await get();
      let reviewKind=kind==='read_review'?'public_read':kind==='resource_review'?'resource_read':kind;
      if(kind==='read_review'||kind==='resource_review'){
       const candidates=Array.from({length:kind==='resource_review'?resourceCount:1},(_,i)=>({id:randomUUID(),url:kind==='resource_review'?`https://city.example/assets/public-${i+1}.css`:requested==='exact_path_review'?'https://city.example/permits/details':PUBLIC_URLS[1],role:kind==='resource_review'?'resource':'document',source:'page',code:'BROWSER_REVIEW_REQUIRED',server_deadline:new Date(Date.now()+59000).toISOString(),parent_document_epoch:task.document_epoch+1}));
       if(requested==='exact_resource_review')candidates.unshift({...candidates[0],id:randomUUID(),url:PUBLIC_URLS[0],role:'document'});
       const p=await asWebsite(c=>qaProof(c,task,sid,vid,'review'));await asWebsite(c=>repo.browserWebReadCandidates(c,{tid:task.id,vid,expected_revision:1,proposal:{v:1,candidates},i:p.i,d:p.d}));
      }
      task=await get();const review={id:command.command_id,task_id:task.id,original_run_id:run.run_id,revision:task.revision,kind:reviewKind,state:'pending',server_deadline:reviewKind.endsWith('read')?new Date(Date.now()+59000).toISOString():null,result_code:reviewKind.endsWith('blocked')?'BROWSER_PHASE1_READ_ONLY':null,read_revision:reviewKind.endsWith('read')?2:null};
      // SQL prepare creates the immutable task/run-bound notice. QA varies its
      // safe presentation kind; no external action/approval/grant is created.
      await asWebsite(c=>c.query(`UPDATE browser_commands SET safe_result=jsonb_set(safe_result,'{review}',$2::jsonb) WHERE id=$1`,[command.command_id,JSON.stringify(review)]));entry.reviews=[review];
     }
     if(kind==='paused_private'||kind==='other_device')await asService(c=>repo.browserEnterPrivate(c,{tid:task.id,boot,expected_epoch:task.control_epoch,mode:'private'}));
     else if(!['working','idle_warning','read_review','resource_review','write_blocked','final_blocked'].includes(kind))await control('pause',{fenced:true});
     if(kind==='other_device'){task=await get();await asWebsite(c=>c.query('UPDATE browser_tasks SET controller_user_id=$2,controller_device_hash=$3,control_expires_at=now()+interval \'8 hours\' WHERE id=$1',[task.id,person.id,device]));}
     if(kind==='owner_paused')await asWebsite(c=>c.query("UPDATE browser_tasks SET paused_by='owner',paused_by_user_id=$2 WHERE id=$1",[task.id,QA_PEOPLE.owner.id]));
     if(kind==='turn_ended')await asWebsite(c=>c.query("UPDATE browser_tasks SET paused_by='agent',paused_by_user_id=NULL WHERE id=$1",[task.id]));
     const reason={idle_closed:'idle_closed',crashed:'crashed',latched:'latched',absent:'absent',turn_ended:'turn_ended',owner_paused:'owner_paused',unknown:'unknown'}[kind];if(reason){entry.reason=reason;entry.no_frames=['idle_closed','crashed','latched'].includes(kind);}
     const code={queue_full:'BROWSER_QUEUE_FULL',auth_expired:'BROWSER_AUTH_EXPIRED',access_removed:'BROWSER_REVOKED',closed:'BROWSER_NOT_FOUND',service_unavailable:'BROWSER_SERVICE_UNAVAILABLE'}[kind];if(code){entry.code=code;entry.no_frames=true;}
     if(kind==='idle_warning')entry.idle_closes_at=new Date(Date.now()+60000).toISOString();
     if(kind==='starting')entry.no_frames=true;
     const message=(await asWebsite(c=>c.query(`INSERT INTO ai_messages(conversation_id,role,body) VALUES($1,'user','Please check the public permit information for 124 Maple Avenue.') RETURNING id`,[thread]))).rows[0].id;
     await asWebsite(c=>c.query('UPDATE browser_tasks SET confirmed_answers=$2 WHERE id=$1',[task.id,JSON.stringify([{id:randomUUID(),revision:1,field_key:'project.address',label:'Project address',value:'124 Maple Avenue',source_message_id:message,confirmed_at:new Date().toISOString()}])]));
    }
   }else{
    entry.no_frames=true;
    if(['offer','offer_expired'].includes(kind))await asService(c=>repo.browserQueueOffer(c,{boot}));
   }
   if(archive)await control('stop');
   // Seed attendance is not an extra device competing with screenshot viewers.
   if(kind==='other_device'&&!archive)await asWebsite(c=>c.query("UPDATE browser_viewers SET visible_until=(SELECT expires_at FROM web_sessions WHERE id=browser_viewers.web_session_id) WHERE id=$1",[vid]));
   else await asWebsite(c=>c.query('UPDATE browser_viewers SET left_at=now(),visible_until=now() WHERE id=$1',[vid]));
   if(archive){task=await get();if(task.current_run_id)await asWebsite(c=>c.query("UPDATE dev_agent_runs SET status='done' WHERE id=$1",[task.current_run_id]));}
   scenario.states[key]={url:`/panel?c=${thread}`,as:role,thread_id:thread,task_id:task.id,watch_url:role==='staff'?`/today?browser=${task.id}`:null,notes:`Select with --state ${kind} before capturing; choose Operator > Browser. ${archive?'Historical terminal fixture; not currently selected.':'Selected.'}`};
  };
  // The unique live-person index stays intact. Archive every base state once;
  // future invocations only replace the selected live task (or --refresh).
  if(!previous)for(const role of ['owner','staff'])for(const kind of BASE_STATES)await make(role,kind,{archive:true});
  if(!previous||previous.selected!==requested||refresh){
   for(const role of ['owner','staff'])await make(role,base);
   // Expire only after both admissions/offers. Otherwise the second person's
   // real queue sweep closes the first person's task before QA can join it.
   if(['offer_expired','queue_expired'].includes(base))for(const role of ['owner','staff'])await asWebsite(c=>c.query(base==='offer_expired'?"UPDATE browser_tasks SET queue_offer_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1":"UPDATE browser_tasks SET queue_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[scenario.states[role+'_'+base].task_id]));
   scenario.selected=requested;scenario.selected_at=new Date().toISOString();
  }
  for(const role of ['owner','staff'])for(const [name,[kind,notes]] of Object.entries(RECIPES)){const original=scenario.states[role+'_'+kind];scenario.states[role+'_'+name]={...original,notes:`Select with --state ${name}. ${notes}`};}
  if(requested==='off')await asWebsite(c=>setting(c,'browser.enabled','false'));
  if(requested==='taking_over')for(const role of ['owner','staff'])scenario.tasks[scenario.states[role+'_working'].task_id].control_delay_ms=1000;
  if(requested==='pause_failed')for(const role of ['owner','staff'])scenario.tasks[scenario.states[role+'_working'].task_id].pause_fails=true;
  for(const role of ['owner','staff']){const entry=scenario.tasks[scenario.states[role+'_'+base]?.task_id];if(entry){entry.navigation=['guarded_menu','reload_confirm','exact_path_review','exact_resource_review'].includes(requested);entry.windows=entry.navigation?2:1;entry.audit_pending=requested==='watch_audit_pending';if(requested==='pre_frame_close')entry.no_frames=true;}}
  scenario.states.owner_settings={url:'/settings/browser',as:'owner',notes:'Pilot list contains Taylor and Abigail. All four later flags off.'};
  await writeScenario(dir,scenario);
  return scenario;
 }finally{await c.query('RESET SESSION AUTHORIZATION');await c.query('SELECT pg_advisory_unlock(1150099)');}
}
/** systemd EnvironmentFile syntax: values are quoted data, never shell code.
 * Do not source these files in a shell; use EnvironmentFile on the side units. */
async function mergeEnvironment(target,values){
 let previous='';try{await qaPrivatePath(target,{file:true});previous=await readFile(target,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 // Keep all coordinator lines byte-for-byte, including comments and quoting.
 const kept=previous.split('\n').filter(line=>{const key=/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];return !key||!Object.hasOwn(values,key);}).join('\n').replace(/\n*$/,'');
 const generated=Object.entries(values).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n');
 await writeFile(target,(kept?kept+'\n':'')+generated+'\n',{mode:0o600});await chmod(target,0o600);
}
export async function writeQaEnvironment(c,url){
 const dir=await qaGuard(c);
 const sessionFile=dir+'/keys/session.hex';try{await writeFile(sessionFile,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}await qaPrivatePath(sessionFile,{file:true});
 const shared={SJC_QA_SIDE_BUILD:'1',SJC_QA_BROWSER_FAKE:dir,SJC_BROWSER_ENABLED:'1',SJC_OUTBOUND_DISABLED:'1'};
 for(const [name,key]of Object.entries({request:'SJC_BROWSER_WEB_RPC_KEY',response:'SJC_BROWSER_WEB_RESPONSE_KEY',frame:'SJC_BROWSER_FRAME_KEY'}))shared[key]=(await readFile(dir+'/keys/'+name+'.hex','utf8')).trim();
 const logins=Object.fromEntries(await Promise.all(QA_LOGINS.map(async role=>[role,await qaLoginUrl(url,role,dir)])));
 // Real connections, every URL, before publishing an environment file.
 await verifyQaLoginUrls(logins);
 const side={...shared,DATABASE_URL:logins.sjcos,SESSION_SECRET:(await readFile(sessionFile,'utf8')).trim()};
 for(const [key,role]of Object.entries({DATABASE_URL_AGENT:'sjcos_agent',DATABASE_URL_WORKER:'sjcos_worker',DATABASE_URL_READONLY:'sjcos_readonly',DATABASE_URL_BACKUP:'sjcos_backup',DATABASE_URL_BROWSER:'sjcos_browser'}))side[key]=logins[role];
 const generated=dir+'/side.generated.env';try{await qaPrivatePath(generated,{file:true});}catch(e){if(e.code!=='ENOENT')throw e;}
 await writeFile(generated,Object.entries(side).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n',{mode:0o600});await chmod(generated,0o600);
 await mergeEnvironment(dir+'/side.env',side);
 // Origin/dist/provider/Canvas/Ask/cron configuration belongs to the coordinator.
 // Add an origin default only on first provision; preserve subsequent overrides.
 const sideText=await readFile(dir+'/side.env','utf8');
 if(!/^\s*NEXT_PUBLIC_APP_URL\s*=/m.test(sideText))await mergeEnvironment(dir+'/side.env',{NEXT_PUBLIC_APP_URL:process.env.NEXT_PUBLIC_APP_URL??'http://127.0.0.1:3191'});
 await mergeEnvironment(dir+'/fake.env',{...shared,SJC_QA_DATABASE_URL:url});
}

async function main(){
 const name=process.argv[2],url=qaTarget(name,process.env.SJC_QA_DATABASE_URL);if(process.env.SJC_QA_SIDE_BUILD!=='1'||!process.env.SJC_QA_BROWSER_FAKE)throw Error('QA_ONLY: missing side-build env');
 const args=process.argv.slice(3);let state='working',refresh=false;for(let i=0;i<args.length;i++){if(args[i]==='--state')state=args[++i];else if(args[i]==='--refresh')refresh=true;else throw Error('Usage: qa-seed-browser.mjs DB_NAME [--state STATE] [--refresh]');}
 const {default:pg}=await import('../lib/guarded-pg.mjs');const c=new pg.Client({connectionString:url});await c.connect();try{const scenario=await seedBrowser(c,{state,refresh});await writeQaEnvironment(c,url);console.log(JSON.stringify(scenario.states,null,2));}finally{await c.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});

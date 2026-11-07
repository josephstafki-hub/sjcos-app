'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {browserAPI,BrowserAPIError,type Detail,type Viewer,type Reads} from './browser/api';
import {browserDevice} from './browser/device';
import {browserModel,browserErrorCopy,browserErrorState,privateWatchReady,type BrowserModel} from './browser/model';
import {createFrameGate,readReview,browserFlags,createStreamLifecycle,browserProjection,renewControl} from './browser/session';
import type {Frame as FrameData,ControlMessage,BrowserEvents} from '../../lib/browser/web-types';
import {isNavigation,navigationBinding} from './browser/navigation';
import {Frame,InputEvent} from '../../lib/browser/phase1-contracts.mjs';

export type BrowserSession=ReturnType<typeof useBrowserSession>;
const initial:BrowserModel={state:'empty',origin:'',phone:true,ownerName:'Owner',personName:'Team member',width:360};
export function useBrowserSession({taskId,conversationId,visible,active=true,ownerView=false,localThreadId,signal,onExit,identity,onCreated,ensureConversation}:{taskId:string|null;conversationId:string|null;visible:boolean;active?:boolean;ownerView?:boolean;localThreadId?:string|null;signal?:AbortSignal;onExit?:()=>void;identity?:{personName:string;ownerName:string;isOwner:boolean};onCreated?:(id:string)=>void;ensureConversation?:()=>Promise<string>}) {
 const [model,setModel]=useState<BrowserModel>(initial),[version,refresh]=useState(0),[joinVersion,rejoin]=useState(0);
 const live=useRef({model,visible,active,onExit,onCreated,ensureConversation});live.current={model,visible,active,onExit,onCreated,ensureConversation};
 const adoption=useRef<{taskId:string;joined:Viewer & Detail}|null>(null),viewer=useRef<Viewer|null>(null),detail=useRef<Detail|null>(null),frame=useRef<FrameData|null>(null),token=useRef<{value:string;expires:number}|null>(null),reads=useRef<Reads|null>(null),seq=useRef(0),busy=useRef(false),current=useRef(0),frameGate=useRef(createFrameGate()),streamDrain=useRef<Promise<unknown>>(Promise.resolve()),streamAbort=useRef<AbortController|null>(null),streamStop=useRef<(()=>Promise<unknown>)|null>(null),offset=useRef(0),idleDeadline=useRef<string|null>(null),address=useRef(''),purpose=useRef(''),requestedAction=useRef<string|null>(null),donePrompt=useRef(false),leaveResolve=useRef<((ok:boolean)=>void)|null>(null),lastMove=useRef(0),mustPause=useRef(false);
 const patch=useCallback((p:Partial<BrowserModel>)=>setModel(m=>({...m,...p})),[]);
 const clear=useCallback(()=>{streamAbort.current?.abort();frame.current=null;token.current=null;patch({frameUrl:undefined,capture:false});},[patch]);
 const failure=useCallback((e:unknown)=>{const code=(e as BrowserAPIError)?.code??'';clear();patch({state:browserErrorState(code),error:browserErrorCopy(code,live.current.model),availableControls:[]});},[clear,patch]);
 const apply=useCallback((d:Detail)=>{
  const old=detail.current;if((old&&d.revision<old.revision)||!frameGate.current.observe(d))return false;
  if(old&&(old.context_generation!==d.context_generation||old.task.private!==d.task.private)){clear();patch({privateConsented:false});refresh(x=>x+1);}
  if(ownerView&&d.task.private&&d.private_view_status!=='authorized'&&(frame.current||old?.private_view_status==='authorized')){clear();refresh(x=>x+1);}
  if(ownerView&&d.task.private&&!['pending_audit','authorized'].includes(d.private_view_status)){if(live.current.model.privateConsented||frame.current){clear();refresh(x=>x+1);}patch({privateConsented:false});}
  detail.current=d;
  if(d.task.control!=='person'){token.current=null;patch({capture:false});}
  const derived=browserModel({task:d.task,hasControl:!!token.current&&token.current.expires>Date.now()}),projection=browserProjection(d);
  offset.current=Date.parse(d.server_time)-Date.now();idleDeadline.current=d.idle_closes_at??null;
  const state=d.pending_action?.state==='pending'?d.pending_action.kind==='final_blocked'?'final_blocked':d.pending_action.kind==='write_blocked'?'write_blocked':d.pending_action.kind==='resource_read'?'resource_review':'read_review':donePrompt.current&&d.task.private?'done':projection.state??(d.reason_code?browserErrorState(d.reason_code):derived.state);
  patch({...derived,...projection,error:d.reason_code?browserErrorCopy(d.reason_code,live.current.model):undefined,ownerName:projection.ownerName??identity?.ownerName??'Owner',state,origin:d.task.allowed_sites[0]?new URL(d.task.allowed_sites[0]).host:'Browser',sites:d.task.allowed_sites,areas:d.task.required_areas,queuePosition:d.queue_position,availableControls:d.available_controls??[],navigation:d.navigation,privateViewStatus:d.private_view_status??'required'});
  return true;
 },[clear,patch,identity?.ownerName,ownerView]);
 const reload=useCallback(async()=>{if(!taskId||!viewer.current)return;const generation=current.current,d=await browserAPI.detail(taskId,viewer.current);if(generation===current.current){const blocked=!frameGate.current.ready();apply(d);if(blocked&&frameGate.current.ready())refresh(x=>x+1);}},[taskId,apply]);
 useEffect(()=>{patch({phone:browserDevice()==='phone',...identity,ownerView});},[identity?.personName,identity?.ownerName,identity?.isOwner,ownerView,patch]);
 useEffect(()=>{
  const generation=++current.current;const c=new AbortController();viewer.current=null;mustPause.current=false;frameGate.current=createFrameGate();detail.current=null;reads.current=null;donePrompt.current=false;clear();patch({state:taskId?'starting':'empty',hasTask:!!taskId,privateConsented:false,privateViewStatus:'required',dialog:null,error:undefined,availableControls:[],queuePosition:null,readUrls:[],approvedReadUrls:[],readExpired:true,watchingOwner:false});
  const abort=()=>{c.abort();clear();viewer.current=null;patch({state:'access_removed',dialog:null});};signal?.addEventListener('abort',abort,{once:true});
  if(!taskId||!active)return ()=>{c.abort();signal?.removeEventListener('abort',abort);};
  const join=async()=>{try{const pending=adoption.current?.taskId===taskId?adoption.current.joined:null;adoption.current=null;const d=pending??await browserAPI.join(taskId,{mode:ownerView?'owner_review':'initiator',...(ownerView&&localThreadId?{local_thread_id:localThreadId}:{})},undefined,c.signal);if(c.signal.aborted||generation!==current.current){void browserAPI.leave(taskId,d).catch(()=>{});return;}viewer.current=d;apply(d);if(requestedAction.current)void action('load_action',requestedAction.current);void browserAPI.answers(taskId,d).then(a=>{if(!c.signal.aborted)patch({answers:a.answers});}).catch(()=>{});if(joinVersion>0&&!d.task.private)patch({state:'reconnected'});refresh(x=>x+1);}catch(e){if(!c.signal.aborted)failure(e);}};
  void join();
  const presence=async()=>{const v=viewer.current,d=detail.current;if(!v||!d||c.signal.aborted)return;try{if(ownerView&&v.owner_review_claim&&Date.parse(v.owner_review_claim.expires_at)<Date.now()+30000){const renewed=await browserAPI.join(taskId,{mode:'owner_review',...(localThreadId?{local_thread_id:localThreadId}:{}),private_view:live.current.model.privateConsented===true},v,c.signal);if(c.signal.aborted)return;viewer.current=renewed;apply(renewed);refresh(x=>x+1);return;}const renewed=await browserAPI.presence(taskId,v,{visible:!document.hidden&&live.current.active,host_context:ownerView?{kind:'owner_review',claim_id:v.owner_review_claim!.claim_id}:{kind:'initiator',conversation_id:conversationId!},expected_epoch:d.task.control_epoch});if(c.signal.aborted)return;token.current=renewControl(token.current,detail.current??d,renewed);await reload();}catch(e){if(!c.signal.aborted){if(['BROWSER_STREAM_STALE','BROWSER_REVIEW_STALE'].includes((e as BrowserAPIError).code)){clear();try{await reload();}catch(error){failure(error);}}else failure(e);}}};
  const tick=setInterval(presence,5000);
  const hide=()=>{if(document.hidden){clear();void presence();}};document.addEventListener('visibilitychange',hide);
  return ()=>{c.abort();clearInterval(tick);signal?.removeEventListener('abort',abort);document.removeEventListener('visibilitychange',hide);const v=viewer.current;viewer.current=null;clear();leaveResolve.current?.(false);leaveResolve.current=null;if(v)void browserAPI.leave(taskId,v).catch(()=>{});};
 },[taskId,conversationId,active,ownerView,localThreadId,signal,joinVersion,apply,clear,patch,reload,failure]);
 useEffect(()=>{
  const v=viewer.current,d=detail.current;if(!taskId||!v||!d||!visible||!active||document.hidden||!frameGate.current.ready()||(ownerView&&d.task.private&&!privateWatchReady(model)))return;
  const c=new AbortController();streamAbort.current=c;const lifecycle=createStreamLifecycle(()=>c.abort());c.signal.addEventListener('abort',()=>lifecycle.fail(),{once:true});let stopped=false,opened=false,serverRotated=false,rotation:ReturnType<typeof setTimeout>|undefined;
  const stop=()=>{stopped=true;if(rotation)clearTimeout(rotation);frame.current=null;patch({frameUrl:undefined});if(!opened||serverRotated||c.signal.aborted){lifecycle.fail();c.abort();return Promise.resolve();}return lifecycle.close(binding=>browserAPI.closeStream(taskId,v,binding));};streamStop.current=stop;
  const run=async()=>{try{await streamDrain.current;if(stopped||c.signal.aborted)return;opened=true;await browserAPI.events(taskId,v,c.signal,(name,payload)=>{
   if(name==='state'){const s=payload as BrowserEvents['state'];if(s.stream_id&&s.stream_generation)lifecycle.bind({stream_id:s.stream_id,stream_generation:s.stream_generation});}
   if(stopped||c.signal.aborted)return;
   if(name==='state'){const s=payload as BrowserEvents['state'];offset.current=Date.parse(s.server_time)-Date.now();idleDeadline.current=s.idle_closes_at;apply({...detail.current!,...s});patch({watchingOwner:s.watching_owner});void reload().catch(failure);}
   if(name==='frame'){const f=Frame.parse(payload),now=detail.current;lifecycle.bind({stream_id:f.stream_id,stream_generation:f.stream_generation});if(!frameGate.current.ready()||!now||now.task.state==='closed'||now.task.state==='failed'||(ownerView&&now.task.private&&(now.private_view_status!=='authorized'||!privateWatchReady(live.current.model))))return;if(f.control_epoch!==now.task.control_epoch||f.document_epoch!==now.task.document_epoch)return;if(frame.current?.stream_id===f.stream_id&&frame.current.seq>=f.seq)return;frame.current=f;if(!live.current.model.livePaused)patch({frameUrl:'data:image/jpeg;base64,'+f.jpeg_base64});}
   if(name==='action'){const a=payload as {review:Detail['pending_action'];revision:number};if(detail.current&&a.revision>=detail.current.revision){detail.current={...detail.current,pending_action:a.review,revision:a.revision};apply(detail.current);void loadReads();}}
   if(name==='reauth'){serverRotated=true;frame.current=null;patch({frameUrl:undefined});rotation=setTimeout(()=>refresh(x=>x+1),0);}
   if(name==='closed'){clear();const code=(payload as {code:string}).code;if(code==='BROWSER_OK')patch({state:'closed'});else failure(new BrowserAPIError(code));}
  });if(!stopped&&!serverRotated&&!c.signal.aborted){clear();patch({state:'disconnected'});}}catch(e){if(!stopped&&!serverRotated&&!c.signal.aborted)failure(e);}finally{lifecycle.fail();}};void run();
  return ()=>{if(streamStop.current===stop)streamStop.current=null;streamDrain.current=stop().catch(()=>{});};
  // Live pause deliberately leaves the authenticated stream and attendance running.
 },[taskId,visible,active,ownerView,model.privateConsented,model.privateViewStatus,version,apply,clear,patch,failure,reload]);
 useEffect(()=>{const tick=setInterval(()=>{if(token.current&&token.current.expires<=Date.now()){token.current=null;patch({state:'paused_private',capture:false});}if(reads.current&&readReview(reads.current,offset.current).readExpired)patch({readExpired:true});const end=idleDeadline.current;if(end)patch({idleSeconds:Math.max(0,Math.ceil((Date.parse(end)-Date.now()-offset.current)/1000))});},1000);return ()=>clearInterval(tick);},[patch]);
 async function loadReads(){if(!taskId||!viewer.current)return;const generation=current.current;reads.current=null;patch({readUrls:[],readExpired:true});try{const r=await browserAPI.reads(taskId,viewer.current);if(generation!==current.current)return;reads.current=r;patch({...readReview(r,offset.current),approvedReadUrls:(r.entries??[]).map(e=>e.canonical_url)});}catch(e){if(generation===current.current)patch({error:browserErrorCopy((e as BrowserAPIError).code,live.current.model)});}}
 const perform=async(action:ControlMessage['action'],target?:string)=>{
  const v=viewer.current,d=detail.current;if(!taskId||!v||!d)throw new BrowserAPIError('BROWSER_CONTROL_EXPIRED');
  if(!d.available_controls?.includes(action))throw new BrowserAPIError('BROWSER_FORBIDDEN');
  const navigation=isNavigation(action)?navigationBinding(d,action,target):undefined;if(isNavigation(action)&&!navigation)throw new BrowserAPIError('BROWSER_REVIEW_STALE');
  const epoch=current.current;token.current=null;frame.current=null;patch({capture:false,frameUrl:undefined,availableControls:[]});
  if(isNavigation(action)&&streamStop.current){const close=streamStop.current();streamDrain.current=close.catch(()=>{});await close;}else streamAbort.current?.abort();
  // The response alone is not presentation authority. Discard the old stream
  // synchronously, then wait for authoritative detail/state in the new context.
  if(action==='fresh_browser')frameGate.current.reset(d.context_generation);
  const r=await browserAPI.control(taskId,v,action,d.task.control_epoch,navigation??undefined);if(epoch!==current.current)return;
  if(['done','pause','stop','fresh_browser'].includes(action))mustPause.current=false;
  if(action==='take_over')mustPause.current=true;
  if(action==='fresh_browser')frameGate.current.reset(d.context_generation,r.context_generation);
  await reload();
  const authoritative=detail.current;
  if(r.control_token&&r.expires_at&&authoritative?.context_generation===r.context_generation&&authoritative.task.control_epoch===r.task.control_epoch&&authoritative.task.control==='person'){token.current={value:r.control_token,expires:Date.parse(r.expires_at)-offset.current};apply(authoritative);}
  refresh(x=>x+1);
 };
 const action=async(name:string,value?:string)=>{
  if(name==='load_action'&&!viewer.current){requestedAction.current=value??null;return;}
  if(name==='address'){address.current=value??'';let ready=false;try{const url=new URL(address.current);ready=url.protocol==='https:'&&!url.username&&!url.password&&!url.hash;}catch{}patch({addressReady:ready});return;}if(name==='purpose'){purpose.current=value??'';return;}
  if(name==='cancel'){patch({dialog:null,error:undefined});leaveResolve.current?.(false);leaveResolve.current=null;return;}
  if(name==='capture_off'){patch({capture:false});return;}
  if(name==='capture'){if(token.current&&browserDevice()!=='phone')patch({capture:!live.current.model.capture});return;}
  if(name==='zoom'){patch({zoom:!live.current.model.zoom,capture:false});return;}
  if(name==='live_pause'){patch({livePaused:!live.current.model.livePaused});return;}
  if(name==='keep_paused'){donePrompt.current=false;patch({state:'paused_private'});return;}
  if(name==='menu'){patch({dialog:'menu'});return;}
  if(name==='takeover'){if(browserDevice()==='phone')return;if(!ownerView&&live.current.model.isOwner&&live.current.model.ownConfirmSuppressed)name='confirm_takeover';else {patch({dialog:ownerView?'replace':'takeover'});return;}}
  if(name==='reload'){if(detail.current&&navigationBinding(detail.current,'reload'))patch({dialog:'reload'});return;}
  if(name==='fresh'){patch({dialog:'fresh'});return;}
  if(name==='pause_owner'){patch({dialog:'pause_owner'});return;}
  if(name==='sites'){patch({dialog:'sites'});void loadReads();return;}
  if(name==='exit'){live.current.onExit?.();return;}
  if(busy.current)return;busy.current=true;patch({busy:true,error:undefined});
  try{
   if(name==='back'||name==='forward'||name==='window'||name==='confirm_reload'){await perform(name==='window'?'switch_tab':name==='confirm_reload'?'reload':name,value);patch({dialog:null});await loadReads();}
   else if(name==='load_action'&&value&&viewer.current){const result=await browserAPI.action(value,viewer.current);if(result.task_id!==taskId)throw new BrowserAPIError('BROWSER_FORBIDDEN');patch({state:result.outcome_code==='BROWSER_PHASE1_READ_ONLY'?'final_blocked':'unknown'});}
   else if(name==='confirm_takeover'){if(browserDevice()==='phone')return;patch({state:'taking_over',capture:false});await perform('take_over');patch({dialog:null});}
   else if(name==='done'){donePrompt.current=true;await perform('done');patch({state:'done',capture:false});}
   else if(name==='confirm_fresh'){clear();patch({privateConsented:false});donePrompt.current=false;await perform('fresh_browser');patch({dialog:null});}
   else if(name==='confirm_leave'||name==='retry_pause'){await perform('pause');patch({dialog:null});leaveResolve.current?.(true);leaveResolve.current=null;}
   else if(name==='confirm_pause_owner'){await perform('pause');patch({dialog:null,ownerPaused:true});}
   else if(name==='stop'){await perform('stop');patch({state:'closed',dialog:null});leaveResolve.current?.(true);leaveResolve.current=null;}
   else if(name==='resume'){if(!detail.current?.task.private)await perform('resume');}
   else if(name==='start'&&taskId){const started=await browserAPI.start(taskId,viewer.current??undefined);apply(started);if(started.start_code)throw new BrowserAPIError(started.start_code);await reload();}
   else if(name==='reconnect'){clear();rejoin(x=>x+1);}
   else if(name==='show_private'&&taskId&&detail.current?.task.private){const epoch=current.current;clear();patch({privateConsented:false,privateViewStatus:'pending_audit'});const v=await browserAPI.join(taskId,{mode:'owner_review',private_view:true,...(localThreadId?{local_thread_id:localThreadId}:{})},viewer.current??undefined);if(epoch!==current.current||!apply(v))return;viewer.current=v;patch({privateConsented:v.task.private&&['pending_audit','authorized'].includes(v.private_view_status)});refresh(x=>x+1);}
   else if(name==='keep_open'&&taskId&&viewer.current&&detail.current){await browserAPI.presence(taskId,viewer.current,{visible:true,host_context:ownerView?{kind:'owner_review',claim_id:viewer.current.owner_review_claim!.claim_id}:{kind:'initiator',conversation_id:conversationId!},expected_epoch:detail.current.task.control_epoch});await reload();}
   else if(name==='close_review'&&detail.current?.pending_action&&viewer.current){await browserAPI.closeNotice(detail.current.pending_action.id,viewer.current,detail.current.pending_action.revision);await reload();}
   else if((name==='approve_read'||name==='deny_read')&&taskId&&viewer.current&&reads.current){const r=reads.current;if(name==='approve_read'&&(live.current.model.readExpired||readReview(r,offset.current).readExpired))return;if(name==='deny_read'&&!r.candidates?.length&&detail.current?.pending_action)await browserAPI.closeNotice(detail.current.pending_action.id,viewer.current,detail.current.pending_action.revision);else await browserAPI.decideRead(taskId,viewer.current,r.revision,(r.candidates??[]).map(x=>({url:x.url,role:x.role,source:x.source})),name==='approve_read'?'approve':'deny');await reload();}
   else if(name==='create'){const targetConversation=conversationId??await live.current.ensureConversation?.();if(!targetConversation)throw new BrowserAPIError('BROWSER_FORBIDDEN');const url=new URL(address.current);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new BrowserAPIError('BROWSER_BAD_INPUT');if(taskId&&viewer.current&&detail.current){await browserAPI.sites(taskId,viewer.current,url.origin,'document',detail.current.task.manifest_revision,{v:1,entries:[{url:url.href,role:'document',source:'person'}]});await reload();await loadReads();}else {const created=await browserAPI.create({conversation_id:targetConversation,task_kind:'public_research',purpose:purpose.current,origins:[{origin:url.origin,role:'document'}],initial_url:url.href,read_proposal:{v:1,entries:[{url:url.href,role:'document',source:'person'}]}});const joined=await browserAPI.join(created.task.task_id,{mode:'initiator'});try{const started=await browserAPI.start(created.task.task_id,joined);if(started.start_code)throw new BrowserAPIError(started.start_code);Object.assign(joined,started);}catch(e){await browserAPI.leave(created.task.task_id,joined).catch(()=>{});throw e;}adoption.current={taskId:created.task.task_id,joined};live.current.onCreated?.(created.task.task_id);}patch({dialog:null});refresh(x=>x+1);}
   else if(name==='suppress_confirm'){const settings=await browserAPI.settings();await browserAPI.saveSettings({...browserFlags(settings.flags),pilot_user_ids:settings.pilot_user_ids,suppress_own_takeover_confirm:value==='true',expected_revision:settings.revision});patch({ownConfirmSuppressed:value==='true'});}
  }catch(e){if(['back','forward','window','confirm_reload'].includes(name)&&(e as BrowserAPIError).code==='BROWSER_REVIEW_REQUIRED'){patch({dialog:null});await reload();await loadReads();refresh(x=>x+1);}else if(name==='confirm_leave'||name==='retry_pause'){clear();patch({state:'pause_failed',dialog:null,error:undefined});}else {failure(e);if((e as BrowserAPIError).code==='BROWSER_REVIEW_STALE'){reads.current=null;patch({readUrls:[],readExpired:true});}}}finally{busy.current=false;patch({busy:false});}
 };
 const input=(event:unknown)=>{
  const v=viewer.current,d=detail.current,f=frame.current,t=token.current;
  if(!taskId||!v||!d||!f||!t||t.expires<=Date.now()||browserDevice()==='phone'||!live.current.visible||!live.current.active||document.hidden||live.current.model.zoom||live.current.model.livePaused)return;
  const parsed=InputEvent.safeParse(event);if(!parsed.success)return;
  if(parsed.data.type==='pointer'&&parsed.data.phase==='move'){if(Date.now()-lastMove.current<34)return;lastMove.current=Date.now();}
  const generation=current.current;
  void browserAPI.input(taskId,v,{viewer_id:v.viewer_id,device_secret:v.device_secret,control_token:t.value,stream_id:f.stream_id,stream_generation:f.stream_generation,frame_id:f.frame_id,document_epoch:f.document_epoch,control_epoch:f.control_epoch,seq:++seq.current,idempotency_key:crypto.randomUUID(),event:parsed.data}).catch(()=>{if(generation===current.current){clear();patch({state:'paused_private',error:'Connection lost. Browser paused.'});}});
 };
 const beforeLeave=(destination='Chat')=>{
  if(donePrompt.current){donePrompt.current=false;patch({state:'paused_private'});}
  if(busy.current)return Promise.resolve(false);
  if(!mustPause.current)return Promise.resolve(true);
  if(leaveResolve.current)return Promise.resolve(false);
  patch({capture:false,dialog:'leave',destination});return new Promise<boolean>(resolve=>{leaveResolve.current=resolve;});
 };
 useEffect(()=>{if(['read_review','resource_review'].includes(model.state))void loadReads();},[model.state]);
 const claim=viewer.current?.owner_review_claim;
 return {model,action,input,beforeLeave,claim,hasControl:()=>mustPause.current,refresh:()=>refresh(x=>x+1),patch};
}

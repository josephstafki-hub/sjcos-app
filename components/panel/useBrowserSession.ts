'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {browserAPI,BrowserAPIError,type Detail,type Viewer,type Reads} from './browser/api';
import {browserDevice} from './browser/device';
import {browserModel,browserErrorCopy,browserErrorState,privateWatchReady,type BrowserModel} from './browser/model';
import {createFrameGate,readReview,browserFlags,createStreamLifecycle,browserProjection,renewControl} from './browser/session';
import type {Frame as FrameData,ControlMessage,BrowserEvents} from '../../lib/browser/web-types';
import {isNavigation,navigationBinding} from './browser/navigation';
import {Frame,InputEvent} from '../../lib/browser/phase1-contracts.mjs';

export type BrowserSession=ReturnType<typeof useBrowserSession>;
type JoinLease={binding:unknown[];key:string;version:number;joined:(Viewer & Detail)|null;pending:Promise<Viewer & Detail>|null;owner:object;release?:object;retiring:Promise<void>|null;drain:Promise<unknown>|null;retirementFailed:boolean};
// All acquisitions (including private consent/claim renewal) belong to the lease,
// so departure also waits for their committed replies before retiring it.
function acquireLease(lease:JoinLease,request:()=>Promise<Viewer & Detail>){
 if(!lease.pending)lease.pending=request().then(d=>{lease.joined=d;lease.key=crypto.randomUUID();return d;}).finally(()=>{lease.pending=null;});
 return lease.pending;
}
const loadKey=(d:Detail)=>`${d.context_generation}:${d.task.document_epoch}`;
const initial:BrowserModel={state:'empty',origin:'',phone:true,ownerName:'Owner',personName:'Team member',width:360};
export function useBrowserSession({taskId,conversationId,visible,active=true,ownerView=false,localThreadId,signal,onExit,identity,onCreated,ensureConversation}:{taskId:string|null;conversationId:string|null;visible:boolean;active?:boolean;ownerView?:boolean;localThreadId?:string|null;signal?:AbortSignal;onExit?:()=>void;identity?:{personName:string;ownerName:string;isOwner:boolean;canChooseProject?:boolean};onCreated?:(id:string)=>void;ensureConversation?:()=>Promise<string>}) {
 const [model,setModel]=useState<BrowserModel>(initial),[version,refresh]=useState(0),[joinVersion,rejoin]=useState(0);
 const live=useRef({model,visible,active,onExit,onCreated,ensureConversation,identity});live.current={model,visible,active,onExit,onCreated,ensureConversation,identity};
 const readRequest=useRef(0);
 const reconnectReview=useRef(false);
 // Metadata and presence success cannot repair a lost stream or a failed pause.
 const recovery=useRef<'disconnected'|'pause_failed'|null>(null);
 // A replacement frame completes this loading episode even if a poll still
 // reports loading. A non-loading update or a new document starts another.
 const completedLoad=useRef<string|null>(null);
 const deviceId=useRef<string|null>(null);
 const getDeviceId=useCallback(()=>deviceId.current??=crypto.randomUUID(),[]);
 const adoption=useRef<{taskId:string;joined:Viewer & Detail}|null>(null),viewer=useRef<Viewer|null>(null),detail=useRef<Detail|null>(null),frame=useRef<FrameData|null>(null),token=useRef<{value:string;expires:number}|null>(null),reads=useRef<Reads|null>(null),seq=useRef(0),busy=useRef(false),current=useRef(0),frameGate=useRef(createFrameGate()),streamDrain=useRef<Promise<unknown>>(Promise.resolve()),streamAbort=useRef<AbortController|null>(null),streamStop=useRef<(()=>Promise<unknown>)|null>(null),offset=useRef(0),idleDeadline=useRef<string|null>(null),address=useRef(''),purpose=useRef(''),requestedAction=useRef<string|null>(null),donePrompt=useRef(false),leaveResolve=useRef<((ok:boolean)=>void)|null>(null),lastMove=useRef(0),mustPause=useRef(false);
 // A lease survives effect replay and reconnects, but never crosses a task,
 // thread, role or authenticated host scope. No credential is persisted.
 const leases=useRef<JoinLease[]>([]),joinLease=useRef<JoinLease|null>(null);
 const snapshotRef=useRef<{task_id:string;revision:string;status:string;takeover:boolean;attention:'none'|'needs_you';run_id:string|null}|null>(null);
 const patch=useCallback((p:Partial<BrowserModel>)=>setModel(m=>({...m,...p})),[]);
 const clear=useCallback(()=>{streamAbort.current?.abort();frame.current=null;token.current=null;patch({frameUrl:undefined,capture:false});},[patch]);
 const failure=useCallback((e:unknown)=>{
  const code=(e as BrowserAPIError)?.code??'',state=browserErrorState(code),held=token.current;
  clear();
  if(['auth_expired','access_removed','closed','off','latched'].includes(state)){recovery.current=null;viewer.current=null;}
  else if(state==='disconnected'&&!recovery.current)recovery.current='disconnected';
  if(recovery.current){if(recovery.current==='pause_failed')token.current=held;patch({state:recovery.current,error:undefined});return;}
  patch({state,dialog:null,error:browserErrorCopy(code,live.current.model),availableControls:[]});
 },[clear,patch]);
 const apply=useCallback((d:Detail)=>{
  const old=detail.current;if((old&&d.revision<old.revision)||!frameGate.current.observe(d))return false;
  if(old&&(old.context_generation!==d.context_generation||old.task.private!==d.task.private||old.task.privacy_mode!==d.task.privacy_mode)){clear();patch({privateConsented:false});refresh(x=>x+1);}
  if(ownerView&&d.task.private&&d.private_view_status!=='authorized'&&(frame.current||old?.private_view_status==='authorized')){clear();refresh(x=>x+1);}
  if(ownerView&&d.task.private&&!['pending_audit','authorized'].includes(d.private_view_status)){if(live.current.model.privateConsented||frame.current){clear();refresh(x=>x+1);}patch({privateConsented:false});}
  if(d.navigation?.loading!==true||(old&&loadKey(old)!==loadKey(d)))completedLoad.current=null;
  detail.current=d;
  snapshotRef.current={task_id:d.task.task_id??taskId!,revision:String(d.revision),status:d.task.state,takeover:d.task.control==='person',attention:d.pending_action?.state==='pending'||d.task.attention&&d.task.attention!=='none'?'needs_you':'none',run_id:d.task.run_id??null};
  if(d.task.control!=='person'){token.current=null;patch({capture:false});}
  const derived=browserModel({task:d.task,hasControl:!!token.current&&token.current.expires>Date.now()}),projection=browserProjection(d);
  offset.current=Date.parse(d.server_time)-Date.now();idleDeadline.current=d.idle_closes_at??null;
  const loading=derived.state==='working'&&d.navigation?.loading===true&&completedLoad.current!==loadKey(d);
  const terminal=['closed','failed'].includes(d.task.state),reasonState=d.reason_code?browserErrorState(d.reason_code):null;
  const stronger=terminal||!!reasonState&&['auth_expired','access_removed','off','latched','closed'].includes(reasonState);
  if(stronger){recovery.current=null;clear();}
  const state=terminal?derived.state:stronger?reasonState!:d.pending_action?.state==='pending'?d.pending_action.kind==='final_blocked'?'final_blocked':d.pending_action.kind==='write_blocked'?'write_blocked':d.pending_action.kind==='resource_read'?'resource_review':'read_review':recovery.current??(donePrompt.current&&d.task.private?'done':reconnectReview.current&&!ownerView&&d.task.state==='paused'?'reconnected':derived.state==='controlling'?'controlling':projection.state??(d.reason_code?browserErrorState(d.reason_code):loading?'loading':derived.state));
  if(!['read_review','resource_review'].includes(state)&&reads.current){reads.current=null;++readRequest.current;patch({readUrls:[],readSuggestions:[],readNextCursor:null});}
  patch({...derived,...projection,error:recovery.current&&!stronger?undefined:d.reason_code?browserErrorCopy(d.reason_code,live.current.model):undefined,...(!['read_review','resource_review'].includes(state)?{readExpired:false}:{}),ownerName:projection.ownerName??live.current.identity?.ownerName??'Owner',state,taskId:d.task.task_id??taskId??undefined,taskRevision:d.revision,ownerPaused:false,origin:d.site_label??(d.task.allowed_sites[0]?new URL(d.task.allowed_sites[0]).host:'Browser'),projectLabel:d.job_label??null,busyWithLabel:d.busy_with_label??null,sites:d.task.allowed_sites,areas:d.task.required_areas,queuePosition:d.queue_position,availableControls:d.available_controls??[],navigation:d.navigation,privateViewStatus:d.private_view_status??'required'});
  return true;
 },[clear,patch,ownerView,taskId]);
 const reload=useCallback(async()=>{if(!taskId||!viewer.current)return;const generation=current.current,v=viewer.current,d=await browserAPI.detail(taskId,v);if(generation===current.current&&v===viewer.current){const blocked=!frameGate.current.ready();apply(d);if(blocked&&frameGate.current.ready())refresh(x=>x+1);}},[taskId,apply]);
 useEffect(()=>{patch({phone:browserDevice()==='phone',...identity,ownerView});},[identity?.personName,identity?.ownerName,identity?.isOwner,identity?.canChooseProject,ownerView,patch]);
 useEffect(()=>{
  const generation=++current.current;recovery.current=null;reconnectReview.current=false;const c=new AbortController();viewer.current=null;mustPause.current=false;frameGate.current=createFrameGate();detail.current=null;completedLoad.current=null;snapshotRef.current=null;reads.current=null;donePrompt.current=false;clear();patch({state:taskId?'starting':'empty',taskId:taskId??undefined,taskRevision:undefined,ownerPaused:false,idleSeconds:undefined,projectId:null,projectLabel:null,hasTask:!!taskId,privateConsented:false,privateViewStatus:'required',dialog:null,error:undefined,availableControls:[],queuePosition:null,readUrls:[],approvedReadUrls:[],readExpired:true,watchingOwner:false});
  const abort=()=>{c.abort();recovery.current=null;clear();viewer.current=null;patch({state:'access_removed',dialog:null});};signal?.addEventListener('abort',abort,{once:true});
  if(!taskId||!active)return ()=>{c.abort();signal?.removeEventListener('abort',abort);};
  const binding=[taskId,conversationId,ownerView,localThreadId,signal],owner={};
  let lease=leases.current.find(l=>l.binding.every((v,i)=>v===binding[i]));
  if(!lease){
   lease={binding,key:crypto.randomUUID(),version:joinVersion,joined:null,pending:null,owner,retiring:null,drain:null,retirementFailed:false};leases.current.push(lease);
  }
  lease.owner=owner;lease.release=undefined;joinLease.current=lease;
  const mounted=lease;
  // Once Leave is sent it cannot be cancelled. Keep its ACK as an acquisition
  // barrier; an uncertain failure must drain on retry before any replacement.
  const retire=()=>{
   mounted.retirementFailed=false;
   const leaving=mounted.joined!;
   const retirement=Promise.resolve().then(()=>browserAPI.leave(taskId,leaving)).then(()=>{
    mounted.joined=null;mounted.key=crypto.randomUUID();mounted.version=-1;
   }).catch(e=>{mounted.retirementFailed=true;throw e;}).finally(()=>{mounted.retiring=null;});
   mounted.retiring=retirement;return retirement;
  };
  const join=async()=>{try{
   // Different host/auth scopes cannot share credentials. Their prior same-task
   // retirement must finish too, since the server may still reuse this device.
   const predecessors=leases.current.filter(l=>l!==mounted&&l.binding[0]===taskId&&l.drain).map(l=>l.drain!);
   if(predecessors.length)await Promise.all(predecessors);
   if(mounted.retiring)await mounted.retiring;
   else if(mounted.retirementFailed)await retire();
   if(c.signal.aborted||mounted.owner!==owner)return;
   const adopted=adoption.current?.taskId===taskId?adoption.current.joined:null;adoption.current=null;
   if(adopted)mounted.joined=adopted;
   if(!mounted.pending&&(!mounted.joined||mounted.version!==joinVersion)){
    mounted.version=joinVersion;
    acquireLease(mounted,()=>browserAPI.join(taskId,{device_id:getDeviceId(),mode:ownerView?'owner_review':'initiator',...(ownerView&&localThreadId?{local_thread_id:localThreadId}:{})},mounted.joined??undefined,undefined,mounted.key));
   }
   const d=mounted.pending?await mounted.pending:mounted.joined!;
   if(c.signal.aborted||generation!==current.current)return;
   reconnectReview.current=joinVersion>0;viewer.current=d;apply(d);if(requestedAction.current)void action('load_action',requestedAction.current);void browserAPI.answers(taskId,d).then(a=>{if(!c.signal.aborted)patch({answers:a.answers});}).catch(()=>{});refresh(x=>x+1);
  }catch(e){if(!c.signal.aborted)failure(e);}};
  void join();
  const presence=async()=>{const v=viewer.current,d=detail.current;if(!v||!d||c.signal.aborted)return;try{if(ownerView&&v.owner_review_claim&&Date.parse(v.owner_review_claim.expires_at)<Date.now()+30000){const renewed=await acquireLease(mounted,()=>browserAPI.join(taskId,{device_id:getDeviceId(),mode:'owner_review',...(localThreadId?{local_thread_id:localThreadId}:{}),private_view:live.current.model.privateConsented===true},v,undefined,mounted.key));if(c.signal.aborted)return;mounted.joined=renewed;viewer.current=renewed;apply(renewed);refresh(x=>x+1);return;}const renewed=await browserAPI.presence(taskId,v,{visible:!document.hidden&&live.current.active,host_context:ownerView?{kind:'owner_review',claim_id:v.owner_review_claim!.claim_id}:{kind:'initiator',conversation_id:conversationId!},expected_epoch:d.task.control_epoch});if(c.signal.aborted)return;token.current=renewControl(token.current,detail.current??d,renewed);await reload();}catch(e){if(!c.signal.aborted){if(['BROWSER_STREAM_STALE','BROWSER_REVIEW_STALE'].includes((e as BrowserAPIError).code)){clear();try{await reload();}catch(error){failure(error);}}else failure(e);}}};
  const tick=setInterval(presence,5000);
  const hide=()=>{if(document.hidden){clear();void presence();}};document.addEventListener('visibilitychange',hide);
  return ()=>{c.abort();clearInterval(tick);signal?.removeEventListener('abort',abort);document.removeEventListener('visibilitychange',hide);viewer.current=null;clear();leaveResolve.current?.(false);leaveResolve.current=null;
   // Ownership can transfer while a committed join reply is still in flight,
   // including A→empty→A and A→B→A. Check the departing token AFTER the
   // pending acquisition, immediately before sending Leave.
   if(mounted.owner!==owner)return;
   mounted.release=owner;
   mounted.drain=Promise.resolve(mounted.pending).catch(()=>null).then(()=>{
     if(mounted.owner!==owner||mounted.release!==owner||mounted.retiring||!mounted.joined)return;
     return retire();
   });
   void mounted.drain.catch(()=>{});};
 },[taskId,conversationId,active,ownerView,localThreadId,signal,joinVersion,apply,clear,patch,reload,failure,getDeviceId]);
 const streamSession=!!detail.current&&['active','paused'].includes(detail.current.task.state)&&detail.current.reason_code!=='BROWSER_DISABLED';
 useEffect(()=>{
  const v=viewer.current,d=detail.current;if(recovery.current||joinLease.current?.pending||!taskId||!v||!d||!visible||!active||document.hidden||!v.stream_id||!Number.isSafeInteger(v.stream_generation)||v.stream_generation<1||!['active','paused'].includes(d.task.state)||d.reason_code==='BROWSER_DISABLED'||!frameGate.current.ready()||(ownerView&&d.task.private&&!privateWatchReady(model)))return;
  const c=new AbortController();streamAbort.current=c;const lifecycle=createStreamLifecycle(()=>c.abort());c.signal.addEventListener('abort',()=>lifecycle.fail(),{once:true});let requiredFrameBinding:Pick<FrameData,'stream_id'|'stream_generation'>|null=null;let stopped=false,opened=false,serverRotated=false,rotation:ReturnType<typeof setTimeout>|undefined;
  const stop=()=>{stopped=true;if(rotation)clearTimeout(rotation);frame.current=null;patch({frameUrl:undefined});if(!opened||serverRotated||c.signal.aborted){lifecycle.fail();c.abort();return Promise.resolve();}return lifecycle.close(binding=>browserAPI.closeStream(taskId,v,binding));};streamStop.current=stop;
  const run=async()=>{try{await streamDrain.current;if(stopped||c.signal.aborted||v!==viewer.current||joinLease.current?.pending)return;opened=true;await browserAPI.events(taskId,v,c.signal,(name,payload)=>{
   if(name==='state'){const s=payload as BrowserEvents['state'];if(s.stream_id&&s.stream_generation)lifecycle.bind({stream_id:s.stream_id,stream_generation:s.stream_generation});}
   if(stopped||serverRotated||c.signal.aborted||v!==viewer.current||recovery.current)return;
   if(name==='state'){const s=payload as BrowserEvents['state'];if(s.stream_id&&s.stream_generation&&frame.current&&(frame.current.stream_id!==s.stream_id||frame.current.stream_generation!==s.stream_generation)){requiredFrameBinding={stream_id:s.stream_id,stream_generation:s.stream_generation};frame.current=null;patch({frameUrl:undefined});}offset.current=Date.parse(s.server_time)-Date.now();idleDeadline.current=s.idle_closes_at;apply({...detail.current!,...s});patch({watchingOwner:s.watching_owner});void reload().catch(failure);}
   if(name==='frame'){const f=Frame.parse(payload),now=detail.current;if(requiredFrameBinding&&(f.stream_id!==requiredFrameBinding.stream_id||f.stream_generation!==requiredFrameBinding.stream_generation))return;lifecycle.bind({stream_id:f.stream_id,stream_generation:f.stream_generation});if(!frameGate.current.ready()||!now||now.task.state==='closed'||now.task.state==='failed'||(ownerView&&now.task.private&&(now.private_view_status!=='authorized'||!privateWatchReady(live.current.model))))return;if(f.control_epoch!==now.task.control_epoch||f.document_epoch!==now.task.document_epoch)return;if(frame.current?.stream_id===f.stream_id&&frame.current.seq>=f.seq)return;frame.current=f;if(!live.current.model.livePaused){if(now.navigation?.loading===true){completedLoad.current=loadKey(now);apply(now);}patch({frameUrl:'data:image/jpeg;base64,'+f.jpeg_base64});}}
   if(name==='action'){const a=payload as {review:Detail['pending_action'];revision:number};if(detail.current&&a.revision>=detail.current.revision){detail.current={...detail.current,pending_action:a.review,revision:a.revision};apply(detail.current);void loadReads();}}
   if(name==='reauth'){serverRotated=true;frame.current=null;patch({frameUrl:undefined});rotation=setTimeout(()=>refresh(x=>x+1),0);}
   if(name==='closed'){clear();const code=(payload as {code:string}).code;if(code==='BROWSER_OK')patch({state:'closed'});else failure(new BrowserAPIError(code));}
  });if(!stopped&&!serverRotated&&!c.signal.aborted){recovery.current='disconnected';clear();patch({state:'disconnected',error:undefined});}}catch(e){
   if(stopped||serverRotated||c.signal.aborted||v!==viewer.current||joinLease.current?.pending)return;
   // A private stream can be refused while its audit authorization is still
   // pending. Only fresh authenticated detail for THIS consented viewer may
   // keep the waiting screen; a real access/auth failure still wins.
   if(ownerView&&detail.current?.task.private&&live.current.model.privateConsented){
    try{const latest=await browserAPI.detail(taskId,v);if(stopped||c.signal.aborted||v!==viewer.current)return;apply(latest);if(['closed','failed'].includes(detail.current?.task.state??'')||detail.current?.private_view_status==='pending_audit')return;}
    catch(error){failure(error);return;}
   }
   const code=(e as BrowserAPIError).code;
   if(!code||['BROWSER_STREAM_STALE','BROWSER_FRAME_TOO_LARGE'].includes(code)){recovery.current='disconnected';clear();patch({state:'disconnected',error:undefined});}else failure(e);
  }finally{lifecycle.fail();}};void run();
  return ()=>{if(streamStop.current===stop)streamStop.current=null;streamDrain.current=stop().catch(()=>{});};
  // Live pause deliberately leaves the authenticated stream and attendance running.
 },[taskId,visible,active,ownerView,model.privateConsented,model.privateViewStatus,streamSession,viewer.current?.viewer_id,viewer.current?.owner_review_claim?.claim_id,viewer.current?.stream_id,viewer.current?.stream_generation,version,apply,clear,patch,failure,reload]);
 useEffect(()=>{const tick=setInterval(()=>{if(token.current&&token.current.expires<=Date.now()){token.current=null;patch({...(recovery.current?{}:{state:'paused_private'}),capture:false});}if(reads.current&&readReview(reads.current,offset.current).readExpired)patch({readExpired:true});const end=idleDeadline.current;if(end)patch({idleSeconds:Math.max(0,Math.ceil((Date.parse(end)-Date.now()-offset.current)/1000))});},1000);return ()=>clearInterval(tick);},[patch]);
 async function loadReads(cursor?:string){if(!taskId||!viewer.current)return;const generation=current.current,request=++readRequest.current,revision=reads.current?.revision;reads.current=null;patch({readUrls:[],readSuggestions:[],readNextCursor:null,readExpired:true});try{const r=await browserAPI.reads(taskId,viewer.current,cursor);if(generation!==current.current||request!==readRequest.current)return;if(cursor&&revision!==r.revision)throw new BrowserAPIError('BROWSER_REVIEW_STALE');reads.current=r;patch({...readReview(r,offset.current),readNextCursor:r.next_cursor??null,approvedReadUrls:(r.entries??[]).map(e=>e.canonical_url)});}catch(e){if(generation===current.current&&request===readRequest.current)patch({error:browserErrorCopy((e as BrowserAPIError).code,live.current.model)});}}
 const perform=async(action:ControlMessage['action'],target?:string)=>{
  const v=viewer.current,d=detail.current;if(!taskId||!v||!d)throw new BrowserAPIError('BROWSER_CONTROL_EXPIRED');
  if(!d.available_controls?.includes(action))throw new BrowserAPIError('BROWSER_FORBIDDEN');
  const navigation=isNavigation(action)?navigationBinding(d,action,target):undefined;if(isNavigation(action)&&!navigation)throw new BrowserAPIError('BROWSER_REVIEW_STALE');
  const epoch=current.current;if(action!=='pause')token.current=null;frame.current=null;patch({capture:false,frameUrl:undefined,availableControls:[]});
  if(isNavigation(action)&&streamStop.current){const close=streamStop.current();streamDrain.current=close.catch(()=>{});await close;}else streamAbort.current?.abort();
  // The response alone is not presentation authority. Discard the old stream
  // synchronously, then wait for authoritative detail/state in the new context.
  if(action==='fresh_browser')frameGate.current.reset(d.context_generation);
  const r=await browserAPI.control(taskId,v,action,d.task.control_epoch,navigation??undefined);if(epoch!==current.current)return;
  if(['pause','stop','take_over','fresh_browser'].includes(action))recovery.current=null;
  if(action==='pause')token.current=null;
  if(['resume','take_over','done','pause','stop','fresh_browser'].includes(action))reconnectReview.current=false;
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
  if(name==='project'){try{const job=JSON.parse(value??'{}') as {id:string;label:string};if(!detail.current)patch({projectId:job.id,projectLabel:job.label});}catch{}return;}
  if(name==='next_reads'){const cursor=live.current.model.readNextCursor;if(!cursor)return;await loadReads(cursor);if(live.current.model.dialog==='addresses'&&reads.current?.candidates.length)patch({dialog:null,state:reads.current.candidates.some(c=>c.role==='resource')?'resource_review':'read_review'});return;}
  if(name==='review_addresses'){await loadReads();const r=reads.current;patch(r?.candidates.length?{dialog:null,state:r.candidates.some(c=>c.role==='resource')?'resource_review':'read_review'}:{dialog:'addresses'});return;}
  if(name==='address'){address.current=value??'';let ready=false;try{const url=new URL(address.current);ready=url.protocol==='https:'&&!url.username&&!url.password&&!url.hash;}catch{}patch({addressReady:ready});return;}if(name==='purpose'){purpose.current=value??'';return;}
  if(name==='cancel'){patch({dialog:null,error:undefined});leaveResolve.current?.(false);leaveResolve.current=null;return;}
  if(name==='capture_off'){patch({capture:false});return;}
  if(name==='capture'){if(!recovery.current&&live.current.model.state==='controlling'&&token.current&&browserDevice()!=='phone')patch({capture:!live.current.model.capture});return;}
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
  if(busy.current)return;const held=token.current,heldDetail=detail.current,generation=current.current;busy.current=true;patch({busy:true,error:undefined});
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
   else if(name==='reconnect'){recovery.current=null;clear();rejoin(x=>x+1);}
   else if(name==='show_private'&&taskId&&detail.current?.task.private){
    const epoch=current.current,lease=joinLease.current;if(!lease)return;
    clear();patch({privateConsented:false,privateViewStatus:'pending_audit'});
    const v=await acquireLease(lease,()=>browserAPI.join(taskId,{device_id:getDeviceId(),mode:'owner_review',private_view:true,...(localThreadId?{local_thread_id:localThreadId}:{})},viewer.current??undefined,undefined,lease.key));
    if(epoch!==current.current)return;
    // A newer poll can supersede the join's metadata, but not its credentials.
    // Install them before publishing authorization or starting a new stream.
    viewer.current=v;apply(v);lease.joined=v;
    patch({privateConsented:v.task.private&&v.context_generation===detail.current?.context_generation&&['pending_audit','authorized'].includes(v.private_view_status)});refresh(x=>x+1);
   }
   else if(name==='keep_open'&&taskId&&viewer.current&&detail.current){await browserAPI.presence(taskId,viewer.current,{visible:true,host_context:ownerView?{kind:'owner_review',claim_id:viewer.current.owner_review_claim!.claim_id}:{kind:'initiator',conversation_id:conversationId!},expected_epoch:detail.current.task.control_epoch});await reload();}
   else if(name==='close_review'&&detail.current?.pending_action&&viewer.current){await browserAPI.closeNotice(detail.current.pending_action.id,viewer.current,detail.current.pending_action.revision);await reload();}
   else if((name==='approve_read'||name==='deny_read')&&taskId&&viewer.current&&reads.current){const r=reads.current;if(name==='approve_read'&&(live.current.model.readExpired||readReview(r,offset.current).readExpired))return;if(name==='deny_read'&&!r.candidates?.length&&detail.current?.pending_action)await browserAPI.closeNotice(detail.current.pending_action.id,viewer.current,detail.current.pending_action.revision);else await browserAPI.decideRead(taskId,viewer.current,r.revision,(r.candidates??[]).map(x=>({url:x.url,role:x.role,source:x.source})),name==='approve_read'?'approve':'deny');await reload();}
   else if(name==='create'){const projectId=live.current.model.projectId;const targetConversation=conversationId??await live.current.ensureConversation?.();if(!targetConversation)throw new BrowserAPIError('BROWSER_FORBIDDEN');const url=new URL(address.current);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new BrowserAPIError('BROWSER_BAD_INPUT');if(taskId&&viewer.current&&detail.current){await browserAPI.sites(taskId,viewer.current,url.origin,'document',detail.current.task.manifest_revision,{v:1,entries:[{url:url.href,role:'document',source:'person'}]});await reload();await loadReads();}else {const created=await browserAPI.create({conversation_id:targetConversation,task_kind:'public_research',purpose:purpose.current,origins:[{origin:url.origin,role:'document'}],initial_url:url.href,...(projectId?{project_id:projectId}:{}),read_proposal:{v:1,entries:[{url:url.href,role:'document',source:'person'}]}});const joined=await browserAPI.join(created.task.task_id,{device_id:getDeviceId(),mode:'initiator'});try{const started=await browserAPI.start(created.task.task_id,joined);if(started.start_code)throw new BrowserAPIError(started.start_code);Object.assign(joined,started);}catch(e){await browserAPI.leave(created.task.task_id,joined).catch(()=>{});throw e;}adoption.current={taskId:created.task.task_id,joined};live.current.onCreated?.(created.task.task_id);}patch({dialog:null});refresh(x=>x+1);}
   else if(name==='suppress_confirm'){const settings=await browserAPI.settings();await browserAPI.saveSettings({...browserFlags(settings.flags),pilot_user_ids:settings.pilot_user_ids,suppress_own_takeover_confirm:value==='true',expected_revision:settings.revision});patch({ownConfirmSuppressed:value==='true'});}
  }catch(e){if(['back','forward','window','confirm_reload'].includes(name)&&(e as BrowserAPIError).code==='BROWSER_REVIEW_REQUIRED'){patch({dialog:null});await reload();await loadReads();refresh(x=>x+1);}else if((name==='confirm_leave'||name==='retry_pause')&&generation===current.current){
   const state=browserErrorState((e as BrowserAPIError).code);
   if(['auth_expired','access_removed','closed','off','latched'].includes(state))failure(e);
   else {recovery.current='pause_failed';clear();patch({state:'pause_failed',dialog:null,error:undefined});try{await reload();}catch(error){failure(error);}
    const d=detail.current;if(recovery.current==='pause_failed'&&held&&held.expires>Date.now()&&d?.task.control==='person'&&d.task.control_epoch===heldDetail?.task.control_epoch&&d.context_generation===heldDetail.context_generation){token.current=held;apply(d);}
   }
  }else {failure(e);if((e as BrowserAPIError).code==='BROWSER_REVIEW_STALE'){reads.current=null;patch({readUrls:[],readExpired:true});}}}finally{busy.current=false;patch({busy:false});}
 };
 const input=(event:unknown)=>{
  const v=viewer.current,d=detail.current,f=frame.current,t=token.current;
  if(recovery.current||live.current.model.state!=='controlling'||busy.current||!taskId||!v||!d||!f||!t||t.expires<=Date.now()||browserDevice()==='phone'||!live.current.visible||!live.current.active||document.hidden||live.current.model.zoom||live.current.model.livePaused)return;
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
 const snapshot=useMemo(()=>{const base=snapshotRef.current;if(!base)return null;const status=model.state==='closed'?'closed':['working','loading'].includes(model.state)?'active':model.state==='starting'?'starting':['queued','offer','queue_expired','offer_expired'].includes(model.state)?'queued':['crashed','latched','access_removed','idle_closed','service_unavailable'].includes(model.state)?'failed':'paused';return {...base,status,stateLabel:model.state==='controlling'?"You're in control":model.state==='taking_over'?'Finishing the last step…':model.state==='offer'?'Browser is ready.':model.state==='offer_expired'?'You missed your turn.':model.state==='queue_expired'?'You left the line.':undefined,attention:['disconnected','unknown','auth_expired','read_review','resource_review','write_blocked','final_blocked','queue_expired','offer_expired'].includes(model.state)?'needs_you' as const:base.attention};},[model.state,model.taskRevision,snapshotRef.current]);
 return {model:taskId&&model.taskId!==taskId?{...model,state:'starting' as const,frameUrl:undefined,answers:[],dialog:null}:model,snapshot:snapshot?.task_id===taskId?snapshot:null,action,input,beforeLeave,claim,hasControl:()=>mustPause.current,refresh:()=>refresh(x=>x+1),patch};
}

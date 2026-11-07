'use client';
import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {browserRowStatus} from './browser/model';
import {BrowserView} from './BrowserView';
import {browserAPI} from './browser/api';
import {useBrowserSession,type BrowserSession} from './useBrowserSession';
import {getAskPaneFeed,getServerAskPaneFeed,subscribeAskPanes,publishAskPaneKind,registerAskPane,registerAskPaneOverlay,selectAskPane,type AskPaneScope,type AskPaneRenderContext} from './askPaneRegistry';
import {trapAskFocus} from './askPaneFocus';
import type {PaneSnapshot} from './askPaneLayout';

/** Registration has no persisted private store: hook-local session only. */
type Handle={get:()=>BrowserSession;subscribe:(fn:()=>void)=>()=>void};
export function BrowserPane({context,slot,handle}:{context:AskPaneRenderContext;slot:'title'|'meta'|'content'|'actions';handle:Handle}) {
 const session=useSyncExternalStore(handle.subscribe,handle.get,handle.get);
 const root=useRef<HTMLDivElement>(null),currentAction=useRef(session.action);currentAction.current=session.action;
 const m={...session.model,width:context.paneWidth,landscape:context.landscape,compactCapture:session.model.capture&&(context.landscape||(context.viewportWidth<1024&&typeof window!=='undefined'&&(window.visualViewport?.height??window.innerHeight)<window.innerHeight-150))};
 useEffect(()=>{
  if(slot!=='content'||!getAskPaneFeed().scope)return;
  if(!m.dialog&&['read_review','resource_review','write_blocked','final_blocked'].includes(m.state))return registerAskPaneOverlay({scope:getAskPaneFeed().scope!,priority:400,onEscape:()=>void currentAction.current('close_review')});
  if(!m.dialog)return;
  const element=root.current?.querySelector<HTMLElement>('[role="dialog"]');if(!element)return;
  const opener=document.activeElement as HTMLElement|null;
  element.querySelector<HTMLElement>('h2')?.focus();
  const release=registerAskPaneOverlay({scope:getAskPaneFeed().scope!,priority:m.dialog==='leave'?300:m.dialog==='menu'?600:501,onEscape:()=>void currentAction.current('cancel'),element});
  const key=(e:KeyboardEvent)=>trapAskFocus(e,element);element.addEventListener('keydown',key);
  return ()=>{release();element.removeEventListener('keydown',key);opener?.isConnected&&opener.focus();};
 },[slot,m.dialog,m.state]);
 if(context.signal.aborted)return null;
 return <div ref={root} className="h-full min-h-0"><BrowserView model={m} slot={slot} onAction={(a,v)=>void session.action(a,v)} onInput={session.input}/></div>;
}
export function useBrowserFeed(scope:AskPaneScope|null,agent:string,active=true,visible=false,onClaude?:()=>void,onExit?:()=>void,ensureConversation?:()=>Promise<string>,newChatProject?:string) {
 const feed=useSyncExternalStore(subscribeAskPanes,getAskPaneFeed,getServerAskPaneFeed);
 const [metadata,setMetadata]=useState<PaneSnapshot[]>([]);
 const [taskId,setTaskId]=useState<string|null>(null),[availability,setAvailability]=useState(false);
 const [identity,setIdentity]=useState<{personName:string;ownerName:string;isOwner:boolean}>();
 const session=useBrowserSession({taskId,conversationId:scope?.threadId==='new-chat'?null:scope?.threadId??null,visible:!!scope&&active&&visible,active:!!scope&&active,signal:feed.signal,identity,onExit,onCreated:setTaskId,ensureConversation});
 const current=useRef(session);current.current={...session,action:async(a,v)=>{if(a==='watch'&&v){window.dispatchEvent(new CustomEvent('sjcos:browser-watch',{detail:{taskId:v}}));return;}if(a==='claude'){onClaude?.();return;}return session.action(a,v);}};
 const listeners=useRef(new Set<()=>void>());
 const handle=useRef<Handle>({get:()=>current.current,subscribe:fn=>{listeners.current.add(fn);return ()=>{listeners.current.delete(fn);};}}).current;
 useLayoutEffect(()=>{listeners.current.forEach(fn=>fn());},[session]);
 useEffect(()=>{setTaskId(null);setMetadata([]);if(!scope)return;let disposed=false;const c=new AbortController();
  const poll=async()=>{if(document.hidden||!active)return;try{
   const a=await browserAPI.availability(c.signal);if(disposed||getAskPaneFeed().scope!==scope)return;current.current.patch({busyWithLabel:a.busy_with_label??null});setAvailability(a.enabled===true&&a.can_start===true);
   if(a.enabled!==true||a.can_start!==true){publishAskPaneKind(scope,'browser',[]);return;}
   const list=scope.threadId==='new-chat'?{tasks:[],snapshots:[]}:await browserAPI.tasks(scope.threadId,c.signal);
   if(disposed||getAskPaneFeed().scope!==scope)return;
   const selected=list.tasks.find(t=>!['closed','failed'].includes(t.state))??list.tasks[0];setTaskId(selected?.task_id??null);
   setMetadata((list.snapshots??[]).filter(x=>x.kind==='browser'));
   if(current.current.model.isOwner){const inUse=await browserAPI.inUse(c.signal).catch(()=>null);if(inUse&&!disposed&&getAskPaneFeed().scope===scope)current.current.patch({inUse:inUse.items});}
  }catch{if(!disposed){setAvailability(false);publishAskPaneKind(scope,'browser',[]);}}};
  void poll();const timer=setInterval(poll,5000);return ()=>{disposed=true;c.abort();clearInterval(timer);publishAskPaneKind(scope,'browser',[]);};
 },[scope,active]);
 useEffect(()=>{if(scope?.threadId!=='new-chat'||!newChatProject)return;let disposed=false;void import('./BrowserIdentity').then(m=>m.browserProject(newChatProject)).then(r=>{if(!disposed&&r.ok&&r.project&&getAskPaneFeed().scope===scope)current.current.patch({projectId:r.project.id,projectLabel:r.project.label});}).catch(()=>{});return ()=>{disposed=true;};},[scope,newChatProject]);
 // The list selects a task and supplies provenance. Only the accepted session
 // revision publishes its state, so polling cannot overwrite the pane with an
 // independent status. Before join both surfaces say Opening browser….
 useLayoutEffect(()=>{
  if(!scope||!availability||getAskPaneFeed().scope!==scope)return;
  const accepted=session.snapshot,base=metadata.find(x=>x.kind==='browser'&&x.task_id===taskId);
  const row:PaneSnapshot=taskId?{kind:'browser',id:taskId,task_id:taskId,thread_id:scope.threadId,user_id:scope.userId,run_id:accepted?.run_id??null,label:base?.label??'Browser',status:accepted?.status??'starting',stateLabel:accepted?.stateLabel,takeover:session.model.state==='controlling',attention:accepted?.attention??'none',revision:accepted?.revision??'0'}:{kind:'browser',id:'empty',task_id:'empty',thread_id:scope.threadId,user_id:scope.userId,run_id:null,label:'Browser',status:'empty',takeover:false,attention:'none',revision:'0'};
  publishAskPaneKind(scope,'browser',[row]);
 },[scope,availability,taskId,metadata,session.model.taskRevision,session.model.state,session.snapshot?.revision,session.snapshot?.status,session.snapshot?.attention]);
 useEffect(()=>{if(!scope)return;void import('./BrowserIdentity').then(m=>m.browserPaneIdentity(scope.threadId==='new-chat'?null:scope.threadId)).then(x=>{if(x.ok&&getAskPaneFeed().scope===scope){setIdentity({personName:x.name??'You',ownerName:x.isOwner?(x.name??'Owner'):'Owner',isOwner:x.isOwner});if(scope.threadId!=='new-chat')void import('./BrowserIdentity').then(m=>m.browserChatProject(scope.threadId)).then(r=>{if(r.ok&&r.project&&getAskPaneFeed().scope===scope&&!current.current.model.hasTask)current.current.patch({projectId:r.project.id,projectLabel:r.project.label});}).catch(()=>{});if(x.isOwner)void browserAPI.settings().then(s=>{if(getAskPaneFeed().scope===scope)current.current.patch({ownConfirmSuppressed:s.takeover_confirm_suppressed_user_ids.includes(scope.userId)});}).catch(()=>{});if(x.isOwner)void browserAPI.inUse().then(r=>{if(getAskPaneFeed().scope===scope)current.current.patch({inUse:r.items.filter(item=>item.task_id!==current.current.model.taskId)});}).catch(()=>{});}}).catch(()=>{});},[scope]);
 useEffect(()=>{
  if(!availability||!scope)return;
  return registerAskPane({id:'browser',focusEntry:root=>root.querySelector<HTMLElement>('[data-browser-title]')?.focus(),beforeLeave:(_s,reason)=>current.current.beforeLeave(reason==='navigation'?'app':reason==='switch'?'Canvas':'Chat'),render:context=>({title:<BrowserPane context={context} slot="title" handle={handle}/>,meta:<BrowserPane context={context} slot="meta" handle={handle}/>,content:<BrowserPane context={context} slot="content" handle={handle}/>,actions:<BrowserPane context={context} slot="actions" handle={handle}/>})});
 },[availability,scope,handle]);
 useEffect(()=>{if(!taskId)session.patch({state:agent==='claude'||agent==='auto'?'empty':'unsupported'});},[agent,taskId,session.patch]);
}
/** Own-thread status, below existing chat header. No frame, claim or token. */
export function BrowserStatusRow(){
 const feed=useSyncExternalStore(subscribeAskPanes,getAskPaneFeed,getServerAskPaneFeed);
 const task=feed.snapshots.find(x=>x.kind==='browser'&&x.id!=='empty');if(!task||!feed.scope||task.kind!=='browser')return null;
 const status=browserRowStatus(task);if(status===null)return null;
 return <button type="button" data-browser-ui className="min-h-11 w-full shrink-0 border-b border-rule px-3 text-left text-subheading" onClick={e=>selectAskPane(feed.scope!,{kind:'browser',id:task.id},e.currentTarget)}>Browser · {status} <span aria-hidden="true">›</span></button>;
}

'use client';
import {useEffect,useLayoutEffect,useRef,useSyncExternalStore} from 'react';
import dynamic from 'next/dynamic';
import type {EventPage,CanvasEventsResponse,CanvasListResponse,CanvasGetResponse} from '@/lib/canvas-api-types';
import {registerAskPane,refreshAskPaneKindSignal,getAskPaneFeed,publishAskPaneKind,subscribeAskPanes,getServerAskPaneFeed,type AskPaneRegistration} from '../askPaneRegistry';
import {canvasPanelIdentity} from './actions';
import {canvasState,canvasServerState,subscribeCanvas,clearCanvas,invalidateCanvasViews,updateCanvas,applyCanvasList,publishCanvases} from './store';
import {canvasFetch,fixCanvasPrompt} from './state';
const Pane=dynamic(()=>import('../CanvasPane').then(m=>m.CanvasPane),{ssr:false});
export function useCanvasFeed({changes,threadId,pending,activeRunId,blocked,prefill}:{changes?:EventPage;threadId:string|null;pending:boolean;activeRunId:string|null;blocked:boolean;prefill:(text:string,id?:string,version?:number)=>void}){
 const host=useSyncExternalStore(subscribeAskPanes,getAskPaneFeed,getServerAskPaneFeed);
 const enabled=process.env.NEXT_PUBLIC_SJC_CANVAS_ENABLED==='1';
 const cursorRef=useRef<string|undefined>(undefined),beforeRef=useRef<string|null>(null),lastThread=useRef(threadId);
 if(lastThread.current!==threadId){lastThread.current=threadId;cursorRef.current=undefined;beforeRef.current=null;}
 const refresh=useRef<()=>void>(()=>{}),args=useRef({pending,activeRunId,prefill});args.current={pending,activeRunId,prefill};
 const appliedChanges=useRef<EventPage | undefined>(undefined);
 const value=useSyncExternalStore(subscribeCanvas,canvasState,canvasServerState);
 useLayoutEffect(()=>{if(!enabled)return;clearCanvas();},[enabled,threadId,blocked,host.scope]);
 useEffect(()=>{
  if(!enabled)return;
  const registration:AskPaneRegistration={id:'canvas',onActivate:()=>refresh.current(),focusEntry:root=>root.querySelector<HTMLElement>('[data-canvas-title]')?.focus(),render:context=>({title:<Pane context={context} slot="title"/>,meta:<Pane context={context} slot="meta"/>,content:<Pane context={context} slot="content"/>,actions:<Pane context={context} slot="actions"/>})};
  return registerAskPane(registration);
 },[enabled]);
 useEffect(()=>{
  if(!enabled||blocked)return;
  let disposed=false,busy=false;const c=new AbortController();
  const poll=async()=>{
   if(disposed||busy||document.hidden)return;busy=true;
   try{
    const shared=getAskPaneFeed().scope;
    if(!shared||shared.threadId!==(threadId??'new-chat'))return;
    if(canvasState().scope!==shared)updateCanvas({scope:shared,prefill:(...a)=>args.current.prefill(...a)});
    if(!threadId){const identity=await canvasPanelIdentity(null);if(disposed||!identity.ok)return;if('availability' in identity)updateCanvas({availability:identity.availability});publishCanvases();return;}
    let scope=canvasState().scope;
    let events=canvasState().events;
    // No after means newest page; has_more then points BACKWARD, not forward.
    // Preserve the forward high-water and explicitly drain that direction.
    let more=true;
    while(more&&!disposed){const wasInitial=!cursorRef.current;
     const page=await canvasFetch<CanvasEventsResponse>(`/api/threads/${threadId}/canvas-events?limit=20${cursorRef.current?`&after=${encodeURIComponent(cursorRef.current)}`:''}`,c.signal);
     if(disposed||canvasState().scope!==scope)return;
     let revisionChanged=false;
     if(canvasState().availability&&canvasState().availability!.revision!==page.availability.revision&&scope){
      revisionChanged=true;invalidateCanvasViews();refreshAskPaneKindSignal(scope,'canvas');
     }
     if(wasInitial)beforeRef.current=page.has_more?page.next_before:null;
     cursorRef.current=revisionChanged?undefined:page.cursor;more=revisionChanged||wasInitial?true:page.has_more;events=[...new Map([...events,...page.events].map(e=>[e.id,e])).values()];
     if(!page.availability.master)events=events.map(e=>({id:e.id,thread_id:e.thread_id,run_id:e.run_id,actor_user_id:e.actor_user_id,at:e.at,group_id:e.group_id,kind:'unavailable' as const,canvas_id:e.canvas_id}));
     updateCanvas({availability:page.availability,events});
    }
    const list=await canvasFetch<CanvasListResponse>(`/api/threads/${threadId}/canvases?limit=20`,c.signal);
    if(disposed||canvasState().scope!==scope)return;
    applyCanvasList(list);
    const query=new URLSearchParams(window.location.search),action=query.get('canvas_action'),id=query.get('canvas'),version=Number(query.get('canvas_v'));
    if(id&&['fix','simplify','change'].includes(action??'')&&Number.isSafeInteger(version)&&version>0){
     const selected=await canvasFetch<CanvasGetResponse>(`/api/canvas/${encodeURIComponent(id)}?version=${version}`,c.signal);
     if(disposed||canvasState().scope!==scope)return;
     const url=new URL(window.location.href);url.searchParams.delete('canvas_action');url.searchParams.delete('canvas_v');url.searchParams.delete('canvas');window.history.replaceState(window.history.state,'',url);
     args.current.prefill(action==='change'?`Change the "${selected.selected.title}" canvas (version ${version}): `:fixCanvasPrompt(selected.selected,action==='fix'?'RENDER_FAILED':'RENDER_TIMEOUT'),id,version);
    }
    publishCanvases(args.current.pending);
   }catch(e){if(!disposed){const code=(e as {code?:string}).code;if(code==='AUTH_REQUIRED'||code==='SIGN_IN_AGAIN'||code==='ASK_PAUSED'||code==='CANVAS_UNAVAILABLE'||code==='THREAD_UNAVAILABLE'){const s=canvasState().scope;clearCanvas();if(s)publishAskPaneKind(s,'canvas',[]);}else if(code==='CANVAS_DISABLED'){updateCanvas({items:[],views:{}});publishCanvases();}}}finally{busy=false;}
  };
  refresh.current=()=>{void poll();};void poll();
  const visibility=()=>{if(document.hidden){updateCanvas({views:{}});}else void poll();};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',poll);
  return ()=>{disposed=true;c.abort();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focus',poll);refresh.current=()=>{};clearCanvas();
 };
 },[enabled,threadId,blocked,host.scope]);
 useEffect(()=>{if(!enabled)return;const timer=setInterval(()=>refresh.current(),pending?2000:30000);refresh.current();return ()=>clearInterval(timer);},[enabled,pending]);
 useEffect(()=>{
  const scope=canvasState().scope;
  if(!enabled||blocked||!changes||appliedChanges.current===changes||!scope||scope.threadId!==threadId||document.hidden)return;
  if(changes.events.some(e=>e.thread_id!==threadId))return;
  appliedChanges.current=changes;
  // A new availability revision requires reauthorization of cached metadata/code.
  if(canvasState().availability?.revision!==changes.availability.revision){invalidateCanvasViews();refreshAskPaneKindSignal(scope,'canvas');updateCanvas({items:[],views:{},events:canvasState().events.map(e=>({id:e.id,thread_id:e.thread_id,run_id:e.run_id,actor_user_id:e.actor_user_id,at:e.at,group_id:e.group_id,kind:'unavailable' as const,canvas_id:e.canvas_id}))});publishCanvases();refresh.current();return;}
  const events=[...new Map([...canvasState().events,...changes.events].map(e=>[e.id,e])).values()];
  updateCanvas({events,availability:changes.availability});
  refresh.current();
 },[enabled,blocked,threadId,changes,value.scope]);
 const loadOlder=async()=>{
  const before=beforeRef.current,scope=canvasState().scope;if(!before||!scope||!threadId)return;
  try{const page=await canvasFetch<CanvasEventsResponse>(`/api/threads/${threadId}/canvas-events?limit=20&before=${encodeURIComponent(before)}`);
   if(canvasState().scope!==scope)return;
   beforeRef.current=page.has_more?page.next_before:null;
   updateCanvas({events:[...new Map([...page.events,...canvasState().events].map(e=>[e.id,e])).values()]});
  }catch{/* a normal feed refresh clears revoked source */}
 };
 return enabled&&value.scope?.threadId===(threadId??'new-chat')?{...value,loadOlder,hasOlder:!!beforeRef.current}:null;
}

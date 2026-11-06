'use client';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {CanvasGetResponse,CanvasListResponse} from '@/lib/canvas-api-types';
import {AskContentPane} from '../AskContentPane';
import {CanvasPane} from '../CanvasPane';
import {fixCanvasPrompt} from './state';
import {useAskContentWidth,useAskViewport} from '../askPaneHooks';
import {askPaneOverlays,setAskPaneScope,type AskPaneRegistration} from '../askPaneRegistry';
import {topEscapeLayer} from '../askPaneLayout';
import {clearCanvas,updateCanvas,canvasState,canvasServerState,subscribeCanvas,publishCanvases} from './store';
import {canvasFetch} from './state';
export function CanvasViewer({initial}:{initial:CanvasGetResponse}){
 const root=useRef<HTMLDivElement>(null),width=useAskContentWidth(root),viewport=useAskViewport();
 const [active,setActive]=useState(true),[ready,setReady]=useState(false);
 const store=useSyncExternalStore(subscribeCanvas,canvasState,canvasServerState);
 const selected=store.selection[initial.canvas.id]?.version??initial.selected.version;
 const latest=store.items.find(x=>x.canvas.id===initial.canvas.id)?.canvas.latest_version??initial.canvas.latest_version;
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>{
  const c=new AbortController();controller.current=c;let gone=false;
  const scope={userId:initial.canvas.user_id,threadId:initial.canvas.thread_id,claimToken:crypto.randomUUID()};setAskPaneScope(scope);
  updateCanvas({scope,openCanvas:(id,version)=>{window.location.href=`/panel/canvas/${id}?v=${version}`;},items:[{canvas:initial.canvas,latest:{...initial.selected,version:initial.canvas.latest_version}}],events:[],views:{},selection:{[initial.canvas.id]:{version:initial.selected.version,follow:initial.selected.version===initial.canvas.latest_version}},availability:initial.availability,prefill:(text,id,version)=>{const n=version??initial.selected.version;const v=canvasState().views[initial.canvas.id]?.data?.selected??initial.selected;const action=text===fixCanvasPrompt(v,'RENDER_FAILED')?'fix':text===fixCanvasPrompt(v,'RENDER_TIMEOUT')?'simplify':'change';window.location.href=`/panel?c=${initial.canvas.thread_id}&canvas=${id??initial.canvas.id}&canvas_v=${n}&canvas_action=${action}`;}});
  setReady(true);
  void canvasFetch<CanvasListResponse>(`/api/threads/${initial.canvas.thread_id}/canvases?limit=20`,c.signal).then(list=>{if(!gone)updateCanvas({items:list.canvases});},()=>{});
  const refresh=async()=>{if(document.hidden||gone)return;try{
   const data=await canvasFetch<CanvasGetResponse>(`/api/canvas/${initial.canvas.id}`,c.signal);if(gone)return;
   const state=canvasState();if(state.availability?.revision!==data.availability.revision){c.abort();clearCanvas();setActive(false);return;}updateCanvas({items:state.items.map(item=>item.canvas.id===data.canvas.id?{canvas:data.canvas,latest:data.selected}:item),availability:data.availability});
   if(state.selection[initial.canvas.id]?.follow!==false)updateCanvas({selection:{...state.selection,[initial.canvas.id]:{version:data.canvas.latest_version,follow:true}}});
   publishCanvases();setActive(true);
  }catch{if(!gone){clearCanvas();c.abort();setActive(false);}}};
  const timer=setInterval(()=>{void refresh();},30000);
  const visibility=()=>{if(document.hidden){c.abort();clearCanvas();setActive(false);}else window.location.reload();};
  window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',visibility);
  return ()=>{gone=true;c.abort();clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',visibility);clearCanvas();setAskPaneScope(null);};
 },[initial]); // Initial props are an already authorized uncached server read.
 const context={snapshot:{kind:'canvas' as const,attention:'none' as const,revision:`${initial.availability.revision}:${latest}`,id:initial.canvas.id,label:initial.selected.title,thread_id:initial.canvas.thread_id,user_id:initial.canvas.user_id,run_id:initial.selected.run_id,selected_version:selected,latest_version:latest},mode:'popout' as const,compact:width<640||viewport.height<600,landscape:false,paneWidth:width,viewportWidth:viewport.width,split:true,signal:controller.current?.signal??new AbortController().signal,frameBoundary:(_frame:HTMLIFrameElement,direction:'forward'|'backward'|'escape')=>{if(direction==='escape'){const top=topEscapeLayer(askPaneOverlays(canvasState().scope));if(top)top.onEscape();else root.current?.querySelector<HTMLElement>('[data-canvas-title]')?.focus();}}};
 const registration:AskPaneRegistration={id:'canvas',render:ctx=>({title:<CanvasPane context={ctx} slot="title"/>,meta:<CanvasPane context={ctx} slot="meta"/>,content:<CanvasPane context={ctx} slot="content"/>,actions:<CanvasPane context={ctx} slot="actions"/>})};
 return <main ref={root} className="h-dvh min-h-0 bg-paper p-2 text-ink"><a className="sr-only focus:not-sr-only" href={`/panel?c=${initial.canvas.thread_id}`}>Chat</a>{active&&!ready?<p role="status">Loading canvas…</p>:active?<AskContentPane id="canvas-viewer" {...context} registration={registration} entrySerial={1} onExit={()=>{window.location.href=`/panel?c=${initial.canvas.thread_id}`;}}/>:<p role="status">This canvas isn&apos;t available to this account.</p>}</main>;
}

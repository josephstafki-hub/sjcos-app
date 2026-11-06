'use client';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {CanvasGetResponse,CanvasMutationResponse} from '@/lib/canvas-api-types';
import type {AskPaneRenderContext} from '../../askPaneRegistry';
import {CanvasVersions} from '../../CanvasVersions';
import {CanvasOverlay} from '../CanvasOverlay';
import {canvasState,canvasServerState,subscribeCanvas,patchCanvas,chooseCanvas,selectCanvasVersion,askCanvasChange,updateCanvas,publishCanvases} from '../store';
import {canvasFetch} from '../state';
import {FloorCanvasStage,type FloorCanvasPreview} from './FloorCanvasStage';
export function FloorCanvasPane({context,slot,data}:{context:AskPaneRenderContext;slot:'title'|'meta'|'content'|'actions';data:CanvasGetResponse&{floor?:FloorCanvasPreview}}) {
 const state=useSyncExternalStore(subscribeCanvas,canvasState,canvasServerState);
 const [overlay,setOverlay]=useState<null|'versions'|'picker'|'about'|'restore'>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const request=useRef<{kind:string;id:string}|null>(null);
 const {canvas,selected:v}=data, floor=data.floor;
 useEffect(()=>{
  if(slot!=='content')return;let done=false;
  const controller=new AbortController(),abort=()=>controller.abort();context.signal.addEventListener('abort',abort,{once:true});
  const timer=setInterval(()=>{if(document.hidden||done)return;void canvasFetch<CanvasGetResponse>(`/api/canvas/${canvas.id}?version=${v.version}`,controller.signal).then(fresh=>{if(!done&&!controller.signal.aborted)patchCanvas(canvas.id,{data:fresh});},()=>{if(!done)patchCanvas(canvas.id,{data:undefined,error:'CANVAS_UNAVAILABLE'});});},2000);
  return()=>{done=true;controller.abort();clearInterval(timer);context.signal.removeEventListener('abort',abort);};
 },[slot,canvas.id,v.version,context.signal]);
 async function mutate(kind:'latest'|'restore') {
  if(busy)return;setBusy(true);setNotice('');
  if(request.current?.kind!==kind)request.current={kind,id:crypto.randomUUID()};
  try{
   const latest=state.items.find(x=>x.canvas.id===canvas.id)?.canvas.latest_version??canvas.latest_version;
   const body=kind==='latest'?{request_id:request.current!.id,base_version:latest,expected_design_rev:floor!.latestRev}:{request_id:request.current!.id,base_version:latest,restore_version:v.version};
   const result=await canvasFetch<CanvasMutationResponse>(`/api/canvas/${canvas.id}/${kind==='latest'?'floor-latest':'restore'}`,context.signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   updateCanvas({items:canvasState().items.map(x=>x.canvas.id===canvas.id?{canvas:result.canvas,latest:result.selected}:x)});selectCanvasVersion(canvas.id,result.selected.version);publishCanvases();setOverlay(null);request.current=null;
   if(!result.changed)setNotice('This floor plan is already current.');
  }catch{setNotice("The floor plan changed. Try again.");request.current=null;}finally{setBusy(false);}
 }
 const label=`Floor plan · ${v.title} · v${v.design?.number??floor?.number??''}`;
 const button='min-h-11 rounded-md border border-rule bg-card px-3 text-meta';
 if(slot==='title')return <button data-canvas-title className="h-11 min-w-0 truncate px-2 text-left font-serif text-subheading" onClick={()=>patchCanvas(canvas.id,{sheet:'picker'})}>{label} ▾</button>;
 if(slot==='meta')return <span className="truncate text-meta">Read only{v.change_note?` · ${v.change_note}`:''}</span>;
 if(slot==='actions')return <div className="flex min-h-14 items-center gap-1 px-2"><button className={button} onClick={()=>patchCanvas(canvas.id,{sheet:'versions'})}>Versions</button><button className={button} onClick={()=>patchCanvas(canvas.id,{sheet:'about'})}>About</button><button className={button} onClick={()=>askCanvasChange(canvas.id)}>Ask for a change</button></div>;
 const sheet=state.views[canvas.id]?.sheet;
 const close=()=>{setOverlay(null);patchCanvas(canvas.id,{sheet:undefined});};
 return <div className="relative flex h-full min-h-0 flex-col">
  {(notice||busy)&&<p role="status" className="px-2 text-meta">{busy?'Loading floor plan…':notice}</p>}
  {data.capabilities.preview&&floor?<FloorCanvasStage floor={floor} visible={!context.signal.aborted} onLoadLatest={()=>void mutate('latest')}/>:<p role="status">Floor plan preview is turned off.</p>}
  {sheet==='versions'&&<CanvasVersions id={canvas.id} selected={v.version} onSelect={n=>selectCanvasVersion(canvas.id,n)} onClose={close}/>}
  {sheet==='picker'&&<CanvasOverlay title="Canvases" onClose={close}>{state.items.map(x=><button key={x.canvas.id} className={`${button} block w-full text-left`} onClick={()=>{chooseCanvas(x.canvas.id,x.canvas.latest_version);close();}}>{x.canvas.kind==='floor_plan'?`Floor plan · ${x.latest.title} · v${x.latest.design?.number??''}`:x.latest.title}</button>)}</CanvasOverlay>}
  {sheet==='about'&&<CanvasOverlay title="About this floor plan" onClose={close}><p>{v.summary}</p>{v.version!==canvas.latest_version&&<button className={button} onClick={()=>{patchCanvas(canvas.id,{sheet:undefined});setOverlay('restore');}}>Use this version</button>}</CanvasOverlay>}
  {overlay==='restore'&&<CanvasOverlay title={`Use floor plan v${v.design?.number}?`} onClose={close}><p>Your newer versions will stay. The full designer will keep its current drawing.</p><button className={button} disabled={busy} onClick={()=>void mutate('restore')}>Use this version</button><button className={button} onClick={close}>Cancel</button></CanvasOverlay>}
 </div>;
}

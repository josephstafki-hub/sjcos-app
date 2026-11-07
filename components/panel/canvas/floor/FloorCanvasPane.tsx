'use client';
import {useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import type {CanvasGetResponse,CanvasMutationResponse} from '@/lib/canvas-api-types';
import type {AskPaneRenderContext} from '../../askPaneRegistry';
import {CanvasVersions} from '../../CanvasVersions';
import {CanvasOverlay} from '../CanvasOverlay';
import {canvasState,canvasServerState,subscribeCanvas,patchCanvas,selectCanvasVersion,askCanvasChange,updateCanvas,publishCanvases} from '../store';
import {canvasFetch} from '../state';
import {FloorCanvasStage,type FloorCanvasPreview} from './FloorCanvasStage';
export function FloorCanvasPane({context,slot,data,picker,onDelete}:{picker:ReactNode;onDelete:()=>void;context:AskPaneRenderContext;slot:'title'|'meta'|'content'|'actions';data:CanvasGetResponse&{floor?:FloorCanvasPreview}}) {
 const state=useSyncExternalStore(subscribeCanvas,canvasState,canvasServerState);
 const [overlay,setOverlay]=useState<null|'restore'>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
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
 const number=v.design?.number??floor?.number??'';
 const canEdit=floor?.can_edit===true;
 const button='min-h-11 rounded-md border border-rule bg-card px-3 text-meta';
 if(slot==='title')return <div className="flex min-w-0 flex-1 items-center gap-1">
  {picker}
  {floor&&canEdit&&<a className={`${button} hidden shrink-0 items-center min-[820px]:inline-flex`} href={floor.href} target="_blank" rel="noopener noreferrer">Edit floor plan ↗</a>}
  <button className="size-11 shrink-0 rounded" aria-label="Floor plan options" onClick={()=>patchCanvas(canvas.id,{sheet:'menu'})}>⋯</button>
 </div>;
 // An older Canvas version is not a designer change: offer the existing newer
 // version (no mutation). "Load latest" is only for the newest Canvas version
 // whose pinned snapshot differs from the live designer drawing.
 const item=state.items.find(x=>x.canvas.id===canvas.id);
 const latestVersion=Math.max(canvas.latest_version,item?.canvas.latest_version??0);
 const older=v.version<latestVersion;
 const latestNumber=item&&item.canvas.latest_version===latestVersion?item.latest?.design?.number:undefined;
 if(slot==='meta')return <span className="flex min-w-0 items-center gap-2 text-meta">
  <span className="shrink-0">Floor plan · v{number} · Read only</span>
  {older&&<span role="status" className="flex shrink-0 items-center gap-1">{latestNumber!=null?<><span className="hidden min-[640px]:inline">Floor plan</span> v{latestNumber} is ready</>:'A newer version is ready'} <button className="shrink-0 underline" onClick={()=>selectCanvasVersion(canvas.id,latestVersion)}>Latest</button></span>}
  {!older&&floor?.changed&&<span role="status" className="flex min-w-0 items-center gap-1"><span className="hidden truncate min-[640px]:inline">The floor plan changed.</span><span className="min-[640px]:hidden">Changed.</span><button className="shrink-0 underline" disabled={busy} onClick={()=>void mutate('latest')}>Load latest</button></span>}
  {!older&&v.change_note&&!floor?.changed&&<span className="truncate">{v.change_note}</span>}
 </span>;
 if(slot==='actions')return <div className={`flex h-full w-full min-w-0 gap-1 ${context.landscape?'flex-col justify-start px-1':'items-center px-2'}`}>
  <div className="flex shrink-0 items-center justify-center">
   <button className={`min-h-11 ${context.landscape?'min-w-8':'min-w-11'}`} aria-label="Previous version" disabled={v.version<=1||busy} onClick={()=>selectCanvasVersion(canvas.id,v.version-1)}>‹</button>
   <button className="min-h-11 px-1 text-meta" onClick={()=>patchCanvas(canvas.id,{sheet:'versions'})}>Versions</button>
   <button className={`min-h-11 ${context.landscape?'min-w-8':'min-w-11'}`} aria-label="Next version" disabled={v.version>=canvas.latest_version||busy} onClick={()=>selectCanvasVersion(canvas.id,v.version+1)}>›</button>
  </div>
  <button className={`${button} min-w-0 ${context.landscape?'w-full whitespace-normal':'flex-1'}`} onClick={()=>askCanvasChange(canvas.id)}>Ask for a change</button>
 </div>;
 const sheet=state.views[canvas.id]?.sheet;
 const close=()=>{setOverlay(null);patchCanvas(canvas.id,{sheet:undefined});};
 const openRestore=()=>{patchCanvas(canvas.id,{sheet:undefined});setOverlay('restore');};
 async function copyLink(){try{await navigator.clipboard.writeText(new URL(`/floor/${floor!.designId}`,window.location.origin).href);setNotice('Link copied.');}catch{setNotice("Couldn't copy the link. Try again.");}close();}

 return <div className="relative flex h-full min-h-0 flex-col">
  {(notice||busy)&&<p role="status" className="px-2 text-meta">{busy?'Loading floor plan…':notice}</p>}
  {data.capabilities.preview&&floor?<FloorCanvasStage floor={floor} visible={!context.signal.aborted} />:<p role="status">Floor plan preview is turned off.</p>}
  {sheet==='versions'&&<CanvasVersions id={canvas.id} selected={v.version} onSelect={n=>selectCanvasVersion(canvas.id,n)} onClose={close}/>}
  {sheet==='menu'&&<CanvasOverlay title="Floor plan options" menu onClose={close}>
   {floor&&<><p className="text-meta min-[640px]:hidden">Edit on a tablet or computer</p><a className={`flex min-h-14 items-center ${canEdit?'min-[820px]:hidden':''}`} href={`/floor/${floor.designId}`} target="_blank" rel="noopener noreferrer"><span className="min-[640px]:hidden">Open floor plan ↗</span><span className="hidden min-[640px]:inline">{canEdit?'Edit floor plan ↗':'Open floor plan ↗'}</span></a></>}
   <button className="block min-h-14 w-full text-left" onClick={()=>patchCanvas(canvas.id,{sheet:'about'})}>About this floor plan</button>
   {v.version<canvas.latest_version&&<button className="block min-h-14 w-full text-left" onClick={openRestore}>Use this version</button>}
   <button className="block min-h-14 w-full text-left" disabled={!floor} onClick={()=>void copyLink()}>Copy link</button>
   <button className="block min-h-14 w-full border-t border-rule text-left text-flag" onClick={()=>{close();onDelete();}}>Delete canvas…</button>
  </CanvasOverlay>}
  {sheet==='about'&&<CanvasOverlay title="About this floor plan" onClose={close}><p>{v.summary}</p></CanvasOverlay>}
  {overlay==='restore'&&<CanvasOverlay title={`Make floor plan v${v.design?.number} the latest?`} onClose={close}><p>Your newer versions will stay. The full designer will keep its current drawing.</p><button className={button} disabled={busy} onClick={()=>void mutate('restore')}>Use this version</button><button className={button} onClick={close}>Cancel</button></CanvasOverlay>}
 </div>;
}

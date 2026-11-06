'use client';
import {useEffect,useRef,useState} from 'react';
import type {VersionMeta} from '@/lib/canvas-api-types';
import type {AskPaneRenderContext} from '../askPaneRegistry';
import {connectCanvasPage} from './page-bridge';
import {patchCanvas} from './store';
import {versionPath} from './state';
export function PageStage({id,version,context}:{id:string;version:VersionMeta;context:AskPaneRenderContext}){
 const frame=useRef<HTMLIFrameElement>(null);const [ready,setReady]=useState(false),[height,setHeight]=useState(200),[scale,setScale]=useState(1),[fine,setFine]=useState(false);
 useEffect(()=>{const q=matchMedia('(any-pointer: fine)');const adopt=()=>setFine(q.matches);adopt();q.addEventListener('change',adopt);return ()=>q.removeEventListener('change',adopt);},[]);
 useEffect(()=>{
  const bridge=connectCanvasPage({frame:frame.current!,signal:context.signal,onReady:()=>{setReady(true);patchCanvas(id,{ready:true,exportReady:true,renderError:undefined});},onHeight:setHeight,onFailure:()=>patchCanvas(id,{ready:false,exportReady:false,renderError:'LOAD_TIMEOUT'}),onBoundary:direction=>{if(frame.current)context.frameBoundary(frame.current,direction);}});
  return bridge.close;
 },[id,version.version,context.signal]);
 return <div role="group" aria-label="Page preview" tabIndex={0} onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='+'||e.key==='='){e.preventDefault();setScale(s=>Math.min(4,s*1.2));}if(e.key==='-'){e.preventDefault();setScale(s=>Math.max(.25,s/1.2));}if(e.key==='0'){e.preventDefault();setScale(1);}}} className="relative h-full min-h-0 overflow-hidden bg-card">
  {!ready&&<p role="status" className="absolute left-3 top-3">Opening page…</p>}
  <div className="h-full overflow-auto"><iframe ref={frame} src={versionPath(id,version.version)+'/preview'} sandbox="allow-scripts" referrerPolicy="no-referrer" title={`${version.title}, page, version ${version.version}`} aria-describedby={`canvas-summary-${id}`} className="block w-full border-0" style={{height:Math.max(200,Math.min(8192,height)),zoom:scale}}/></div>
  <div className="absolute bottom-2 right-2 flex w-fit rounded-md border border-rule bg-card shadow-sm" aria-label="Page size">{(!context.compact||fine)&&<button className="size-12" aria-label="Zoom out" onClick={()=>setScale(s=>Math.max(.25,s/1.2))}>−</button>}<button className="min-h-12 min-w-12" onClick={()=>setScale(1)}>100%</button>{(!context.compact||fine)&&<button className="size-12" aria-label="Zoom in" onClick={()=>setScale(s=>Math.min(4,s*1.2))}>+</button>}</div>
 </div>;
}

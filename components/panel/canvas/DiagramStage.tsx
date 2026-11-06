'use client';
import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import type {CanvasCodeResponse,VersionMeta} from '@/lib/canvas-api-types';
import type {AskPaneRenderContext} from '../askPaneRegistry';
import {canvasFetch,versionPath} from './state';
import {patchCanvas} from './store';
import {connectCanvasRenderer} from './bridge';
const clamp=(n:number)=>Math.min(4,Math.max(.25,n));
export function DiagramStage({id,version,code,context,onReady}:{id:string;version:VersionMeta;code:CanvasCodeResponse;context:AskPaneRenderContext;onReady?:(height:number)=>void}){
 const frame=useRef<HTMLIFrameElement>(null),stage=useRef<HTMLDivElement>(null);
 const [status,setStatus]=useState<'opening'|'ready'|'failed'>('opening');
 const [size,setSize]=useState({width:800,height:600}),[scale,setScale]=useState(1),[pan,setPan]=useState({x:0,y:0}),[fit,setFit]=useState(true),[fine,setFine]=useState(false);
 const gesture=useRef({x:0,y:0,moved:false,multi:false});
 const pointers=useRef(new Map<number,{x:number;y:number}>()),pinch=useRef(0),tap=useRef(0);
 const reset=()=>{setFit(true);setPan({x:0,y:0});};
 const zoom=(delta:number)=>{setFit(false);setScale(old=>clamp(old*delta));};
 useEffect(()=>{const query=matchMedia('(any-pointer: fine)');const adopt=()=>setFine(query.matches);adopt();query.addEventListener('change',adopt);return ()=>query.removeEventListener('change',adopt);},[]);
 useEffect(()=>{
  if(!fit||!stage.current)return;
  const measure=()=>{const box=stage.current!.getBoundingClientRect();setScale(clamp(Math.min((box.width-24)/size.width,(box.height-24)/size.height)));};
  measure();const ro=new ResizeObserver(measure);ro.observe(stage.current);return ()=>ro.disconnect();
 },[fit,size]);
 useEffect(()=>{
  const el=stage.current;if(!el)return;
  const wheel=(e:WheelEvent)=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();zoom(Math.exp(-e.deltaY*.003));};el.addEventListener('wheel',wheel,{passive:false});return ()=>el.removeEventListener('wheel',wheel);
 },[]);
 useEffect(()=>{
  const controller=new AbortController();let disposed=false;
  const disconnect=connectCanvasRenderer({frame:frame.current!,id,version:version.version,source:code.code,signal:context.signal,
   onFailure:renderError=>{setStatus('failed');patchCanvas(id,{ready:false,renderError});},
   onHeight:height=>onReady?.(height),
   onEscape:()=>{if(frame.current)context.frameBoundary(frame.current,'escape');},
   onRendered:data=>{
    setStatus('ready');setSize({width:data.width,height:data.height});patchCanvas(id,{ready:true,renderError:undefined});onReady?.(data.height);
    // Rendering never writes project files. Server independently rebuilds the SVG.
    if(code.availability.exports)void canvasFetch<{ok:true;canvas_id:string;version:number;renderer_version:string;sha256:string}>(versionPath(id,version.version)+'/render',controller.signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({svg:data.svg})}).then(result=>{if(!disposed&&result.canvas_id===id&&result.version===version.version&&typeof result.renderer_version==='string'&&/^[a-f0-9]{64}$/.test(result.sha256))patchCanvas(id,{exportReady:true});},()=>{if(!disposed)patchCanvas(id,{notice:"Couldn't prepare the file. Try again."});});
   }
  });
  const abort=()=>{disposed=true;controller.abort();disconnect();};
  context.signal.addEventListener('abort',abort,{once:true});
  return ()=>{abort();context.signal.removeEventListener('abort',abort);};
 },[id,version.version,code.code,context.signal]); // context callbacks are host-owned
 const pointer=(e:ReactPointerEvent)=>{
  const prev=pointers.current.get(e.pointerId);if(!prev)return;
  if(Math.hypot(e.clientX-gesture.current.x,e.clientY-gesture.current.y)>3)gesture.current.moved=true;
  pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.current.size===2){const [a,b]=[...pointers.current.values()];const distance=Math.hypot(a.x-b.x,a.y-b.y);if(pinch.current)zoom(distance/pinch.current);pinch.current=distance;}
  else{setPan(p=>({x:p.x+e.clientX-prev.x,y:p.y+e.clientY-prev.y}));setFit(false);}
 };
 return <div ref={stage} role="group" aria-label="Diagram zoom and pan" tabIndex={0} className="relative h-full min-h-0 overflow-hidden bg-white text-slate-900 focus-visible:outline-2 focus-visible:outline-focus" style={{touchAction:'none'}}
  onKeyDown={e=>{if(['+','=','-','0','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();if(e.key==='0')reset();else if(e.key==='+'||e.key==='=')zoom(1.2);else if(e.key==='-')zoom(1/1.2);else {setFit(false);setPan(p=>({x:p.x+(e.key==='ArrowLeft'?-24:e.key==='ArrowRight'?24:0),y:p.y+(e.key==='ArrowUp'?-24:e.key==='ArrowDown'?24:0)}));}}}}
  onPointerDown={e=>{if((e.target as HTMLElement).closest('button'))return;if(e.pointerType==='mouse')setFine(true);e.currentTarget.setPointerCapture(e.pointerId);if(!pointers.current.size)gesture.current={x:e.clientX,y:e.clientY,moved:false,multi:false};else gesture.current.multi=true;pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});}}
  onPointerMove={pointer} onPointerUp={e=>{pointers.current.delete(e.pointerId);pinch.current=0;const now=performance.now();if(e.pointerType==='touch'&&!gesture.current.moved&&!gesture.current.multi){if(now-tap.current<300)reset();tap.current=now;}}} onPointerCancel={e=>{pointers.current.delete(e.pointerId);pinch.current=0;}} onDoubleClick={reset}>
  {status==='opening'&&<p role="status" className="absolute left-3 top-3">Opening diagram…</p>}
  {status!=='failed'&&<iframe ref={frame} src="/api/canvas/renderer" sandbox="allow-scripts" referrerPolicy="no-referrer" title={`${version.title}, diagram, version ${version.version}`} aria-describedby={`canvas-summary-${id}`} className="absolute border-0" style={{width:size.width,height:size.height,left:'50%',top:'50%',pointerEvents:'none',transformOrigin:'center',transform:`translate(-50%,-50%) translate(${pan.x}px,${pan.y}px) scale(${scale})`}}/>}
  <div className="absolute bottom-2 right-2 flex rounded-md border border-slate-300 bg-white/95 shadow-sm" aria-label="Zoom">
   {(!context.compact||fine)&&<button className="size-12" aria-label="Zoom out" onClick={()=>zoom(1/1.2)}>−</button>}
   <button className="min-h-12 min-w-12 px-2" aria-pressed={fit} onClick={reset}>Fit</button>
   <button className="min-h-12 min-w-12 px-2" aria-label="100%" title={`Zoom ${Math.round(scale*100)}%`} onClick={()=>{setFit(false);setScale(1);setPan({x:0,y:0});}}>100%</button>
   {(!context.compact||fine)&&<button className="size-12" aria-label="Zoom in" onClick={()=>zoom(1.2)}>+</button>}
  </div>
 </div>;
}

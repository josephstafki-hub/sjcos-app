'use client';
import {useSyncExternalStore} from 'react';
import {canvasState,canvasServerState,subscribeCanvas} from './canvas/store';
import {Workflow} from 'lucide-react';
import type {Availability,CanvasEvent} from '@/lib/canvas-api-types';
export function CanvasCard({event,availability,latestVersion,showing=false,creating=false,stopped=false,onOpen}:{event?:CanvasEvent;availability?:Availability;latestVersion?:number;showing?:boolean;creating?:boolean;stopped?:boolean;onOpen:(id:string,version:number,opener:HTMLElement)=>void}){
 const state=useSyncExternalStore(subscribeCanvas,canvasState,canvasServerState);
 const kind=state.items.find(item=>item.canvas.id===event?.canvas_id)?.canvas.kind;
 const label=kind==='page'?'Page':kind==='diagram'?'Diagram':'Canvas';
 let generic:string|null=null;
 if(availability&&!availability.master)generic='Canvas is turned off.';
 else if(creating)generic='Claude is making a canvas…';
 else if(event?.kind==='unavailable')generic="This canvas isn't available.";
 else if(event?.kind==='deleted')generic='This canvas was deleted.';
 else if(event?.kind==='rejected')generic=`Claude couldn't make this canvas (${event.reason}). It's still in the chat as text.`;
 if(generic)return <div role="status" className="rounded-md border border-rule p-3 text-body text-ink-3">{generic}</div>;
 if(!event||!('version' in event))return null;
 const v=event.version,older=(latestVersion??v.version)>v.version;
 const disabled=showing&&!older;
 const versionLabel=v.design?`floor plan v${v.design.number}`:`version ${v.version}`;
 return <article className="rounded-md border border-rule bg-card p-3">
  <div className="flex items-center gap-2"><Workflow className="size-4 shrink-0" aria-hidden="true"/><h3 className="truncate font-serif text-subheading">{v.title}</h3></div>
  <p className="text-meta text-ink-3">{label} · {v.design?`v${v.design.number}`:`Version ${v.version}`}{older?' · Newer version available':''}</p>
  <p className="line-clamp-1 text-body text-ink-2">{v.summary}</p>
  {stopped&&<p className="text-meta text-ink-3">Canvas saved before the run stopped.</p>}
  {event.kind==='saved'&&<p className="text-meta text-ink-3">Saved to {event.project_name}</p>}
  <button className="min-h-11 rounded-md border border-rule bg-card px-3 text-body text-ai-2 focus-visible:outline-2 focus-visible:outline-focus" aria-disabled={disabled||undefined}
   aria-label={disabled?'Showing':older?`Open ${versionLabel}: ${v.title}, ${label.toLowerCase()}, newer version available`:`Open canvas: ${v.title}, ${label.toLowerCase()}, ${versionLabel}`}
   onClick={e=>{if(!disabled)onOpen(event.canvas_id,v.version,e.currentTarget);}}>{disabled?'Showing':older?`Open ${versionLabel}`:'Open canvas'}</button>
 </article>;
}

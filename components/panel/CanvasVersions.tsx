'use client';
import {useEffect,useState} from 'react';
import type {CanvasVersionsResponse,VersionMeta} from '@/lib/canvas-api-types';
import {CanvasOverlay} from './canvas/CanvasOverlay';
import {canvasFetch,canvasVersionTime,canvasVersionByline} from './canvas/state';
export function CanvasVersions({id,selected,onSelect,onClose}:{id:string;selected:number;onSelect:(version:number)=>void;onClose:()=>void}){
 const [rows,setRows]=useState<VersionMeta[]>([]),[before,setBefore]=useState<number|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(true);
 const load=async(signal?:AbortSignal,boundary?:number)=>{setLoading(true);setError(false);try{const p=await canvasFetch<CanvasVersionsResponse>(`/api/canvas/${id}/versions?limit=20${boundary?`&before=${boundary}`:''}`,signal);if(!signal?.aborted){setRows(old=>boundary?[...old,...p.versions]:p.versions);setBefore(p.next_before);}}catch{if(!signal?.aborted){setRows([]);setError(true);}}finally{if(!signal?.aborted)setLoading(false);}};
 useEffect(()=>{const c=new AbortController();void load(c.signal);return ()=>c.abort();},[id]); // eslint-disable-line react-hooks/exhaustive-deps
 return <CanvasOverlay title="Versions" onClose={onClose}>
  {rows.filter((v,i,a)=>!v.design||a.findIndex(x=>x.design?.snapshot_id===v.design?.snapshot_id)===i).map(v=><button key={v.version} aria-current={v.version===selected?'true':undefined} onClick={()=>{onSelect(v.version);onClose();}} className="flex min-h-14 w-full flex-col justify-center border-b border-rule px-2 text-left">
   <span>{v.design?`Floor plan · ${v.title} · v${v.design.number}`:`Version ${v.version}`}{v.version===selected?' ✓':''}</span><span className="text-meta text-ink-3">{canvasVersionByline(v.change_note,v.actor.name)}{(v.change_note.trim()||v.actor.name.trim())?' · ':''}<time dateTime={v.created_at}>{canvasVersionTime(v.created_at)}</time></span>
  </button>)}
  {loading&&<p role="status">Loading versions…</p>}{error&&<p role="alert">Couldn&apos;t load versions. <button className="min-h-11" onClick={()=>void load(undefined,before??undefined)}>Try again</button></p>}
  {before&&!loading&&<button className="min-h-11" onClick={()=>void load(undefined,before)}>Older versions</button>}
 </CanvasOverlay>;
}

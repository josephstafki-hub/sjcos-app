'use client';
import dynamic from 'next/dynamic';
import {useEffect,useState} from 'react';
import type {DesignerProps} from '@/components/floor/Designer';
const PreviewDesigner=dynamic(()=>import('@/components/floor/Designer').then(m=>m.Designer),{ssr:false,loading:()=> <p role="status">Loading floor plan…</p>});
export type FloorCanvasPreview={props:DesignerProps;snapshotId:string;designId:string;number:number;latestRev:number;changed:boolean;href:string};
/** Parent owns authorization/polling, outer title/history and the explicit CAS
 * Load latest mutation. Current live revision is notice data, never a doc. */
export function FloorCanvasStage({floor,visible,onLoadLatest}:{floor:FloorCanvasPreview;visible:boolean;onLoadLatest:(rev:number)=>void}) {
 const {props,snapshotId,designId,latestRev,changed}=floor;
 const [wide,setWide]=useState(false),[shown,setShown]=useState(true);
 useEffect(()=>{
  const q=window.matchMedia('(min-width: 640px)');const change=()=>setWide(q.matches);change();q.addEventListener('change',change);
  const visibility=()=>setShown(!document.hidden);visibility();document.addEventListener('visibilitychange',visibility);
  return()=>{q.removeEventListener('change',change);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 if (!visible) return null;
 if(!shown)return null;
 return <section className="relative flex h-full min-h-0 flex-col" aria-label={`Floor plan · ${props.design.name} · v${floor.number}`}>
  {changed&&<p role="status" className="flex-none px-2 text-meta">The floor plan changed. <button className="min-h-11 rounded-md border border-rule bg-card px-3" onClick={()=>onLoadLatest(latestRev)}>Load latest</button></p>}
  <div className="absolute right-2 top-2 z-10"><details><summary className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border border-rule bg-card" aria-label="Floor plan options">⋯</summary><div className="absolute right-0 w-56 rounded-md border border-rule bg-card p-2 shadow-pop">{!wide&&<p className="text-meta">Edit on a tablet or computer</p>}<a href={`/floor/${designId}`} className="flex min-h-11 items-center text-body" target="_blank" rel="noopener noreferrer">{wide?'Edit floor plan ↗':'Open floor plan ↗'}</a></div></details></div>
  <PreviewDesigner key={snapshotId} {...props} readOnly embeddedPreview isOwner={false}/>
 </section>;
}

'use client';
import dynamic from 'next/dynamic';
import {useEffect,useState} from 'react';
import type {DesignerProps} from '@/components/floor/Designer';
const PreviewDesigner=dynamic(()=>import('@/components/floor/Designer').then(m=>m.Designer),{ssr:false,loading:()=> <p role="status">Loading floor plan…</p>});
export type FloorCanvasPreview={props:DesignerProps;snapshotId:string;designId:string;number:number;latestRev:number;changed:boolean;href:string;can_edit?:boolean};
/** Parent owns authorization/polling, outer title/history and the explicit CAS
 * Load latest mutation. Current live revision is notice data, never a doc. */
export function FloorCanvasStage({floor,visible}:{floor:FloorCanvasPreview;visible:boolean}) {
 const {props,snapshotId}=floor;
 const [shown,setShown]=useState(true);
 useEffect(()=>{
  const visibility=()=>setShown(!document.hidden);visibility();document.addEventListener('visibilitychange',visibility);
  return()=>{document.removeEventListener('visibilitychange',visibility);};
 },[]);
 if (!visible) return null;
 if(!shown)return null;
 return <section className="relative flex h-full min-h-0 flex-col" aria-label={`Floor plan · ${props.design.name} · v${floor.number}`}>
  <PreviewDesigner key={snapshotId} {...props} readOnly embeddedPreview isOwner={false}/>
 </section>;
}

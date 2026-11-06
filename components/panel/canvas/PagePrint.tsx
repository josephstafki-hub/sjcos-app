'use client';
import {useEffect,useRef,useState} from 'react';
import {connectCanvasPage} from './page-bridge';
export function PagePrint({id,version,title}:{id:string;version:number;title:string}){
 const frame=useRef<HTMLIFrameElement>(null),bridge=useRef<ReturnType<typeof connectCanvasPage>|null>(null);
 const [ready,setReady]=useState(false),[failed,setFailed]=useState(false),[height,setHeight]=useState(600),[overflow,setOverflow]=useState(false);
 useEffect(()=>{const c=new AbortController();bridge.current=connectCanvasPage({frame:frame.current!,signal:c.signal,onReady:()=>setReady(true),onHeight:(height,overflow)=>{setHeight(height);setOverflow(overflow);},onBoundary(){},onFailure:()=>setFailed(true)});
  const before=()=>bridge.current?.printLayout(true),after=()=>bridge.current?.printLayout(false);window.addEventListener('beforeprint',before);window.addEventListener('afterprint',after);
  return ()=>{c.abort();window.removeEventListener('beforeprint',before);window.removeEventListener('afterprint',after);};
 },[id,version]);
 return <><div className="my-4 flex flex-wrap gap-4 print:hidden"><button className="min-h-11 rounded-md border border-rule bg-card px-3" disabled={!ready||failed||overflow} onClick={()=>{bridge.current?.printLayout(true);requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));}}>Print / Save PDF</button><a className="inline-flex min-h-11 items-center" href={`/api/canvas/${id}/versions/${version}/download?format=html`} download>Page (HTML)</a><p>{failed?"Claude's page couldn't be shown.":!ready?'Opening page…':'Open the file to print it on this device.'}</p></div><iframe ref={frame} src={`/api/canvas/${id}/versions/${version}/preview`} sandbox="allow-scripts" referrerPolicy="no-referrer" title={`${title}, page, version ${version}`} className="w-full border-0" style={{height:Math.max(200,Math.min(height,8192))}}/></>;
}

'use client';
import {useEffect,useRef,useState} from 'react';
import {connectCanvasPage} from './page-bridge';
export function PagePrint({id,version,title}:{id:string;version:number;title:string}){
 const frame=useRef<HTMLIFrameElement>(null),bridge=useRef<ReturnType<typeof connectCanvasPage>|null>(null);
 const [ready,setReady]=useState(false),[failed,setFailed]=useState(false),[height,setHeight]=useState(200),[overflow,setOverflow]=useState(false),[measured,setMeasured]=useState(false),[printing,setPrinting]=useState(false),[printCommit,setPrintCommit]=useState(0),[printError,setPrintError]=useState(false);
 const active=useRef(false),inPrint=useRef(false);
 useEffect(()=>{const c=new AbortController();active.current=true;setReady(false);setMeasured(false);setFailed(false);
  bridge.current=connectCanvasPage({frame:frame.current!,signal:c.signal,onReady:()=>setReady(true),onHeight:(height,overflow)=>{setHeight(height);setOverflow(overflow);setMeasured(true);},onBoundary(){},onFailure:()=>setFailed(true)});
  const before=()=>{if(!inPrint.current)void bridge.current?.printLayout(true);},after=()=>{inPrint.current=false;setPrinting(false);void bridge.current?.printLayout(false);};window.addEventListener('beforeprint',before);window.addEventListener('afterprint',after);
  return ()=>{active.current=false;c.abort();window.removeEventListener('beforeprint',before);window.removeEventListener('afterprint',after);};
 },[id,version]);
 // This effect runs after React commits the authenticated print-layout height.
 useEffect(()=>{if(!printCommit||!active.current)return;const raf=requestAnimationFrame(()=>{if(!active.current)return;try{window.print();}catch{inPrint.current=false;setPrinting(false);setPrintError(true);void bridge.current?.printLayout(false);}});return ()=>cancelAnimationFrame(raf);},[printCommit]);
 const print=async()=>{
  if(printing||!bridge.current)return;setPrinting(true);setPrintError(false);
  const current=bridge.current,result=await current.printLayout(true);
  if(!active.current||bridge.current!==current)return;
  if(!result||result.overflow){setPrinting(false);setPrintError(true);void current.printLayout(false);return;}
  setHeight(result.height);setOverflow(result.overflow);inPrint.current=true;setPrintCommit(n=>n+1);
 };
 return <><div className="my-4 flex flex-wrap gap-4 print:hidden"><button className="min-h-11 rounded-md border border-rule bg-card px-3" disabled={!ready||!measured||failed||overflow||printing} onClick={()=>void print()}>Print / Save PDF</button><a className="inline-flex min-h-11 items-center" href={`/api/canvas/${id}/versions/${version}/download?format=html`} download>Page (HTML)</a><p role="status">{failed?"Claude's page couldn't be shown.":printError?"Couldn't prepare the page to print. Try again or open the HTML file.":!ready||!measured?'Opening page…':printing?'Preparing print…':'Open the file to print it on this device.'}</p></div><iframe ref={frame} src={`/api/canvas/${id}/versions/${version}/preview`} sandbox="allow-scripts" referrerPolicy="no-referrer" title={`${title}, page, version ${version}`} className="w-full border-0" style={{height:Math.max(200,Math.min(height,8192))}}/></>;
}

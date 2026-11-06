'use client';
import {useEffect,useRef,useSyncExternalStore,lazy,Suspense} from 'react';
import type {CanvasMutationResponse} from '@/lib/canvas-api-types';
import type {AskPaneRenderContext} from './askPaneRegistry';
const CanvasSaveDialog=lazy(()=>import('./CanvasSaveDialog').then(m=>({default:m.CanvasSaveDialog})));
import {CanvasVersions} from './CanvasVersions';
import {CanvasOverlay} from './canvas/CanvasOverlay';
import {DiagramStage} from './canvas/DiagramStage';
import {canvasState,canvasServerState,subscribeCanvas,patchCanvas,loadCanvas,chooseCanvas,selectCanvasVersion,askCanvasChange,publishCanvases,updateCanvas} from './canvas/store';
import {canvasFetch,fixCanvasPrompt,renderDiagnosticCopy,versionPath,CANVAS_EMPTY_PROMPT} from './canvas/state';
import {ASK_STATUS_COPY} from './askStatusCopy';
export function CanvasPane({context,slot}:{context:AskPaneRenderContext;slot:'title'|'meta'|'content'|'actions'}){
 const state=useSyncExternalStore(subscribeCanvas,canvasState,canvasServerState);
 const {snapshot,compact,landscape,signal}=context;
 const id=snapshot.id,number=snapshot.kind==='canvas'?snapshot.selected_version:0,latest=snapshot.kind==='canvas'?snapshot.latest_version:0;
 const raw=state.views[id]??{},view=raw.data?.selected.version===number||!raw.data?raw:{};
 const data=view.data,v=data?.selected;
 const attempt=useRef<{action:string;request_id:string}|null>(null);
 const sheet=(name:typeof view.sheet)=>patchCanvas(id,{sheet:name});
 // Only the content slot owns loading/cancellation; slots share a tab-local store.
 useEffect(()=>{if(slot!=='content'||id==='empty')return;const c=new AbortController();const cancel=()=>c.abort();signal.addEventListener('abort',cancel,{once:true});void loadCanvas(id,number,c.signal);return ()=>{c.abort();signal.removeEventListener('abort',cancel);};},[slot,id,number,signal]);
 const busy=!!view.loading;
 const newer=latest>number;
 const copy=async()=>{if(!view.code)return;try{await navigator.clipboard.writeText(view.code.code);patchCanvas(id,{notice:'Code copied.'});}catch{patchCanvas(id,{notice:"Couldn't copy. Select the code and copy it."});}};
 const download=async(format:'svg'|'mmd')=>{
  try{const response=await fetch(versionPath(id,number)+`/download?format=${format}`,{cache:'no-store',signal});if(!response.ok)throw Error();const blob=await response.blob();if(signal.aborted)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${(v?.title??'Diagram').replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,80)||'Diagram'} (v${number}).${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{if(!signal.aborted)patchCanvas(id,{notice:"Couldn't prepare the file. Try again."});}
 };
 const mutate=async(action:'delete'|'restore')=>{
  if(action==='restore'&&(!v||!data))return;
  if(action==='delete'&&!v&&!attempt.current)return;
  if(attempt.current?.action!==action)attempt.current={action,request_id:crypto.randomUUID()};
  try{
   if(action==='delete'){
    // Hide the title immediately. A failed deletion stays fenced and title-free.
    patchCanvas(id,{data:undefined,code:undefined,sheet:undefined,error:'DELETING'});
    await canvasFetch(`/api/canvas/${id}`,signal,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:attempt.current.request_id})});
    updateCanvas({items:state.items.filter(x=>x.canvas.id!==id),events:state.events.map(e=>e.canvas_id===id?{id:e.id,thread_id:e.thread_id,actor_user_id:e.actor_user_id,run_id:e.run_id,at:e.at,group_id:e.group_id,kind:'deleted',canvas_id:id}:e)});publishCanvases();
   }else{
    const result=await canvasFetch<CanvasMutationResponse>(`/api/canvas/${id}/restore`,signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:attempt.current.request_id,base_version:latest,restore_version:number})});
    updateCanvas({items:state.items.map(item=>item.canvas.id===id?{canvas:result.canvas,latest:result.selected}:item)});selectCanvasVersion(id,result.selected.version);sheet(undefined);
   }
   attempt.current=null;
  }catch(e){const code=(e as {code?:string}).code;patchCanvas(id,action==='delete'?{error:'DELETE_FAILED'}:{notice:code==='VERSION_CONFLICT'?'A newer version was saved.':"Couldn't use this version. Try again.",sheet:undefined});}
 };
 const copyButton=<button disabled={!view.code} className="min-h-11 rounded border border-rule px-3" onClick={()=>void copy()}>Copy code</button>;
 const codeBlock=<><p className="py-2 text-meta text-ink-3">Diagram code · Untrusted text · Version {number}</p>{copyButton}<pre tabIndex={0} className="mt-2 overflow-auto whitespace-pre p-3 font-mono text-[13px] [font-variant-ligatures:none] [font-feature-settings:'liga'_0,'calt'_0]">{view.code?.code??'Loading code…'}</pre></>;
 if(slot==='title')return <div className="flex min-w-0 items-center"><button data-canvas-title className="h-11 min-w-0 flex-1 truncate px-2 text-left font-serif text-subheading" onClick={()=>sheet('picker')}>{view.error?'Canvas':v?.title??snapshot.label} ▾</button><button className="size-11 shrink-0 rounded" aria-label="Canvas actions" onClick={()=>sheet('menu')}>⋯</button></div>;
 if(slot==='meta')return view.error?<span/>:<span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
  {id!=='empty'&&<span className="min-w-0 truncate">Diagram · Version {number} of {latest}</span>}
  {newer&&<span className="flex shrink-0 items-center gap-1">· Version {latest} is ready <button className="underline" onClick={()=>selectCanvasVersion(id,latest)}>Latest</button></span>}
  {state.updating&&<span className="truncate">Claude is updating this canvas…</span>}{view.notice&&<span role="status" className="truncate">{view.notice}</span>}
 </span>;
 if(slot==='actions')return id==='empty'?null:<div className={`flex h-full w-full min-w-0 ${landscape?'flex-col':'items-center'}`}>
  <button className="min-h-11 min-w-11 shrink-0" aria-label={number<=1?'No earlier version':'Previous version'} disabled={number<=1||busy} onClick={()=>selectCanvasVersion(id,number-1)}>‹</button>
  <button className="min-h-11 px-1 text-body" disabled={!!view.error} onClick={()=>sheet('versions')}>Versions</button>
  <button className="min-h-11 min-w-11 shrink-0" aria-label={!newer?'No newer version':'Next version'} disabled={!newer||busy} onClick={()=>selectCanvasVersion(id,number+1)}>›</button>
  <button className="min-h-11 min-w-0 flex-1 rounded bg-ai-soft px-2 text-body font-medium text-ai-2" disabled={!v} onClick={()=>askCanvasChange(id)}>Ask for a change</button>
 </div>;
 const failure=view.error==='AUTH_REQUIRED'?'Sign in to open this canvas.':view.error==='ASK_PAUSED'?ASK_STATUS_COPY.ASK_PAUSED:view.error==='CANVAS_DISABLED'?'Canvas is turned off. Your saved project files are still available.':view.error==='CANVAS_UNAVAILABLE'?"This canvas isn't available to this account.":view.error==='DELETING'?'This canvas is being deleted.':view.error==='DELETE_FAILED'?"Deleting didn't finish. The canvas stays hidden until it does.":"Couldn't load canvas.";
 return <div className="flex h-full min-h-0 flex-col">
  {id==='empty'?<div className="p-4 text-body"><p>No canvas yet. Ask for a diagram.</p><button className="min-h-11 rounded-md border border-rule bg-card px-3 text-ai-2" onClick={()=>state.prefill?.(CANVAS_EMPTY_PROMPT)}>Draw the steps for a permit</button></div>:
   view.error?<div className="p-4" role="status"><p>{failure}</p>{view.error==='DELETE_FAILED'&&<button className="min-h-11 rounded-md border border-rule bg-card px-3" onClick={()=>void mutate('delete')}>Try again</button>}{view.error==='AUTH_REQUIRED'?<a className="inline-flex min-h-11 items-center rounded-md border border-rule bg-card px-3" href={`/login?returnTo=${encodeURIComponent(`/panel/canvas/${id}?v=${number}`)}`}>Sign in</a>:!['DELETING','CANVAS_UNAVAILABLE','CANVAS_DISABLED','DELETE_FAILED'].includes(view.error)&&<button className="min-h-11 rounded-md border border-rule bg-card px-3" onClick={()=>void loadCanvas(id,number,signal,true)}>Try again</button>}</div>:
   !v?<div className="p-4" role="status"><p>{view.notice==='This is taking a while.'?'This is taking a while.':'Loading canvas…'}</p>{view.notice==='This is taking a while.'&&<><button className="min-h-11 rounded-md border border-rule bg-card px-3" onClick={()=>void loadCanvas(id,number,signal,true)}>Try again</button><button className="min-h-11 rounded-md border border-rule bg-card px-3" disabled={!view.code} onClick={()=>sheet('code')}>Show code</button></>}</div>:<>
    <p id={`canvas-summary-${id}`} className="sr-only">{v.summary}</p>
    {!compact&&<div className="shrink-0 border-b border-rule px-3">
     <div className="flex gap-2" role="group" aria-label="Canvas view"><button className="min-h-11 rounded-md px-2 text-ink-3 aria-pressed:bg-card aria-pressed:text-ink aria-pressed:shadow-card" aria-pressed={view.tab!=='code'} onClick={()=>patchCanvas(id,{tab:'preview'})}>Preview</button><button className="min-h-11 rounded-md px-2 text-ink-3 aria-pressed:bg-card aria-pressed:text-ink aria-pressed:shadow-card" disabled={!data?.capabilities.code} aria-pressed={view.tab==='code'} onClick={()=>patchCanvas(id,{tab:'code'})}>Code</button></div>
     {data?.capabilities.save&&!['RENDER_FAILED','RENDER_TIMEOUT'].includes(view.renderError??'')&&<button className="min-h-12 rounded-md border border-rule bg-card px-3 disabled:opacity-50" disabled={!view.exportReady} onClick={()=>sheet('save')}>Save to project files</button>}
     <details><summary className="min-h-11 cursor-pointer py-2">About this diagram</summary><p className="pb-2 text-body">{v.summary}</p></details>
     {newer&&<p className="text-meta text-ink-3">{v.change_note}</p>}
    </div>}
    <div className="relative min-h-0 flex-1 overflow-auto">
     {view.renderError?<div className="p-3"><p role="status">{view.renderError==='LOAD_TIMEOUT'?'This is taking a while.':view.renderError==='RENDER_TIMEOUT'?'This diagram is too complex to show here.':"Couldn't draw this diagram. Its code is below."}</p>
      {view.renderError==='RENDER_FAILED'&&<p className="py-1 text-meta text-ink-3">{renderDiagnosticCopy(view.renderDiagnostic)}</p>}
      {view.renderError==='RENDER_FAILED'?<>
       <div className="flex flex-wrap gap-2">{copyButton}<button className="min-h-12 rounded-md border border-rule bg-card px-3 text-ai-2" onClick={()=>askCanvasChange(id,fixCanvasPrompt(v,'RENDER_FAILED',view.renderDiagnostic))}>Ask Claude to fix it</button></div>
       <p className="py-2 text-meta text-ink-3">Diagram code · Untrusted text · Version {number}</p><pre tabIndex={0} className="mt-2 overflow-auto whitespace-pre p-3 font-mono text-[13px] [font-variant-ligatures:none] [font-feature-settings:'liga'_0,'calt'_0]">{view.code?.code??'Loading code…'}</pre>
      </>:<><button className="min-h-12 rounded-md border border-rule bg-card px-3" onClick={()=>sheet('code')}>Show code</button>{view.renderError==='LOAD_TIMEOUT'?<button className="min-h-12 rounded-md border border-rule bg-card px-3" onClick={()=>void loadCanvas(id,number,signal,true)}>Try again</button>:<button className="min-h-12 rounded-md border border-rule bg-card px-3 text-ai-2" onClick={()=>askCanvasChange(id,fixCanvasPrompt(v,'RENDER_TIMEOUT'))}>Ask Claude to simplify it</button>}</>}
     </div>:
      view.tab==='code'&&!compact?<div className="p-3">{codeBlock}</div>:
      data?.capabilities.preview&&view.code?<DiagramStage key={`${id}:${number}`} id={id} version={v} code={view.code} context={context}/>:<div className="p-3"><p>Preview is turned off.</p>{data?.capabilities.code&&<button className="min-h-11 rounded-md border border-rule bg-card px-3" onClick={()=>sheet('code')}>Show code</button>}</div>}
    </div>
   </>}
  {view.sheet==='save'&&data&&<Suspense fallback={<p role="status">Loading…</p>}><CanvasSaveDialog key={`${id}:${number}`} data={data} onClose={()=>sheet(undefined)}/></Suspense>}
  {view.sheet==='versions'&&<CanvasVersions id={id} selected={number} onSelect={n=>selectCanvasVersion(id,n)} onClose={()=>sheet(undefined)}/>}
  {view.sheet==='code'&&<CanvasOverlay title="Show code" onClose={()=>sheet(undefined)}>{codeBlock}</CanvasOverlay>}
  {view.sheet==='about'&&<CanvasOverlay title="About this diagram" onClose={()=>sheet(undefined)}><p className="py-3">{v?.summary}</p></CanvasOverlay>}
  {view.sheet==='picker'&&<CanvasOverlay title="Canvases in this chat" onClose={()=>sheet(undefined)}>{state.items.map(item=><button key={item.canvas.id} className="flex min-h-14 w-full items-center justify-between gap-2 border-b border-rule px-2 text-left" onClick={e=>chooseCanvas(item.canvas.id,item.canvas.latest_version,e.currentTarget)}><span className="truncate">{item.latest.title}</span><span className="shrink-0 text-meta">Version {item.canvas.latest_version} {id===item.canvas.id?'✓':''}</span></button>)}{!state.items.length&&<p>No canvas yet. Ask for a diagram.</p>}</CanvasOverlay>}
  {view.sheet==='menu'&&<CanvasOverlay title="Canvas actions" menu onClose={()=>sheet(undefined)}><div className="flex flex-col [&_button]:min-h-14 [&_button]:text-left [&_a]:min-h-14 [&_a]:py-4">
   {compact&&<><button disabled={!data?.capabilities.code} onClick={()=>sheet('code')}>Show code</button><button onClick={()=>sheet('about')}>About this diagram</button></>}
   {compact&&data?.capabilities.save&&!['RENDER_FAILED','RENDER_TIMEOUT'].includes(view.renderError??'')&&<button disabled={!view.exportReady} onClick={()=>sheet('save')}>Save to project files</button>}
   <details><summary className="min-h-14 cursor-pointer py-4">Download</summary><button className="block w-full" title={!data?.availability.exports?"Drawing downloads aren’t available yet.":undefined} disabled={!data?.availability.exports||!view.exportReady||!data?.capabilities.download_formats.includes('svg')} onClick={()=>void download('svg')}>Drawing (SVG)</button><button className="block w-full" disabled={!data?.capabilities.code||!data?.availability.source} onClick={()=>void download('mmd')}>Diagram code (.mmd)</button></details>
   {process.env.NEXT_PUBLIC_SJC_CANVAS_PRINT_ENABLED==='1'&&data?.availability.exports&&view.exportReady&&<a href={`/panel/canvas/${id}/print?v=${number}`} target="_blank" rel="noopener noreferrer">Print / Save PDF</a>}
   {v&&<a href={`/panel/canvas/${id}?v=${number}`} target="_blank" rel="noopener noreferrer">Open in new tab</a>}
   {newer&&data?.capabilities.restore&&<button onClick={()=>sheet('restore')}>Use this version</button>}
   <hr className="border-rule"/><button disabled={!v} onClick={()=>sheet('delete')}>Delete canvas…</button>
  </div></CanvasOverlay>}
  {view.sheet==='restore'&&<CanvasOverlay title={`Make Version ${number} the latest?`} onClose={()=>sheet(undefined)}><p>Your newer versions will stay.</p><button className="min-h-11 rounded-md border border-rule bg-card px-3" onClick={()=>void mutate('restore')}>Use this version</button><button className="min-h-11 px-3" onClick={()=>sheet(undefined)}>Cancel</button></CanvasOverlay>}
  {view.sheet==='delete'&&<CanvasOverlay title="Delete canvas?" onClose={()=>sheet(undefined)}><p>It&apos;s removed now and erased for good after 30 days. Saved project files will stay.</p><button className="min-h-11 rounded-md border border-rule bg-card px-3 text-flag" onClick={()=>void mutate('delete')}>Delete canvas</button><button className="min-h-11 px-3" onClick={()=>sheet(undefined)}>Cancel</button></CanvasOverlay>}
 </div>;
}

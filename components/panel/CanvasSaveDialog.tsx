'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {CanvasGetResponse} from '@/lib/canvas-api-types';
import {CanvasOverlay} from './canvas/CanvasOverlay';
import {searchCanvasProjectsAction} from '@/lib/actions/canvas-projects';
import {JobPicker} from './JobPicker';
import {removedAreas,showRowWarnings,audienceSentence,acknowledgementLabel} from '@/lib/canvas-save-policy.mjs';
type Policy={owner:boolean;baseline_areas:string[];baseline_source:string;policy_revision:string;area_options:{key:string;label:string}[];project:{slug:string;name:string}};
export function CanvasAudienceChips({names}:{names:string[]}){
 const [expanded,setExpanded]=useState(false);
 if(!names.length)return <p>🔒 Staff</p>;
 const full=names.join(', ');
 return <div role="group" className="flex flex-wrap gap-1" title={full} aria-label={full}>
  {names.slice(0,3).map(name=><span key={name} className="rounded-md border border-rule bg-card px-2 py-1 text-meta">{name}</span>)}
  {names.length>3&&<><button className="min-h-12 rounded-md border border-rule bg-card px-2" aria-label={`${full}. ${expanded?'Hide':'Show'} all required access areas`} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>+{names.length-3} more</button>{expanded&&<ul className="w-full text-body">{names.map(name=><li key={name}>{name}</li>)}</ul>}</>}
 </div>;
}
export function CanvasSaveDialog({data,onClose}:{data:CanvasGetResponse;onClose:()=>void}){
 const base=`/api/canvas/${data.canvas.id}/versions/${data.selected.version}`;
 const searchProjects=useCallback((query:string)=>searchCanvasProjectsAction(data.canvas.id,data.selected.version,query),[data.canvas.id,data.selected.version]);
 const [project,setProject]=useState(data.canvas.project_slug??''),[pick,setPick]=useState(!project),[filename,setFilename]=useState(`${data.selected.title} (v${data.selected.version}).html`);
 const [p,setPolicy]=useState<Policy|null>(null),[kind,setKind]=useState('staff'),[selected,setSelected]=useState<string[]>([]),[ack,setAck]=useState<{token:string;expires:number}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[another,setAnother]=useState(false),[offerAnother,setOfferAnother]=useState(false);
 const selection=useRef(0),request=useRef<string|null>(null);
 const ackRow=useRef<HTMLLabelElement|null>(null),ackShown=useRef(false);
 const reset=()=>{selection.current++;setAck(null);request.current=null;};
 useEffect(()=>{reset();setPolicy(null);setError('');if(!project)return;const c=new AbortController();void fetch(`${base}/save-policy?project=${encodeURIComponent(project)}`,{cache:'no-store',signal:c.signal}).then(async r=>{const b=await r.json();if(!r.ok)throw Error(b.message);if(!c.signal.aborted){setPolicy(b);setSelected(b.baseline_areas);}}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[base,project,refresh]);
 useEffect(()=>{if(!ack)return;const t=setTimeout(()=>{reset();setError('Review who can read this copy again.');},Math.max(0,ack.expires-Date.now()));return()=>clearTimeout(t);},[ack]);
 useEffect(()=>()=>{selection.current++;},[]);
 const removed=p?removedAreas(p.baseline_areas,selected):[],warnings=showRowWarnings(removed);
 const needsAck=!!p?.owner&&kind==='staff'&&removed.length>0;
 // Build R4-1: the reason Save is off lives in the sticky footer, never under it.
 const hint=!project?'Choose a project.':needsAck&&!ack?'Tick the line above to save.':null;
 useEffect(()=>{if(!needsAck){ackShown.current=false;return;}if(ackShown.current)return;ackShown.current=true;ackRow.current?.scrollIntoView({block:'nearest'});},[needsAck]);
 const change=(next:string[])=>{reset();setSelected(next);};
 const acknowledge=async(checked:boolean)=>{
  reset();if(!checked||!p)return;const epoch=selection.current;setBusy(true);setError('');
  try{const r=await fetch(`${base}/save-policy/acknowledgement`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_slug:project,expected_policy_revision:p.policy_revision,removed_areas:removed})}),b=await r.json();if(!r.ok)throw Object.assign(Error(b.message),{code:b.code});if(epoch===selection.current)setAck({token:b.token,expires:b.expires_at});}catch(e){setError((e as Error).message);setRefresh(x=>x+1);}finally{setBusy(false);}
 };
 const save=async()=>{if(!p)return;setBusy(true);setError('');const request_id=request.current??=crypto.randomUUID();try{
 const body={request_id,project_slug:project,expected_policy_revision:p.policy_revision,filename,...(p.owner?{audience:kind==='owner_only'?{kind}:{kind:'staff',required_areas:selected},...(ack?{declassification_ack:ack.token}:{})}:{}),...(another?{save_another_copy:true}:{})};
 const r=await fetch(`${base}/save`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),b=await r.json();if(!r.ok){if(b.code==='SAVE_POLICY_CHANGED'||b.code==='SAVE_FAILED'){reset();setRefresh(x=>x+1);}if(b.code==='SAVE_POLICY_CONFLICT')setOfferAnother(true);throw Error(b.message);}onClose();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <CanvasOverlay title="Save to project files" onClose={onClose}><div className="flex flex-col gap-3 pt-3">
 <p>Canvas: {data.selected.title} · Version {data.selected.version}</p>
 {data.canvas.lead_slug&&<p>Leads can&apos;t hold canvas copies yet. Pick a project, or download it.</p>}
 <div className="flex min-h-12 items-center gap-2"><span>Project</span><button className="min-h-12 min-w-0 flex-1 truncate rounded-md border border-rule bg-card px-3 text-left" aria-expanded={pick} onClick={()=>setPick(!pick)}>{p?.project.name||project||'Pick a project'} {pick?'▴':'▾'}</button></div>
 {pick&&<JobPicker inline projectOnly search={searchProjects} title="Project" placeholder="Search projects…" onPick={j=>{reset();setProject(j.slug);setPick(false);}} onDone={()=>setPick(false)}/>}
 <label>Filename<input className="block min-h-12 w-full border border-rule bg-paper px-2 text-base" value={filename} onChange={e=>{request.current=null;setFilename(e.target.value);}}/></label>
 {p?.owner&&<><label className="flex min-h-12 items-center gap-2"><input type="radio" checked={kind==='staff'} onChange={()=>{reset();setKind('staff');}}/>Share with staff</label>
 {kind==='staff'&&<>{p.baseline_source==='unknown_context'&&<p>Claude may have used anything in this chat, so every area is ticked.</p>}<button className="min-h-12 shrink-0 self-start rounded-md border border-rule bg-card px-3 text-left" onClick={()=>change([])}>Untick all</button>
 <div role="group" aria-label="Required access areas" className="max-h-[min(20rem,38dvh)] shrink-0 overflow-y-auto overscroll-contain rounded-md border border-rule bg-card px-3">{p.area_options.map(o=><div key={o.key}><label className="flex min-h-12 w-full cursor-pointer items-center gap-3"><input className="size-5 shrink-0 accent-ink" type="checkbox" checked={selected.includes(o.key)} onChange={()=>change(selected.includes(o.key)?selected.filter(k=>k!==o.key):[...selected,o.key])}/>{o.label}</label>{warnings&&removed.includes(o.key)&&<p className="pb-2 pl-8 text-meta text-ink-2">Staff without {o.label} access will be able to read this. <button className="min-h-11 rounded-md border border-rule bg-paper px-3" onClick={()=>change([...selected,o.key])}>Keep {o.label} ticked</button></p>}</div>)}</div></>}
 <label className="flex min-h-12 items-center gap-2"><input type="radio" checked={kind==='owner_only'} onChange={()=>{reset();setKind('owner_only');}}/>Only Joe</label></>}
 {p&&!p.owner&&<CanvasAudienceChips names={p.area_options.filter(o=>selected.includes(o.key)).map(o=>o.label)}/>}
 {p&&<><p>{audienceSentence(kind,selected,p.area_options,p.project.name)}</p>{p.owner&&kind==='staff'&&removed.length>0&&<><label ref={ackRow} className="flex min-h-12 scroll-mb-24 items-start gap-2" aria-label={selected.length?'I understand — share without '+p.area_options.filter(o=>removed.includes(o.key)).map(o=>o.label).join(', '):acknowledgementLabel(selected,removed,p.area_options,p.project.name)}><input type="checkbox" checked={!!ack} disabled={busy} onChange={e=>void acknowledge(e.target.checked)}/>{acknowledgementLabel(selected,removed,p.area_options,p.project.name)}</label>{removed.length>2&&<details><summary>All removed areas</summary>{p.area_options.filter(o=>removed.includes(o.key)).map(o=><p key={o.key}>{o.label}</p>)}</details>}</>}</>}
 <p>It won&apos;t appear on the client portal.</p>
 {offerAnother&&<label className="min-h-12"><input type="checkbox" checked={another} onChange={e=>{request.current=null;setAnother(e.target.checked);}}/>Save another copy after the previous copy is moved to Trash</label>}
 <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-t border-rule bg-paper py-2">{error?<p role="alert" className="mr-auto text-body text-flag">{error}</p>:hint&&<p className="mr-auto text-body text-ink-3">{hint}</p>}<button className="min-h-12" onClick={onClose}>Cancel</button><button className="min-h-12 rounded-md border border-rule bg-card px-3 disabled:opacity-50" disabled={busy||!p||(p.owner&&kind==='staff'&&removed.length>0&&!ack)} onClick={()=>void save()}>Save</button></div>
 </div></CanvasOverlay>;
}

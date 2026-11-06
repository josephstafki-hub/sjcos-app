import type {RenderDiagnostic} from './bridge';
import type {CanvasEvent,VersionMeta} from '@/lib/canvas-api-types';
export function groupCanvasEvents(events:readonly CanvasEvent[]):CanvasEvent[]{
 const unique=new Map(events.map(e=>[e.id,e]));
 const redacted=new Map<string,CanvasEvent>();
 for(const e of unique.values())if((e.kind==='deleted'||e.kind==='unavailable')&&e.canvas_id)redacted.set(e.canvas_id,e);
 const groups=new Map<string,CanvasEvent>();
 for(const original of [...unique.values()].sort((a,b)=>a.at.localeCompare(b.at)||(BigInt(a.id)<BigInt(b.id)?-1:1))){
  const e=original.canvas_id&&redacted.has(original.canvas_id)?{...redacted.get(original.canvas_id)!,group_id:original.group_id,run_id:original.run_id}:original;
  const old=groups.get(e.group_id);
  if(!old||!('version' in old)||!('version' in e)||old.version.version<=e.version.version)groups.set(e.group_id,old?{...e,at:old.at}:e);
 }
 return [...groups.values()];
}
export const renderDiagnosticCopy=(diagnostic?:RenderDiagnostic)=>({
 SOURCE_REJECTED:'The diagram source did not pass the supported syntax checks.',
 SYNTAX_ERROR:'Mermaid could not parse the diagram. Check its syntax.',
 LAYOUT_FAILED:'Mermaid could not lay out the diagram.',
 DRAWING_REJECTED:'The drawing did not pass the supported SVG checks.',
}[diagnostic??'LAYOUT_FAILED']);
export const changeCanvasPrompt=(v:Pick<VersionMeta,'title'|'version'>)=>`Change the "${v.title}" diagram (version ${v.version}): `;
export function fixCanvasPrompt(v:VersionMeta,code:'RENDER_FAILED'|'RENDER_TIMEOUT',diagnostic?:RenderDiagnostic){
 return code==='RENDER_TIMEOUT'?`Simplify the "${v.title}" diagram (version ${v.version}) so it can be shown here.`:`Fix the "${v.title}" diagram (version ${v.version}). The error was: ${renderDiagnosticCopy(diagnostic)}`;
}
export function canvasVersionTime(at:string,now=new Date()){
 const date=new Date(at),today=date.getFullYear()===now.getFullYear()&&date.getMonth()===now.getMonth()&&date.getDate()===now.getDate();
 const time=date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
 return today?time:`${date.toLocaleDateString('en-US',{month:'short',day:'numeric'})}, ${time}`;
}
export const canvasVersionByline=(note:string,name:string)=>[note.trim(),name.trim()].filter(Boolean).join(' · ');
export const CANVAS_EMPTY_PROMPT='Draw the permit steps for this job as a diagram.';
export const versionPath=(id:string,version:number)=>`/api/canvas/${encodeURIComponent(id)}/versions/${version}`;
export async function canvasFetch<T>(url:string,signal?:AbortSignal,init?:RequestInit):Promise<T>{
 const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...init,signal});
 const body=await response.json();
 if(!response.ok||body.ok===false)throw {code:response.status===401?'AUTH_REQUIRED':body.code??'INTERNAL_ERROR'};
 return body as T;
}

/** Attach committed run groups to replies; interleave orphan/human cards by server time. */
export function canvasTranscript<T extends {id:string;createdAt:string;role:string;runId?:string}>(messages:readonly T[],groups:readonly CanvasEvent[]) {
 const standalone=groups.filter(e=>!e.run_id||!messages.some(m=>m.role==='assistant'&&m.runId===e.run_id));
 const rows:Array<{kind:'message';at:string;id:string;message:T}|{kind:'canvas';at:string;id:string;event:CanvasEvent}>=[
  ...messages.map(message=>({kind:'message' as const,at:message.createdAt,id:message.id,message})),
  ...standalone.map(event=>({kind:'canvas' as const,at:event.at,id:event.id,event})),
 ];
 return rows.sort((a,b)=>(a.at??'').localeCompare(b.at??'')||(a.kind==='canvas'&&b.kind==='canvas'?(BigInt(a.id)<BigInt(b.id)?-1:1):0));
}

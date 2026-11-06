import 'server-only';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {canvasGet,canvasFailure,canvasStatus,canvasBody,canvasSameOrigin} from '@/lib/ask-canvases';
import {threadPrincipal} from '@/lib/thread-access';
import {pool} from '@/lib/db';
import {buildCanvasRendererDocument,canvasResponseHeaders,MERMAID_ASSET_PATH,MERMAID_ASSET_SHA256} from '@/lib/canvas-renderer.mjs';
import type {CanvasError,CanvasGetResponse} from '@/lib/canvas-api-types';
const error=(code:string)=>Object.assign(Error(code),{code});
// Public library bytes only. Private source, versions and responses are never cached.
let renderer:Promise<ReturnType<typeof buildCanvasRendererDocument>>|undefined;
export function rendererDocument(){return renderer??=readFile(path.join(process.cwd(),MERMAID_ASSET_PATH),'utf8').then(mermaidBundle=>buildCanvasRendererDocument({mermaidBundle,mermaidSha256:MERMAID_ASSET_SHA256})).catch(e=>{renderer=undefined;throw e;});}
export async function authorizeRenderer(){
 const person=await threadPrincipal();
 if(process.env.SJC_CANVAS_ENABLED!=='1')throw error('CANVAS_DISABLED');
 const rows=await pool.query("SELECT key,value FROM app_settings WHERE key=ANY($1)",[['canvas.diagrams_enabled','canvas.staff_enabled']]);
 const flags=Object.fromEntries(rows.rows.map(r=>[r.key,r.value===true||r.value==='true']));
 if(!flags['canvas.diagrams_enabled']||(person.role==='staff'&&!flags['canvas.staff_enabled']))throw error('CANVAS_DISABLED');
}
function routeFailure(e:unknown){
 const fixed=(e as {code?:string})?.code;
 if(fixed==='EXPORT_NOT_READY')return {ok:false,code:fixed,message:'Open this version to prepare the drawing.',retryable:true} satisfies CanvasError;
 return canvasFailure(e);
}
export async function canvasRoute(work:()=>Promise<Response>){
 try{return await work();}catch(e){const failure=routeFailure(e);return Response.json(failure,{status:failure.code==='EXPORT_NOT_READY'?409:canvasStatus(failure),headers:{...canvasResponseHeaders('api'),Vary:'Cookie, Authorization'}});}
}
export async function selectedCanvas(params:Promise<{id:string;version:string}>):Promise<CanvasGetResponse>{
 // Authenticate before input diagnostics. Backend repeats ownership, area, flags and recovery.
 await threadPrincipal();const {id,version}=await params;
 if(!/^[1-9][0-9]*$/.test(version)||!Number.isSafeInteger(Number(version)))throw error('INVALID_INPUT');
 return canvasGet(id,{version:Number(version),include_source:true});
}
export async function codeRoute(params:Promise<{id:string;version:string}>){return canvasRoute(async()=>{
 const data=await selectedCanvas(params);if(!data.code||!data.capabilities.code)throw error('CANVAS_DISABLED');
 return Response.json(data.code,{headers:{...canvasResponseHeaders('api'),Vary:'Cookie, Authorization'}});
});}
export async function previewRoute(params:Promise<{id:string;version:string}>){return canvasRoute(async()=>{
 await selectedCanvas(params);
 // Static pages are Phase 2. L1 always uses the source-free shared renderer route.
 throw error('UNSUPPORTED_KIND');
});}
export async function renderRoute(req:Request,params:Promise<{id:string;version:string}>){return canvasRoute(async()=>{
 canvasSameOrigin(req);const data=await selectedCanvas(params);
 if(!data.availability.exports)throw error('CANVAS_DISABLED');
 await canvasBody(req,524320);
 // 0108 owns immutable, quota-accounted derivatives. Never accept/store one early.
 throw error('CANVAS_DISABLED');
});}
export async function downloadRoute(req:Request,params:Promise<{id:string;version:string}>){return canvasRoute(async()=>{
 const data=await selectedCanvas(params),format=new URL(req.url).searchParams.get('format');
 if(format==='svg'){if(!data.availability.exports)throw error('CANVAS_DISABLED');throw error('EXPORT_NOT_READY');}
 if(format!=='mmd')throw error('INVALID_INPUT');
 if(!data.code||!data.availability.source||!data.capabilities.code)throw error('CANVAS_DISABLED');
 const title=data.selected.title.replace(/[^\p{L}\p{N} _-]/gu,'').trim().slice(0,80)||'Diagram';
 const filename=`${title} (v${data.selected.version}).mmd`;
 return new Response(data.code.code,{headers:{...canvasResponseHeaders('code'),'Content-Disposition':`attachment; filename="diagram-v${data.selected.version}.mmd"; filename*=UTF-8''${encodeURIComponent(filename)}`,Vary:'Cookie, Authorization'}});
});}

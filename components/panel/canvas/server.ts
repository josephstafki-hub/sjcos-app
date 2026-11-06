import 'server-only';
import {canvasRender,canvasDrawing,canvasPageFile} from '@/lib/canvas-exports';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {canvasPagePreview,canvasGet,canvasFailure,canvasStatus,canvasBody,canvasSameOrigin} from '@/lib/ask-canvases';
import {threadPrincipal} from '@/lib/thread-access';
import {pool} from '@/lib/db';
import {buildCanvasPageDocument,buildCanvasRendererDocument,canvasResponseHeaders,MERMAID_ASSET_PATH,MERMAID_ASSET_SHA256} from '@/lib/canvas-renderer.mjs';
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
export async function selectedCanvas(params:Promise<{id:string;version:string}>,include_source=true):Promise<CanvasGetResponse>{
 // Authenticate before input diagnostics. Backend repeats ownership, area, flags and recovery.
 await threadPrincipal();const {id,version}=await params;
 if(!/^[1-9][0-9]*$/.test(version)||!Number.isSafeInteger(Number(version)))throw error('INVALID_INPUT');
 return canvasGet(id,{version:Number(version),include_source});
}
export async function codeRoute(params:Promise<{id:string;version:string}>){return canvasRoute(async()=>{
 const data=await selectedCanvas(params);if(!data.code||!data.capabilities.code)throw error('CANVAS_DISABLED');
 return Response.json(data.code,{headers:{...canvasResponseHeaders('api'),Vary:'Cookie, Authorization'}});
});}
export async function previewRoute(params:Promise<{id:string;version:string}>){return canvasRoute(async()=>{
 const data=await selectedCanvas(params,false);
 if(data.canvas.kind!=='page')throw error('UNSUPPORTED_KIND');
 if(!data.availability.pages||!data.capabilities.preview)throw error('CANVAS_DISABLED');
 const page=await canvasPagePreview(data.canvas.id,data.selected.version);
 const doc=buildCanvasPageDocument(page.source);
 return new Response(doc.html,{headers:{...doc.headers,Vary:'Cookie, Authorization'}});
});}
export async function renderRoute(req:Request,params:Promise<{id:string;version:string}>){return canvasRoute(async()=>{
 canvasSameOrigin(req);const data=await selectedCanvas(params);
 if(!data.availability.exports)throw error('CANVAS_DISABLED');
 const input=await canvasBody(req,3145800);
 return Response.json(await canvasRender(data.canvas.id,data.selected.version,input),{headers:canvasResponseHeaders('api')});
});}
export async function downloadRoute(req:Request,params:Promise<{id:string;version:string}>){return canvasRoute(async()=>{
 const format=new URL(req.url).searchParams.get('format'),data=await selectedCanvas(params,format==='mmd'||format==='txt');
 if(format==='html'){if(data.canvas.kind!=='page')throw error('INVALID_INPUT');if(!data.availability.exports)throw error('CANVAS_DISABLED');const d=await canvasPageFile(data.canvas.id,data.selected.version);return new Response(d.html,{headers:{...canvasResponseHeaders('error'),'Content-Disposition':`attachment; filename="page-v${d.version}.html"`,Vary:'Cookie, Authorization'}});}
 if(format==='svg'){if(data.canvas.kind!=='diagram')throw error('INVALID_INPUT');if(!data.availability.exports)throw error('CANVAS_DISABLED');const d=await canvasDrawing(data.canvas.id,data.selected.version);return new Response(d.svg,{headers:{...canvasResponseHeaders('api'),'Content-Type':'image/svg+xml','Content-Disposition':`attachment; filename="drawing-v${d.version}.svg"; filename*=UTF-8''${encodeURIComponent(d.title.replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,80)+` (v${d.version}).svg`)}`}});}
 if(format!==(data.canvas.kind==='page'?'txt':'mmd'))throw error('INVALID_INPUT');
 if(!data.code||!data.availability.source||!data.capabilities.code)throw error('CANVAS_DISABLED');
 const extension=data.canvas.kind==='page'?'txt':'mmd';
 const title=data.selected.title.replace(/[^\p{L}\p{N} _-]/gu,'').trim().slice(0,80)||'Diagram';
 const filename=`${title} (v${data.selected.version}).${extension}`;
 return new Response(data.code.code,{headers:{...canvasResponseHeaders('code'),'Content-Disposition':`attachment; filename="${data.canvas.kind==='page'?'page':'diagram'}-v${data.selected.version}.${extension}"; filename*=UTF-8''${encodeURIComponent(filename)}`,Vary:'Cookie, Authorization'}});
});}

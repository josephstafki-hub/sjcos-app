'use client';
import type {Availability,CanvasCodeResponse,CanvasEvent,CanvasGetResponse,CanvasListResponse} from '@/lib/canvas-api-types';
import {getAskPaneFeed,publishAskPaneSnapshots,recalledAskPane,selectAskPane,type AskPaneScope} from '../askPaneRegistry';
import {canvasFetch,versionPath} from './state';
export type CanvasView={data?:CanvasGetResponse;code?:CanvasCodeResponse;error?:string;renderError?:'RENDER_FAILED'|'RENDER_TIMEOUT'|'LOAD_TIMEOUT';ready?:boolean;exportReady?:boolean;loading?:boolean;tab?:'preview'|'code';sheet?:'menu'|'code'|'about'|'versions'|'picker'|'delete'|'restore';notice?:string};
export type CanvasState={scope:AskPaneScope|null;items:CanvasListResponse['canvases'];events:CanvasEvent[];availability?:Availability;views:Record<string,CanvasView>;selection:Record<string,{version:number;follow:boolean}>;openCanvas?:((id:string,version:number)=>void)|null;updating?:boolean;prefill:((text:string,id?:string,version?:number)=>void)|null};
const listeners=new Set<()=>void>();
const empty:CanvasState={scope:null,items:[],events:[],views:{},selection:{},prefill:null};
let state=empty;
export const canvasState=()=>state;
export const canvasServerState=()=>empty;
export const subscribeCanvas=(fn:()=>void)=>{listeners.add(fn);return ()=>{listeners.delete(fn);};};
export function updateCanvas(next:Partial<CanvasState>){state={...state,...next};listeners.forEach(f=>f());}
export function clearCanvas(){state={...empty};listeners.forEach(f=>f());}
export function patchCanvas(id:string,patch:Partial<CanvasView>){updateCanvas({views:{...state.views,[id]:{...state.views[id],...patch}}});}
export function publishCanvases(canFollow=false){
 const {scope,items,selection}=state;if(!scope)return;
 const existing=getAskPaneFeed().snapshots.filter(x=>x.kind!=='canvas');
 const snapshots=items.map(({canvas,latest})=>{const s=selection[canvas.id];return {kind:'canvas' as const,id:canvas.id,thread_id:canvas.thread_id,user_id:canvas.user_id,run_id:latest.run_id,label:latest.title,attention:'new' as const,revision:`${state.availability?.revision}:${canvas.latest_version}`,selected_version:s?.follow===false?s.version:canvas.latest_version,latest_version:canvas.latest_version,followLatest:s?.follow!==false};});
 // Empty is an authorized thread view, never a committed canvas or card.
 const last=recalledAskPane(scope);if(last?.kind==='canvas'){const index=snapshots.findIndex(x=>x.id===last.id);if(index>0)snapshots.unshift(...snapshots.splice(index,1));}
 if(!items.length&&state.availability?.master)snapshots.push({kind:'canvas',id:'empty',thread_id:scope.threadId,user_id:scope.userId,run_id:null,label:'Canvas',attention:'new',revision:'empty',selected_version:0,latest_version:0,followLatest:true});
 publishAskPaneSnapshots(scope,[...existing,...snapshots],canFollow&&items.length>0);
}
export function chooseCanvas(id:string,version:number,opener:HTMLElement|null=null){
 const {scope}=state;if(!scope)return;
 if(state.openCanvas){state.openCanvas(id,version);return;}
 const latest=state.items.find(x=>x.canvas.id===id)?.canvas.latest_version??version;
 updateCanvas({selection:{...state.selection,[id]:{version,follow:version===latest}}});
 patchCanvas(id,{sheet:undefined});publishCanvases();selectAskPane(scope,{kind:'canvas',id},opener);
}
export function selectCanvasVersion(id:string,version:number){
 const latest=state.items.find(x=>x.canvas.id===id)?.canvas.latest_version??version;
 updateCanvas({selection:{...state.selection,[id]:{version,follow:version===latest}}});publishCanvases();
}
export function applyCanvasList(list:CanvasListResponse){
 const recalled=state.scope?recalledAskPane(state.scope):null;
 let selection=state.selection;
 if(recalled?.kind==='canvas'&&recalled.selected_version&&!selection[recalled.id])selection={...selection,[recalled.id]:{version:recalled.selected_version,follow:recalled.followLatest!==false}};
 updateCanvas({items:list.availability.master?list.canvases:[],availability:list.availability,selection,views:list.availability.master?state.views:{}});
}
const inflight=new Map<string,Promise<void>>(),requests=new Map<string,AbortController>();
export async function loadCanvas(id:string,version:number,signal:AbortSignal,force=false){
 if(id==='empty'||signal.aborted)return;
 const scope=state.scope,key=`${scope?.claimToken}:${id}:${version}`;
 if(inflight.has(key)&&!force)return inflight.get(key);
 requests.get(key)?.abort();const controller=new AbortController();requests.set(key,controller);
 const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
 patchCanvas(id,{loading:true,error:undefined,notice:undefined,data:undefined,code:undefined,ready:false,exportReady:false,renderError:undefined});
 const deadline=setTimeout(()=>{if(!controller.signal.aborted&&state.scope===scope)patchCanvas(id,{notice:'This is taking a while.'});},10000);
 const work=(async()=>{try{
  const data=await canvasFetch<CanvasGetResponse>(`/api/canvas/${id}?version=${version}`,controller.signal);
  const code=data.capabilities.code?await canvasFetch<CanvasCodeResponse>(versionPath(id,version)+'/code',controller.signal):undefined;
  if(controller.signal.aborted||state.scope!==scope)return;
  patchCanvas(id,{data,code,loading:false});
 }catch(e){if(!controller.signal.aborted&&state.scope===scope)patchCanvas(id,{loading:false,error:(e as {code?:string}).code??'INTERNAL_ERROR',data:undefined,code:undefined});}finally{clearTimeout(deadline);signal.removeEventListener('abort',abort);if(requests.get(key)===controller){inflight.delete(key);requests.delete(key);}}})();inflight.set(key,work);return work;
}
export function askCanvasChange(id:string,text?:string){const v=state.views[id]?.data?.selected;if(!v)return;state.prefill?.(text??`Change the "${v.title}" diagram (version ${v.version}): `,id,v.version);}

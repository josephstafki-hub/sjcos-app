'use client';
// The only Browser UI module aware of website routes. No credentials are persisted.
import {TaskUI,ReviewNotice,OwnerBrowserReviewClaim,validateEvent,ManualInput} from '../../../lib/browser/phase1-contracts.mjs';
import {BROWSER_API as root,BROWSER_HEADERS} from '../../../lib/browser/web-types';
import type {NavigationBinding} from './navigation';
import type * as Web from '../../../lib/browser/web-types';
import type {TaskUI as Task,ReviewNotice as Review,OwnerBrowserReviewClaim as OwnerClaim,BrowserStatus,BrowserJoin,BrowserAvailability,BrowserResponse,ControlMessage,ManualInput as Input} from '../../../lib/browser/web-types';
export type {Task,Review,OwnerClaim};
export type Viewer=Pick<BrowserJoin,'viewer_id'|'device_secret'|'expires_at'|'owner_review_claim'>;
export type Detail=BrowserStatus;
export type Reads=Web.BrowserReads;
export type Settings=Web.BrowserSettings;
let csrf:{token:string;expires:number}|null=null;
export class BrowserAPIError extends Error {constructor(public code:string){super(code);}}
const viewerHeaders=(v?:Viewer)=>v?{[BROWSER_HEADERS.viewer]:v.viewer_id,[BROWSER_HEADERS.device]:v.device_secret,...(v.owner_review_claim?{[BROWSER_HEADERS.claim]:v.owner_review_claim.claim_id}:{})}:{};
async function request<T>(path:string,body?:unknown,viewer?:Viewer,signal?:AbortSignal):Promise<T> {
 if(body!==undefined&&(!csrf||csrf.expires<=Date.now()+5000)) {const r=await fetch(root+'/csrf',{credentials:'same-origin',cache:'no-store',signal});const j=await r.json();if(!r.ok||!j.ok)throw new BrowserAPIError(j.code??'BROWSER_AUTH_EXPIRED');csrf={token:j.csrf_token,expires:Date.parse(j.expires_at)};}
 const r=await fetch(root+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal,headers:{...viewerHeaders(viewer),...(body===undefined?{}:{'Content-Type':'application/json',[BROWSER_HEADERS.csrf]:csrf!.token})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const j:BrowserResponse<T>=await r.json();if(!r.ok||j.ok!==true)throw new BrowserAPIError(j.ok===false?j.code:'BROWSER_SERVICE_UNAVAILABLE');return j as T;
}
const paged=(path:string,cursor?:string,extra:Record<string,string>={})=>path+'?'+new URLSearchParams({...extra,limit:'20',...(cursor?{cursor}:{})});
const I=()=>({idempotency_key:crypto.randomUUID()});const taskPath=(id:string)=>'/tasks/'+encodeURIComponent(id);const sessionPath=(id:string)=>'/sessions/'+encodeURIComponent(id);
export const browserAPI={
 availability:(signal?:AbortSignal)=>request<BrowserAvailability>('/availability',undefined,undefined,signal),
 tasks:async(conversation:string,signal?:AbortSignal)=>{const page=await collectBrowserPages(cursor=>request<Web.BrowserTasks>(paged('/tasks',cursor,{conversation_id:conversation}),undefined,undefined,signal),'items',signal);return {...page,tasks:page.items.map(x=>x.task),snapshots:page.items.map(x=>x.snapshot)};},
 inUse:(signal?:AbortSignal)=>collectBrowserPages(cursor=>request<Web.BrowserInUse>(paged('/in-use',cursor),undefined,undefined,signal),'items',signal),
 create:(body:Omit<Web.BrowserCreateRequest,'idempotency_key'>,signal?:AbortSignal)=>request<Web.BrowserTaskResult>('/tasks',{...body,...I()},undefined,signal),
 detail:async(id:string,v?:Viewer,signal?:AbortSignal)=>{const d=await request<Detail>(taskPath(id),undefined,v,signal);TaskUI.parse(d.task);if(d.pending_action)ReviewNotice.parse(d.pending_action);return d;},
 decline:(id:string,v:Viewer)=>request<Web.BrowserTaskResult>(taskPath(id)+'/decline',I(),v),
 start:(id:string,v?:Viewer)=>request<Web.BrowserStart>(taskPath(id)+'/start',I(),v),
 join:async(id:string,body:Omit<Web.BrowserJoinRequest,'idempotency_key'>,v?:Viewer,signal?:AbortSignal,joinKey?:string)=>{const d=await request<BrowserJoin>(taskPath(id)+'/join',{...body,idempotency_key:joinKey??crypto.randomUUID()},v,signal);TaskUI.parse(d.task);if(d.owner_review_claim)OwnerBrowserReviewClaim.parse(d.owner_review_claim);return d;},
 leave:(id:string,v:Viewer)=>request(taskPath(id)+'/leave',{viewer_id:v.viewer_id,device_secret:v.device_secret,...I()},v),
 closeStream:async(id:string,v:Viewer,binding:Pick<Web.Frame,'stream_id'|'stream_generation'>)=>{const r=await request<Web.BrowserStreamClose>(sessionPath(id)+'/stream-close',{viewer_id:v.viewer_id,device_secret:v.device_secret,...binding,...I()},v);if(r.closed!==true||r.planned!==true||r.stream_id!==binding.stream_id||r.stream_generation!==binding.stream_generation)throw new BrowserAPIError('BROWSER_STREAM_STALE');return r;},
 presence:(id:string,v:Viewer,body:Omit<Web.BrowserPresenceRequest,'viewer_id'|'device_secret'|'idempotency_key'>)=>request<Web.BrowserPresence>(sessionPath(id)+'/presence',{...body,viewer_id:v.viewer_id,device_secret:v.device_secret,...I()},v),
 control:(id:string,v:Viewer,action:ControlMessage['action'],epoch:number,navigation?:NavigationBinding)=>request<Web.BrowserControl>(sessionPath(id)+'/control',{action,viewer_id:v.viewer_id,device_secret:v.device_secret,expected_epoch:epoch,...navigation,...(['take_over','fresh_browser'].includes(action)?{confirmed:true}:{}),...I()},v),
 sites:(id:string,v:Viewer,origin:string,role:Web.BrowserCreateRequest['origins'][number]['role'],revision:number,proposal?:Web.ReadProposal)=>request<Web.BrowserTaskResult>(taskPath(id)+'/sites',{origin,role,expected_revision:revision,...(proposal?{proposal}:{}),...I()},v),
 reads:async(id:string,v?:Viewer,cursor?:string)=>{const page=await request<Reads>(paged(taskPath(id)+'/reads',cursor),undefined,v);return {...page,entries:page.items.flatMap(x=>x.kind==='entry'?[x.entry]:[]),candidates:page.items.flatMap(x=>x.kind==='candidate'?[x.candidate]:[])};},
 decideRead:(id:string,v:Viewer,revision:number,entries:Web.ReadProposal['entries'],decision:'approve'|'deny')=>request(taskPath(id)+'/reads',{expected_revision:revision,proposal:{v:1,entries},decision,...I()},v),
 answers:async(id:string,v:Viewer)=>{const page=await collectBrowserPages(cursor=>request<Web.BrowserAnswers>(paged(taskPath(id)+'/answers',cursor),undefined,v),'items');return {...page,answers:page.items};},
 decideAnswers:(id:string,v:Viewer,body:Omit<Web.BrowserAnswersRequest,'idempotency_key'>)=>request(taskPath(id)+'/answers',{...body,...I()},v),
 action:(id:string,v?:Viewer)=>request<Web.BrowserReview>('/actions/'+encodeURIComponent(id),undefined,v),
 closeNotice:(id:string,v:Viewer,revision:number)=>request('/actions/'+encodeURIComponent(id)+'/decision',{decision:'deny',expected_revision:revision,...I()},v),
 input:(id:string,v:Viewer,body:Input)=>request<unknown>(sessionPath(id)+'/private-input',ManualInput.parse(body),v),
 settings:()=>request<Settings>('/settings'),saveSettings:(body:Omit<Web.BrowserSettingsRequest,'idempotency_key'>)=>request<Settings>('/settings',{...body,...I()}),
 async events(id:string,v:Viewer,signal:AbortSignal,onEvent:(name:string,data:unknown)=>void) {
  const response=await fetch(root+sessionPath(id)+'/events',{credentials:'same-origin',cache:'no-store',headers:viewerHeaders(v),signal});
  if(!response.ok){const error=await response.json().catch(()=>null);throw new BrowserAPIError(error?.code??'BROWSER_STREAM_STALE');}if(!response.body)throw new BrowserAPIError('BROWSER_STREAM_STALE');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  try {while(!signal.aborted){const {done,value}=await reader.read();if(done)break;buffer=(buffer+decoder.decode(value,{stream:true})).replaceAll('\r\n','\n');if(buffer.length>350000)throw new BrowserAPIError('BROWSER_FRAME_TOO_LARGE');let end;while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const name=block.split('\n').find(x=>x.startsWith('event:'))?.slice(6).trim();const data=block.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');if(name&&data)onEvent(name,validateEvent(name,JSON.parse(data)));}}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
};

/** Build a complete metadata projection before publishing it. A changed revision,
 * repeated cursor, abort or stale reply discards every page collected so far. */
export async function collectBrowserPages<T extends {revision:number;next_cursor?:string|null;items:unknown[]}>(load:(cursor?:string,revision?:number)=>Promise<T>,key:'items',signal?:AbortSignal):Promise<T> {
 let cursor:string|undefined,revision:number|undefined,first:T|undefined;const rows:unknown[]=[],seen=new Set<string>();
 do {
  signal?.throwIfAborted();const page=await load(cursor,revision);signal?.throwIfAborted();
  if(revision!==undefined&&page.revision!==revision)throw new BrowserAPIError('BROWSER_REVIEW_STALE');
  first??=page;revision=page.revision;const items=page[key];if(!Array.isArray(items))throw new BrowserAPIError('BROWSER_BAD_INPUT');if(items.length>20||rows.length+items.length>512)throw new BrowserAPIError('BROWSER_SERVICE_UNAVAILABLE');rows.push(...items);
  cursor=page.next_cursor??undefined;
  if(cursor){if(seen.has(cursor)||seen.size>=100)throw new BrowserAPIError('BROWSER_REVIEW_STALE');seen.add(cursor);}
 }while(cursor);
 return {...first!,[key]:rows,next_cursor:null};
}

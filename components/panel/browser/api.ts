'use client';
// The only Browser UI module aware of website routes. No credentials are persisted.
import {TaskUI,ReviewNotice,OwnerBrowserReviewClaim,validateEvent,ManualInput} from '../../../lib/browser/phase1-contracts.mjs';
import type {z} from 'zod';
export type Task=z.infer<typeof TaskUI>;
export type Review=z.infer<typeof ReviewNotice>;
export type OwnerClaim=z.infer<typeof OwnerBrowserReviewClaim>;
export type Viewer={viewer_id:string;device_secret:string;expires_at:string;owner_review_claim?:OwnerClaim};
export type Detail={task:Task;revision:number;context_generation:number;available_controls:string[];pending_action:Review|null;queue_position:number|null;server_time:string};
export type Reads={revision:number;expires_at:string|null;entries:{canonical_url:string}[];candidates:{url?:string;canonical_url?:string;role:'document'|'resource';source:'person'|'agent'|'page'}[];server_time:string};
export type Settings={flags:Record<string,boolean>;pilot_user_ids:string[];takeover_confirm_suppressed_user_ids:string[];revision:number};
const root='/api/agent-browser';
let csrf:{token:string;expires:number}|null=null;
export class BrowserAPIError extends Error {constructor(public code:string){super(code);}}
const viewerHeaders=(v?:Viewer)=>v?{'X-SJC-Browser-Viewer':v.viewer_id,'X-SJC-Browser-Device':v.device_secret,...(v.owner_review_claim?{'X-SJC-Browser-Claim':v.owner_review_claim.claim_id}:{})}:{};
async function request<T>(path:string,body?:unknown,viewer?:Viewer,signal?:AbortSignal):Promise<T> {
 if(body!==undefined&&(!csrf||csrf.expires<=Date.now()+5000)) {const r=await fetch(root+'/csrf',{credentials:'same-origin',cache:'no-store',signal});const j=await r.json();if(!r.ok||!j.ok)throw new BrowserAPIError(j.code??'BROWSER_AUTH_EXPIRED');csrf={token:j.csrf_token,expires:Date.parse(j.expires_at)};}
 const r=await fetch(root+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal,headers:{...viewerHeaders(viewer),...(body===undefined?{}:{'Content-Type':'application/json','X-SJC-CSRF':csrf!.token})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const j=await r.json();if(!r.ok||j.ok!==true)throw new BrowserAPIError(j.code??'BROWSER_SERVICE_UNAVAILABLE');return j;
}
const I=()=>({idempotency_key:crypto.randomUUID()});const taskPath=(id:string)=>'/tasks/'+encodeURIComponent(id);const sessionPath=(id:string)=>'/sessions/'+encodeURIComponent(id);
export const browserAPI={
 availability:(signal?:AbortSignal)=>request<{enabled:boolean;staff_enabled:boolean;can_start:boolean;reason_code:string|null;revision:number}>('/availability',undefined,undefined,signal),
 tasks:(conversation:string,signal?:AbortSignal)=>request<{tasks:Task[];snapshots:import('../askPaneLayout').PaneSnapshot[];revision:number}>('/tasks?conversation_id='+encodeURIComponent(conversation),undefined,undefined,signal),
 inUse:(signal?:AbortSignal)=>request<{items:NonNullable<import('./model').BrowserModel['inUse']>}>('/in-use',undefined,undefined,signal),
 create:(body:Record<string,unknown>,signal?:AbortSignal)=>request<{task:Task;revision:number;context_generation:number}>('/tasks',{...body,...I()},undefined,signal),
 detail:async(id:string,v?:Viewer,signal?:AbortSignal)=>{const d=await request<Detail>(taskPath(id),undefined,v,signal);TaskUI.parse(d.task);if(d.pending_action)ReviewNotice.parse(d.pending_action);return d;},
 start:(id:string,v?:Viewer)=>request<{task:Task;revision:number}>(taskPath(id)+'/start',I(),v),
 join:async(id:string,body:{mode:'initiator'|'owner_review';local_thread_id?:string;private_view?:boolean;action_id?:string},v?:Viewer,signal?:AbortSignal)=>{const d=await request<Viewer & Detail>(taskPath(id)+'/join',{...body,...I()},v,signal);TaskUI.parse(d.task);if(d.owner_review_claim)OwnerBrowserReviewClaim.parse(d.owner_review_claim);return d;},
 leave:(id:string,v:Viewer)=>request(taskPath(id)+'/leave',{viewer_id:v.viewer_id,device_secret:v.device_secret,...I()},v),
 presence:(id:string,v:Viewer,body:{visible:boolean;host_context:{kind:'initiator';conversation_id:string}|{kind:'owner_review';claim_id:string};expected_epoch:number})=>request(sessionPath(id)+'/presence',{...body,viewer_id:v.viewer_id,device_secret:v.device_secret,...I()},v),
 control:(id:string,v:Viewer,action:string,epoch:number)=>request<{task:Task;revision:number;control_token?:string;expires_at?:string}>(sessionPath(id)+'/control',{action,viewer_id:v.viewer_id,device_secret:v.device_secret,expected_epoch:epoch,...(['take_over','fresh_browser'].includes(action)?{confirmed:true}:{}),...I()},v),
 sites:(id:string,v:Viewer,origin:string,role:string,revision:number)=>request(taskPath(id)+'/sites',{origin,role,expected_revision:revision,...I()},v),
 reads:(id:string,v?:Viewer)=>request<Reads>(taskPath(id)+'/reads',undefined,v),
 decideRead:(id:string,v:Viewer,revision:number,entries:unknown[],decision:'approve'|'deny')=>request(taskPath(id)+'/reads',{expected_revision:revision,proposal:{v:1,entries},decision,...I()},v),
 answers:(id:string,v:Viewer)=>request<{revision:number;answers:NonNullable<import('./model').BrowserModel['answers']>}>(taskPath(id)+'/answers',undefined,v),
 decideAnswers:(id:string,v:Viewer,body:Record<string,unknown>)=>request(taskPath(id)+'/answers',{...body,...I()},v),
 action:(id:string,v?:Viewer)=>request<{review:Review;task_id:string;revision:number;outcome_code:string;server_deadline:string|null}>('/actions/'+encodeURIComponent(id),undefined,v),
 closeNotice:(id:string,v:Viewer,revision:number)=>request('/actions/'+encodeURIComponent(id)+'/decision',{decision:'deny',expected_revision:revision,...I()},v),
 input:(id:string,v:Viewer,body:unknown)=>request<{accepted_seq:number}>(sessionPath(id)+'/private-input',ManualInput.parse(body),v),
 settings:()=>request<Settings>('/settings'),saveSettings:(body:Record<string,unknown>)=>request<Settings>('/settings',{...body,...I()}),
 async events(id:string,v:Viewer,signal:AbortSignal,onEvent:(name:string,data:unknown)=>void) {
  const response=await fetch(root+sessionPath(id)+'/events',{credentials:'same-origin',cache:'no-store',headers:viewerHeaders(v),signal});
  if(!response.ok||!response.body)throw new BrowserAPIError('BROWSER_STREAM_STALE');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  try {while(!signal.aborted){const {done,value}=await reader.read();if(done)break;buffer=(buffer+decoder.decode(value,{stream:true})).replaceAll('\r\n','\n');if(buffer.length>350000)throw new BrowserAPIError('BROWSER_FRAME_TOO_LARGE');let end;while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const name=block.split('\n').find(x=>x.startsWith('event:'))?.slice(6).trim();const data=block.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');if(name&&data)onEvent(name,validateEvent(name,JSON.parse(data)));}}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
};

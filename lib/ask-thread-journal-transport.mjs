// Construction-time stdio bridge. Never constructed from tool args/headers.
import {randomUUID} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createInteractionAdapter({transportKind,env=process.env,config=key=>env[key],httpActive=()=>false}={}){
 const context=Object.freeze({transport:'runner_stdio',run_id:env.SJC_RUN_ID,conversation_id:env.SJC_CONVERSATION_ID,principal_user_id:env.SJC_PRINCIPAL_USER_ID,run_profile:env.SJC_RUN_PROFILE,run_started_s:Number(env.SJC_RUN_STARTED_S)});
 const allowed=transportKind==='stdio'&&[context.run_id,context.conversation_id,context.principal_user_id].every(v=>typeof v==='string'&&uuid.test(v))&&['operator','business'].includes(context.run_profile)&&Number.isSafeInteger(context.run_started_s)&&context.run_started_s>0;
 const ids=new Set(),send=globalThis.fetch;
 async function call(action,input){
  // HTTP ALS is a backstop even if a server was misconstructed as stdio.
  if(!allowed||httpActive())throw Error('RUN_CONTEXT_REQUIRED');
  const secret=config('CRON_SECRET');if(!secret)throw Error('RUN_CONTEXT_REQUIRED');
  const base=new URL(config('APP_INTERNAL_URL')||'http://127.0.0.1:3017');
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('RUN_CONTEXT_REQUIRED');
  const res=await send(new URL('/api/internal/ask-interactions',base),{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json',authorization:`Bearer ${secret}`},body:JSON.stringify({action,input,context})});
  if(!res.ok)throw Error('RUN_CONTEXT_REQUIRED');
  const result=await res.json();if(!result.ok)throw Error('RUN_CONTEXT_REQUIRED');return result;
 }
 return Object.freeze({
  async create(kind,payload){const id=randomUUID();const r=await call('create',{id,kind,payload});if(r.id!==id)throw Error('RUN_CONTEXT_REQUIRED');ids.add(id);return id;},
  async poll(id){if(!ids.has(id))throw Error('RUN_CONTEXT_REQUIRED');return (await call('poll',{id})).interaction;},
  async expire(id){if(!ids.has(id))throw Error('RUN_CONTEXT_REQUIRED');await call('expire',{id});},
  // Phase 1 seam: before any answer/dismissal/timeout text reaches a model,
  // the provenance adapter will durably ingest the exact result. Phase 0
  // performs only current run/thread authorization here; no completeness claim.
  async beforeDeliver(id){if(!ids.has(id))throw Error('RUN_CONTEXT_REQUIRED');await call('poll',{id});},
 });
}

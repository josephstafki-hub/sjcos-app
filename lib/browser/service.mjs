/** Production lifecycle manager. No I/O at import; no fixture authority, default
 * context, saved state, arbitrary CDP method, or automatic command replay.
 * io is installation-owned, never derived from RPC JSON. */
import {randomUUID} from 'node:crypto';
import {UUID,TaskSafe} from './phase1-contracts.mjs';
import {createPublicOutputFence} from './privacy.mjs';
import {createObservationRegistry,observePublic} from './public-observation.mjs';
import {withDeadline,reviewActivityDeadline} from './timers.mjs';
import {pageMetadata} from './controller-rpc.mjs';
export async function phase1Hooks(){
 const [privacy,input,observation,read,submit]=await Promise.all([import('./privacy.mjs'),import('./privacy.mjs'),import('./public-observation.mjs'),import('./read-authority.mjs'),import('./submit-guard.mjs')]);
 return {enterPrivate:privacy.enterPrivate,authorizeManualInput:input.authorizeManualInput,sanitizePublicObservation:observation.sanitizePublicObservation,prepareReadDispatch:read.prepareReadDispatch,submitGuard:submit.submitGuard};
}
export class BrowserService{
 constructor({io,clock=Date.now,uid=process.getuid()}){
  if(!Number.isSafeInteger(uid)||uid<=0||!io)throw Error('BROWSER_FORBIDDEN');
  this.io=io;this.clock=clock;this.contexts=new Map();this.browser=null;this.starting=null;this.ready=false;this.emptySince=clock();this.opening=Promise.resolve();this.cancelledOpens=new Set();
 }
 async start(){if(this.ready)return;await this.io.reconcile();await this.io.audit({event:'controller_boot'});this.ready=true;}
 live(id,generation){const r=this.contexts.get(id);if(!r||r.fenced||r.task.context_generation!==generation)throw Error('BROWSER_REVOKED');return r;}
 async open(task){
  // Serialize first and second context creation, including asynchronous newContext.
  const prior=this.opening;let release;this.opening=new Promise(r=>release=r);await prior;
  try{
   UUID.parse(task.id);UUID.parse(task.person_id);
   if(!this.ready||!['active','starting'].includes(task.state)||!Number.isSafeInteger(task.context_generation)||task.context_generation<1)throw Error('BROWSER_REVOKED');
   if(this.contexts.size>=2||[...this.contexts.values()].some(x=>x.task.person_id===task.person_id))throw Error('BROWSER_BUSY');
   if(await this.io.authorize(task)!==true)throw Error('BROWSER_FORBIDDEN');
   if(!this.browser)this.browser=await this.io.browser();
   if(!this.ready||await this.io.authorize(task)!==true)throw Error('BROWSER_REVOKED');
   const context=await this.browser.newContext({acceptDownloads:false,serviceWorkers:'block',viewport:{width:1280,height:800}});
   if(!this.ready||this.cancelledOpens.has(task.id)||await this.io.authorize(task)!==true){await context.close();throw Error('BROWSER_REVOKED');}
   const record={outputFence:createPublicOutputFence({contextGeneration:task.context_generation}),registry:createObservationRegistry(),observations:new Set(),reads:new Set(),commandsFenced:false,task:{...task},context,tabs:new Set(),fenced:false,lastProgress:this.clock(),presentUntil:task.present_until,warning:false,lock:Promise.resolve(),started:this.clock(),seen:new Map()};
   if(task.private)record.outputFence.fence();this.contexts.set(task.id,record);return {context_id:context.id??null,context_generation:task.context_generation};
  }finally{release();}
 }
 trackTab(id,target){const r=this.contexts.get(id);if(!r||r.fenced||typeof target!=='string'||r.tabs.has(target)||r.tabs.size>=2||[...this.contexts.values()].reduce((n,x)=>n+x.tabs.size,0)>=4)throw Error('BROWSER_RESOURCE_LIMIT');r.tabs.add(target);}
 closeTab(id,target){this.contexts.get(id)?.tabs.delete(target);}
 async locked(id,fn,allowFenced=false){const r=this.contexts.get(id);if(!r||r.fenced&&!allowFenced)throw Error('BROWSER_REVOKED');const prior=r.lock;let release;r.lock=new Promise(x=>release=x);await prior;try{if(!allowFenced)this.live(id,r.task.context_generation);return await fn(r);}finally{release();}}
 /** This adapter is constructed UNDER locked(); D must not reacquire it. */
 async privacyIO(r){
  const supplied=await this.io.privacyIO?.(r)??{};
  const call=(name,...args)=>{const fn=supplied[name];if(fn)return fn(...args);if(typeof this.io[name]!=='function')throw Error('BROWSER_PRIVATE_INPUT_REQUIRED');return this.io[name](r,...args);};
  return {...supplied,outputFence:r.outputFence,
   fenceCommands:()=>{r.commandsFenced=true;return true;},
   withContextLock:async(id,fn)=>{if(id!==r.task.id)throw Error('BROWSER_REVOKED');return fn();},
   readTask:async()=>TaskSafe.parse(await (supplied.readTask?.()??this.io.readTask?.(r)??Object.fromEntries(Object.keys(TaskSafe.shape).map(k=>[k,r.task[k]])))),
   cancelAndDrainCommands:()=>{for(const c of r.reads)c.abort();return call('cancelAndDrainCommands');},
   cancelObservations:async()=>{for(const c of r.reads)c.abort();for(const c of r.observations)c.abort();r.registry.clear();return call('cancelObservations');},
   stopAndAckScreencast:()=>call('stopAndAckScreencast'),drainPublicOutputs:()=>call('drainPublicOutputs'),
   persistPrivate:async args=>{const saved=await call('persistPrivate',args);Object.assign(r.task,saved);return saved;},
   rotatePrivateHandles:saved=>call('rotatePrivateHandles',saved),ackPrivate:binding=>call('ackPrivate',binding),
   pauseAfterFailure:async()=>{r.commandsFenced=true;r.outputFence.fence();await this.pause(r,'BROWSER_PRIVATE_INPUT_REQUIRED');},
  };
 }
 async privateBarrier(r){
  if(r.privateBarrier?.drained===true&&r.task.private&&!r.outputFence.isOpen())return r.privateBarrier;
  r.outputFence.fence();r.commandsFenced=true;
  const ack=await this.io.hooks.enterPrivate({taskId:r.task.id,bootId:r.task.controller_boot_id,expectedEpoch:r.task.control_epoch,contextGeneration:r.task.context_generation,reason:'manual',io:await this.privacyIO(r)});
  if(ack?.drained!==true||ack.privacy_mode!=='private')throw Error('BROWSER_PRIVATE_INPUT_REQUIRED');
  r.outputFence.fence();r.commandsFenced=true;r.registry.clear();r.privateBarrier=ack;
  Object.assign(r.task,{state:'paused',private:true,privacy_mode:'private',...(Number.isSafeInteger(ack.control_epoch)?{control_epoch:ack.control_epoch}:{})});return ack;
 }
 async takeOver(id,proof){return this.locked(id,async r=>{
  if(await this.io.authorizeHuman?.(r,proof)!==true)throw Error('BROWSER_FORBIDDEN');
  const g=r.task.context_generation;await this.privateBarrier(r);this.live(id,g);
  if(await this.io.authorizeHuman(r,proof)!==true)throw Error('BROWSER_FORBIDDEN');
  return r.privateBarrier; // website grants control ONLY after this ACK
 });}
 async manualInput(id,proof){return this.locked(id,async r=>{
  const generation=r.task.context_generation;
  // Private model capabilities are revoked. Human input uses fresh website proof.
  const authorize=this.io.authorizeHuman?()=>this.io.authorizeHuman(r,proof):()=>r.task.private?false:this.io.authorize(r.task,proof);
  if(await authorize()!==true)throw Error('BROWSER_FORBIDDEN');this.live(id,generation);
  await this.privateBarrier(r);this.live(id,generation);
  // Website takeover increments epoch again after the privacy ACK. Never use
  // the barrier's older epoch to authorize a subsequently granted human input.
  if(this.io.readTask)Object.assign(r.task,TaskSafe.parse(await this.io.readTask(r)));this.live(id,generation);
  const resolved=await this.io.resolveInput?.(r,proof)??proof;this.live(id,generation);
  const allowed=await this.io.hooks.authorizeManualInput({...resolved,task:r.task,now:this.clock()});this.live(id,generation);
  if(allowed?.allowed!==true)throw Error('BROWSER_CONTROL_EXPIRED');
  await this.io.deliverInput(r,resolved);this.live(id,generation);r.lastProgress=this.clock();return {ok:true};
 });}
 async read(id,fn){
  const r=this.contexts.get(id);if(!r||r.commandsFenced||r.fenced)throw Error('BROWSER_REVOKED');
  const g=r.task.context_generation,c=new AbortController();r.reads.add(c);
  try{const value=await withDeadline(signal=>fn(signal),{ms:30000,signal:c.signal,onTimeout:()=>this.pause(r,'BROWSER_TIMEOUT')});this.live(id,g);if(r.commandsFenced)throw Error('BROWSER_REVOKED');return value;}
  finally{r.reads.delete(c);}
 }
 async observe(id,raw){
  const r=this.contexts.get(id);if(!r)throw Error('BROWSER_REVOKED');
  const generation=r.task.context_generation,cancel=new AbortController();r.observations.add(cancel);
  try{return await observePublic({readTask:async()=>this.live(id,generation).task,
   capture:()=>withDeadline(signal=>raw(signal),{ms:30000,signal:cancel.signal,onTimeout:()=>this.pause(r,'BROWSER_TIMEOUT')}),
   outputFence:r.outputFence,registry:r.registry,emit:()=>{},now:this.clock});}
  finally{r.observations.delete(cancel);}
 }
 observation(id,observationId,ref){const r=this.contexts.get(id);if(!r)throw Error('BROWSER_OBSERVATION_STALE');return r.registry.resolve({observationId,ref,task:r.task,now:this.clock()});}
 modelTicket(id){return this.contexts.get(id)?.outputFence.ticket();}
 publishModel(id,ticket,value){const r=this.contexts.get(id);let result;
  if(!r||!r.outputFence.publish({ticket,task:r.task,sink:'model',value,emit:x=>{result=x;}}))throw Error('BROWSER_PRIVATE_INPUT_REQUIRED');return result;
 }
 projection(id){const r=this.contexts.get(id);return r?{state_reason:r.reason??null,idle_closes_at:new Date(r.lastProgress+300000).toISOString(),window_count:r.tabs.size}:null;}
 page({request,items,revision,key,scope}){return pageMetadata({request,items,revision,key,scope});}
 async done(id,proof){return this.locked(id,async r=>{
  if(await this.io.authorizeHuman?.(r,proof)!==true)throw Error('BROWSER_FORBIDDEN');
  const {finishPrivateInput}=await import('./privacy.mjs');
  const task=await finishPrivateInput({io:{stopInputAndCapture:()=>this.io.stopInputAndCapture(r),pausePrivate:()=>this.io.pausePrivate(r,proof)}});Object.assign(r.task,task);return task;
 });}
 async command(id,{idempotency_key,digest,epoch},fn){return this.locked(id,async r=>{
  UUID.parse(idempotency_key);if(r.commandsFenced)throw Error('BROWSER_REVOKED');if(epoch!==r.task.control_epoch)throw Error('BROWSER_CONTROL_EXPIRED');
  const seen=r.seen.get(idempotency_key);if(seen){if(seen.digest!==digest)throw Error('BROWSER_IDEMPOTENCY_CONFLICT');return seen.result;}
  if(await this.io.authorize(r.task)!==true)throw Error('BROWSER_FORBIDDEN');this.live(id,r.task.context_generation);
  // SQL begin/finish are mandatory in production; in-memory cache is only an
  // optimization. Never invoke twice after a lost/unknown finish.
  const begin=await this.io.begin(r,{idempotency_key,digest,epoch});if(begin.state!=='accepted')return this.io.commandResult(begin);
  let result;
  try{result=await fn(r);this.live(id,r.task.context_generation);await this.io.finish(begin,'succeeded');r.lastProgress=this.clock();}
  catch{await this.io.finish(begin,'unknown');throw Error('BROWSER_SERVICE_UNAVAILABLE');}
  if(r.seen.size>=256)r.seen.delete(r.seen.keys().next().value);r.seen.set(idempotency_key,{digest,result});return result;
 });}
 async fresh(id,proof){return this.locked(id,async r=>{
  if(r.task.state!=='paused'||proof?.confirmed!==true)throw Error('BROWSER_CONTROL_EXPIRED');
  r.outputFence.fence();for(const c of r.reads)c.abort();for(const c of r.observations)c.abort();r.registry.clear();r.fenced=true;await this.io.fence(r);await r.context.close();
  // Website-only catalog consumes completed old-context fence before clearing
  // privacy. Controller cannot mint a new public generation on its own.
  const next=await this.io.confirmFresh(r.task,proof);
  if(next.context_generation!==r.task.context_generation+1||next.controller_boot_id===r.task.controller_boot_id)throw Error('BROWSER_REVOKED');
  this.contexts.delete(id);if(!this.contexts.size)this.emptySince=this.clock();await this.io.release(r);return next;
 },true);}
 async close(id,next='closed',code='BROWSER_REVOKED',alreadyPersisted=false){
  this.cancelledOpens.add(id);const r=this.contexts.get(id);if(!r)return;
  r.outputFence.fence();for(const c of r.reads)c.abort();for(const c of r.observations)c.abort();r.registry.clear();r.fenced=true; // synchronous: in-flight continuations fail before any await
  const results=await Promise.allSettled([this.io.fence(r),alreadyPersisted?Promise.resolve():this.io.transition(r.task,next,code),r.context.close()]);
  this.contexts.delete(id);if(!this.contexts.size)this.emptySince=this.clock();
  await this.io.release(r);if(results.some(x=>x.status==='rejected'))throw Error('BROWSER_SERVICE_UNAVAILABLE');
 }
 async pause(r,code){r.reason=code==='BROWSER_ATTENDED_ONLY'?'absent':null;r.commandsFenced=true;for(const c of r.reads)c.abort();for(const c of r.observations)c.abort();r.registry.clear();await this.io.fence(r);await this.io.transition(r.task,'paused',code);r.task.state='paused';}
 async runEnd(id,disposition){const r=this.contexts.get(id);if(!r)return;const normal=['waiting','completed','done'].includes(disposition);r.reason=normal?'turn_ended':'crashed';r.commandsFenced=true;for(const c of r.reads)c.abort();for(const c of r.observations)c.abort();r.registry.clear();await this.io.fence(r);if(this.io.runEnd)await this.io.runEnd(r.task,disposition==='done'?'completed':disposition);if(normal){r.task.state='paused';if(!this.io.runEnd)await this.io.transition(r.task,'paused','BROWSER_SERVICE_UNAVAILABLE');}else await this.close(id,'failed','BROWSER_SERVICE_UNAVAILABLE',!!this.io.runEnd);}
 attendance(id,until){const r=this.contexts.get(id);if(!r||!Number.isFinite(until)||until>this.clock()+15000)throw Error('BROWSER_BAD_INPUT');r.presentUntil=until;}
 progress(id,kind){const r=this.contexts.get(id);if(!r||!['input','tool','review'].includes(kind))throw Error('BROWSER_BAD_INPUT');if(kind==='review')throw Error('BROWSER_REVIEW_PENDING');r.lastProgress=this.clock();}
 review(id,review){const r=this.contexts.get(id);if(!r)throw Error('BROWSER_REVOKED');r.reviewUntil=reviewActivityDeadline({...review,present_until:r.presentUntil,now:this.clock()});}
 async tick(){
  const now=this.clock();
  for(const [id,r] of this.contexts){
   if(now-Math.max(r.lastProgress,Math.min(r.reviewUntil??0,now))>=300000){await this.close(id,'closed','BROWSER_REVOKED');continue;}
   if(now-r.lastProgress>=240000&&!r.warning){r.warning=true;await this.io.warn?.(r,{idle_closes_at:new Date(r.lastProgress+300000).toISOString()});}
   if(!r.commandsFenced&&now>=r.presentUntil)await this.pause(r,'BROWSER_ATTENDED_ONLY');
   else if(!r.commandsFenced&&await this.io.authorize(r.task)!==true)await this.close(id,'failed','BROWSER_REVOKED');
  }
  if(!this.contexts.size&&this.browser&&now-this.emptySince>=60000){const browser=this.browser;this.browser=null;await browser.close();}
 }
 async pressure(){this.ready=false;await Promise.allSettled([...this.contexts.keys()].map(id=>this.close(id,'failed','BROWSER_RESOURCE_LIMIT')));}
 async shutdown(){this.ready=false;await this.pressure();await this.browser?.close();this.browser=null;}
}

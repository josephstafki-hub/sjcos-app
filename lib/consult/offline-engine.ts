import {deadlineFetch,transportCode} from './transport.ts';
/** Framework-independent controller. No decrypted shared singleton or automatic rebase. */
import {ConsultOfflineStore,assertOfflineLease,partitionKey,verifyLease,type SignedLease,type OfflineIdentity,type OfflineLease} from './offline.ts';
import {applyReceipt,applyServerEpoch,enqueue,nextBatch,type QueueState,type ConsultOp,type OpReceipt} from './queue.ts';
export interface LocalBlob {summary_text?:string;hash:string;event_id:string;mime:string;kind:'photo'|'initials';instance_id:string;field_key?:string;shot_key?:string;receipt?:{file_id:string;media_id:string}}
export interface LocalVisit {queue:QueueState;snapshot:unknown;blobs:LocalBlob[];last_send:number|null;close_intent?:{paused?:string;notified?:boolean;started_at?:number;evidence_started?:boolean;baseline_evidence?:Record<string,unknown>|null;baseline_hash?:string;evidence:Record<string,unknown>|null;request?:{expected_revision:number;manifest:unknown}};last_send_failure?:{code:string;at:number;detail?:string}|null}
export type OfflineRepository=Pick<ConsultOfflineStore,'load'|'save'|'saveBlob'|'loadBlob'|'preflight'|'close'|'deleteBlob'|'blobHashes'>;
export class OfflineEngine {
 lastSendFailure:{code:string;at:number;detail?:string}|null=null;
 private device:string|null=null;private key:CryptoKey|null=null;private lease:OfflineLease|null=null;private value:LocalVisit|null=null;private revision=0;private running=false;
 private mutations:Promise<unknown>=Promise.resolve();
 private exclusive<T>(work:()=>Promise<T>):Promise<T>{const next=this.mutations.then(work);this.mutations=next.catch(()=>undefined);return next;}
 readonly identity:OfflineIdentity;private store:OfflineRepository;private request:typeof fetch;
 constructor(identity:OfflineIdentity,store:OfflineRepository,request:typeof fetch=fetch){
  this.identity=identity;this.store=store;
  // Browser fetch requires a Window/undefined receiver, never this engine.
  this.request=(input,init)=>deadlineFetch(request,input,init);
 }
 async unlockSigned(key:CryptoKey,signed:SignedLease,device:string,trusted:JsonWebKey){const lease=await verifyLease(signed,this.identity,device,trusted);const result=await this.unlock(key,lease);this.device=device;return result;}
 /** Low-level seam for verified leases; UI uses unlockSigned. */
 async unlock(key:CryptoKey,lease:OfflineLease){this.lock();assertOfflineLease(this.identity,lease);this.key=key;this.lease=lease;const saved=await this.store.load<LocalVisit>(this.identity,lease,key);this.revision=saved?.revision??0;this.value=saved?.value??null;if(this.value?.queue.blocked==='revoked'){this.lock();throw new Error('offline_quarantined');}return this.read();}
 lock(){this.device=null;this.key=null;this.lease=null;this.value=null;}
 logout(){this.lock();} // Ciphertext and nonextractable device key remain for same-user recovery.
 private access(){if(!this.key||!this.lease)throw new Error('offline_locked');assertOfflineLease(this.identity,this.lease);return {key:this.key,lease:this.lease};}
 read():LocalVisit|null{this.access();if(this.value?.queue.blocked==='deleted')return {...structuredClone(this.value),snapshot:null,blobs:[],queue:{...this.value.queue,projection:{},entries:[]}};return this.value?structuredClone(this.value):null;}
 private async commit(value:LocalVisit){const {key,lease}=this.access();const revision=await this.store.save(this.identity,lease,key,this.revision,value);this.access();this.revision=revision;this.value=structuredClone(value);}
 async prepare(value:LocalVisit){if(this.value)throw new Error('local_conflict');await this.store.preflight();await this.commit(value);}
 async saveCloseIntent(evidence:Record<string,unknown>|null){return this.exclusive(async()=>{const v=this.read();if(v)await this.commit({...v,close_intent:{evidence,baseline_evidence:(v.snapshot as {close_evidence?:Record<string,unknown>})?.close_evidence??null,baseline_hash:(v.snapshot as {close_evidence_hash?:string})?.close_evidence_hash,started_at:Date.now()}});});}
 async markEvidenceStarted(){return this.exclusive(async()=>{const v=this.read();if(v?.close_intent)await this.commit({...v,close_intent:{...v.close_intent,evidence_started:true}});});}
 async saveCloseRequest(request:{expected_revision:number;manifest:unknown}){return this.exclusive(async()=>{const v=this.read();if(v?.close_intent)await this.commit({...v,close_intent:{...v.close_intent,request}});});}
 /** r10 R10-1: after the office refused a close, drop the refused request but keep the intent, so the next try builds a fresh one. */
 async pauseClose(code:string,notified=false){return this.exclusive(async()=>{const v=this.read();if(v?.close_intent)await this.commit({...v,close_intent:{...v.close_intent,paused:code,notified}});});}
 async clearCloseRequest(){return this.exclusive(async()=>{const v=this.read();if(v?.close_intent){const {request:_drop,paused:_paused,...rest}=v.close_intent;void _drop;await this.commit({...v,close_intent:rest});}});}
 async clearCloseIntent(request?:{expected_revision:number;manifest:unknown}){return this.exclusive(async()=>{const v=this.read();if(request && JSON.stringify(v?.close_intent?.request)!==JSON.stringify(request))return;if(v)await this.commit({...v,close_intent:undefined});});}
 /** One durable transaction: initialization is either entirely present or absent. */
 async captureBatch(ops:ConsultOp[],projection:Record<string,unknown>){return this.exclusive(async()=>{const v=this.read();if(!v)throw new Error('not_prepared');let queue=v.queue;for(const op of ops)queue=enqueue(queue,op,projection);await this.commit({...v,queue});});}
 async capture(op:ConsultOp,projection:Record<string,unknown>){return this.exclusive(async()=>{const v=this.read();if(!v)throw new Error('not_prepared');await this.commit({...v,queue:enqueue(v.queue,op,projection)});});}
 async orphanHashes(){this.access();const v=this.read();const referenced=new Set(v?.blobs.map(b=>b.hash)??[]);return (await this.store.blobHashes(this.identity)).filter(h=>!referenced.has(h));}
 async evictSyncedBlobs(){const v=this.read();if(!v)return;for(const b of v.blobs)if(b.receipt&&!v.blobs.some(p=>p.hash===b.hash&&!p.receipt))await this.store.deleteBlob(this.identity,b.hash);}
 async captureBlob(blob:Blob,metadata:LocalBlob,op?:ConsultOp,projection:Record<string,unknown>={}){return this.exclusive(()=>this.captureBlobWrite(blob,metadata,op,projection));}
 private async captureBlobWrite(blob:Blob,metadata:LocalBlob,op?:ConsultOp,projection:Record<string,unknown>={}){const v=this.read(),{key,lease}=this.access();if(!v||v.queue.blocked)throw new Error('offline_locked');await this.store.saveBlob(this.identity,lease,key,metadata.hash,blob);await this.commit({...v,queue:op?enqueue(v.queue,op,projection):v.queue,blobs:[...v.blobs.filter(b=>b.event_id!==metadata.event_id),metadata]});}
 /** Replace the durable baseline atomically with queue rebasing; original operations and blobs survive. */
 async refreshSnapshot(snapshot:{consult:{revision:string|number;completion_generation:string|number;deletion_epoch?:string|number}}){return this.exclusive(async()=>{
  const v=this.read();if(!v||v.queue.blocked)return;
  const old=v.snapshot as typeof snapshot|null;
  if(old?.consult && Number(snapshot.consult.revision)<Number(old.consult.revision))return;
  const generation=Number(snapshot.consult.completion_generation??v.queue.generation),deletion=Number(snapshot.consult.deletion_epoch??v.queue.deletion_epoch);
  if(generation<v.queue.generation||deletion<v.queue.deletion_epoch)return;
  let queue=applyServerEpoch(v.queue,generation,v.queue.device_epoch,deletion);
  // Epoch rebasing marks unsent operations as conflicts; retain their projection for local drafts.
  if(!queue.blocked)queue={...queue,projection:v.queue.entries.some(e=>e.status!=='accepted')?v.queue.projection:{}};
  const close_intent=v.close_intent ? {...v.close_intent,baseline_hash:v.close_intent.baseline_hash??(v.snapshot as {close_evidence_hash?:string})?.close_evidence_hash} : undefined;
  await this.commit({...v,close_intent,snapshot:queue.blocked==='deleted'?null:snapshot,queue,...(queue.blocked==='deleted'?{blobs:[]}: {})});
 });}
 async resumeAuthorized(snapshot:unknown){const v=this.read();if(!v)return;if(v.queue.blocked==='signed_out')await this.commit({...v,snapshot,queue:{...v.queue,blocked:null,entries:v.queue.entries.map(e=>e.status==='locked'&&e.error_code==='signed_out'?{...e,status:'pending',error_code:undefined}:e)}});}
 async epochs(generation:number,device:number,deletion:number){const v=this.read();if(!v)return;await this.commit({...v,queue:applyServerEpoch(v.queue,generation,device,deletion),...(deletion>v.queue.deletion_epoch?{snapshot:null,blobs:[]}: {})});}
 /** Owner recovery must stage original operations as proposals with original authors.
  * No replacement user is ever allowed to drain the old author's queue. */
 recoveryManifest(){const v=this.read();return {identity:this.identity,partition:partitionKey(this.identity),ops:v?.queue.entries.filter(e=>e.status!=='accepted').map(e=>e.op)??[],blobs:v?.blobs??[]};}
 private async post(path:string,body:unknown,method='POST',headers:Record<string,string>={}){return this.request(`/api/consult/${this.identity.consult_id}${path}`,{method,credentials:'same-origin',cache:'no-store',headers:{'X-Consult-CSRF':'1','Content-Type':'application/json',...headers},body:JSON.stringify(body)});}
 private async receipts(receipts:OpReceipt[],detail?:string){const v=this.read();if(!v)return;let queue=v.queue;const failure=receipts.find(r=>r.status!==200);if(!failure)this.lastSendFailure=null;if(failure)this.lastSendFailure={code:failure.error_code??(failure.status===0?'no_signal':'send_failed'),at:Date.now(),...(detail?{detail}: {})};for(const r of receipts)queue=applyReceipt(queue,r,Date.now());await this.commit({...v,queue,last_send_failure:this.lastSendFailure,last_send:receipts.some(r=>r.status>=200&&r.status<300)?Date.now():v.last_send,...(queue.blocked?{snapshot:null}: {})});if(queue.blocked==='signed_out'||queue.blocked==='revoked')this.lock();}
 async replay(){return this.exclusive(async()=>{try{await this.replayWrite();}catch(e){this.lastSendFailure={code:transportCode(e),at:Date.now(),detail:String(e)};let v:LocalVisit|null=null;try{v=this.key?this.read():null;}catch{/* locked lease: memory diagnostic remains visible */}if(v)await this.commit({...v,last_send_failure:this.lastSendFailure});throw e;}});}
 private async stoppedSend(code:string){this.lastSendFailure={code,at:Date.now()};if(this.key){const v=this.read();if(v)await this.commit({...v,last_send_failure:this.lastSendFailure});}}
 private async replayWrite(){
  if(this.running)return;this.running=true;
  try{const v=this.read();if(!v||v.queue.blocked){await this.stoppedSend(v?.queue.blocked??'not_prepared');return;}
   const ops=nextBatch(v.queue,Date.now());
   if(!ops.length){const first=v.queue.entries.find(e=>e.status!=='accepted');if(first){await this.stoppedSend(first.status==='pending'?(first.next_at>Date.now()?'retry_wait':'op_too_large'):(first.error_code??`queue_${first.status}`));return;}}
   if(ops.length){let response:Response;try{response=await this.post('',{command:'ops',input:{nonce:crypto.randomUUID(),ops}});}catch(e){await this.receipts(ops.map(o=>({id:o.client_event_id,status:0,error_code:transportCode(e)})),String(e));return;}
    const result=await response.json();const receipts:OpReceipt[]=response.ok?result:ops.map(o=>({id:o.client_event_id,status:response.status,error_code:result.error_code}));
    if(!Array.isArray(receipts)||receipts.length!==ops.length||new Set(receipts.map(r=>r.id)).size!==ops.length||receipts.some(r=>!ops.some(o=>o.client_event_id===r.id)))throw new Error('invalid_receipts');await this.receipts(receipts);
   }
   if(!this.key)return; // receipts already recorded the lock reason
   const current=this.read();if(!current||current.queue.blocked){await this.stoppedSend(current?.queue.blocked??'not_prepared');return;}
   for(const blob of current.blobs.filter(b=>!b.receipt)){await this.upload(blob);}
  }finally{this.running=false;}
 }
 private async upload(meta:LocalBlob){
  const {key,lease}=this.access(),v=this.read()!;const blob=await this.store.loadBlob(this.identity,lease,key,meta.hash);if(!blob)throw new Error('blob_missing');
  const first=v.queue.entries[0]?.op;const device=first?.device_id??this.device;if(!device)throw new Error('device_missing');
  const init=await this.post('/uploads',{event_id:meta.event_id,device_id:device,device_epoch:v.queue.device_epoch,kind:meta.kind,mime:meta.mime,size:blob.size,sha256:meta.hash,instance_id:meta.instance_id,...(meta.field_key?{field_key:meta.field_key}:{}),...(meta.shot_key?{shot_key:meta.shot_key}:{})});
  if(!init.ok){await this.transportFailure(init.status);return;}const status=await init.json();
  if(!status.receipt&&(!Number.isInteger(status.part_bytes)||status.part_bytes<=0||!status.upload_id||!Array.isArray(status.received_parts)))throw new Error('invalid_upload_response');
  if(!status.receipt){for(let n=0;n<Math.ceil(blob.size/status.part_bytes);n++){
   if(status.received_parts.some((p:{n:number})=>p.n===n))continue;
   const bytes=await blob.slice(n*status.part_bytes,(n+1)*status.part_bytes).arrayBuffer();const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
   const part=await this.request(`/api/consult/${this.identity.consult_id}/uploads/${status.upload_id}/parts/${n}`,{method:'PUT',credentials:'same-origin',headers:{'X-Consult-CSRF':'1','X-Part-SHA256':sha},body:bytes});if(!part.ok){await this.transportFailure(part.status);return;}
  }}
  const committed=status.receipt?null:await this.post(`/uploads/${status.upload_id}/commit`,{event_id:meta.event_id,sha256:meta.hash,...(meta.summary_text!==undefined?{summary_text:meta.summary_text}:{})});if(committed&&!committed.ok){await this.transportFailure(committed.status);return;}
  const receipt=status.receipt??await committed!.json(),latest=this.read()!;if(!receipt?.file_id||!receipt?.media_id)throw new Error('invalid_upload_receipt');this.lastSendFailure=null;await this.commit({...latest,last_send:Date.now(),last_send_failure:null,blobs:latest.blobs.map(b=>b.event_id===meta.event_id?{...b,receipt}:b)});
 }
 private async transportFailure(status:number){this.lastSendFailure={code:status===401?'signed_out':status===403?'revoked':`upload_${status}`,at:Date.now()};const v=this.read();if(!v)return;await this.commit({...v,last_send_failure:this.lastSendFailure});if([401,403,410,426].includes(status)){const queue={...v.queue,blocked:(status===401?'signed_out':status===403?'revoked':status===410?'deleted':'update_required') as QueueState['blocked'],projection:{}};await this.commit({...v,queue,snapshot:null});this.lock();}}
}

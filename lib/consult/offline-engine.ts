/** Framework-independent controller. No decrypted shared singleton or automatic rebase. */
import {ConsultOfflineStore,assertOfflineLease,partitionKey,verifyLease,type SignedLease,type OfflineIdentity,type OfflineLease} from './offline.ts';
import {applyReceipt,applyServerEpoch,enqueue,nextBatch,type QueueState,type ConsultOp,type OpReceipt} from './queue.ts';
export interface LocalBlob {hash:string;event_id:string;mime:string;kind:'photo'|'initials';instance_id:string;field_key?:string;shot_key?:string;receipt?:{file_id:string;media_id:string}}
export interface LocalVisit {queue:QueueState;snapshot:unknown;blobs:LocalBlob[];last_send:number|null;close_intent?:{evidence:Record<string,unknown>|null;request?:{expected_revision:number;manifest:unknown}};last_send_failure?:{code:string;at:number}|null}
export type OfflineRepository=Pick<ConsultOfflineStore,'load'|'save'|'saveBlob'|'loadBlob'|'preflight'|'close'|'deleteBlob'|'blobHashes'>;
export class OfflineEngine {
 lastSendFailure:{code:string;at:number}|null=null;
 private device:string|null=null;private key:CryptoKey|null=null;private lease:OfflineLease|null=null;private value:LocalVisit|null=null;private revision=0;private running=false;
 private mutations:Promise<unknown>=Promise.resolve();
 private exclusive<T>(work:()=>Promise<T>):Promise<T>{const next=this.mutations.then(work);this.mutations=next.catch(()=>undefined);return next;}
 readonly identity:OfflineIdentity;private store:OfflineRepository;private request:typeof fetch;
 constructor(identity:OfflineIdentity,store:OfflineRepository,request:typeof fetch=fetch){this.identity=identity;this.store=store;this.request=request;}
 async unlockSigned(key:CryptoKey,signed:SignedLease,device:string,trusted:JsonWebKey){const lease=await verifyLease(signed,this.identity,device,trusted);const result=await this.unlock(key,lease);this.device=device;return result;}
 /** Low-level seam for verified leases; UI uses unlockSigned. */
 async unlock(key:CryptoKey,lease:OfflineLease){this.lock();assertOfflineLease(this.identity,lease);this.key=key;this.lease=lease;const saved=await this.store.load<LocalVisit>(this.identity,lease,key);this.revision=saved?.revision??0;this.value=saved?.value??null;if(this.value?.queue.blocked==='revoked'){this.lock();throw new Error('offline_quarantined');}return this.read();}
 lock(){this.device=null;this.key=null;this.lease=null;this.value=null;}
 logout(){this.lock();} // Ciphertext and nonextractable device key remain for same-user recovery.
 private access(){if(!this.key||!this.lease)throw new Error('offline_locked');assertOfflineLease(this.identity,this.lease);return {key:this.key,lease:this.lease};}
 read():LocalVisit|null{this.access();if(this.value?.queue.blocked==='deleted')return {...structuredClone(this.value),snapshot:null,blobs:[],queue:{...this.value.queue,projection:{},entries:[]}};return this.value?structuredClone(this.value):null;}
 private async commit(value:LocalVisit){const {key,lease}=this.access();const revision=await this.store.save(this.identity,lease,key,this.revision,value);this.access();this.revision=revision;this.value=structuredClone(value);}
 async prepare(value:LocalVisit){if(this.value)throw new Error('local_conflict');await this.store.preflight();await this.commit(value);}
 async saveCloseIntent(evidence:Record<string,unknown>|null){return this.exclusive(async()=>{const v=this.read();if(v)await this.commit({...v,close_intent:{evidence}});});}
 async saveCloseRequest(request:{expected_revision:number;manifest:unknown}){return this.exclusive(async()=>{const v=this.read();if(v?.close_intent)await this.commit({...v,close_intent:{...v.close_intent,request}});});}
 async clearCloseIntent(){return this.exclusive(async()=>{const v=this.read();if(v)await this.commit({...v,close_intent:undefined});});}
 async capture(op:ConsultOp,projection:Record<string,unknown>){return this.exclusive(async()=>{const v=this.read();if(!v)throw new Error('not_prepared');await this.commit({...v,queue:enqueue(v.queue,op,projection)});});}
 async orphanHashes(){this.access();const v=this.read();const referenced=new Set(v?.blobs.map(b=>b.hash)??[]);return (await this.store.blobHashes(this.identity)).filter(h=>!referenced.has(h));}
 async evictSyncedBlobs(){const v=this.read();if(!v)return;for(const b of v.blobs)if(b.receipt&&!v.blobs.some(p=>p.hash===b.hash&&!p.receipt))await this.store.deleteBlob(this.identity,b.hash);}
 async captureBlob(blob:Blob,metadata:LocalBlob){return this.exclusive(()=>this.captureBlobWrite(blob,metadata));}
 private async captureBlobWrite(blob:Blob,metadata:LocalBlob){const v=this.read(),{key,lease}=this.access();if(!v||v.queue.blocked)throw new Error('offline_locked');await this.store.saveBlob(this.identity,lease,key,metadata.hash,blob);await this.commit({...v,blobs:[...v.blobs.filter(b=>b.event_id!==metadata.event_id),metadata]});}
 async resumeAuthorized(snapshot:unknown){const v=this.read();if(!v)return;if(v.queue.blocked==='signed_out')await this.commit({...v,snapshot,queue:{...v.queue,blocked:null,entries:v.queue.entries.map(e=>e.status==='locked'&&e.error_code==='signed_out'?{...e,status:'pending',error_code:undefined}:e)}});}
 async epochs(generation:number,device:number,deletion:number){const v=this.read();if(!v)return;await this.commit({...v,queue:applyServerEpoch(v.queue,generation,device,deletion),...(deletion>v.queue.deletion_epoch?{snapshot:null,blobs:[]}: {})});}
 /** Owner recovery must stage original operations as proposals with original authors.
  * No replacement user is ever allowed to drain the old author's queue. */
 recoveryManifest(){const v=this.read();return {identity:this.identity,partition:partitionKey(this.identity),ops:v?.queue.entries.filter(e=>e.status!=='accepted').map(e=>e.op)??[],blobs:v?.blobs??[]};}
 private async post(path:string,body:unknown,method='POST',headers:Record<string,string>={}){return this.request(`/api/consult/${this.identity.consult_id}${path}`,{method,credentials:'same-origin',cache:'no-store',headers:{'X-Consult-CSRF':'1','Content-Type':'application/json',...headers},body:JSON.stringify(body)});}
 private async receipts(receipts:OpReceipt[]){const v=this.read();if(!v)return;let queue=v.queue;const failure=receipts.find(r=>r.status!==200);if(!failure)this.lastSendFailure=null;if(failure)this.lastSendFailure={code:failure.error_code??(failure.status===0?'no_signal':'send_failed'),at:Date.now()};for(const r of receipts)queue=applyReceipt(queue,r,Date.now());await this.commit({...v,queue,last_send_failure:this.lastSendFailure,last_send:receipts.some(r=>r.status>=200&&r.status<300)?Date.now():v.last_send,...(queue.blocked?{snapshot:null}: {})});if(queue.blocked==='signed_out'||queue.blocked==='revoked')this.lock();}
 async replay(){return this.exclusive(async()=>{try{await this.replayWrite();}catch(e){this.lastSendFailure={code:e instanceof Error?e.message:'unknown',at:Date.now()};const v=this.key?this.read():null;if(v)await this.commit({...v,last_send_failure:this.lastSendFailure});throw e;}});}
 private async replayWrite(){
  if(this.running)return;this.running=true;
  try{const v=this.read();if(!v||v.queue.blocked)return;
   const ops=nextBatch(v.queue,Date.now());
   if(ops.length){let response:Response;try{response=await this.post('',{command:'ops',input:{nonce:crypto.randomUUID(),ops}});}catch{await this.receipts(ops.map(o=>({id:o.client_event_id,status:0})));return;}
    const result=await response.json();const receipts:OpReceipt[]=response.ok?result:ops.map(o=>({id:o.client_event_id,status:response.status,error_code:result.error_code}));
    if(!Array.isArray(receipts)||receipts.length!==ops.length||new Set(receipts.map(r=>r.id)).size!==ops.length||receipts.some(r=>!ops.some(o=>o.client_event_id===r.id)))throw new Error('invalid_receipts');await this.receipts(receipts);
   }
   if(!this.key)return;const current=this.read();if(!current||current.queue.blocked)return;
   for(const blob of current.blobs.filter(b=>!b.receipt)){await this.upload(blob);}
  }finally{this.running=false;}
 }
 private async upload(meta:LocalBlob){
  const {key,lease}=this.access(),v=this.read()!;const blob=await this.store.loadBlob(this.identity,lease,key,meta.hash);if(!blob)throw new Error('blob_missing');
  const first=v.queue.entries[0]?.op;const device=first?.device_id??this.device;if(!device)throw new Error('device_missing');
  const init=await this.post('/uploads',{event_id:meta.event_id,device_id:device,device_epoch:v.queue.device_epoch,kind:meta.kind,mime:meta.mime,size:blob.size,sha256:meta.hash,instance_id:meta.instance_id,...(meta.field_key?{field_key:meta.field_key}:{}),...(meta.shot_key?{shot_key:meta.shot_key}:{})});
  if(!init.ok){await this.transportFailure(init.status);return;}const status=await init.json();
  if(!status.receipt){for(let n=0;n<Math.ceil(blob.size/status.part_bytes);n++){
   if(status.received_parts.some((p:{n:number})=>p.n===n))continue;
   const bytes=await blob.slice(n*status.part_bytes,(n+1)*status.part_bytes).arrayBuffer();const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
   const part=await this.request(`/api/consult/${this.identity.consult_id}/uploads/${status.upload_id}/parts/${n}`,{method:'PUT',credentials:'same-origin',headers:{'X-Consult-CSRF':'1','X-Part-SHA256':sha},body:bytes});if(!part.ok){await this.transportFailure(part.status);return;}
  }}
  const committed=status.receipt?null:await this.post(`/uploads/${status.upload_id}/commit`,{event_id:meta.event_id,sha256:meta.hash});if(committed&&!committed.ok){await this.transportFailure(committed.status);return;}
  const receipt=status.receipt??await committed!.json(),latest=this.read()!;await this.commit({...latest,blobs:latest.blobs.map(b=>b.event_id===meta.event_id?{...b,receipt}:b)});
 }
 private async transportFailure(status:number){this.lastSendFailure={code:status===401?'signed_out':status===403?'revoked':`upload_${status}`,at:Date.now()};const v=this.read();if(!v)return;await this.commit({...v,last_send_failure:this.lastSendFailure});if([401,403,410,426].includes(status)){const queue={...v.queue,blocked:(status===401?'signed_out':status===403?'revoked':status===410?'deleted':'update_required') as QueueState['blocked'],projection:{}};await this.commit({...v,queue,snapshot:null});this.lock();}}
}

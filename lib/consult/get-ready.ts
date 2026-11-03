/** Ordered real checks for §5.2. UI renders progress, then imports OfflineEngine. */
import {definitionChecksum} from './forms/seed.ts';
import type {ModuleDef,TemplateDef} from './form-types.ts';
import {ConsultOfflineStore,checkCapacity,type OfflineIdentity,type SignedLease} from './offline.ts';
import {OfflineVault} from './offline-vault.ts';
import {OfflineEngine} from './offline-engine.ts';
import {emptyQueue} from './queue.ts';
import {prepareConsultShell,type PrecacheManifest} from './service-worker.ts';
import type {ReadyCheck,CheckResult} from './readiness.ts';
export async function getReady(input:{identity:OfflineIdentity;device:string;pin:string;manifest:PrecacheManifest;worker:ServiceWorker;store:ConsultOfflineStore;storage:Pick<StorageManager,'estimate'|'persist'>;needed_bytes:number;request?:typeof fetch;onCheck:(check:ReadyCheck,result:CheckResult)=>void}){
 const request=input.request??fetch;let check:ReadyCheck='visit_details';
 const progress=(key:ReadyCheck)=>{check=key;input.onCheck(key,{state:'checking'});},done=()=>input.onCheck(check,{state:'done'});
 const post=async(command:string,data:unknown)=>{const r=await request(`/api/consult/${input.identity.consult_id}`,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Consult-CSRF':'1'},body:JSON.stringify({command,input:data})});const value=await r.json();if(!r.ok||value.ok===false)throw new Error(value.error_code??value.code??'not_ready');return value;};
 try{
  progress('visit_details');const response=await request(`/api/consult/${input.identity.consult_id}`,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error(response.status===401?'signed_out':response.status===403?'revoked':'snapshot_unavailable');const snapshot=await response.json();done();
  progress('forms');for(const pin of snapshot.pins as {checksum:string;definition:ModuleDef|TemplateDef}[])if(await definitionChecksum(pin.definition)!==pin.checksum)throw new Error('checksum_mismatch');if(!snapshot.pins.length)throw new Error('missing_forms');done();
  progress('offline_pages');if(input.manifest.build!==input.identity.build)throw new Error('update_required');await prepareConsultShell(input.worker,input.manifest);done();
  progress('saving_on_device');await input.store.preflight();const capacity=await checkCapacity(input.storage,input.needed_bytes);done();
  progress('offline_lease');const prepared=await post('prepare_device',{device:input.device,expected_revision:Number(snapshot.consult.revision)});
  const signed:SignedLease=await post('offline_lease',{device:input.device,build:input.identity.build});
  const vault=new OfflineVault(input.store);
  try{await vault.enroll(input.identity,input.device,input.pin,signed);}catch(e){if(!(e instanceof Error)||e.message!=='already_enrolled')throw e;await vault.renew(input.identity,input.device,signed);}
  const unlocked=await vault.unlock(input.identity,input.device,input.pin),engine=new OfflineEngine(input.identity,input.store,request);await engine.unlockSigned(unlocked.key,signed,input.device,unlocked.issuer);
  // Existing pending state always wins over a new downloaded projection.
  if(!engine.read())await engine.prepare({queue:emptyQueue(prepared.generation,prepared.epoch,Number(snapshot.consult.deletion_epoch??0),prepared.last_ack_seq),snapshot,blobs:snapshot.media??[],last_send:null});
  else {await engine.epochs(prepared.generation,prepared.epoch,Number(snapshot.consult.deletion_epoch??engine.read()!.queue.deletion_epoch));await engine.resumeAuthorized(snapshot);}
  done();input.onCheck('microphone',{state:'not_yet',reason:'Notes off'});return {ok:true as const,engine,capacity,expires_at:unlocked.lease.expires_at};
 }catch(error){const code=error instanceof Error?error.message:'not_ready';input.onCheck(check,{state:'problem',reason:code});return {ok:false as const,code,check};}
}

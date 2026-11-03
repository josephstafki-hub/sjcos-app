/** Identity partitions contain only AES-GCM ciphertext. Unlock/key issuance is external. */
export interface OfflineIdentity { user_id: string; session_epoch: number; build: string; consult_id: string }
export interface OfflineLease { user_id: string; session_epoch: number; expires_at: number }
export function partitionKey(id: OfflineIdentity): string { return JSON.stringify([id.user_id,id.session_epoch,id.build,id.consult_id]); }
export function assertOfflineLease(id:OfflineIdentity, lease:OfflineLease, now=Date.now()):void {
  if(id.user_id!==lease.user_id || id.session_epoch!==lease.session_epoch || !Number.isFinite(lease.expires_at) || now>=lease.expires_at || lease.expires_at-now>24*60*60*1000) throw new Error('offline_locked');
}
export interface SealedRecord { version:1; revision:number; iv:Uint8Array<ArrayBuffer>; ciphertext:ArrayBuffer }
export async function seal(value:unknown,key:CryptoKey,partition:string,revision:number):Promise<SealedRecord> {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`${partition}:${revision}`)},key,new TextEncoder().encode(JSON.stringify(value)));
  return {version:1,revision,iv,ciphertext};
}
export async function unseal<T>(record:SealedRecord,key:CryptoKey,partition:string):Promise<T> {
  if(record.version!==1) throw new Error('update_required');
  const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:new TextEncoder().encode(`${partition}:${record.revision}`)},key,record.ciphertext);
  return JSON.parse(new TextDecoder().decode(data)) as T;
}
export class ConsultOfflineStore {
  private db: IDBDatabase;
  private constructor(db: IDBDatabase) { this.db = db; }
  static async open(factory:IDBFactory=indexedDB):Promise<ConsultOfflineStore> {
    return new Promise((resolve,reject)=>{
      const request=factory.open('sjcos-consult-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('partitions');
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('storage_blocked'));
      request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(new ConsultOfflineStore(request.result));};
    });
  }
  close():void { this.db.close(); }
  private read(partition:string):Promise<SealedRecord|undefined> {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('partitions','readonly');const req=tx.objectStore('partitions').get(partition);
      tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
    });
  }
  async load<T>(id:OfflineIdentity,lease:OfflineLease,key:CryptoKey,now=Date.now()):Promise<{revision:number;value:T}|null> {
    assertOfflineLease(id,lease,now);const partition=partitionKey(id);const record=await this.read(partition);
    return record?{revision:record.revision,value:await unseal<T>(record,key,partition)}:null;
  }
  /** Whole state includes outbox and local projection: one commit, then show Saved. CAS prevents two tabs losing edits. */
  async save(id:OfflineIdentity,lease:OfflineLease,key:CryptoKey,expected_revision:number,value:unknown,now=Date.now()):Promise<number> {
    assertOfflineLease(id,lease,now);const partition=partitionKey(id),revision=expected_revision+1;
    const record=await seal(value,key,partition,revision);
    await new Promise<void>((resolve,reject)=>{
      const tx=this.db.transaction('partitions','readwrite');const store=tx.objectStore('partitions');const req=store.get(partition);let mismatch=false;
      req.onsuccess=()=>{if((req.result?.revision??0)!==expected_revision){mismatch=true;tx.abort();}else store.put(record,partition);};
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(new Error(mismatch?'local_conflict':'storage_full'));tx.onerror=()=>reject(tx.error);
    });return revision;
  }
  async preflight():Promise<void> {
    const id=`preflight:${crypto.randomUUID()}`;
    await new Promise<void>((resolve,reject)=>{
      const tx=this.db.transaction('partitions','readwrite'),store=tx.objectStore('partitions');store.put('probe',id);
      const req=store.get(id);req.onsuccess=()=>{if(req.result!=='probe')tx.abort();else store.delete(id);};
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(new Error('storage_unavailable'));tx.onerror=()=>reject(tx.error);
    });
  }
}

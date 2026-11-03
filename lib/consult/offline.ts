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
      const request=factory.open('sjcos-consult-v1',2);
      request.onupgradeneeded=()=>{for(const name of ['partitions','keys'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('storage_blocked'));
      request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(new ConsultOfflineStore(request.result));};
    });
  }
  async keyRecord<T>(name:string,value?:T):Promise<T|undefined>{
    return new Promise((resolve,reject)=>{const tx=this.db.transaction('keys',value===undefined?'readonly':'readwrite'),store=tx.objectStore('keys');const req=value===undefined?store.get(name):store.put(value,name);tx.oncomplete=()=>resolve(value===undefined?req.result:value);tx.onabort=()=>reject(tx.error);});
  }
  async clearPartition(id:OfflineIdentity):Promise<void>{
    const prefix=partitionKey(id);await new Promise<void>((resolve,reject)=>{const tx=this.db.transaction('partitions','readwrite'),store=tx.objectStore('partitions'),req=store.openCursor();req.onsuccess=()=>{const cursor=req.result;if(cursor){if(String(cursor.key)===prefix||String(cursor.key).startsWith(prefix+':blob:'))cursor.delete();cursor.continue();}};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
  }
  async saveBlob(id:OfflineIdentity,lease:OfflineLease,key:CryptoKey,hash:string,blob:Blob):Promise<void>{
    assertOfflineLease(id,lease);if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('invalid_hash');
    const bytes=new Uint8Array(await blob.arrayBuffer());const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');if(hash!==digest)throw new Error('invalid_hash');
    const partition=partitionKey(id)+':blob:'+hash,iv=crypto.getRandomValues(new Uint8Array(12));
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(partition)},key,bytes);
    await new Promise<void>((resolve,reject)=>{const tx=this.db.transaction('partitions','readwrite');tx.objectStore('partitions').put({version:1,revision:1,iv,ciphertext},partition);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(new Error('storage_full'));});
  }
  async loadBlob(id:OfflineIdentity,lease:OfflineLease,key:CryptoKey,hash:string):Promise<Blob|null>{
    assertOfflineLease(id,lease);const partition=partitionKey(id)+':blob:'+hash,record=await this.read(partition);if(!record)return null;
    return new Blob([await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:new TextEncoder().encode(partition)},key,record.ciphertext)]);
  }
  async deleteBlob(id:OfflineIdentity,hash:string):Promise<void>{
    await new Promise<void>((resolve,reject)=>{const tx=this.db.transaction('partitions','readwrite');tx.objectStore('partitions').delete(partitionKey(id)+':blob:'+hash);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
  }
  async blobHashes(id:OfflineIdentity):Promise<string[]>{
    const prefix=partitionKey(id)+':blob:';return new Promise((resolve,reject)=>{const hashes:string[]=[],tx=this.db.transaction('partitions','readonly'),req=tx.objectStore('partitions').getAllKeys();tx.oncomplete=()=>resolve(req.result.map(String).filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length)));tx.onabort=()=>reject(tx.error);});
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

/** Nonextractable device key must be persisted as a CryptoKey in the keys store. */
export async function createDeviceKey():Promise<CryptoKey>{return crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
export interface PinEnvelope {salt:Uint8Array<ArrayBuffer>;wrapped:SealedRecord}
async function pinKey(pin:string,salt:Uint8Array<ArrayBuffer>,device:CryptoKey):Promise<CryptoKey>{
 if(!/^\d{6,12}$/.test(pin))throw new Error('invalid_pin');
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,256);
 // Device key is required in addition to PIN; its ciphertext is deterministic only for this salt.
 const mixed=await crypto.subtle.encrypt({name:'AES-GCM',iv:salt.slice(0,12)},device,new Uint8Array(32));
 return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new Uint8Array([...new Uint8Array(bits),...new Uint8Array(mixed)])),'AES-GCM',false,['encrypt','decrypt']);
}
export async function enrollPin(pin:string,device:CryptoKey,identity:string):Promise<PinEnvelope>{
 const salt=crypto.getRandomValues(new Uint8Array(16)),key=await pinKey(pin,salt,device),secret=crypto.getRandomValues(new Uint8Array(32));
 return {salt,wrapped:await seal(Array.from(secret),key,identity,1)};
}
export async function unlockPin(pin:string,device:CryptoKey,envelope:PinEnvelope,identity:string):Promise<CryptoKey>{
 const key=await pinKey(pin,envelope.salt,device);const raw=await unseal<number[]>(envelope.wrapped,key,identity);
 return crypto.subtle.importKey('raw',new Uint8Array(raw),'AES-GCM',false,['encrypt','decrypt']);
}
export interface SignedLease {payload:string;signature:string;public_key:JsonWebKey}
export interface DeviceLease extends OfflineLease {consult_id:string;device_id:string;build:string;issued_at:number;purpose?:'recovery'}
export async function verifyLease(signed:SignedLease,id:OfflineIdentity,device:string,trusted:JsonWebKey,now=Date.now(),recovery=false):Promise<DeviceLease>{
 const key=await crypto.subtle.importKey('jwk',trusted,{name:'Ed25519'},false,['verify']);
 const signature=Uint8Array.from(atob(signed.signature),c=>c.charCodeAt(0));
 if(!await crypto.subtle.verify('Ed25519',key,signature,new TextEncoder().encode(signed.payload)))throw new Error('offline_locked');
 const lease=JSON.parse(signed.payload) as DeviceLease;if((lease.purpose==='recovery')!==recovery)throw new Error('offline_locked');assertOfflineLease(id,lease,now);
 if(lease.consult_id!==id.consult_id||lease.device_id!==device||lease.build!==id.build||lease.issued_at>now||lease.expires_at-lease.issued_at>86400000)throw new Error('offline_locked');return lease;
}
export async function checkCapacity(storage:Pick<StorageManager,'estimate'|'persist'>,needed:number):Promise<{free:number;persistent:boolean}>{
 if(!Number.isSafeInteger(needed)||needed<0)throw new Error('invalid_capacity');
 const {usage,quota}=await storage.estimate();if(quota===undefined||usage===undefined||quota-usage<needed+5*1024*1024)throw new Error('storage_full');
 return {free:quota-usage,persistent:await storage.persist().catch(()=>false)};
}

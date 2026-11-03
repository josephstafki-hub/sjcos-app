/** Online enrollment pins the lease issuer key. Offline unlock cannot replace it. */
import {createDeviceKey,enrollPin,unlockPin,verifyLease,partitionKey,ConsultOfflineStore,type OfflineIdentity,type SignedLease,type PinEnvelope} from './offline.ts';
interface Enrollment {device:CryptoKey;pin:PinEnvelope;issuer:JsonWebKey;lease:SignedLease;failures:number;retry_at:number}
export class OfflineVault {
 private store:ConsultOfflineStore;
 constructor(store:ConsultOfflineStore){this.store=store;}
 private name(id:OfflineIdentity,device:string){return `enrollment:${partitionKey(id)}:${device}`;}
 /** Only call from the freshly authenticated Get ready flow. Never replaces an old key. */
 async enroll(id:OfflineIdentity,device:string,pin:string,signed:SignedLease){
  const name=this.name(id,device);if(await this.store.keyRecord(name))throw new Error('already_enrolled');
  await verifyLease(signed,id,device,signed.public_key);
  const deviceKey=await createDeviceKey(),envelope=await enrollPin(pin,deviceKey,name);
  await this.store.keyRecord<Enrollment>(name,{device:deviceKey,pin:envelope,issuer:signed.public_key,lease:signed,failures:0,retry_at:0});
 }
 /** Owner obtains a scoped recovery lease online; only the original PIN/device can decrypt. */
 async recover(id:OfflineIdentity,device:string,pin:string,signed:SignedLease){
  const name=this.name(id,device),record=await this.store.keyRecord<Enrollment>(name);if(!record)throw new Error('not_prepared');
  const lease=await verifyLease(signed,id,device,record.issuer,Date.now(),true);
  const key=await unlockPin(pin,record.device,record.pin,name);
  const saved=await this.store.load(id,lease,key);return {saved,readBlob:(hash:string)=>this.store.loadBlob(id,lease,key,hash)};
 }
 async renew(id:OfflineIdentity,device:string,signed:SignedLease){const name=this.name(id,device),record=await this.store.keyRecord<Enrollment>(name);if(!record)throw new Error('not_prepared');await verifyLease(signed,id,device,record.issuer);await this.store.keyRecord(name,{...record,lease:signed});}
 async unlock(id:OfflineIdentity,device:string,pin:string){
  const name=this.name(id,device),record=await this.store.keyRecord<Enrollment>(name);if(!record)throw new Error('not_prepared');if(Date.now()<record.retry_at)throw new Error('pin_retry_later');
  const lease=await verifyLease(record.lease,id,device,record.issuer);
  try{const key=await unlockPin(pin,record.device,record.pin,name);await this.store.keyRecord(name,{...record,failures:0,retry_at:0});return {key,lease,signed:record.lease,issuer:record.issuer};}
  catch{await this.store.keyRecord(name,{...record,failures:record.failures+1,retry_at:Date.now()+Math.min(300000,1000*2**Math.min(9,record.failures))});throw new Error('invalid_pin');}
 }
}

/** Fixed exporter wire protocol. The fsynced outbox is local durability only;
 * every ack is pinned Ed25519 proof of the independent S3 Object Lock append. */
import {connect} from 'node:net';
import {lstat} from 'node:fs/promises';
import {sign,verify,createPublicKey,createHash} from 'node:crypto';
import {canonical} from './acceptance-attestation.mjs';
import {UUID} from './phase1-contracts.mjs';
import {trustedPath} from './protected-bootstrap.mjs';
import {createCheckpointOutbox} from './audit-service.mjs';
export const CHECKPOINT_SOCKET='/run/sjcos-browser-exporter/checkpoint.sock';
const fail=()=>{throw Error('BROWSER_SERVICE_UNAVAILABLE');};
const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Object.keys(x).sort().join(',')===keys.split(',').sort().join(',');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const seq=x=>Number.isSafeInteger(x)&&x>0;
const utc=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(x)&&Number.isFinite(Date.parse(x));
const signature=x=>{if(typeof x!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(x))fail();const bytes=Buffer.from(x,'base64');if(bytes.toString('base64')!==x)fail();return bytes;};
export function verifyCheckpointRecord(record,key){
 if(!exact(record,'v,seq,digest,time,install_id,boot_id,sig')||record.v!==1||!seq(record.seq)||!hex(record.digest)||!utc(record.time)||!UUID.safeParse(record.install_id).success||!UUID.safeParse(record.boot_id).success||Buffer.byteLength(canonical(record)+'\n')>1024||key?.asymmetricKeyType!=='ed25519')fail();
 const {sig,...payload}=record;if(!verify(null,Buffer.from(canonical(payload)),key,signature(sig)))fail();return record;
}
export function verifyExporterAck(record,ack,key,now=Date.now()){
 if(!exact(ack,'v,seq,digest,sink,object_key,version_id,retain_until,ack_sig')||ack.v!==1||!seq(ack.seq)||ack.seq!==record.seq||!hex(ack.digest)||ack.digest!==record.digest||ack.sink!=='s3-object-lock'||!utc(ack.retain_until)||Date.parse(ack.retain_until)<=now||!['object_key','version_id'].every(k=>typeof ack[k]==='string'&&ack[k].length>0&&Buffer.byteLength(ack[k])<=1024&&!/[\x00-\x1f\x7f]/.test(ack[k]))||key?.asymmetricKeyType!=='ed25519')fail();
 const {ack_sig,...payload}=ack;if(!verify(null,Buffer.from(canonical(payload)),key,signature(ack_sig)))fail();return ack;
}
export function exporterAttestation(record,ack,key,now=Date.now()){
 verifyExporterAck(record,ack,key,now);
 const keyId=k=>createHash('sha256').update(k.export({type:'spki',format:'der'})).digest('hex');
 return {verified:true,through_seq:record.seq,digest:record.digest,key_id:'checkpoint-v1',signature:record.sig,install_id:record.install_id,boot_id:record.boot_id,sink_key_id:keyId(key),sink_signature:ack.ack_sig,ack_id:createHash('sha256').update(canonical(ack)).digest('hex'),expires_at:new Date(now+5000).toISOString()};
}
export async function exchangeCheckpoint(record){
 await trustedPath('/run/sjcos-browser-exporter');
 const socketStat=await lstat(CHECKPOINT_SOCKET);if(!socketStat.isSocket()||socketStat.isSymbolicLink()||socketStat.uid!==0||(socketStat.mode&0o002))fail();
 return new Promise((resolve,reject)=>{
  const socket=connect(CHECKPOINT_SOCKET);let bytes=Buffer.alloc(0),done=false;
  const finish=(error,value)=>{if(done)return;done=true;socket.destroy();error?reject(Error('BROWSER_SERVICE_UNAVAILABLE')):resolve(value);};
  socket.setTimeout(1500,()=>finish(true));socket.on('error',()=>finish(true));socket.on('end',()=>{if(!done)finish(true);});
  socket.once('connect',()=>{const line=canonical(record)+'\n';if(Buffer.byteLength(line)>1024)return finish(true);socket.write(line);});
  socket.on('data',chunk=>{if(bytes.length+chunk.length>4096)return finish(true);bytes=Buffer.concat([bytes,chunk]);const end=bytes.indexOf(10);if(end<0)return;if(end!==bytes.length-1)return finish(true);try{finish(false,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,end))));}catch{finish(true);}});
 });
}
export function createAuditCheckpointClient({directory,install_id,boot_id,privateKey,exporterPublicKey,commit,readHead,exchange=exchangeCheckpoint,maxBytes=64*1024*1024,clock=Date.now}){
 UUID.parse(install_id);UUID.parse(boot_id);
 if(privateKey?.asymmetricKeyType!=='ed25519'||exporterPublicKey?.asymmetricKeyType!=='ed25519'||typeof commit!=='function'||typeof readHead!=='function')fail();
 const publicKey=createPublicKey(privateKey);let last=clock(),events=0,ready=false,lock=Promise.resolve();
 const serial=fn=>{const next=lock.then(fn);lock=next.catch(()=>{});return next;};
 const outbox=createCheckpointOutbox({directory,maxBytes,deliver:cp=>{const replay_at=new Date(clock()).toISOString(),payload={...cp,replay_at};return exchange({...payload,replay_sig:sign(null,Buffer.from(canonical(payload)),privateKey).toString('base64')});},verifyRecord:cp=>verifyCheckpointRecord(cp,publicKey),verifyAck:(cp,ack)=>exporterAttestation(cp,ack,exporterPublicKey,clock()),clock});
 const replay=async()=>{let result;do{result=await outbox.replay(commit);}while(result.remaining>0);};
 const checkpoint=async head=>{
  if(!seq(head?.seq)||!hex(head.digest))fail();
  const payload={v:1,seq:head.seq,digest:head.digest,time:new Date(clock()).toISOString(),install_id,boot_id};
  const cp={...payload,sig:sign(null,Buffer.from(canonical(payload)),privateKey).toString('base64')};
  // Replay all prior pending records before a newer head can reach the sink.
  await outbox.enqueue(cp);await replay();last=clock();events=0;return {checkpoint:cp};
 };
 return Object.freeze({
  checkpoint:head=>serial(()=>checkpoint(head)),
  beforeEffect:()=>serial(async()=>{if(!ready)fail();await replay();await outbox.capacity();}),
  boot:()=>serial(async()=>{ready=false;await replay();ready=true;last=clock();}),
  event:head=>serial(async()=>{if(!ready)fail();events++;if(events>=100||clock()-last>=60000)return checkpoint(head);}),
  tick:()=>serial(async()=>{if(!ready)fail();if(clock()-last>=60000){const head=await readHead();if(head?.seq>0)await checkpoint(head);}}),
  shutdown:()=>serial(async()=>{ready=false;await replay();const head=await readHead();if(head?.seq>0)await checkpoint(head);}),
 });
}

/** Concrete ordered assembly: owner verifier attests the cryptographic ACK,
 * narrow SQL checkpoint commits, THEN local spool removal. stageEvent must
 * produce the exact authenticated event accepted by browser_append_audit. */
export function createProductionAudit({transaction,writer,stageEvent,readHead,...options}){
 if(typeof transaction!=='function'||typeof writer?.checkpoint!=='function'||typeof stageEvent!=='function')fail();
 const client=createAuditCheckpointClient({...options,readHead,commit:async result=>{
  await writer.checkpoint({checkpoint:result.checkpoint,ack:result.ack,ackId:result.ackId});
  const {browserCheckpoint}=await import('./repository.mjs');
  await transaction(c=>browserCheckpoint(c,{seq:result.checkpoint.seq,d:Buffer.from(result.checkpoint.digest,'hex'),key_id:result.attestation.key_id,signature:Buffer.from(result.checkpoint.sig,'base64'),external_ack:result.ackId}));
 }});
 const append=async intent=>{
  const {browserAppendAudit}=await import('./repository.mjs');
  const args=await stageEvent(intent),result=await transaction(c=>browserAppendAudit(c,args));
  const head=await readHead();if(head.seq<result.seq)fail();return head;
 };
 return {checkpoints:client,
  audit:async intent=>{const head=await append(intent);await client.event(head);},
  anchorPrivateView:async intent=>{const head=await append(intent);await client.checkpoint(head);return {consume_seq:head.seq};},
  anchorReadIntent:async intent=>{const head=await append(intent);await client.checkpoint(head);return {consume_seq:head.seq};},
 };
}

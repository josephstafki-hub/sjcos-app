/** Purpose separated audit verification. The installation's owner-only bridge
 * stages attestations; the controller itself never receives an owner DSN.
 * Independent checkpoint signature verification is mandatory, never ACK-shaped
 * success or signature presence. These functions have no startup side effects. */
import {createHmac,createHash,timingSafeEqual,verify} from 'node:crypto';
import {canonical} from './acceptance-attestation.mjs';
const fail=()=>{throw Error('BROWSER_SERVICE_UNAVAILABLE');};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function eventAttestation({event,chain,key,now=Date.now()}){
 if(!(key instanceof Uint8Array)||key.length!==32||!chain||chain.v!==1||!Number.isSafeInteger(event.seq)||event.seq<1||Date.parse(chain.at)>now||now-Date.parse(chain.at)>5000)fail();
 const expected=digest(canonical(event));
 if(expected!==chain.digest||chain.previous_digest!==event.previous_digest||chain.at!==event.at||canonical(chain.binding)!==canonical(event.binding)||!/^[a-f0-9]{64}$/.test(chain.hmac??''))fail();
 const h=createHmac('sha256',key).update('browser-phase1-audit\0').update(canonical(event)).digest();
 if(!timingSafeEqual(h,Buffer.from(chain.hmac,'hex')))fail();
 return {verified:true,digest:expected,hmac:chain.hmac,key_id:chain.key_id,expires_at:new Date(now+5000).toISOString()};
}
export function checkpointAttestation({checkpoint,ack,installationPublicKey,sinkPublicKey,now=Date.now()}){
 const {signature,...payload}=checkpoint??{}, {sink_signature,...sinkPayload}=ack??{};
 const decode=x=>{if(typeof x!=='string')fail();const b=Buffer.from(x,'base64');if(b.length!==64||b.toString('base64')!==x)fail();return b;};
 if(payload.purpose!=='browser-phase1-checkpoint'||sinkPayload.purpose!=='browser-phase1-independent-ack'||sinkPayload.digest!==payload.digest||sinkPayload.through_seq!==payload.through_seq||sinkPayload.install_id!==payload.install_id||sinkPayload.boot_id!==payload.boot_id||sinkPayload.key_id!==payload.key_id||sinkPayload.signature!==signature||Date.parse(payload.expires_at)<=now||Date.parse(sinkPayload.expires_at)<=now||!verify(null,Buffer.from(canonical(payload)),installationPublicKey,decode(signature))||!verify(null,Buffer.from(canonical(sinkPayload)),sinkPublicKey,decode(sink_signature)))fail();
 return {verified:true,through_seq:payload.through_seq,digest:payload.digest,key_id:payload.key_id,signature,install_id:payload.install_id,boot_id:payload.boot_id,sink_key_id:sinkPayload.sink_key_id,sink_signature,expires_at:new Date(Math.min(now+5000,Date.parse(payload.expires_at),Date.parse(sinkPayload.expires_at))).toISOString()};
}
export function createAuditService({repository,stageEvent,independentCheckpoint}){
 if(!repository||typeof stageEvent!=='function'||typeof independentCheckpoint!=='function')fail();
 return {
  async anchorReadIntent(intent){
   // Trusted bridge verifies HMAC and canonical event, commits append, obtains
   // independent signature, stages owner-only checkpoint attestation and commits
   // SQL checkpoint. Missing any step throws; D must then consume exactly once.
   const event=await stageEvent(intent);const appended=await repository.append(event);
   const checkpoint=await independentCheckpoint({...event,seq:appended.seq});
   if(!checkpoint?.attestation||checkpoint.attestation.verified!==true)fail();
   await repository.checkpoint(checkpoint);return {consume_seq:appended.seq,checkpoint_ack_id:checkpoint.ack};
  },
 };
}

/** Owner-only attestation writer. No caller supplies a setting key or an
 * already-verified boolean. Actual LOGIN is checked inside each transaction. */
export function createProtectedAuditWriter({transaction,eventKey,installationPublicKey,sinkPublicKey,clock=Date.now}){
 if(typeof transaction!=='function')fail();
 const write=(setting,value)=>transaction(async c=>{
  const {rows}=await c.query("SELECT session_user::text AS login,current_user::text AS effective,pg_get_userbyid(relowner)::text AS owner FROM pg_class WHERE oid='public.app_settings'::regclass");
  if(rows.length!==1||rows[0].login!==rows[0].owner||rows[0].effective!==rows[0].owner)fail();
  await c.query('INSERT INTO app_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[setting,JSON.stringify(value)]);return value;
 });
 return {
  async event({event,chain}){
   const {UUID}=await import('./phase1-contracts.mjs');UUID.parse(event.event_id);UUID.parse(event.task_id);
   if(Object.keys(event).sort().join(',')!=='at,binding,code,event,event_id,object_id,previous_digest,seq,task_id,v'||event.v!==1||!['task_admitted','run_attached','run_ended','task_transition','viewer_joined','viewer_left','command_begin','command_finish','manifest_published','read_consumed','maintenance'].includes(event.event))fail();
   return write('browser.audit_event.'+event.event_id,eventAttestation({event,chain,key:eventKey,now:clock()}));
  },
  async checkpoint({checkpoint,ack,ackId}){
   if(typeof ackId!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(ackId))fail();
   if(checkpoint?.v===1){
    const {verifyCheckpointRecord,exporterAttestation}=await import('./audit-checkpoint-client.mjs');
    verifyCheckpointRecord(checkpoint,installationPublicKey);
    const attestation=exporterAttestation(checkpoint,ack,sinkPublicKey,clock());if(attestation.ack_id!==ackId)fail();
    return write('browser.checkpoint.'+ackId,attestation);
   }
   if(ack?.ack_id!==ackId)fail();
   return write('browser.checkpoint.'+ackId,checkpointAttestation({checkpoint,ack,installationPublicKey,sinkPublicKey,now:clock()}));
  },
 };
}
/** Protected fsynced outbox. This is NOT an independent sink. deliver must
 * contact the installation's independently administered append-only sink and
 * return a verified Ed25519 ACK; outage leaves the item for crash-safe replay.
 * No read dispatch is possible merely because a spool file was written. */
export function createCheckpointOutbox({directory,installationPublicKey,sinkPublicKey,deliver,refreshCheckpoint,verifyRecord,verifyAck,maxBytes=64*1024*1024,clock=Date.now}){
 if(typeof directory!=='string'||!directory.startsWith('/')||typeof deliver!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024)fail();
 let lock=Promise.resolve();
 const serial=async fn=>{const prior=lock;let release;lock=new Promise(r=>release=r);await prior;try{return await fn();}finally{release();}};
 const fs=()=>import('node:fs/promises');
 const syncDir=async()=>{const f=await (await fs()).open(directory,'r');try{await f.sync();}finally{await f.close();}};
 const entries=async()=>{
  const f=await fs(),s=await f.lstat(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))fail();
  const names=await f.readdir(directory);let total=0;const list=[];
  for(const name of names){if(!/^[0-9a-f]{64}\.json$/.test(name))fail();const st=await f.lstat(directory+'/'+name);if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077)||st.size>8192)fail();total+=st.size;list.push(name);}
  if(total>maxBytes)fail();return {list,total};
 };
 const store=async checkpoint=>{
  const f=await fs(),bytes=canonical(checkpoint);if(Buffer.byteLength(bytes)>4096)fail();
  const name=digest(bytes)+'.json',file=directory+'/'+name,{total}=await entries();if(total+Buffer.byteLength(bytes)>maxBytes)fail();
  let handle;try{handle=await f.open(file,'wx',0o600);await handle.writeFile(bytes);await handle.sync();}catch(e){if(e.code!=='EEXIST')throw e;if(await f.readFile(file,'utf8')!==bytes)fail();}finally{await handle?.close();}await syncDir();return file;
 };
 const send=async(checkpoint,file)=>{
  if(verifyRecord)verifyRecord(checkpoint);
  const ack=await deliver(checkpoint);
  const attestation=verifyAck?verifyAck(checkpoint,ack):checkpointAttestation({checkpoint,ack,installationPublicKey,sinkPublicKey,now:clock()});
  const ackId=verifyAck?attestation.ack_id:ack.ack_id;
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(ackId??''))fail();
  // Caller must commit SQL checkpoint before acknowledging/removing the file.
  return {checkpoint,ack,attestation,ackId,complete:async()=>serial(async()=>{await (await fs()).unlink(file);await syncDir();})};
 };
 return {
  capacity:()=>serial(async()=>{const {total}=await entries();if(total+1024>maxBytes)fail();return true;}),
  enqueue:checkpoint=>serial(async()=>{if(verifyRecord)verifyRecord(checkpoint);return store(checkpoint);}),
  submit:checkpoint=>serial(async()=>send(checkpoint,await store(checkpoint))),
  replay:commit=>serial(async()=>{
   if(typeof commit!=='function')fail();const {list}=await entries();let count=0;
   // Hash filenames are not chronological: independently pinned sink head is
   // monotonic, so replay strictly in sequence order, including boot boundaries.
   const ordered=[];for(const name of list){const value=JSON.parse(await (await fs()).readFile(directory+'/'+name,'utf8'));ordered.push({name,seq:value.seq??value.through_seq});}
   ordered.sort((a,b)=>a.seq-b.seq||a.name.localeCompare(b.name));
   for(const {name} of ordered.slice(0,100)){
    const file=directory+'/'+name;let checkpoint=JSON.parse(await (await fs()).readFile(file,'utf8'));
    if(digest(canonical(checkpoint))+'.json'!==name)fail();
    if(Date.parse(checkpoint.expires_at)<=clock()){
     const {signature,...original}=checkpoint;
     if(typeof refreshCheckpoint!=='function'||!verify(null,Buffer.from(canonical(original)),installationPublicKey,Buffer.from(signature,'base64')))fail();
     const fresh=await refreshCheckpoint(checkpoint),{signature:_,expires_at:__,...identity}=fresh;
     const {expires_at:___,...prior}=original;
     if(canonical(identity)!==canonical(prior))fail();checkpoint=fresh;
    }
    const result=await send(checkpoint,file);await commit(result);await (await fs()).unlink(file);await syncDir();count++;
   }return {replayed:count,remaining:list.length-count};
  }),
 };
}

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

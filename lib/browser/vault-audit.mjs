// Offline/controller audit primitives. HMAC, Ed25519 signing keys and external
// sink trust/high-water configuration never come from the application database.
import {createHash,createHmac,timingSafeEqual,verify,sign} from 'node:crypto';
import {canonicalJson} from './vault.mjs';
const events=new Set(['task_admitted','run_attached','run_ended','task_transition','viewer_joined','viewer_left','session_revoked','command_begin','command_finish','manifest_published','read_consumed','checkpoint','maintenance','action_prepared','action_approved','action_denied','action_consumed','action_result','action_stale','vault_changed','file_changed','handoff_changed','key_rotated','retention_boundary']);
const fail=()=>{throw Error('BROWSER_AUDIT_INVALID');};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
function eventBytes(e){
 if(Object.keys(e).sort().join()!==['seq','event_id','task_id','run_id','actor_user_id','event','canonical_origin','object_id','revision','result_code','at','key_id'].sort().join()||!Number.isSafeInteger(e.seq)||e.seq<1||!events.has(e.event)||!uuid(e.event_id)||! /^[A-Z0-9_]{1,80}$/.test(e.result_code)||! /^[a-z0-9_-]{1,80}$/.test(e.key_id)||new Date(e.at).toISOString()!==e.at)fail();
 for(const k of ['task_id','run_id','actor_user_id','object_id'])if(e[k]!==null&&!uuid(e[k]))fail();
 if(e.revision!==null&&(!Number.isSafeInteger(e.revision)||e.revision<1))fail();
 if(e.canonical_origin!==null&&! /^https:\/\/[a-z0-9.-]+$/.test(e.canonical_origin))fail();
 return Buffer.from(canonicalJson(e));
}
export function authenticateAuditEvent(event,previous_digest,key){
 if(!hex(previous_digest)||!Buffer.isBuffer(key)||key.length!==32)fail();
 const digest=createHash('sha256').update('SJCOS/browser/audit/v1\0').update(eventBytes(event)).update(Buffer.from(previous_digest,'hex')).digest('hex');
 const hmac=createHmac('sha256',key).update('SJCOS/browser/audit-auth/v1\0').update(Buffer.from(digest,'hex')).digest('hex');
 return {event,previous_digest,digest,hmac};
}
function equal(a,b){return hex(a)&&hex(b)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
function checkpointBytes(c){
 if(Object.keys(c).sort().join()!==['through_seq','digest','at','install_id','boot_id','key_id'].sort().join()||!Number.isSafeInteger(c.through_seq)||c.through_seq<1||!hex(c.digest)||!uuid(c.install_id)||!uuid(c.boot_id)||new Date(c.at).toISOString()!==c.at||! /^[a-z0-9_-]{1,80}$/.test(c.key_id))fail();
 return Buffer.from('SJCOS/browser/checkpoint/v1\0'+canonicalJson(c));
}
export function signAuditCheckpoint(checkpoint,privateKey){return sign(null,checkpointBytes(checkpoint),privateKey).toString('base64');}
export function auditAckBytes(checkpoint,signature,ack_id,sink_key_id){
 if(!uuid(ack_id)||! /^[a-z0-9_-]{1,80}$/.test(sink_key_id))fail();
 return Buffer.from('SJCOS/browser/sink-ack/v1\0'+canonicalJson({checkpoint,signature,ack_id,sink_key_id}));
}
export function verifyAudit({rows,keys,checkpoints,signingKeys,sinkKeys,expectedHighest,boundary={seq:0,digest:'00'.repeat(32)},installId}){
 try{
  if(!Number.isSafeInteger(expectedHighest)||expectedHighest<1||!uuid(installId)||!hex(boundary.digest))fail();
  let seq=boundary.seq,previous=boundary.digest;const digests=new Map([[seq,previous]]);
  for(const row of rows){if(row.event.seq!==seq+1||row.previous_digest!==previous)fail();const expected=authenticateAuditEvent(row.event,previous,keys[row.event.key_id]);if(!equal(row.digest,expected.digest)||!equal(row.hmac,expected.hmac))fail();seq++;previous=row.digest;digests.set(seq,previous);}
  let high=0;
  for(const anchor of checkpoints){const c=anchor.checkpoint;
   if(c.install_id!==installId||c.through_seq<high||digests.get(c.through_seq)!==c.digest||!verify(null,checkpointBytes(c),signingKeys[c.key_id],Buffer.from(anchor.signature,'base64'))||!verify(null,auditAckBytes(c,anchor.signature,anchor.ack_id,anchor.sink_key_id),sinkKeys[anchor.sink_key_id],Buffer.from(anchor.sink_signature,'base64')))fail();high=c.through_seq;
  }
  if(seq!==expectedHighest||high!==expectedHighest)fail();
  // A retained boundary must itself have an independently acknowledged anchor.
  if(boundary.seq>0&&!checkpoints.some(a=>a.checkpoint.through_seq===boundary.seq&&a.checkpoint.digest===boundary.digest))fail();
  return {seq,digest:previous};
 }catch{fail();}
}

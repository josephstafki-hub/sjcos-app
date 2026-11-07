/** Frozen parameterized SQL adapters. Pass an explicit pg client, never a DSN.
 * Transaction ownership belongs to the caller; functions commit no network I/O.
 */
import {z} from 'zod';
import {UUID,UInt,TaskSafe,OriginManifest,ReadManifestV1,InputEpochs,ReadConsumeProof,ReviewNotice,OwnerBrowserReviewClaim,ERROR_CODES} from './phase1-contracts.mjs';
const hash=z.instanceof(Uint8Array).refine(x=>x.byteLength===32);
const json=z.unknown().refine(x=>x!==undefined&&new TextEncoder().encode(JSON.stringify(x)).length<=65536);
export const SQL_FUNCTIONS=Object.freeze({
 browser_web_admit:Object.freeze({args:z.strictObject({conversation:UUID,project:UUID.nullable(),kind:z.string().max(500),manifest:z.strictObject({purpose:z.string().min(1).max(500),origins:OriginManifest,lead_slug:z.string().max(160).optional(),initial_read:ReadManifestV1}),session:UUID,i:UUID,d:hash}),sql:"SELECT public.browser_web_admit($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::uuid,$6::uuid,$7::bytea) AS result",keys:["conversation", "project", "kind", "manifest", "session", "i", "d"]}),
 browser_web_join:Object.freeze({args:z.strictObject({tid:UUID,session:UUID,device_hash:hash,role:z.string().max(500),private_view:z.boolean(),i:UUID,d:hash}),sql:"SELECT public.browser_web_join($1::uuid,$2::uuid,$3::bytea,$4::text,$5::boolean,$6::uuid,$7::bytea) AS result",keys:["tid", "session", "device_hash", "role", "private_view", "i", "d"]}),
 browser_web_leave:Object.freeze({args:z.strictObject({vid:UUID,i:UUID}),sql:"SELECT public.browser_web_leave($1::uuid,$2::uuid) AS result",keys:["vid", "i"]}),
 browser_web_presence:Object.freeze({args:z.strictObject({vid:UUID,visible:z.boolean(),generation:UInt,i:UUID}),sql:"SELECT public.browser_web_presence($1::uuid,$2::boolean,$3::bigint,$4::uuid) AS result",keys:["vid", "visible", "generation", "i"]}),
 browser_web_owner_view:Object.freeze({args:z.strictObject({tid:UUID,aid:UUID.nullable(),session:UUID,local_thread:UUID.nullable(),i:UUID}),sql:"SELECT public.browser_web_owner_view($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid) AS result",keys:["tid", "aid", "session", "local_thread", "i"]}),
 browser_web_sites:Object.freeze({args:z.strictObject({tid:UUID,vid:UUID,expected_revision:UInt,manifest:OriginManifest,i:UUID,d:hash}),sql:"SELECT public.browser_web_sites($1::uuid,$2::uuid,$3::integer,$4::jsonb,$5::uuid,$6::bytea) AS result",keys:["tid", "vid", "expected_revision", "manifest", "i", "d"]}),
 browser_web_reads:Object.freeze({args:z.strictObject({tid:UUID,vid:UUID,expected_revision:UInt,proposal:ReadManifestV1,decision:z.string().max(500),i:UUID,d:hash}),sql:"SELECT public.browser_web_reads($1::uuid,$2::uuid,$3::integer,$4::jsonb,$5::text,$6::uuid,$7::bytea) AS result",keys:["tid", "vid", "expected_revision", "proposal", "decision", "i", "d"]}),
 browser_web_attach_run:Object.freeze({args:z.strictObject({tid:UUID,rid:UUID,vid:UUID,expected_epoch:UInt,i:UUID}),sql:"SELECT public.browser_web_attach_run($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::uuid) AS result",keys:["tid", "rid", "vid", "expected_epoch", "i"]}),
 browser_web_capability:Object.freeze({args:z.strictObject({tid:UUID,rid:UUID,vid:UUID,server_kind:z.string().max(500),process_binding:json,i:UUID}),sql:"SELECT public.browser_web_capability($1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::uuid) AS result",keys:["tid", "rid", "vid", "server_kind", "process_binding", "i"]}),
 browser_web_control:Object.freeze({args:z.strictObject({tid:UUID,vid:UUID,op:z.string().max(500),epoch:UInt,i:UUID,d:hash}),sql:"SELECT public.browser_web_control($1::uuid,$2::uuid,$3::text,$4::bigint,$5::uuid,$6::bytea) AS result",keys:["tid", "vid", "op", "epoch", "i", "d"]}),
 browser_web_input:Object.freeze({args:z.strictObject({tid:UUID,vid:UUID,frame:UUID,epochs:InputEpochs,seq:UInt,i:UUID,d:hash}),sql:"SELECT public.browser_web_input($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::bigint,$6::uuid,$7::bytea) AS result",keys:["tid", "vid", "frame", "epochs", "seq", "i", "d"]}),
 browser_authorize:Object.freeze({args:z.strictObject({tid:UUID,rid:UUID,k:hash}),sql:"SELECT public.browser_authorize($1::uuid,$2::uuid,$3::bytea) AS result",keys:["tid", "rid", "k"]}),
 browser_read_state:Object.freeze({args:z.strictObject({tid:UUID,k:hash,scope:z.string().max(500)}),sql:"SELECT public.browser_read_state($1::uuid,$2::bytea,$3::text) AS result",keys:["tid", "k", "scope"]}),
 browser_command_begin:Object.freeze({args:z.strictObject({tid:UUID,rid:UUID,k:hash,i:UUID,epoch:UInt,seq:UInt,op:z.string().max(500),d:hash}),sql:"SELECT public.browser_command_begin($1::uuid,$2::uuid,$3::bytea,$4::uuid,$5::bigint,$6::bigint,$7::text,$8::bytea) AS result",keys:["tid", "rid", "k", "i", "epoch", "seq", "op", "d"]}),
 browser_command_finish:Object.freeze({args:z.strictObject({command:UUID,boot:UUID,result:z.string().max(500)}),sql:"SELECT public.browser_command_finish($1::uuid,$2::uuid,$3::text) AS result",keys:["command", "boot", "result"]}),
 browser_enter_private:Object.freeze({args:z.strictObject({tid:UUID,boot:UUID,expected_epoch:UInt,mode:z.string().max(500)}),sql:"SELECT public.browser_enter_private($1::uuid,$2::uuid,$3::bigint,$4::text) AS result",keys:["tid", "boot", "expected_epoch", "mode"]}),
 browser_runtime_transition:Object.freeze({args:z.strictObject({tid:UUID,boot:UUID,epoch:UInt,next:z.string().max(500),code:z.string().max(500)}),sql:"SELECT public.browser_runtime_transition($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text) AS result",keys:["tid", "boot", "epoch", "next", "code"]}),
 browser_run_end:Object.freeze({args:z.strictObject({tid:UUID,rid:UUID,disposition:z.string().max(500),boot:UUID}),sql:"SELECT public.browser_run_end($1::uuid,$2::uuid,$3::text,$4::uuid) AS result",keys:["tid", "rid", "disposition", "boot"]}),
 browser_maintenance_claim:Object.freeze({args:z.strictObject({boot:UUID,lim:UInt}),sql:"SELECT public.browser_maintenance_claim($1::uuid,$2::integer) AS result",keys:["boot", "lim"]}),
 browser_maintenance_finish:Object.freeze({args:z.strictObject({job:UUID,boot:UUID,result:z.string().max(500),proof:json}),sql:"SELECT public.browser_maintenance_finish($1::uuid,$2::uuid,$3::text,$4::jsonb) AS result",keys:["job", "boot", "result", "proof"]}),
 browser_append_audit:Object.freeze({args:z.strictObject({tid:UUID,event_id:UUID,event:z.string().max(500),object_id:UUID.nullable(),code:z.string().max(500),chain:json}),sql:"SELECT public.browser_append_audit($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::jsonb) AS result",keys:["tid", "event_id", "event", "object_id", "code", "chain"]}),
 browser_checkpoint:Object.freeze({args:z.strictObject({seq:UInt,d:hash,key_id:z.string().max(500),signature:z.instanceof(Uint8Array).refine(x=>x.byteLength===64),external_ack:z.string().max(500)}),sql:"SELECT public.browser_checkpoint($1::bigint,$2::bytea,$3::text,$4::bytea,$5::text) AS result",keys:["seq", "d", "key_id", "signature", "external_ack"]}),
 browser_read_consume:Object.freeze({args:z.strictObject({tid:UUID,boot:UUID,revision:UInt,entry:UUID,manifest_d:hash,request_d:hash,flow_nonce:UUID,generation:UInt,epoch:UInt}),sql:"SELECT public.browser_read_consume($1::uuid,$2::uuid,$3::integer,$4::uuid,$5::bytea,$6::bytea,$7::uuid,$8::bigint,$9::bigint) AS result",keys:["tid", "boot", "revision", "entry", "manifest_d", "request_d", "flow_nonce", "generation", "epoch"]}),
 browser_web_queue:Object.freeze({args:z.strictObject({tid:UUID,vid:UUID,op:z.string().max(500),i:UUID,d:hash}),sql:"SELECT public.browser_web_queue($1::uuid,$2::uuid,$3::text,$4::uuid,$5::bytea) AS result",keys:["tid", "vid", "op", "i", "d"]}),
 browser_queue_offer:Object.freeze({args:z.strictObject({boot:UUID}),sql:"SELECT public.browser_queue_offer($1::uuid) AS result",keys:["boot"]}),
});
const utc=z.iso.datetime(),positive=UInt.min(1),hex=z.string().regex(/^[0-9a-f]{64}$/),o=z.strictObject;
const states=z.enum(['accepted','running','succeeded','failed','unknown']);
export const RESULT_SCHEMAS=Object.freeze({
 browser_web_admit:TaskSafe,browser_web_join:o({viewer_id:UUID,expires_at:utc}),browser_web_leave:o({left:z.literal(true)}),
 browser_web_owner_view:OwnerBrowserReviewClaim,browser_web_presence:o({present_until:utc}),browser_web_sites:TaskSafe,
 browser_web_reads:o({revision:UInt,digest:hex.nullable(),expires_at:utc.nullable(),blocked_entries:z.array(o({id:UUID,code:z.enum(ERROR_CODES)})),pending_action_id:z.null()}),
 browser_web_attach_run:TaskSafe,browser_web_capability:o({capability_hash:hex,expires_at:utc}),browser_web_control:TaskSafe,
 browser_web_input:o({proof_id:UUID,expires_at:utc}),browser_authorize:TaskSafe,
 browser_command_begin:o({command_id:UUID,state:states}),browser_command_finish:o({state:states}),browser_read_consume:ReadConsumeProof,
 browser_enter_private:TaskSafe,browser_runtime_transition:TaskSafe,browser_run_end:TaskSafe,
 browser_maintenance_claim:o({jobs:z.array(o({id:UUID,kind:z.enum(['cleanup','reconcile','revoke']),object_id:UUID,expected_revision:UInt,lease_until:utc})).max(25)}),
 browser_maintenance_finish:o({done:z.boolean()}),browser_append_audit:o({seq:positive}),browser_checkpoint:o({recorded:z.literal(true)}),
 browser_web_queue:TaskSafe,browser_queue_offer:z.union([o({offered:z.literal(false)}),o({offered:z.literal(true),task_id:UUID,offer_expires_at:utc})])
});
export async function callBrowserFunction(client,name,args){
 if(!client||typeof client.query!=='function'||!Object.hasOwn(SQL_FUNCTIONS,name))throw Error('BROWSER_BAD_INPUT');
 const def=SQL_FUNCTIONS[name],parsed=def.args.parse(args);
 const result=await client.query(def.sql,def.keys.map(k=>parsed[k] instanceof Uint8Array?parsed[k]:typeof parsed[k]==='object'&&parsed[k]!==null?JSON.stringify(parsed[k]):parsed[k]));
 const value=result.rows[0]?.result;
 if(name==='browser_read_state')return (parsed.scope==='task'?TaskSafe:parsed.scope==='action'?ReviewNotice.nullable():z.array(z.never()).max(0)).parse(value);
 return RESULT_SCHEMAS[name].parse(value);
}
export const browserWebAdmit=(client,args)=>callBrowserFunction(client,"browser_web_admit",args);
export const browserWebJoin=(client,args)=>callBrowserFunction(client,"browser_web_join",args);
export const browserWebLeave=(client,args)=>callBrowserFunction(client,"browser_web_leave",args);
export const browserWebPresence=(client,args)=>callBrowserFunction(client,"browser_web_presence",args);
export const browserWebOwnerView=(client,args)=>callBrowserFunction(client,"browser_web_owner_view",args);
export const browserWebSites=(client,args)=>callBrowserFunction(client,"browser_web_sites",args);
export const browserWebReads=(client,args)=>callBrowserFunction(client,"browser_web_reads",args);
export const browserWebAttachRun=(client,args)=>callBrowserFunction(client,"browser_web_attach_run",args);
export const browserWebCapability=(client,args)=>callBrowserFunction(client,"browser_web_capability",args);
export const browserWebControl=(client,args)=>callBrowserFunction(client,"browser_web_control",args);
export const browserWebInput=(client,args)=>callBrowserFunction(client,"browser_web_input",args);
export const browserAuthorize=(client,args)=>callBrowserFunction(client,"browser_authorize",args);
export const browserReadState=(client,args)=>callBrowserFunction(client,"browser_read_state",args);
export const browserCommandBegin=(client,args)=>callBrowserFunction(client,"browser_command_begin",args);
export const browserCommandFinish=(client,args)=>callBrowserFunction(client,"browser_command_finish",args);
export const browserEnterPrivate=(client,args)=>callBrowserFunction(client,"browser_enter_private",args);
export const browserRuntimeTransition=(client,args)=>callBrowserFunction(client,"browser_runtime_transition",args);
export const browserRunEnd=(client,args)=>callBrowserFunction(client,"browser_run_end",args);
export const browserMaintenanceClaim=(client,args)=>callBrowserFunction(client,"browser_maintenance_claim",args);
export const browserMaintenanceFinish=(client,args)=>callBrowserFunction(client,"browser_maintenance_finish",args);
export const browserAppendAudit=(client,args)=>callBrowserFunction(client,"browser_append_audit",args);
export const browserCheckpoint=(client,args)=>callBrowserFunction(client,"browser_checkpoint",args);
export const browserReadConsume=(client,args)=>callBrowserFunction(client,"browser_read_consume",args);
export const browserWebQueue=(client,args)=>callBrowserFunction(client,"browser_web_queue",args);
export const browserQueueOffer=(client,args)=>callBrowserFunction(client,"browser_queue_offer",args);

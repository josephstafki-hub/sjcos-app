/** Owner-connection transaction service. Caller authenticates freshly and supplies a
 * server-minted person envelope. Never expose an envelope or this client to browsers. */
import {pinnedDerivations} from './derive.ts';
import {signOfflineLease} from './offline-lease.ts';
import {enqueueConsultFindings} from '../worker/consult.ts';
import type { PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from './queue.ts';
import { consultCompleteness, type CompletionInput, type CompletionItem } from './completeness.ts';
import { compileCondition } from './forms/conditions.ts';
import { validateModule, validateTemplate, type FormRegistry } from './forms/validate.ts';
import type { ModuleDef, TemplateDef } from './form-types.ts';
const uuid=z.string().uuid(), rev=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;});
const note=z.string().trim().min(1).max(8000);
const skip=z.enum(['Not on this job','No access','Not safe to measure','Client declined','Get on return visit','Sub/supplier will measure','Other']);
const assumption=z.strictObject({text:note,responsible_trade:note,verification_point:note,adjustment_route:z.enum(['precon_change','change_order']),quantity:z.number().finite().nonnegative().nullable(),unit:note.nullable(),exclusion:note.nullable()});
export const evidenceSchema=z.strictObject({
 photos_ok:z.boolean(),manual_confirmed:z.literal(true),handed_back:z.literal(true),ack_reason:note.nullable(),promised_date:day,
 no_trades_confirmed:z.boolean(),touched_trades:z.array(note).max(50),
 trade_walks:z.array(z.strictObject({trade:note,needed:z.boolean(),reason:note,day:day.optional()})).max(50),
 rrp:z.strictObject({receipt:z.boolean(),firm_current:z.boolean(),renovator_current:z.boolean(),redelivery_required:z.boolean(),redelivery_day:day.optional()}),
 flags:z.record(z.string(),z.strictObject({disposition:z.enum(['price_it','allowance','sub_must_look','not_an_issue']),note})),
 skips:z.record(z.string(),z.strictObject({reason:skip,note:note.optional(),assumption:assumption.optional(),trade_walk_decided:z.boolean().optional()})),
 return_day:day.optional(),
});
const address=z.strictObject({instance_id:uuid,field_key:z.string().regex(/^[a-z][a-z0-9_]*$/)});
const opSchema=z.strictObject({protocol_version:z.literal(1),client_event_id:uuid,device_id:uuid,device_epoch:rev.min(1),seq:rev.min(1),base_revision:rev,generation:rev.min(1),type:z.enum(['start','answer','clear','create_instance','remove_instance','resolve','discard_rejection']),target:z.unknown(),payload:z.unknown(),payload_sha256:z.string().regex(/^[a-f0-9]{64}$/)});
const answerPayload=z.strictObject({status:z.enum(['answered','skipped','cleared']),value:z.unknown().optional(),unit:z.string().optional(),skip_reason:skip.optional(),skip_note:z.string().max(8000).optional()});
const instanceTarget=z.strictObject({instance_id:uuid,module_key:z.string(),parent_id:uuid.optional(),label:note});
const manifestSchema=z.strictObject({device:uuid,epoch:rev.min(1),last_seq:rev,required_blob_hashes:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(10000),initials_hash:z.string().regex(/^[a-f0-9]{64}$/).nullable(),local_pending:z.literal(0)});
export const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
type Context={key_id:string;payload:string;signature:string};
type Snapshot={consult:{id:string;project_id:string;status:string;revision:string;completion_generation:string;conducted_by:string;scheduled_at:string};pins:{definition:ModuleDef|TemplateDef;kind:string}[];instances:{id:string;module_key:string;parent_id:string|null;removed_at:string|null}[];heads:{id:string;instance_id:string;field_key:string;status:string;value:unknown;skip_reason:string|null;skip_note:string|null;server_revision:string}[];conflicts:unknown[]};
async function one<T=Record<string,unknown>>(c:PoolClient,sql:string,args:unknown[]=[]):Promise<T>{return (await c.query(sql,args)).rows[0] as T;}
export async function snapshot(c:PoolClient,context:Context,target:string):Promise<Snapshot>{
 const result=(await one<{v:Snapshot}>(c,'SELECT consult_read($1,$2) v',[await scoped(c,context,'read',target),target])).v;
 const visitPin=result.pins.find(p=>p.kind==='module'&&p.definition.key==='visit');
 if(visitPin){
  const instance=result.consult.id;const keys=result.pins.filter(p=>p.kind==='template').map(p=>p.definition.key);
  const templateKeys=keys.filter(k=>!['garage','openings','flooring'].includes(k));
  result.instances.push({id:instance,module_key:'visit',parent_id:null,removed_at:null});
  for(const [field,value] of Object.entries({templates:templateKeys,add_ons:keys.filter(k=>['garage','openings','flooring'].includes(k))}))result.heads.push({id:instance,instance_id:instance,field_key:field,status:'answered',value,skip_reason:null,skip_note:null,server_revision:result.consult.revision});
 }
 const proposals=(await c.query("SELECT id,actor,instance_id,field_key,base_revision,answer,source_note,generation FROM consult_agent_proposals WHERE consult_id=$1 AND status='pending' ORDER BY id",[target])).rows;
 const findings_job=(await c.query('SELECT generation,status,attempts,available_at,lease_until,last_error,result FROM consult_findings_jobs WHERE consult_id=$1 AND generation=$2',[target,result.consult.completion_generation])).rows[0]??null;
 return {...result,proposals,findings_job} as Snapshot;
}
async function scoped(c:PoolClient,context:Context,operation:string,target:string|null):Promise<Context>{
 const claims=JSON.parse(context.payload);return (await one<{v:Context}>(c,'SELECT consult_mint_context($1,$2) v',[{...claims,operation,consult_id:target},context.key_id])).v;
}
async function authorize(c:PoolClient,context:Context,target:string|null,operation:string,owner=false):Promise<string>{
 const actor=(await one<{v:string}>(c,'SELECT consult_verify_context($1,$2,$3) v',[context,target,operation])).v;
 if(JSON.parse(context.payload).mode!=='person')throw new Error('person_required');
 if(owner && !(await one(c,"SELECT id FROM users WHERE id=$1 AND role='owner'",[actor])))throw new Error('owner_required');
 return actor;
}
async function deviceGate(c:PoolClient,target:string,device:string,epoch:number,actor:string){
 const d=await one<{last_ack_seq:string}>(c,'SELECT last_ack_seq FROM consult_devices WHERE consult_id=$1 AND device_id=$2 AND epoch=$3 AND user_id=$4 AND revoked_at IS NULL FOR UPDATE',[target,device,epoch,actor]);
 if(!d)throw new Error('device_access_denied');return Number(d.last_ack_seq);
}
async function todo(c:PoolClient,s:Snapshot,kind:string,key:string,title:string,assignee:string,date:string|null){
 // Serial consult lock + stable source key makes retries exactly once. No promotion.
 const source=`${s.consult.id}:${kind}:${key}`;
 if(date)await c.query("UPDATE work_items SET due_at=$2::date::timestamp AT TIME ZONE 'America/Chicago' WHERE source_kind='consult' AND source_id=$1 AND status NOT IN ('done','cancelled')",[source,date]);
 await c.query(`INSERT INTO work_items(title,project_id,assignee_key,due_at,source_kind,source_id,requires_approval,created_by)
 SELECT $1,$2,$3,$4::date::timestamp AT TIME ZONE 'America/Chicago','consult',$5,false,'consult'
 WHERE NOT EXISTS(SELECT 1 FROM work_items WHERE source_kind='consult' AND source_id=$5)`,[title,s.consult.project_id,assignee,date,source]);
}
async function audit(c:PoolClient,target:string,actor:string,type:string,payload:unknown){
 await c.query(`INSERT INTO consult_events(consult_id,event_id,actor,source,type,payload,payload_hash,server_revision,generation)
 SELECT id,$2,$3,'office',$4,$5,$6,revision,completion_generation FROM consults WHERE id=$1`,[target,randomUUID(),actor,type,payload,hash(payload)]);
}
async function ownerId(c:PoolClient):Promise<string>{const row=await one<{id:string}>(c,"SELECT id FROM users WHERE role='owner' AND active ORDER BY created_at,id LIMIT 1");if(!row)throw new Error('owner_missing');return row.id;}
export async function schedule(c:PoolClient,context:Context,input:unknown){
 await authorize(c,context,null,'schedule',true);
 const v=z.strictObject({project:uuid,visit_time:z.string().datetime({offset:true}),visitor:uuid,forms:z.array(uuid).min(1),plan:uuid.nullable().optional(),plan_revision:rev.nullable().optional()}).parse(input);
 const id=(await one<{id:string}>(c,'SELECT consult_schedule($1,$2,$3,$4,$5,$6,$7) id',[context,v.project,v.visit_time,v.visitor,v.forms,v.plan??null,v.plan_revision??null])).id;
 const s=await snapshot(c,context,id);const date=(await one<{work_day:string}>(c,"SELECT ($1::timestamptz AT TIME ZONE 'America/Chicago')::date::text AS work_day",[v.visit_time])).work_day;
 await todo(c,s,'schedule','visit','In-home consultation',v.visitor,date);return {id};
}
export async function assign(c:PoolClient,context:Context,target:string,input:unknown){
 const actor=await authorize(c,context,target,'assign',true);
 const v=z.strictObject({visitor:uuid,expected_revision:rev,scheduled_at:z.string().datetime({offset:true}).optional()}).parse(input);
 const s=await snapshot(c,context,target);
 if(Number(s.consult.revision)!==v.expected_revision)throw new Error('conflict');
 if(s.consult.status==='complete')throw new Error('complete_locked');
 if(!await one(c,"SELECT id FROM users WHERE id=$1 AND active AND (role='owner' OR (role='staff' AND 'projects'=ANY(permissions)))",[v.visitor]))throw new Error('invalid_visitor');
 await c.query('UPDATE consult_assignments SET revoked_at=now() WHERE consult_id=$1 AND revoked_at IS NULL',[target]);
 await c.query(`INSERT INTO consult_assignments(consult_id,user_id,assigned_by) VALUES($1,$2,$3) ON CONFLICT(consult_id,user_id) DO UPDATE SET revoked_at=NULL,assigned_by=$3,assigned_at=now()`,[target,v.visitor,actor]);
 await c.query('UPDATE consult_devices SET revoked_at=now() WHERE consult_id=$1 AND revoked_at IS NULL',[target]);
 await c.query("UPDATE consults SET conducted_by=$2,scheduled_at=coalesce($3::timestamptz,scheduled_at),revision=revision+1,status='scheduled' WHERE id=$1",[target,v.visitor,v.scheduled_at??null]);
 await c.query("UPDATE work_items SET assignee_key=$2,due_at=(coalesce($3::timestamptz,$4::timestamptz) AT TIME ZONE 'America/Chicago')::date::timestamp AT TIME ZONE 'America/Chicago' WHERE source_kind='consult' AND source_id=$1",[`${target}:schedule:visit`,v.visitor,v.scheduled_at??null,s.consult.scheduled_at]);
 await audit(c,target,actor,'assignment',v);
 return {revision:v.expected_revision+1};
}
export async function publish(c:PoolClient,context:Context,input:unknown){
 await authorize(c,context,null,'publish_form',true);
 const v=z.strictObject({form_id:uuid,registry_id:uuid}).parse(input);
 const registered=await one<{mappings:FormRegistry['mappings']}>(c,'SELECT mappings FROM consult_mapping_registries WHERE id=$1',[v.registry_id]);
 if(!registered)throw new Error('unknown_mapping_registry');
 // Mappings are an owner-managed versioned registry, not a staff assertion.
 const form=await one<{definition:ModuleDef|TemplateDef;kind:string}>(c,'SELECT definition,kind FROM consult_form_versions WHERE id=$1 FOR UPDATE',[v.form_id]);
 if(!form)throw new Error('form_not_found');
 const modules=(await c.query("SELECT definition FROM consult_form_versions WHERE kind='module' AND (status='published' OR ($1='module' AND status='draft'))",[form.kind])).rows.map(r=>r.definition as ModuleDef);
 const registry:FormRegistry={modules,mappings:registered.mappings};
 if(form.kind==='module')validateModule(form.definition,{...registry,modules:[...modules.filter(m=>m.key!==form.definition.key),form.definition as ModuleDef]});else validateTemplate(form.definition,registry);
 await c.query('INSERT INTO consult_publication_validations(form_id,checksum,registry_id,validator_version) SELECT id,checksum,$2,1 FROM consult_form_versions WHERE id=$1',[v.form_id,v.registry_id]);
 return one(c,'SELECT consult_publish_form($1,$2) checksum',[context,v.form_id]);
}
export async function batch(c:PoolClient,context:Context,target:string,input:unknown){
 const actor=await authorize(c,context,target,'ops');
 if(Array.isArray((input as {ops?:unknown[]})?.ops)&&(input as {ops: {protocol_version?:number}[]}).ops.some(op=>op?.protocol_version!==1))throw new Error('update_required');
 const v=z.strictObject({nonce:z.string().min(16).max(128),ops:z.array(opSchema).min(1).max(50)}).parse(input);
 if(Buffer.byteLength(canonicalJson(v))>256*1024)throw new Error('batch_too_large');
 if(JSON.parse(context.payload).nonce!==v.nonce)throw new Error('nonce_mismatch');
 const digest=hash(v),old=await one<{actor:string;request_hash:string;result:unknown}>(c,'SELECT * FROM consult_batches WHERE consult_id=$1 AND nonce=$2',[target,v.nonce]);
 // Authorization/device are rechecked even on replay.
 for(const op of v.ops)await deviceGate(c,target,op.device_id,op.device_epoch,actor);
 if(old){if(old.actor!==actor||old.request_hash!==digest)throw new Error('idempotency_mismatch');return old.result;}
 if(new Set(v.ops.map(o=>`${o.device_id}:${o.device_epoch}`)).size!==1)throw new Error('mixed_devices');
 const receipts=[];
 for(const op of v.ops){
  const opHash=hash(op),prior=await one<{hash:string;result:unknown}>(c,'SELECT hash,result FROM consult_sync_receipts WHERE consult_id=$1 AND event_id=$2',[target,op.client_event_id]);
  if(prior){if(prior.hash!==opHash)throw new Error('idempotency_mismatch');receipts.push(prior.result);continue;}
  if(hash(op.payload)!==op.payload_sha256)throw new Error('payload_hash_mismatch');
  const seq=await deviceGate(c,target,op.device_id,op.device_epoch,actor);
  if(op.seq!==seq+1)throw new Error('sequence_gap');
  const s=await snapshot(c,context,target);
  if(s.consult.status==='complete')throw new Error('complete_locked');
  if(s.consult.status!=='in_progress'&&s.consult.status!=='incomplete'&&!(op.type==='start'&&s.consult.status==='scheduled'))throw new Error('visit_not_started');
  let receipt:Record<string,unknown>={id:op.client_event_id,status:200};
  await c.query('SAVEPOINT consult_op');
  try {
  if(Number(s.consult.completion_generation)!==op.generation){receipt={...receipt,status:409,error_code:'rebase_required'};}
  else if(op.type==='start'){
   z.null().parse(op.target);z.strictObject({}).parse(op.payload);
   if(s.consult.status!=='scheduled'||Number(s.consult.revision)!==op.base_revision)throw new Error('conflict');
   await c.query("UPDATE consults SET status='in_progress',revision=revision+1,started_at=now(),started_by=$2 WHERE id=$1",[target,actor]);receipt.revision=op.base_revision+1;
  }else if(op.type==='discard_rejection'){
   z.null().parse(op.target);const r=z.strictObject({event_id:uuid,hash:z.string(),reason:note}).parse(op.payload);
   const old=await one<{hash:string;result:{error_code?:string}}>(c,'SELECT hash,result FROM consult_sync_receipts WHERE consult_id=$1 AND event_id=$2',[target,r.event_id]);
   if(!old||old.hash!==r.hash||!old.result.error_code)throw new Error('invalid_rejection');
   if(await one(c,'SELECT x.id FROM consult_conflicts x JOIN consult_answers a ON a.id=x.proposed_answer_id WHERE a.event_id=$1 AND x.resolved_at IS NULL',[r.event_id]))throw new Error('conflict_requires_value');
   receipt={...receipt,supersedes:r.event_id};
  }else if(op.type==='answer'||op.type==='clear'||op.type==='resolve'){
   const a=address.parse(op.target);let p: z.infer<typeof answerPayload>;
   if(op.type==='resolve'){
    const r=z.strictObject({current_answer_id:uuid,proposed_answer_id:uuid,reason:note,answer:answerPayload}).parse(op.payload);
    const x=await one<{id:string}>(c,`SELECT x.id FROM consult_conflicts x JOIN consult_field_heads h USING(consult_id,instance_id,field_key)
     WHERE x.consult_id=$1 AND x.instance_id=$2 AND x.field_key=$3 AND x.current_answer_id=$4 AND x.proposed_answer_id=$5 AND x.resolved_at IS NULL AND h.current_answer_id=$4 AND h.revision=$6`,[target,a.instance_id,a.field_key,r.current_answer_id,r.proposed_answer_id,op.base_revision]);
    if(!x)throw new Error('conflict');p=r.answer;
   }else p=answerPayload.parse(op.payload);
   if(op.type==='clear' && p.status!=='cleared')throw new Error('invalid_clear');
   if(p.status!=='answered'&&p.value!==undefined&&p.value!==null)throw new Error('invalid_value');
   const pinned=s.instances.find(i=>i.id===a.instance_id&&!i.removed_at);
   const def=s.pins.find(p=>p.kind==='module'&&p.definition.key===pinned?.module_key)?.definition as ModuleDef|undefined;
   const field=def?.fields.find(f=>f.key===a.field_key);
   if(p.status==='answered'){
    if(field?.maps_to?.kind==='new_work')z.strictObject({origin:z.enum(['client_requested_optional','found_condition_required']),text:note}).parse(p.value);
    if(field?.maps_to?.kind!=='new_work'&&field?.type==='text'&&(typeof p.value!=='string'||!p.value.trim()))throw new Error('text_required');
    if(field?.type==='date')day.parse(p.value);
    if(field?.type==='multi'&&(!Array.isArray(p.value)||!p.value.length||new Set(p.value).size!==p.value.length))throw new Error('distinct_choices_required');
    if(field?.type==='length'||field?.type==='length_pair'){for(const value of Array.isArray(p.value)?p.value:[p.value])if(typeof value!=='number'||Math.abs(value*16-Math.round(value*16))>1e-8)throw new Error('length_precision');}
   }
   if(def?.context_module||def?.key==='visit'||field?.derive_cases||field?.derive)throw new Error('derived_field_protected');
   const operation={...p,...a,...(op.type==='resolve'?{resolution:op.payload}:{}),generation:op.generation,base_revision:op.base_revision};
   const result=(await one<{v:{code:string;revision:number;answer_id:string}}>(c,'SELECT consult_capture_answer($1,$2,$3,$4,$5,$6) v',[await scoped(c,context,'capture_answer',target),target,op.device_id,op.device_epoch,op.client_event_id,operation])).v;
   receipt={...receipt,revision:Number(result.revision)};
   if(result.code==='conflict'){
    const pair=await one(c,`SELECT to_jsonb(x)||jsonb_build_object('current',to_jsonb(a),'proposed',to_jsonb(b)) pair FROM consult_conflicts x JOIN consult_answers a ON a.id=x.current_answer_id JOIN consult_answers b ON b.id=x.proposed_answer_id WHERE x.consult_id=$1 AND x.proposed_answer_id=$2`,[target,result.answer_id]);
    receipt={...receipt,status:409,error_code:'conflict',conflict:pair?.pair};
   }else if(op.type==='resolve'){
    const r=op.payload as {current_answer_id:string;proposed_answer_id:string};
    await c.query('UPDATE consult_conflicts SET resolved_at=now(),resolved_by=$4,resolution_event=$5 WHERE consult_id=$1 AND current_answer_id=$2 AND proposed_answer_id=$3 AND resolved_at IS NULL',[target,r.current_answer_id,r.proposed_answer_id,actor,op.client_event_id]);
   }
  }else if(op.type==='create_instance'){
   const t=instanceTarget.parse(op.target);z.strictObject({}).parse(op.payload);
   const module=s.pins.find(p=>p.kind==='module'&&p.definition.key===t.module_key)?.definition as ModuleDef|undefined;
   if(module?.context_module||module?.key==='visit')throw new Error('context_protected');
   if(module?.parent_module&&!s.instances.some(i=>i.id===t.parent_id&&i.module_key===module.parent_module&&!i.removed_at))throw new Error('invalid_parent');
   const r=await one<{v:string}>(c,'SELECT consult_create_instance($1,$2,$3,$4,$5,$6,$7) v',[await scoped(c,context,'create_instance',target),target,t.instance_id,t.module_key,t.label,t.parent_id??null,op.base_revision]);receipt.revision=Number(r.v);
  }else{
   const t=z.strictObject({instance_id:uuid}).parse(op.target);z.strictObject({}).parse(op.payload);
   if(op.base_revision!==Number(s.consult.revision))receipt={...receipt,status:409,error_code:'conflict',conflict:{instance_id:t.instance_id,current_revision:Number(s.consult.revision),proposed_revision:op.base_revision}};
   else{
    if(!s.instances.some(i=>i.id===t.instance_id&&!i.removed_at))throw new Error('unknown_instance');
    if(s.instances.some(i=>i.parent_id===t.instance_id&&!i.removed_at))throw new Error('live_children');
    await c.query('UPDATE consult_instances SET removed_at=now(),revision=$3 WHERE consult_id=$1 AND id=$2',[target,t.instance_id,op.base_revision+1]);
    await c.query('UPDATE consults SET revision=revision+1 WHERE id=$1',[target]);receipt.revision=op.base_revision+1;
   }
  }
  if(op.type==='start'||op.type==='remove_instance'||op.type==='create_instance'||op.type==='discard_rejection'||Number(s.consult.completion_generation)!==op.generation){
   await c.query(`INSERT INTO consult_events(consult_id,event_id,actor,device_id,device_epoch,source,type,payload,payload_hash,server_revision,generation) VALUES($1,$2,$3,$4,$5,'typed',$6,$7,$8,$9,$10)`,[target,op.client_event_id,actor,op.device_id,op.device_epoch,op.type,op,opHash,receipt.revision??Number(s.consult.revision),op.generation]);
  }
  await c.query('RELEASE SAVEPOINT consult_op');
  }catch(error){
   await c.query('ROLLBACK TO SAVEPOINT consult_op');
   if(/^(42501|42|08|53|57|XX)/.test((error as {code?:string}).code??''))throw error;
   const message=error instanceof Error?error.message:'';
   const conflict=/conflict|revision/.test(message);
   receipt={id:op.client_event_id,status:conflict?409:422,error_code:conflict?'conflict':'invalid_operation',conflict:conflict?{target:op.target,current_revision:Number(s.consult.revision),proposed_revision:op.base_revision}:undefined};
   // JSONB cannot encode undefined; the optional conflict member is omitted.
   if(!conflict)delete receipt.conflict;
   await c.query('RELEASE SAVEPOINT consult_op');
  }
  await c.query('INSERT INTO consult_sync_receipts VALUES($1,$2,$3,$4,$5,$6,$7)',[target,op.device_id,op.device_epoch,op.client_event_id,op.seq,opHash,receipt]);
  await c.query('UPDATE consult_devices SET last_ack_seq=$4,close_manifest=NULL,close_ack_at=NULL WHERE consult_id=$1 AND device_id=$2 AND epoch=$3',[target,op.device_id,op.device_epoch,op.seq]);
  receipts.push(receipt);
 }
 await c.query('INSERT INTO consult_batches(consult_id,nonce,actor,request_hash,result) VALUES($1,$2,$3,$4,$5)',[target,v.nonce,actor,digest,JSON.stringify(receipts)]);
 return receipts;
}
export async function saveEvidence(c:PoolClient,context:Context,target:string,input:unknown){
 const actor=await authorize(c,context,target,'evidence');
 const v=z.strictObject({device:uuid,epoch:rev.min(1),expected_revision:rev,evidence:evidenceSchema}).parse(input);
 if((v.evidence.return_day||v.evidence.trade_walks.some(w=>w.day))&&JSON.parse(context.payload).role!=='owner')throw new Error('owner_required');
 await deviceGate(c,target,v.device,v.epoch,actor);const s=await snapshot(c,context,target);
 if(s.consult.status==='complete')throw new Error('complete_locked');
 if(Number(s.consult.revision)!==v.expected_revision)throw new Error('conflict');
 await c.query(`INSERT INTO consult_close_evidence VALUES($1,$2,$3,now()) ON CONFLICT(consult_id) DO UPDATE SET evidence=$2,actor=$3,updated_at=now()`,[target,v.evidence,actor]);
 await c.query('UPDATE consults SET photos_ok=$2,promised_date=$3,client_ack_skip=$4,revision=revision+1 WHERE id=$1',[target,v.evidence.photos_ok,v.evidence.promised_date,{reason:v.evidence.ack_reason,handed_back:true,actor}]);
 await c.query('UPDATE consult_devices SET close_manifest=NULL,close_ack_at=NULL WHERE consult_id=$1',[target]);
 await audit(c,target,actor,'close_evidence',v);
 return {revision:v.expected_revision+1};
}
export async function completion(c:PoolClient,context:Context,target:string){
 const s=await snapshot(c,context,target);
 const row=await one<{evidence:unknown;actor:string;updated_at:string}>(c,'SELECT * FROM consult_close_evidence WHERE consult_id=$1',[target]);
 const e=row?evidenceSchema.parse(row.evidence):null;
 const modules=s.pins.filter(p=>p.kind==='module').map(p=>p.definition as ModuleDef);
 const templates=s.pins.filter(p=>p.kind==='template').map(p=>p.definition as TemplateDef);
 const live=s.instances.filter(i=>!i.removed_at);
 const projection=pinnedDerivations(modules,templates,live,s.heads);
 const known=new Set(modules.flatMap(m=>m.fields.map(f=>`${m.key}.${f.key}`)));
 const global:Record<string,unknown>={};
 // Ambiguous repeat values never pick a winner for a cross-module condition.
 for(const m of modules)for(const f of m.fields){const values=live.filter(i=>i.module_key===m.key).flatMap(i=>s.heads.filter(a=>a.instance_id===i.id&&a.field_key===f.key&&a.status==='answered').map(a=>a.value));if(values.length)global[`${m.key}.${f.key}`]=values.length===1?values[0]:values;}
 const media=(await c.query('SELECT id,instance_id,shot_key,sha256,kind FROM consult_media WHERE consult_id=$1 AND removed_at IS NULL',[target])).rows;
 const fields:CompletionItem[]=[], photos:CompletionItem[]=[],flags:CompletionInput['flags']=[];
 for(const i of live){const m=modules.find(m=>m.key===i.module_key);if(!m)throw new Error('unknown_module');
  const values={...global};for(const a of s.heads.filter(a=>a.instance_id===i.id&&a.status==='answered'))values[a.field_key]=a.value;for(const f of m.fields){const derived=projection.scalar(i,f.key);if(derived!==undefined)values[f.key]=derived;}
  const localKnown=new Set([...known,...m.fields.map(f=>f.key)]);
  const required=(r:ModuleDef['fields'][number]['required'])=>compileCondition(r,localKnown)(values);
  for(const f of m.fields){const key=`${i.id}:${f.key}`, a=s.heads.find(a=>a.instance_id===i.id&&a.field_key===f.key);
   const sk=e?.skips[key];
   fields.push({key,tier:f.tier,required:required(f.required),applicable:true,mapped:!!f.maps_to,answered:a?.status==='answered',valid:a?.status==='answered'&&a.value!==null&&a.value!==''&&(!Array.isArray(a.value)||a.value.length>0),skip:a?.status==='skipped'?{reason:a.skip_reason as NonNullable<CompletionItem['skip']>['reason'],note:a.skip_note??undefined,...(sk?.reason===a.skip_reason?sk:{}),condition_validated:typeof f.required!=='boolean'&&!required(f.required)}:undefined});
   for(const [index,flag] of [...(f.flag?[f.flag]:[]),...(f.flags??[])].entries())if(required(flag.when)){const flagKey=index?`${key}:${index}`:key;const d=e?.flags[flagKey];flags.push({key:flagKey,disposition:d?.disposition??null,note:d?.note??'',actor:d?row.actor:null,at:d?String(row.updated_at):null});}
  }
  for(const shot of [...m.shots,...m.fields.flatMap(f=>f.shots??[])]){
   const key=`${i.id}:shot:${shot.key}`;photos.push({key,tier:shot.tier,required:required(shot.required),applicable:true,mapped:false,answered:media.some(p=>p.instance_id===i.id&&p.shot_key===shot.key),valid:true,skip:e?.skips[key]});
  }
 }
 const devices=(await c.query('SELECT device_id,close_ack_at,close_manifest FROM consult_devices WHERE consult_id=$1 AND revoked_at IS NULL',[target])).rows;
 const rrpApplies=typeof global['house.year_built']!=='number'||global['house.year_built']<1978;
 const input:CompletionInput={fields,photos,modules:templates.flatMap(t=>t.modules.map(m=>({key:m.module,minimum:compileCondition(m.required,known)(global)?Math.max(1,m.min??1):0,live_count:live.filter(i=>i.module_key===m.module).length,parents_valid:live.every(i=>!i.parent_id||live.some(p=>p.id===i.parent_id))}))),
 recording:{asked:e?.manual_confirmed===true,choice:e?'manual':null,confirmed_evidence:false,documented_failure_or_stop:false},photo_permission:e?.photos_ok??null,
 acknowledgement:{initials_committed:media.some(m=>m.kind==='initials'),visitor_reason:e?.ack_reason??null,handed_back:e?.handed_back??false},promised_date:e?.promised_date??null,
 manifests:devices.map(d=>({device:d.device_id,acknowledged:!!d.close_ack_at,rejected:0,missing:!d.close_manifest})),unresolved_conflicts:s.conflicts.length,
 rrp:{applies:rrpApplies,receipt:e?.rrp.receipt??false,firm_current:e?.rrp.firm_current??false,renovator_current:e?.rrp.renovator_current??false,redelivery_required:e?.rrp.redelivery_required??false,redelivery_todo:!!e?.rrp.redelivery_day},flags,
 touched_trades:e?.touched_trades??[],trade_walks:(e?.trade_walks??[]).map(w=>({...w,actor:row.actor,at:String(row.updated_at)})),no_trades_confirmed:e?.no_trades_confirmed??false};
 return {result:consultCompleteness(input),snapshot:s,evidence:e};
}
export async function close(c:PoolClient,context:Context,target:string,input:unknown){
 const actor=await authorize(c,context,target,'close');
 const v=z.strictObject({expected_revision:rev,manifest:manifestSchema}).parse(input),m=v.manifest;
 const ack=await deviceGate(c,target,m.device,m.epoch,actor);
 const s=await snapshot(c,context,target);const digest=hash(m);
 const prior=await one<{close_manifest:{digest?:string}|null}>(c,'SELECT close_manifest FROM consult_devices WHERE consult_id=$1 AND device_id=$2 AND epoch=$3',[target,m.device,m.epoch]);
 if(prior.close_manifest?.digest===digest && ['complete','incomplete'].includes(s.consult.status))return {digest,...(await completion(c,context,target)).result,revision:Number(s.consult.revision)};
 if(s.consult.status==='complete')throw new Error('complete_locked');
 if(v.expected_revision!==Number(s.consult.revision))throw new Error('conflict');
 if(ack!==m.last_seq)throw new Error('manifest_sequence_gap');
 const rejected=await one<{n:string}>(c,`SELECT count(*) n FROM consult_sync_receipts r WHERE r.consult_id=$1 AND r.device_id=$2 AND r.epoch=$3 AND (r.result->>'status')::int<>200 AND NOT EXISTS(SELECT 1 FROM consult_conflicts x JOIN consult_answers a ON a.id=x.proposed_answer_id WHERE x.consult_id=r.consult_id AND a.event_id=r.event_id AND x.resolved_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM consult_sync_receipts newer WHERE newer.consult_id=r.consult_id AND newer.result->>'supersedes'=r.event_id::text AND newer.result->>'status'='200')`,[target,m.device,m.epoch]);
 if(Number(rejected.n))throw new Error('unresolved_rejections');
 for(const h of [...m.required_blob_hashes,...(m.initials_hash?[m.initials_hash]:[])]){
  if(!await one(c,'SELECT id FROM consult_media WHERE consult_id=$1 AND sha256=$2 AND removed_at IS NULL',[target,h]))throw new Error('manifest_blob_missing');
 }
 const committed=(await c.query('SELECT sha256,kind FROM consult_media WHERE consult_id=$1 AND removed_at IS NULL',[target])).rows;
 if(committed.some(p=>p.kind==='initials'?m.initials_hash!==p.sha256:!m.required_blob_hashes.includes(p.sha256)))throw new Error('manifest_blob_missing');
 if(m.initials_hash&&!await one(c,"SELECT id FROM consult_media WHERE consult_id=$1 AND sha256=$2 AND kind='initials' AND removed_at IS NULL",[target,m.initials_hash]))throw new Error('manifest_initials_missing');
 await c.query('UPDATE consult_devices SET close_manifest=$4,close_ack_at=now() WHERE consult_id=$1 AND device_id=$2 AND epoch=$3',[target,m.device,m.epoch,{...m,digest}]);
 const {result,evidence}=await completion(c,context,target);
 const owner=await ownerId(c);
 const nextDay=(await one<{work_day:string}>(c,`SELECT CASE extract(isodow FROM (now() AT TIME ZONE 'America/Chicago')::date) WHEN 5 THEN (now() AT TIME ZONE 'America/Chicago')::date+3 WHEN 6 THEN (now() AT TIME ZONE 'America/Chicago')::date+2 ELSE (now() AT TIME ZONE 'America/Chicago')::date+1 END::text AS work_day`)).work_day;
 if(!result.complete)await todo(c,s,'finish','visit','Finish in-home consultation',s.consult.conducted_by,nextDay);
 if(evidence){
  if(Object.values(evidence.skips).some(s=>s.reason==='Get on return visit'))await todo(c,s,'return','visit','Schedule return consultation',owner,evidence.return_day??null);
  await todo(c,s,'promise','estimate','Prepare promised formal estimate',owner,evidence.promised_date);
  for(const w of evidence.trade_walks.filter(w=>w.needed))await todo(c,s,'trade',w.trade,`${w.trade}: bid walk-through`,owner,w.day??null);
  if(evidence.rrp.redelivery_required&&evidence.rrp.redelivery_day)await todo(c,s,'rrp','redelivery','Re-deliver Renovate Right',owner,evidence.rrp.redelivery_day);
 }
 if(result.complete)await c.query('UPDATE consult_field_heads SET locked_generation=$2 WHERE consult_id=$1',[target,s.consult.completion_generation]);
 await c.query(`UPDATE consults SET status=$2,revision=revision+1,closed_at=now(),closed_by=$3,completed_at=CASE WHEN $4 THEN now() END,completed_by=CASE WHEN $4 THEN $3::uuid END,completeness_cache=$5 WHERE id=$1`,[target,result.complete?'complete':'incomplete',actor,result.complete,result]);
 await c.query("UPDATE work_items SET status='done',completed_at=now() WHERE source_kind='consult' AND (source_id=$1 OR ($3 AND source_id=$2)) AND status NOT IN ('done','cancelled')",[`${target}:schedule:visit`,`${target}:finish:visit`,result.complete]);
 await audit(c,target,actor,'close',{manifest:m,digest,result});
 if(result.complete && (await one<{value:string}>(c,"SELECT value FROM app_settings WHERE key='consult_auto_apply_findings'"))?.value==='true'){
  await enqueueConsultFindings(c,target,Number(s.consult.completion_generation));
 }
 return {digest,...result,revision:Number(s.consult.revision)+1};
}
export async function resolveConflict(c:PoolClient,context:Context,target:string,input:unknown){
 const actor=await authorize(c,context,target,'resolve_conflict');
 const v=z.strictObject({instance_id:uuid,field_key:z.string(),current_answer_id:uuid,proposed_answer_id:uuid,expected_revision:rev,generation:rev.min(1),reason:note,choice:z.enum(['current','proposed'])}).parse(input);
 const s=await snapshot(c,context,target);
 if(s.consult.status==='complete')throw new Error('complete_locked');
 if(Number(s.consult.revision)!==v.expected_revision||Number(s.consult.completion_generation)!==v.generation)throw new Error('conflict');
 const x=await one<{id:string}>(c,`SELECT x.id FROM consult_conflicts x JOIN consult_field_heads h USING(consult_id,instance_id,field_key) WHERE x.consult_id=$1 AND x.instance_id=$2 AND x.field_key=$3 AND x.current_answer_id=$4 AND x.proposed_answer_id=$5 AND h.current_answer_id=$4 AND x.resolved_at IS NULL`,[target,v.instance_id,v.field_key,v.current_answer_id,v.proposed_answer_id]);
 if(!x)throw new Error('conflict');
 const event=randomUUID(),revision=v.expected_revision+1;
 await c.query(`INSERT INTO consult_events(consult_id,event_id,actor,source,type,payload,payload_hash,server_revision,generation) VALUES($1,$2,$3,'office','resolve_conflict',$4,$5,$6,$7)`,[target,event,actor,v,hash(v),revision,v.generation]);
 const answer=await one<{id:string}>(c,`INSERT INTO consult_answers(consult_id,instance_id,field_key,status,value,unit,skip_reason,skip_note,source,actor,event_id,base_revision,server_revision,generation)
 SELECT consult_id,instance_id,field_key,status,value,unit,skip_reason,skip_note,'office',$2,$3,server_revision,$4,$5 FROM consult_answers WHERE id=$1 RETURNING id`,[v.choice==='current'?v.current_answer_id:v.proposed_answer_id,actor,event,revision,v.generation]);
 await c.query('UPDATE consult_conflicts SET resolved_at=now(),resolved_by=$2,resolution_event=$3 WHERE id=$1',[x.id,actor,event]);
 await c.query('UPDATE consult_field_heads SET current_answer_id=$4,revision=$5 WHERE consult_id=$1 AND instance_id=$2 AND field_key=$3',[target,v.instance_id,v.field_key,answer.id,revision]);
 await c.query('UPDATE consults SET revision=$2 WHERE id=$1',[target,revision]);
 await c.query('UPDATE consult_devices SET close_manifest=NULL,close_ack_at=NULL WHERE consult_id=$1',[target]);
 return {revision,answer_id:answer.id};
}
export async function command(c:PoolClient,context:Context,target:string,kind:string,input:unknown):Promise<unknown>{
 if(kind==='prepare_device'){
  if(!await one(c,"SELECT key FROM app_settings WHERE key='consult_capture' AND value='true'"))return {ok:false,code:'capture_disabled'};
  const actor=await authorize(c,context,target,'prepare_device');const v=z.strictObject({device:uuid,expected_revision:rev}).parse(input);
  const s=await snapshot(c,context,target);if(Number(s.consult.revision)!==v.expected_revision)return {ok:false,code:'conflict'};
  if(!['scheduled','in_progress','incomplete'].includes(s.consult.status))return {ok:false,code:'complete_locked'};
  const active=await one<{device_id:string;user_id:string;epoch:string}>(c,'SELECT * FROM consult_devices WHERE consult_id=$1 AND revoked_at IS NULL',[target]);
  if(active&&(active.device_id!==v.device||active.user_id!==actor))return {ok:false,code:'device_access_denied'};
  const epoch=active?Number(active.epoch):Number((await one<{epoch:string}>(c,'SELECT coalesce(max(epoch),0)+1 epoch FROM consult_devices WHERE consult_id=$1 AND device_id=$2',[target,v.device])).epoch);
  if(!active){await c.query('INSERT INTO consult_devices(consult_id,device_id,user_id,epoch) VALUES($1,$2,$3,$4)',[target,v.device,actor,epoch]);await audit(c,target,actor,'device_prepared',{device:v.device,epoch});}
  return {ok:true,epoch,revision:Number(s.consult.revision),generation:Number(s.consult.completion_generation)};
 }
 if(kind==='recovery_lease'){
  const actor=await authorize(c,context,target,'recovery_lease',true);
  const v=z.strictObject({original_user:uuid,session_epoch:rev,device:uuid,epoch:rev.min(1),build:note,reason:note}).parse(input);
  if(!await one(c,'SELECT user_id FROM consult_devices WHERE consult_id=$1 AND device_id=$2 AND epoch=$3 AND user_id=$4',[target,v.device,v.epoch,v.original_user]))return {ok:false,code:'device_access_denied'};
  const secret=(await c.query('SELECT secret FROM consult_context_keys WHERE key_id=$1 AND revoked_at IS NULL',[context.key_id])).rows[0]?.secret;
  if(!secret)return {ok:false,code:'consult_key_unavailable'};
  await audit(c,target,actor,'recovery_authorized',v);const now=Date.now();return signOfflineLease({user_id:v.original_user,session_epoch:v.session_epoch,consult_id:target,device_id:v.device,build:v.build,issued_at:now,expires_at:now+900000,purpose:'recovery'},secret);
 }
 if(kind==='recover_device'){
  const actor=await authorize(c,context,target,'recover_device',true);
  const v=z.strictObject({operation_id:uuid,original_user:uuid,device:uuid,epoch:rev.min(1),reason:note,ops:z.array(opSchema).max(50),blobs:z.array(z.strictObject({hash:z.string().regex(/^[a-f0-9]{64}$/),event_id:uuid,instance_id:uuid,kind:z.enum(['photo','initials']),mime:note,field_key:note.optional(),shot_key:note.optional(),receipt:z.strictObject({file_id:uuid,media_id:uuid}).optional()})).max(1000).optional()}).parse(input);
  const device=await one(c,'SELECT user_id FROM consult_devices WHERE consult_id=$1 AND device_id=$2 AND epoch=$3 AND user_id=$4',[target,v.device,v.epoch,v.original_user]);
  if(!device)throw new Error('device_access_denied');
  const prior=await one<{payload_hash:string;payload:typeof v}>(c,'SELECT payload_hash,payload FROM consult_events WHERE consult_id=$1 AND event_id=$2',[target,v.operation_id]);
  if(prior){if(prior.payload_hash!==hash(v))throw new Error('idempotency_mismatch');return {ok:true,staged:true};}
  const s=await snapshot(c,context,target);
  for(const op of v.ops){
   if(op.device_id!==v.device||op.device_epoch!==v.epoch||hash(op.payload)!==op.payload_sha256)throw new Error('invalid_recovery_manifest');
   // Revalidate address/generation/hash. Recovery stages proposals; no accepted answer is written.
   if(op.type==='answer'||op.type==='clear'){
    const a=address.parse(op.target),p=answerPayload.parse(op.payload),instance=s.instances.find(i=>i.id===a.instance_id&&!i.removed_at);
    const module=s.pins.find(pin=>pin.kind==='module'&&pin.definition.key===instance?.module_key)?.definition as ModuleDef|undefined;
    const field=module?.fields.find(f=>f.key===a.field_key);
    if(!field||field.derive||field.derive_cases||module?.context_module)throw new Error('invalid_recovery_field');
    await c.query(`INSERT INTO consult_agent_proposals(consult_id,operation_id,actor,generation,instance_id,field_key,base_revision,answer,source_note)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,[target,op.client_event_id,v.original_user,s.consult.completion_generation,a.instance_id,a.field_key,op.base_revision,p,`Recovered by ${actor} from device ${v.device}, epoch ${v.epoch}, original generation ${op.generation}: ${v.reason}`]);
   }
  }
  await c.query('UPDATE consult_devices SET revoked_at=coalesce(revoked_at,now()) WHERE consult_id=$1 AND device_id=$2 AND epoch=$3',[target,v.device,v.epoch]);
  await c.query(`INSERT INTO consult_events(consult_id,event_id,actor,source,type,payload,payload_hash,server_revision,generation)
   SELECT id,$2,$3,'office','device_recovery',$4,$5,revision,completion_generation FROM consults WHERE id=$1`,[target,v.operation_id,actor,v,hash(v)]);
  return {ok:true,staged:true};
 }
 if(kind==='offline_lease'){
  if(!await one(c,"SELECT key FROM app_settings WHERE key='consult_capture' AND value='true'"))return {ok:false,code:'capture_disabled'};
  const v=z.strictObject({device:uuid,build:note}).parse(input);await snapshot(c,context,target);
  const secret=(await c.query('SELECT secret FROM consult_context_keys WHERE key_id=$1 AND revoked_at IS NULL',[context.key_id])).rows[0]?.secret;
  if(!secret)throw new Error('consult_key_unavailable');const claims=JSON.parse(context.payload),now=Date.now();
  return signOfflineLease({user_id:claims.sub,session_epoch:Math.floor(claims.iat),consult_id:target,device_id:v.device,build:v.build,issued_at:now,expires_at:now+86400000},secret);
 }

 // All callers, including tests, must wrap command in one transaction. Lock before
 // reading receipts/snapshots so two batches cannot observe the same base state.
 await c.query('SELECT p.id FROM projects p JOIN consults c ON c.project_id=p.id WHERE c.id=$1 FOR UPDATE OF p',[target]);
 await c.query('SELECT id FROM consults WHERE id=$1 FOR UPDATE',[target]);
 if(kind==='cancel'){
  await authorize(c,await scoped(c,context,'reopen',target),target,'reopen',true);
  const v=z.strictObject({expected_revision:rev,reason:note}).parse(input);
  const row=await one<{revision:string}>(c,'SELECT revision FROM consults WHERE id=$1',[target]);if(Number(row.revision)!==v.expected_revision)return {ok:false,code:'conflict'};
  await c.query("UPDATE consults SET status='cancelled',revision=revision+1 WHERE id=$1",[target]);
  await audit(c,target,JSON.parse(context.payload).sub,'cancel',{reason:v.reason});return {ok:true};
 }
 if(kind==='apply_findings'){
  const v=z.strictObject({expected_generation:rev.min(1),operation_id:uuid}).parse(input);
  await authorize(c,await scoped(c,context,'apply',target),target,'apply');
  return enqueueConsultFindings(c,target,v.expected_generation);
 }
 if(kind==='proposal_decision'){
  const actor=await authorize(c,context,target,'proposal_decision');
  const v=z.strictObject({proposal_id:uuid,action:z.enum(['use','reject']),op:opSchema.optional()}).parse(input);
  const p=await one<any>(c,"SELECT * FROM consult_agent_proposals WHERE consult_id=$1 AND id=$2 FOR UPDATE",[target,v.proposal_id]);
  if(!p)throw new Error('unknown_proposal');
  if(p.status!=='pending')return {status:p.status};
  const s=await snapshot(c,context,target);if(s.consult.status==='complete')throw new Error('complete_locked');
  if(Number(p.generation)!==Number(s.consult.completion_generation))throw new Error('rebase_required');
  if(v.action==='use'){
   if(!v.op||v.op.type!=='answer'||hash(v.op.target)!==hash({instance_id:p.instance_id,field_key:p.field_key})||hash(v.op.payload)!==hash(p.answer)||v.op.base_revision!==Number(p.base_revision))throw new Error('proposal_mismatch');
   const receipts=await batch(c,await scoped(c,context,'ops',target),target,{nonce:JSON.parse(context.payload).nonce,ops:[v.op]}) as {status:number}[];
   if(receipts[0].status!==200)return receipts;
  }
  await c.query('UPDATE consult_agent_proposals SET status=$3,decided_by=$4,decided_at=now() WHERE consult_id=$1 AND id=$2',[target,p.id,v.action==='use'?'used':'rejected',actor]);
  return {status:v.action==='use'?'used':'rejected'};
 }
 if(kind==='resolve_conflict')return resolveConflict(c,context,target,input);
 if(kind==='ops')return batch(c,context,target,input);
 if(kind==='evidence')return saveEvidence(c,context,target,input);
 if(kind==='close')return close(c,context,target,input);
 if(kind==='assign')return assign(c,context,target,input);
 if(kind==='start'){
  await authorize(c,context,target,'start');const v=z.strictObject({device:uuid,expected_revision:rev}).parse(input);
  return one(c,'SELECT consult_start($1,$2,$3,$4) epoch',[context,target,v.device,v.expected_revision]);
 }
 if(kind==='reopen'){
  const actor=await authorize(c,context,target,'reopen');const v=z.strictObject({expected_revision:rev,reason:note}).parse(input);
  const r=await one(c,'SELECT consult_reopen($1,$2,$3,$4) generation',[context,target,v.expected_revision,v.reason]);
  await c.query('UPDATE consult_devices SET close_manifest=NULL,close_ack_at=NULL WHERE consult_id=$1',[target]);await audit(c,target,actor,'reopen',v);return r;
 }
 throw new Error('unknown_command');
}

import {mergeEvidence} from './evidence-chunks.ts';
import {officeCloseFailure} from './close-errors.ts';
import {touchedTrades} from './trades.ts';
import {sameBathroom} from './flags.ts';
import {conflictSideLabel} from './ui/words.ts';
import {saveAcknowledgedSummary} from './summary.ts';
import {flagInputs} from './flags.ts';
import {evaluatedFlags} from './forms/flags.ts';
import { mergeTemplateModules } from './template-merge.ts';
import { rrpFacts, certificationWarnings } from './rrp.ts';
/** Owner-connection transaction service. Caller authenticates freshly and supplies a
 * server-minted person envelope. Never expose an envelope or this client to browsers. */
import {pinnedDerivations} from './derive.ts';
import {signOfflineLease} from './offline-lease.ts';
import {enqueueConsultFindings} from '../worker/consult.ts';
import type { PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from './queue.ts';
import { consultCompleteness, countedModule, type CompletionInput, type CompletionItem } from './completeness.ts';
import { compileCondition } from './forms/conditions.ts';
import { validateModule, validateTemplate, type FormRegistry } from './forms/validate.ts';
import type { ModuleDef, TemplateDef } from './form-types.ts';
const uuid=z.string().uuid(), rev=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;});
const note=z.string().trim().min(1).max(8000);
const skip=z.enum(['Not on this job','No access','Not safe to measure','Client absent','Joe sets the date','Client declined','Get on return visit','Sub/supplier will measure','Other']);
const assumption=z.strictObject({text:note,responsible_trade:note,verification_point:note,adjustment_route:z.enum(['precon_change','change_order']),quantity:z.number().finite().nonnegative().nullable(),unit:note.nullable(),exclusion:note.nullable()});
export const evidenceSchema=z.strictObject({
 photos_ok:z.boolean(),manual_confirmed:z.literal(true),handed_back:z.literal(true),ack_reason:note.nullable(),promised_date:day.nullable(),
 no_trades_confirmed:z.boolean(),touched_trades:z.array(note).max(50),
 trade_walks:z.array(z.strictObject({trade:note,needed:z.boolean(),reason:note,day:day.optional()})).max(50),
 rrp:z.strictObject({receipt:z.boolean(),firm_current:z.boolean(),renovator_current:z.boolean(),redelivery_required:z.boolean(),redelivery_day:day.optional()}),
 flags:z.record(z.string(),z.strictObject({disposition:z.enum(['price_it','allowance','sub_must_look','not_an_issue']),note})),
 skips:z.record(z.string(),z.strictObject({reason:skip,note:note.optional(),assumption:assumption.optional(),trade_walk_decided:z.boolean().optional()})),
 return_day:day.optional(),
});
export const decisionSchema=evidenceSchema.pick({skips:true,flags:true,trade_walks:true,no_trades_confirmed:true,rrp:true,ack_reason:true}).extend({trade_walks:z.array(z.strictObject({trade:z.string().max(8000),needed:z.boolean().nullable(),reason:z.string().max(8000),day:day.optional()})).max(50),flags:z.record(z.string(),z.strictObject({disposition:z.enum(['price_it','allowance','sub_must_look','not_an_issue']),note:z.string().max(8000)})),rrp:evidenceSchema.shape.rrp.extend({redelivery_day:z.string().max(10).optional()})});
async function readDecisions(c:PoolClient,target:string,closeEvidence:unknown):Promise<unknown>{
 const events=(await c.query("SELECT payload,type FROM consult_events WHERE consult_id=$1 AND type IN ('decisions','close_evidence') ORDER BY server_revision,created_at",[target])).rows;
 let decisions:unknown=null;
 for(const event of events){
  if(event.type==='close_evidence') decisions=closeEvidence?Object.fromEntries(Object.entries(closeEvidence).filter(([key])=>key in decisionSchema.shape)):null;
  else decisions=mergeDecisions(decisions,event.payload.payload);
 }
 return decisions;
}
export function mergeDecisions(before:unknown,payload:unknown):unknown {
 if(!payload || typeof payload!=='object' || !('patch' in payload))return decisionSchema.parse(payload);
 const patch=(payload as {patch:Record<string,unknown>}).patch;
 const out:Record<string,unknown>={skips:{},flags:{},trade_walks:[],no_trades_confirmed:false,rrp:{receipt:false,firm_current:false,renovator_current:false,redelivery_required:false},ack_reason:null,...(before as object??{})};
 for(const [key,value] of Object.entries(patch)){
  if(!(key in decisionSchema.shape))throw new Error('invalid_command');
  if(key==='skips'||key==='flags'){
   const map={...(out[key] as Record<string,unknown>)};
   for(const [id,item] of Object.entries(value as Record<string,unknown>)){if(item===null)delete map[id];else map[id]=item;}
   out[key]=map;
  }else out[key]=value;
 }
 return decisionSchema.parse(out);
}
const address=z.strictObject({instance_id:uuid,field_key:z.string().regex(/^[a-z][a-z0-9_]*$/)});
const opSchema=z.strictObject({protocol_version:z.literal(1),client_event_id:uuid,device_id:uuid,device_epoch:rev.min(1),seq:rev.min(1),base_revision:rev,generation:rev.min(1),type:z.enum(['start','answer','clear','create_instance','remove_instance','resolve','discard_rejection','decisions']),target:z.unknown(),payload:z.unknown(),payload_sha256:z.string().regex(/^[a-f0-9]{64}$/)});
const answerPayload=z.strictObject({summary_text:z.string().min(1).max(32000).optional(),status:z.enum(['answered','skipped','cleared']),value:z.unknown().optional(),unit:z.string().optional(),skip_reason:skip.optional(),skip_note:z.string().max(8000).optional()});
const instanceTarget=z.strictObject({instance_id:uuid,module_key:z.string(),parent_id:uuid.optional(),label:note});
const manifestSchema=z.strictObject({device:uuid,epoch:rev.min(1),last_seq:rev,required_blob_hashes:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(10000),initials_hash:z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),initials_hashes:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(10000).optional(),local_pending:z.literal(0)});
export const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
type Context={key_id:string;payload:string;signature:string};
type Snapshot={consult:{id:string;project_id:string;status:string;revision:string;completion_generation:string;conducted_by:string;scheduled_at:string};pins:{definition:ModuleDef|TemplateDef;kind:string}[];instances:{id:string;module_key:string;parent_id:string|null;removed_at:string|null}[];heads:{id:string;instance_id:string;field_key:string;status:string;value:unknown;skip_reason:string|null;skip_note:string|null;server_revision:string}[];conflicts:{current_answer_id:string;proposed_answer_id:string;current?:unknown;proposed?:unknown}[]};
async function one<T=Record<string,unknown>>(c:PoolClient,sql:string,args:unknown[]=[]):Promise<T>{return (await c.query(sql,args)).rows[0] as T;}
export async function snapshot(c:PoolClient,context:Context,target:string):Promise<Snapshot>{
 const result=(await one<{v:Snapshot}>(c,'SELECT consult_read($1,$2) v',[await scoped(c,context,'read',target),target])).v;
 const records=(await c.query(`SELECT a.*,u.name AS person FROM consult_answers a JOIN users u ON u.id=a.actor WHERE a.consult_id=$1 AND a.id IN (SELECT current_answer_id FROM consult_conflicts WHERE consult_id=$1 AND resolved_at IS NULL UNION SELECT proposed_answer_id FROM consult_conflicts WHERE consult_id=$1 AND resolved_at IS NULL)`,[target])).rows;
 for(const x of result.conflicts){x.current=records.find(a=>a.id===x.current_answer_id);x.proposed=records.find(a=>a.id===x.proposed_answer_id); const a=records.find(a=>a.id===x.current_answer_id), b=records.find(a=>a.id===x.proposed_answer_id); if(a)a.source_label=conflictSideLabel(a,b);if(b)b.source_label=conflictSideLabel(b,a);}
 const visitPin=result.pins.find(p=>p.kind==='module'&&p.definition.key==='visit');
 if(visitPin){
  const instance=result.consult.id;const keys=result.pins.filter(p=>p.kind==='template').map(p=>p.definition.key);
  const templateKeys=keys.filter(k=>!['garage','openings','flooring'].includes(k));
  result.instances.push({id:instance,module_key:'visit',parent_id:null,removed_at:null});
  for(const [field,value] of Object.entries({templates:templateKeys,add_ons:keys.filter(k=>['garage','openings','flooring'].includes(k))}))result.heads.push({id:instance,instance_id:instance,field_key:field,status:'answered',value,skip_reason:null,skip_note:null,server_revision:result.consult.revision});
 }
 const proposals=(await c.query("SELECT id,actor,instance_id,field_key,base_revision,answer,source_note,generation FROM consult_agent_proposals WHERE consult_id=$1 AND status='pending' ORDER BY id",[target])).rows;
 const findings_job=(await c.query('SELECT generation,status,attempts,available_at,lease_until,last_error,result FROM consult_findings_jobs WHERE consult_id=$1 AND generation=$2',[target,result.consult.completion_generation])).rows[0]??null;
 // consult_read has already enforced assignment before any project/lead context is read.
 const display=await one(c,`SELECT coalesce(nullif(p.client_name,''),l.name,p.name) client,p.name project,p.slug,
 nullif(coalesce(nullif(p.address,''),l.address),'') address,u.name visitor_name,(u.role='staff') visitor_staff,
 to_char(v.scheduled_at AT TIME ZONE 'America/Chicago','Dy FMHH12:MI am') scheduled_label,l.phone
 FROM consults v JOIN projects p ON p.id=v.project_id LEFT JOIN leads l ON l.id=p.lead_id JOIN users u ON u.id=v.conducted_by WHERE v.id=$1`,[target]);
 const project=result.consult.project_id;
 const intake=(await c.query(`SELECT i.question,i.answer FROM lead_intake i JOIN projects p ON p.lead_id=i.lead_id WHERE p.id=$1 ORDER BY i.sort_order,i.id LIMIT 200`,[project])).rows;
 const rough=await one<{line_items:{label:string;value?:unknown}[]}>(c,'SELECT e.line_items FROM lead_estimates e JOIN projects p ON p.lead_id=e.lead_id WHERE p.id=$1',[project]);
 const amounts=JSON.parse(context.payload).role==='owner'||JSON.parse(context.payload).areas?.includes('estimates');
 const quantities=(value:unknown)=>Array.isArray(value)?value.slice(0,200).map(q=>({label:q.label,qty:q.qty,unit:q.unit,...(q.basis!==undefined?{basis:q.basis}:{})})):[];
 const firmSettings=Object.fromEntries((await c.query("SELECT key,value FROM app_settings WHERE key IN ('rrp_firm_cert_number','rrp_firm_cert_expiry')")).rows.map(r=>[r.key,r.value]));
 const finish=(await one<{target_end_date:string|null}>(c,'SELECT target_end_date::text FROM projects WHERE id=$1',[project])).target_end_date;
 const prefill={target_end_date:finish,start_date:(await one<{start_date:string|null}>(c,'SELECT start_date::text start_date FROM projects WHERE id=$1',[project])).start_date,firm_cert_number:firmSettings.rrp_firm_cert_number??null,firm_cert_expiry:firmSettings.rrp_firm_cert_expiry??null,intake,year_built:intake.find(i=>/year.*built/i.test(i.question))?.answer??null,
 rough_estimate:(rough?.line_items??[]).slice(0,200).map(l=>({label:l.label,...(amounts?{value:l.value}: {})})),
 scope_items:(await c.query("SELECT key,title,room,trade,quantities FROM scope_items WHERE project_id=$1 AND status NOT IN ('excluded','superseded') ORDER BY key LIMIT 200",[project])).rows.map(i=>({...i,quantities:quantities(i.quantities)})),
 plan_items:(await c.query("SELECT item->>'prompt' prompt,item->>'scope_key' scope_key,item->>'unit' unit,item->>'location' location FROM site_visit_plans p CROSS JOIN LATERAL jsonb_array_elements(p.items) item WHERE project_id=$1 AND p.status<>'superseded' AND item->>'status'='open' AND p.id=coalesce((SELECT site_visit_plan_id FROM consults WHERE id=$2),(SELECT id FROM site_visit_plans WHERE project_id=$1 AND status<>'superseded' ORDER BY revision DESC LIMIT 1)) ORDER BY p.revision DESC LIMIT 200",[project,target])).rows,
 photos:(await c.query("SELECT f.id,f.name FROM files f JOIN leads l ON l.slug=f.lead_slug JOIN projects p ON p.lead_id=l.id WHERE p.id=$1 AND f.type='img' ORDER BY f.created_at DESC LIMIT 100",[project])).rows,
 discovery_notes:(await c.query("SELECT a.summary FROM lead_activity a JOIN projects p ON p.lead_id=a.lead_id WHERE p.id=$1 AND a.kind IN ('discovery','discovery_call') ORDER BY a.created_at DESC LIMIT 20",[project])).rows};
 prefill.discovery_notes.push(...(await c.query("SELECT notes->>'summary' summary FROM calls WHERE (project_id=$1 OR lead_id=(SELECT lead_id FROM projects WHERE id=$1)) AND notes_status='done' AND notes->>'summary' IS NOT NULL ORDER BY started_at DESC LIMIT 20",[project])).rows);
 const visitor_notes=(await one<{payload:{visitor_notes:string}}>(c,"SELECT payload FROM consult_events WHERE consult_id=$1 AND type='scheduled_notes' ORDER BY created_at DESC LIMIT 1",[target]))?.payload.visitor_notes??'';
 const closeEvidence=(await one<{evidence:unknown}>(c,'SELECT evidence FROM consult_close_evidence WHERE consult_id=$1',[target]))?.evidence??null;
 const decisions=await readDecisions(c,target,closeEvidence);

 const media=(await c.query("SELECT m.sha256 hash,m.event_id,m.kind,m.instance_id,m.field_key,m.shot_key,f.mime_type mime,jsonb_build_object('file_id',m.file_id,'media_id',m.id) receipt FROM consult_media m JOIN files f ON f.id=m.file_id WHERE m.consult_id=$1 AND m.removed_at IS NULL AND m.kind IN ('photo','initials') ORDER BY m.created_at",[target])).rows.map(m=>({...m,...(!m.field_key?{field_key:undefined}:{}),...(!m.shot_key?{shot_key:undefined}:{})}));
 const reopened=await latestReopen(c,target);
 const certValues:Record<string,unknown>={};for(const h of result.heads)if(h.status==='answered'&&result.instances.some(i=>i.id===h.instance_id&&i.module_key==='era'&&!i.removed_at))certValues[`era.${h.field_key}`]=h.value;
 for(const h of result.heads)if(h.status==='answered'&&result.instances.some(i=>i.id===h.instance_id&&i.module_key==='house'&&!i.removed_at))certValues[`house.${h.field_key}`]=h.value;
 const certification_warnings=certificationWarnings(certValues,finish);
 return {...result,reopened,certification_warnings,proposals,findings_job,display,prefill,visitor_notes,decisions,close_evidence:closeEvidence,close_evidence_hash:hash(closeEvidence),media} as Snapshot;
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
 const v=z.strictObject({project:uuid,visit_time:z.string().datetime({offset:true}),visitor:uuid,forms:z.array(uuid).min(1),plan:uuid.nullable().optional(),plan_revision:rev.nullable().optional(),visitor_notes:z.string().trim().max(8000).optional()}).parse(input);
 const id=(await one<{id:string}>(c,'SELECT consult_schedule($1,$2,$3,$4,$5,$6,$7) id',[context,v.project,v.visit_time,v.visitor,v.forms,v.plan??null,v.plan_revision??null])).id;
 await audit(c,id,JSON.parse(context.payload).sub,'scheduled_notes',{visitor_notes:v.visitor_notes??''});
 const s=await snapshot(c,context,id);const date=(await one<{work_day:string}>(c,"SELECT ($1::timestamptz AT TIME ZONE 'America/Chicago')::date::text AS work_day",[v.visit_time])).work_day;
 await todo(c,s,'schedule','visit','In-home consultation',v.visitor,date);return {id};
}
export async function assign(c:PoolClient,context:Context,target:string,input:unknown){
 const actor=await authorize(c,context,target,'assign',true);
 const v=z.strictObject({visitor:uuid,expected_revision:rev,scheduled_at:z.string().datetime({offset:true}).optional(),missing_device_reason:note.optional()}).parse(input);
 const s=await snapshot(c,context,target);
 if(Number(s.consult.revision)!==v.expected_revision)throw new Error('conflict');
 if(s.consult.status==='complete')throw new Error('complete_locked');
 if(!await one(c,"SELECT id FROM users WHERE id=$1 AND active AND (role='owner' OR (role='staff' AND 'projects'=ANY(permissions)))",[v.visitor]))throw new Error('invalid_visitor');
 const outstanding=(await c.query('SELECT device_id,epoch,user_id FROM consult_devices WHERE consult_id=$1 AND close_manifest IS NULL',[target])).rows;
 if(outstanding.length&&!v.missing_device_reason)throw new Error('missing_device_manifest_required');
 if(outstanding.length)await audit(c,target,actor,'missing_device_exception',{reason:v.missing_device_reason,devices:outstanding});
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
  }else if(op.type==='decisions'){
   z.null().parse(op.target);mergeDecisions((s as unknown as {decisions:unknown}).decisions,op.payload);
   if(op.base_revision!==Number(s.consult.revision))throw new Error('conflict');
   // Partial wrap decisions are durable evidence, not a claim that Close checks passed.
   await c.query('UPDATE consults SET revision=revision+1 WHERE id=$1',[target]);receipt.revision=Number(s.consult.revision)+1;
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
   if(def?.key==='closing'&&a.field_key==='summary')throw new Error('summary_read_only');
   if(p.status==='skipped' && field?.type==='signature' && !['Client absent','Client declined','Other'].includes(p.skip_reason??''))throw new Error('invalid_skip_reason');
   if(p.status==='skipped' && def?.key==='closing' && a.field_key==='estimate_promised' && !['Joe sets the date','Other'].includes(p.skip_reason??''))throw new Error('invalid_skip_reason');
   if(p.summary_text!==undefined&&await one(c,"SELECT id FROM consult_media WHERE consult_id=$1 AND instance_id=$2 AND field_key='client_initials' AND removed_at IS NULL",[target,a.instance_id]))throw new Error('initials_already_saved');
   if(p.summary_text!==undefined&&!(def?.key==='closing'&&a.field_key==='client_initials'&&p.status==='skipped'))throw new Error('invalid_summary');
   if(p.status==='answered'){
    if(field?.maps_to?.kind==='new_work')z.strictObject({origin:z.enum(['client_requested_optional','found_condition_required']),text:note}).parse(p.value);
    if(field?.maps_to?.kind!=='new_work'&&field?.type==='text'&&(typeof p.value!=='string'||!p.value.trim()))throw new Error('text_required');
    if(field?.range && ['number','count','year','length','length_pair'].includes(field.type)){
     const values=Array.isArray(p.value)?p.value:[p.value];
     if(values.some((value,index)=>{const range=field.component_ranges?.[index]??field.range!;return typeof value!=='number'||!Number.isFinite(value)||value<range[0]||value>range[1];}))throw new Error(`range:${def?.key}.${a.field_key}|${(field.component_ranges??[field.range]).map(r=>r.join('–')).join(' × ')}${field.unit==='in'?'″':''}`);
    }
    if(def?.key==='room'&&field?.key==='part_of'){const titles=s.pins.filter(p=>p.kind==='template').map(p=>(p.definition as TemplateDef).title);if(!Array.isArray(p.value)||p.value.some(v=>!titles.includes(v)))throw new Error('invalid_room_template');}
    if(field?.type==='date')day.parse(p.value);
    if(field?.type==='multi'&&(!Array.isArray(p.value)||!p.value.length||new Set(p.value).size!==p.value.length))throw new Error('distinct_choices_required');
    if(field?.type==='length'||field?.type==='length_pair'){for(const value of Array.isArray(p.value)?p.value:[p.value])if(typeof value!=='number'||Math.abs(value*16-Math.round(value*16))>1e-8)throw new Error('length_precision');}
   }
   if(def?.context_module||def?.key==='visit'||field?.derive_cases||field?.derive)throw new Error('derived_field_protected');
   const operation={...p,...a,...(op.type==='resolve'?{resolution:op.payload}:{}),generation:op.generation,base_revision:op.base_revision};
   const result=(await one<{v:{code:string;revision:number;answer_id:string}}>(c,'SELECT consult_capture_answer($1,$2,$3,$4,$5,$6) v',[await scoped(c,context,'capture_answer',target),target,op.device_id,op.device_epoch,op.client_event_id,operation])).v;
   if(result.code==='accepted'&&p.summary_text!==undefined)await saveAcknowledgedSummary(c,target,a.instance_id,actor,p.summary_text);
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
  if(op.type==='decisions'||op.type==='start'||op.type==='remove_instance'||op.type==='create_instance'||op.type==='discard_rejection'||Number(s.consult.completion_generation)!==op.generation){
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
   if(message.startsWith('range:'))receipt.details={fields:[message.slice(6).split('|')[0]],detail:`Outside ${message.split('|')[1]} — measure again`};
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
 const v=z.strictObject({device:uuid,epoch:rev.min(1),expected_revision:rev,generation:rev.min(1).optional(),map_patch:z.boolean().optional(),baseline:evidenceSchema.nullable().optional(),baseline_hash:z.string().regex(/^[a-f0-9]{64}$/).optional(),evidence:evidenceSchema.partial().extend({skips:z.record(z.string(),evidenceSchema.shape.skips.valueType.nullable()).optional(),flags:z.record(z.string(),evidenceSchema.shape.flags.valueType.nullable()).optional()})}).parse(input);
 await deviceGate(c,target,v.device,v.epoch,actor);const s=await snapshot(c,context,target);
 if(s.consult.status==='complete')throw new Error('complete_locked');
 if(Number(s.consult.revision)!==v.expected_revision)throw new Error('conflict');
 if(v.generation!==undefined&&v.generation!==Number(s.consult.completion_generation))throw new Error('rebase_required');
 const existing=(await one<{evidence:z.infer<typeof evidenceSchema>}>(c,'SELECT evidence FROM consult_close_evidence WHERE consult_id=$1',[target]))?.evidence??null;
 if(v.baseline_hash!==undefined && v.baseline_hash!==hash(existing))throw new Error('stale_snapshot');
 const replacement=evidenceSchema.parse(v.map_patch?mergeEvidence(existing,v.evidence):{...existing,...v.evidence});
 if(JSON.parse(context.payload).role!=='owner' && ((replacement.return_day && replacement.return_day!==existing?.return_day)||replacement.trade_walks.some(w=>w.day && !existing?.trade_walks.some(old=>old.trade===w.trade&&old.day===w.day))))throw new Error('owner_required');
 if(existing && hash(existing)===hash(replacement))return {revision:v.expected_revision};
 // Absence is not deletion. Replacement requires the exact evidence the editor saw.
 if(existing && hash(existing)!==hash(replacement) && v.baseline_hash!==hash(existing) && hash(v.baseline??null)!==hash(existing))throw new Error('evidence_conflict');
 await c.query(`INSERT INTO consult_close_evidence VALUES($1,$2,$3,now()) ON CONFLICT(consult_id) DO UPDATE SET evidence=$2,actor=$3,updated_at=now()`,[target,replacement,actor]);
 await c.query('UPDATE consults SET photos_ok=$2,promised_date=$3,client_ack_skip=CASE WHEN $5 THEN client_ack_skip ELSE $4::jsonb END,revision=revision+1 WHERE id=$1',[target,replacement.photos_ok,replacement.promised_date,{reason:replacement.ack_reason,handed_back:true,actor},!!existing&&existing.ack_reason===replacement.ack_reason&&existing.handed_back===replacement.handed_back]);
 await c.query('UPDATE consult_devices SET close_manifest=NULL,close_ack_at=NULL WHERE consult_id=$1 AND revoked_at IS NULL',[target]);
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
 const global:Record<string,unknown>={'visit.template_count':templates.length};
 // Ambiguous repeat values never pick a winner for a cross-module condition.
 for(const m of modules)for(const f of m.fields){const values=live.filter(i=>i.module_key===m.key).map(i=>projection.scalar(i,f.key)).filter(v=>v!==undefined);if(values.length)global[`${m.key}.${f.key}`]=values.length===1?values[0]:values;}
 const media=(await c.query('SELECT id,instance_id,field_key,shot_key,sha256,kind FROM consult_media WHERE consult_id=$1 AND removed_at IS NULL',[target])).rows;
 const fields:CompletionItem[]=[], photos:CompletionItem[]=[],flags:CompletionInput['flags']=[];
 for(const i of live){const m=modules.find(m=>m.key===i.module_key);if(!m)throw new Error('unknown_module');
  if(!countedModule(m))continue; // r11 extra: the same items the device counts (server-filled visit context is not one)
  const values={...global};for(const a of s.heads.filter(a=>a.instance_id===i.id&&a.status==='answered'))values[a.field_key]=a.value;for(const f of m.fields){const derived=projection.scalar(i,f.key);if(derived!==undefined)values[f.key]=derived;}
  values['toilet_fixture_plans']=live.filter(fixture=>fixture.module_key==='plumb_fixture' && sameBathroom(i,fixture)).flatMap(fixture=>{const get=(key:string)=>s.heads.find(a=>a.instance_id===fixture.id&&a.field_key===key&&a.status==='answered')?.value;return get('fixture')==='Toilet'?[get('plan')]:[];});
    const localKnown=new Set([...known,...m.fields.map(f=>f.key)]);
  const required=(r:ModuleDef['fields'][number]['required'])=>compileCondition(r,localKnown)(values);
  for(const f of m.fields){const key=`${i.id}:${f.key}`, a=s.heads.find(a=>a.instance_id===i.id&&a.field_key===f.key);
   const prefilled=m.key==='era'&&f.key==='before_1978'&&(!a||a.status==='cleared')&&typeof projection.scalar(i,f.key)==='boolean';
   const sk=e?.skips[key];
   // A signature field can't be typed (capture_answer refuses it); committed initials media for that exact field answers it.
   const signed=f.type==='signature'&&media.some(p=>p.instance_id===i.id&&p.kind==='initials'&&p.field_key===f.key);
   fields.push({key,tier:f.tier,required:!['name','level','decision'].includes(f.key)&&required(f.required),applicable:true,mapped:!!f.maps_to,answered:prefilled||a?.status==='answered'||signed,valid:prefilled||signed||(a?.status==='answered'&&a.value!==null&&a.value!==''&&(!Array.isArray(a.value)||a.value.length>0)),skip:a?.status==='skipped'&&!(m.key==='room'&&f.key==='part_of'&&templates.length>1)?{reason:a.skip_reason as NonNullable<CompletionItem['skip']>['reason'],note:a.skip_note??undefined,...(sk?.reason===a.skip_reason?sk:{}),condition_validated:typeof f.required!=='boolean'&&!required(f.required)}:undefined});
   for(const flag of evaluatedFlags(f,key,values)){const flagKey=flag.key;const d=e?.flags[flagKey];flags.push({kind:flag.kind,key:flagKey,address:key,measured:[...new Set(flagInputs(flag.when))].map(ref=>{const parts=ref.split('.'),def=parts.length===1?m.fields.find(f=>f.key===ref):modules.find(m=>m.key===parts[0])?.fields.find(f=>f.key===parts[1]);const source=parts.length===1?i:live.find(i=>i.module_key===parts[0]);return {field:ref,value:values[ref],unit:def?.unit==='in'?'″':def?.unit,address:source?`${source.id}:${def?.key??ref}`:key};}),disposition:d?.disposition??null,note:d?.note??'',actor:d?row.actor:null,at:d?String(row.updated_at):null});}
  }
  for(const shot of [...m.shots,...m.fields.flatMap(f=>f.shots??[])]){
   const key=`${i.id}:shot:${shot.key}`;photos.push({key,tier:shot.tier,required:required(shot.required),applicable:true,mapped:false,answered:media.some(p=>p.instance_id===i.id&&p.shot_key===shot.key),valid:true,skip:e?.skips[key]});
  }
 }
 const devices=(await c.query(`SELECT d.device_id,d.close_ack_at,d.close_manifest FROM consult_devices d WHERE d.consult_id=$1 AND NOT EXISTS(SELECT 1 FROM consult_events e,jsonb_array_elements(e.payload->'devices') x WHERE e.consult_id=d.consult_id AND e.type='missing_device_exception' AND x->>'device_id'=d.device_id::text AND (x->>'epoch')::bigint=d.epoch)`,[target])).rows;
 const rrp=rrpFacts(global,media.some(p=>p.kind==='initials'&&p.field_key==='pamphlet_initials'&&live.some(i=>i.id===p.instance_id&&i.module_key==='era')),s.consult.scheduled_at,(await one<{start_date:string|null}>(c,'SELECT start_date::text FROM projects WHERE id=$1',[s.consult.project_id])).start_date);
 const receiptException=live.some(i=>i.module_key==='era'&&s.heads.some(h=>h.instance_id===i.id&&['pamphlet_given','pamphlet_initials'].includes(h.field_key)&&h.status==='skipped'&&(['Client absent','Client declined'].includes(h.skip_reason??'')||!!h.skip_note?.trim())&&e?.skips[`${i.id}:${h.field_key}`]?.reason===h.skip_reason));
 const rrpApplies=rrp.applies;
 const derivedTrades=touchedTrades(live,flags.some(f=>live.some(i=>i.module_key==='structure'&&f.address?.startsWith(i.id+':'))),global['era.asbestos']);
 const input:CompletionInput={fields,photos,modules:mergeTemplateModules(templates,global).map(m=>({key:m.module,minimum:compileCondition(m.required,known)(global)?Math.max(1,m.min??1):0,live_count:live.filter(i=>i.module_key===m.module).length,parents_valid:live.every(i=>!i.parent_id||live.some(p=>p.id===i.parent_id))})),
 recording:{asked:e?.manual_confirmed===true,choice:e?'manual':null,confirmed_evidence:false,documented_failure_or_stop:false},photo_permission:e?.photos_ok??null,
 acknowledgement:{initials_committed:media.some(m=>m.kind==='initials'&&m.field_key==='client_initials'&&live.some(i=>i.id===m.instance_id&&i.module_key==='closing')),visitor_reason:e?.ack_reason??null,handed_back:e?.handed_back??false},promised_date:e?.promised_date??null,promised_date_skip:s.heads.filter(h=>live.some(i=>i.id===h.instance_id&&i.module_key==='closing')&&h.field_key==='estimate_promised'&&h.status==='skipped').map(h=>({reason:h.skip_reason!,note:h.skip_note}))[0],
 manifests:devices.map(d=>({device:d.device_id,acknowledged:!!d.close_ack_at,rejected:0,missing:!d.close_manifest})),unresolved_conflicts:s.conflicts.length,
 rrp:{applies:rrpApplies,receipt:rrp.receipt||receiptException,firm_current:rrp.firm_current,renovator_current:rrp.renovator_current,redelivery_required:e?.rrp.redelivery_required??false,redelivery_todo:!!e?.rrp.redelivery_day},flags,
 touched_trades:[...new Set([...derivedTrades,...(e?.touched_trades??[])])],trade_walks:(e?.trade_walks??[]).map(w=>({...w,actor:row.actor,at:String(row.updated_at)})),no_trades_confirmed:derivedTrades.length===0&&(e?.no_trades_confirmed??false)};
 return {result:consultCompleteness(input),flags,snapshot:s,evidence:e,receiptException:rrp.applies&&receiptException};
}
export async function close(c:PoolClient,context:Context,target:string,input:unknown){
 const actor=await authorize(c,context,target,'close');
 const v=z.strictObject({expected_revision:rev,manifest:manifestSchema}).parse(input),m=v.manifest;
 const ack=await deviceGate(c,target,m.device,m.epoch,actor);
 const s=await snapshot(c,context,target);const digest=hash(m);const initials=[...new Set([...(m.initials_hashes??[]),...(m.initials_hash?[m.initials_hash]:[])])];
 const prior=await one<{close_manifest:{digest?:string}|null}>(c,'SELECT close_manifest FROM consult_devices WHERE consult_id=$1 AND device_id=$2 AND epoch=$3',[target,m.device,m.epoch]);
 if(prior.close_manifest?.digest===digest && ['complete','incomplete'].includes(s.consult.status))return {digest,...(await completion(c,context,target)).result,revision:Number(s.consult.revision)};
 if(s.consult.status==='complete')throw new Error('complete_locked');
 if(v.expected_revision!==Number(s.consult.revision))throw new Error('conflict');
 if(ack!==m.last_seq)throw new Error('manifest_sequence_gap');
 const rejected=await one<{n:string}>(c,`SELECT count(*) n FROM consult_sync_receipts r WHERE r.consult_id=$1 AND r.device_id=$2 AND r.epoch=$3 AND (r.result->>'status')::int<>200 AND NOT EXISTS(SELECT 1 FROM consult_conflicts x JOIN consult_answers a ON a.id=x.proposed_answer_id WHERE x.consult_id=r.consult_id AND a.event_id=r.event_id AND x.resolved_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM consult_sync_receipts newer WHERE newer.consult_id=r.consult_id AND newer.result->>'supersedes'=r.event_id::text AND newer.result->>'status'='200')`,[target,m.device,m.epoch]);
 if(Number(rejected.n))throw new Error('unresolved_rejections');
 for(const h of [...m.required_blob_hashes,...initials]){
  if(!await one(c,'SELECT id FROM consult_media WHERE consult_id=$1 AND sha256=$2 AND removed_at IS NULL',[target,h]))throw new Error('manifest_blob_missing');
 }
 const committed=(await c.query('SELECT sha256,kind FROM consult_media WHERE consult_id=$1 AND removed_at IS NULL',[target])).rows;
 if(committed.some(p=>p.kind==='initials'?!initials.includes(p.sha256):!m.required_blob_hashes.includes(p.sha256)))throw new Error('manifest_blob_missing');
 for(const initialsHash of initials)if(!await one(c,"SELECT id FROM consult_media WHERE consult_id=$1 AND sha256=$2 AND kind='initials' AND removed_at IS NULL",[target,initialsHash]))throw new Error('manifest_initials_missing');
 await c.query('UPDATE consult_devices SET close_manifest=$4,close_ack_at=now() WHERE consult_id=$1 AND device_id=$2 AND epoch=$3',[target,m.device,m.epoch,{...m,digest}]);
 const {result,evidence,receiptException}=await completion(c,context,target);
 const owner=await ownerId(c);
 if(receiptException)await todo(c,s,'rrp','delivery','Renovate Right: get the owner’s initials, or mail it with a certificate of mailing at least 7 days before work starts',owner,(await one<{start_date:string|null}>(c,'SELECT (start_date - 7)::text AS start_date FROM projects WHERE id=$1',[s.consult.project_id])).start_date);
 const nextDay=(await one<{work_day:string}>(c,`SELECT CASE extract(isodow FROM (now() AT TIME ZONE 'America/Chicago')::date) WHEN 5 THEN (now() AT TIME ZONE 'America/Chicago')::date+3 WHEN 6 THEN (now() AT TIME ZONE 'America/Chicago')::date+2 ELSE (now() AT TIME ZONE 'America/Chicago')::date+1 END::text AS work_day`)).work_day;
 if(!result.complete)await todo(c,s,'finish','visit','Finish in-home consultation',s.consult.conducted_by,nextDay);
 if(evidence){
  if(Object.values(evidence.skips).some(s=>s.reason==='Get on return visit'))await todo(c,s,'return','visit','Schedule return consultation',owner,evidence.return_day??null);
  await todo(c,s,'promise','estimate',evidence.promised_date?'Prepare promised formal estimate':`Set the formal estimate date and tell ${(await one<{client:string}>(c,"SELECT coalesce(client_name,name) client FROM projects WHERE id=$1",[s.consult.project_id])).client}`,owner,evidence.promised_date);
  for(const w of evidence.trade_walks.filter(w=>w.needed))await todo(c,s,'trade',w.trade,`${w.trade}: bid walk-through`,owner,w.day??null);
  if(evidence.rrp.redelivery_required&&evidence.rrp.redelivery_day)await todo(c,s,'rrp','redelivery','Renovate Right: give it again — work starts more than 60 days after the visit. Get the owner’s initials, or mail it with a certificate of mailing at least 7 days before work starts',owner,evidence.rrp.redelivery_day);
 }
 await c.query('SELECT consult_reconcile_rrp($1)',[s.consult.project_id]);
 if(result.complete)await c.query('UPDATE consult_field_heads SET locked_generation=$2 WHERE consult_id=$1',[target,s.consult.completion_generation]);
 await c.query(`UPDATE consults SET status=$2,revision=revision+1,closed_at=now(),closed_by=$3,completed_at=CASE WHEN $4 THEN now() END,completed_by=CASE WHEN $4 THEN $3::uuid END,completeness_cache=$5 WHERE id=$1`,[target,result.complete?'complete':'incomplete',actor,result.complete,result]);
 await c.query("UPDATE work_items SET status='done',completed_at=now() WHERE source_kind='consult' AND (source_id=$1 OR ($3 AND source_id=$2)) AND status NOT IN ('done','cancelled')",[`${target}:schedule:visit`,`${target}:finish:visit`,result.complete]);
 await c.query("UPDATE work_items SET status='done',completed_at=now() WHERE source_kind='consult' AND source_id=$1 AND status NOT IN ('done','cancelled')",[`${target}:close_failure:visit`]);
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
 await c.query('UPDATE consult_devices SET close_manifest=NULL,close_ack_at=NULL WHERE consult_id=$1 AND revoked_at IS NULL',[target]);
 return {revision,answer_id:answer.id};
}
export async function command(c:PoolClient,context:Context,target:string,kind:string,input:unknown):Promise<unknown>{
 if(kind==='prepare_device'){
  if(!await one(c,"SELECT key FROM app_settings WHERE key='consult_capture' AND value='true'"))return {ok:false,code:'capture_disabled'};
  const actor=await authorize(c,context,target,'prepare_device');const v=z.strictObject({device:uuid,expected_revision:rev}).parse(input);
  await c.query('SELECT id FROM consults WHERE id=$1 FOR UPDATE',[target]);
  const s=await snapshot(c,context,target);if(Number(s.consult.revision)!==v.expected_revision)return {ok:false,code:'conflict'};
  if(!['scheduled','in_progress','incomplete'].includes(s.consult.status))return {ok:false,code:'complete_locked'};
  const active=await one<{device_id:string;user_id:string;epoch:string;last_ack_seq:string}>(c,'SELECT * FROM consult_devices WHERE consult_id=$1 AND revoked_at IS NULL',[target]);
  if(active&&(active.device_id!==v.device||active.user_id!==actor))return {ok:false,code:'device_access_denied'};
  const epoch=active?Number(active.epoch):Number((await one<{epoch:string}>(c,'SELECT coalesce(max(epoch),0)+1 epoch FROM consult_devices WHERE consult_id=$1 AND device_id=$2',[target,v.device])).epoch);
  if(!active){await c.query('INSERT INTO consult_devices(consult_id,device_id,user_id,epoch) VALUES($1,$2,$3,$4)',[target,v.device,actor,epoch]);await audit(c,target,actor,'device_prepared',{device:v.device,epoch});}
  return {ok:true,epoch,last_ack_seq:Number(active?.last_ack_seq??0),revision:Number(s.consult.revision),generation:Number(s.consult.completion_generation)};
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
  const v=z.strictObject({operation_id:uuid,original_user:uuid,device:uuid,epoch:rev.min(1),reason:note,ops:z.array(opSchema).max(50),blobs:z.array(z.strictObject({hash:z.string().regex(/^[a-f0-9]{64}$/),event_id:uuid,instance_id:uuid,kind:z.enum(['photo','initials']),mime:note,field_key:note.optional(),shot_key:note.optional(),receipt:z.strictObject({file_id:z.string().regex(/^consult-[0-9a-f-]{36}$/),media_id:uuid}).optional()})).max(1000).optional()}).parse(input);
  const device=await one(c,'SELECT user_id FROM consult_devices WHERE consult_id=$1 AND device_id=$2 AND epoch=$3 AND user_id=$4',[target,v.device,v.epoch,v.original_user]);
  if(!device)throw new Error('device_access_denied');
  const prior=await one<{payload_hash:string;payload:typeof v}>(c,'SELECT payload_hash,payload FROM consult_events WHERE consult_id=$1 AND event_id=$2',[target,v.operation_id]);
  if(prior){if(prior.payload_hash!==hash(v))throw new Error('idempotency_mismatch');return {ok:true,staged:true};}
  const s=await snapshot(c,context,target);
  for(const blob of v.blobs??[])if(blob.receipt&&!await one(c,'SELECT id FROM consult_media WHERE consult_id=$1 AND id=$2 AND file_id=$3 AND sha256=$4 AND instance_id=$5 AND removed_at IS NULL',[target,blob.receipt.media_id,blob.receipt.file_id,blob.hash,blob.instance_id]))throw new Error('invalid_recovery_manifest');
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
 if(kind==='record_rrp_delivery'){
  await authorize(c,context,target,'record_rrp_delivery');
  const v=z.strictObject({method:z.enum(['hand','mail']),day:day,redelivery:z.boolean().optional()}).parse(input);
  return (await c.query('SELECT consult_record_rrp_delivery($1,$2,$3,$4,$5) result',[context,target,v.method,v.day,v.redelivery??false])).rows[0].result;
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
 if(kind==='report_close_failure'){
  const actor=await authorize(c,context,target,kind);
  const v=z.strictObject({reason:note}).parse(input);
  const s=await snapshot(c,context,target);
  if(['complete','incomplete'].includes(s.consult.status))return {reported:false};
  const names=await one<{visitor:string;client:string}>(c,"SELECT u.name visitor,coalesce(p.client_name,p.name) client FROM consults c JOIN projects p ON p.id=c.project_id JOIN users u ON u.id=c.conducted_by WHERE c.id=$1",[target]);
  await todo(c,s,'close_failure','visit',`${names.visitor}'s visit for ${names.client} hasn't closed — ${officeCloseFailure(v.reason)}`,await ownerId(c),null);
  await c.query("UPDATE work_items SET status='open',completed_at=NULL WHERE source_kind='consult' AND source_id=$1 AND status IN ('done','cancelled')",[`${target}:close_failure:visit`]);
  await c.query("UPDATE work_items SET title=$2,body=$3 WHERE source_kind='consult' AND source_id=$1",[`${target}:close_failure:visit`,`${names.visitor}'s visit for ${names.client} hasn't closed — ${officeCloseFailure(v.reason)}`,`Close refusal code: ${v.reason}`]);
  await audit(c,target,actor,'close_failure',v);
  return {reported:true};
 }
 if(kind==='close')return close(c,context,target,input);
 if(kind==='assign')return assign(c,context,target,input);
 if(kind==='start'){
  await authorize(c,context,target,'start');const v=z.strictObject({device:uuid,expected_revision:rev}).parse(input);
  return one(c,'SELECT consult_start($1,$2,$3,$4) epoch',[context,target,v.device,v.expected_revision]);
 }
 if(kind==='reopen'){
  const actor=await authorize(c,context,target,'reopen',true);const v=z.strictObject({expected_revision:rev,reason:note}).parse(input);
  const r=await one(c,'SELECT consult_reopen($1,$2,$3,$4) generation',[context,target,v.expected_revision,v.reason]);
  await c.query('UPDATE consult_devices SET close_manifest=NULL,close_ack_at=NULL WHERE consult_id=$1 AND revoked_at IS NULL',[target]);await audit(c,target,actor,'reopen',v);return r;
 }
 throw new Error('unknown_command');
}

export async function latestReopen(c:Pick<PoolClient,'query'>,target:string):Promise<{who:string;when:string;reason:string}|null>{
 const r=await c.query(`SELECT u.name AS who,e.created_at AS when,e.payload->>'reason' AS reason FROM consult_events e JOIN users u ON u.id=e.actor JOIN consults v ON v.id=e.consult_id WHERE e.consult_id=$1 AND e.type='reopen' AND v.closed_at IS NULL ORDER BY e.server_revision DESC,e.created_at DESC LIMIT 1`,[target]);
 return r.rows[0]??null;
}

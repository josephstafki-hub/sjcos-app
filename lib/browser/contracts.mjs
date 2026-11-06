/** Shared v1 validators for future stdio MCP, routes and UI. No registration.
 * Structural parsing is not authorization. Server adapters must enforce actor,
 * capability, task, observations, reviewed facts and exact request proofs.
 */
import {z} from 'zod';
import {parseBrowserUrl,canonicalOrigin} from './network-policy.mjs';
const object=z.strictObject;
const text=n=>z.string().max(n).refine(x=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(x),'Invalid text');
const bounded=n=>text(n).min(1);
const uuid=z.uuid();
const int=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive=int.min(1);
const iso=z.iso.datetime({offset:true});
const origin=z.string().refine(x=>{try {canonicalOrigin(x);return true;}catch{return false;}},'Invalid origin');
const url=z.string().refine(x=>{try {parseBrowserUrl(x);return true;}catch{return false;}},'Invalid URL');
export const OPERATIONS=Object.freeze(['click','fill','select','check','scroll','key']);
// Deliberately small public control vocabulary. Adapter must normalize ARIA
// roles into these; unsupported controls require human take-over.
export const CONTROL_ROLES=Object.freeze(['button','link','textbox','combobox','checkbox','radio','listbox','option','spinbutton','slider','switch','menuitem','tab','searchbox']);
const operation=z.enum(OPERATIONS);
const ref=bounded(80);
const safeId=bounded(120).regex(/^[A-Za-z0-9_.:-]+$/);
const taskFields={task_id:uuid,run_id:uuid,state:z.enum(['queued','starting','active','paused','closed','failed']),
  control:z.enum(['agent','person','none']),private:z.boolean(),privacy_mode:z.enum(['public','private','delegated_secret']),
  allowed_sites:z.array(origin).max(32).refine(x=>new Set(x).size===x.length),
  required_areas:z.array(safeId).max(32).refine(x=>new Set(x).size===x.length),
  manifest_revision:positive,read_manifest_revision:int,control_epoch:int,document_epoch:int,
  attention:z.enum(['none','person','joe','check_result'])
};
const consistentPrivacy=x=>x.private===(x.privacy_mode!=='public');
export const TaskV1=object(taskFields).refine(consistentPrivacy,'Privacy mode mismatch');
const publicControl=object({ref,role:z.enum(CONTROL_ROLES),label:text(1000)});
const privateControl=object({ref,operation,field_key:safeId.nullable()});
const obs={ok:z.literal(true),observation_id:uuid,document_epoch:int,expires_at:iso};
export const ObservationV1=z.discriminatedUnion('private',[
  object({...obs,private:z.literal(false),untrusted_page:object({origin,text:text(32768),controls:z.array(publicControl).max(150)})}),
  object({...obs,private:z.literal(true),adapter_id:safeId.nullable(),controls:z.array(privateControl).max(150)})
]).superRefine((x,ctx)=>{
  if(Buffer.byteLength(JSON.stringify(x),'utf8')>32768) ctx.addIssue({code:'custom',message:'Observation exceeds 32 KiB'});
  const controls=x.private?x.controls:x.untrusted_page.controls;
  if(new Set(controls.map(c=>c.ref)).size!==controls.length) ctx.addIssue({code:'custom',message:'Duplicate ref'});
  if(x.private&&x.adapter_id===null&&controls.length) ctx.addIssue({code:'custom',message:'Adapter required'});
});
/** Contextual validation required before returning observations to any model. */
export function validateObservation(value,{now,documentEpoch,adapter=null}={}) {
  const x=ObservationV1.parse(value); const expiry=Date.parse(x.expires_at);
  if(!Number.isFinite(now)||expiry<=now||expiry-now>30_000||(documentEpoch!==undefined&&documentEpoch!==x.document_epoch)) throw new Error('BROWSER_OBSERVATION_STALE');
  if(x.private&&x.adapter_id!==null) {
    if(!adapter||adapter.id!==x.adapter_id||!Array.isArray(adapter.controls)||x.controls.some(c=>!adapter.controls.some(a=>a.ref===c.ref&&a.operation===c.operation&&a.field_key===c.field_key))) throw new Error('BROWSER_ADAPTER_REQUIRED');
  }
  return x;
}
export const PermitBrowserHandoffV1=object({version:z.literal(1),project_id:uuid,project_slug:bounded(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),work_item_id:uuid,
  research_file_ids:z.array(safeId).max(128),portal_origin:origin.nullable(),city:text(160).nullable(),
  confirmed_facts:object({address:text(1000).nullable(),applicant_name:text(300).nullable(),license_number:text(120).nullable(),scope_summary:text(4000).nullable()}),
  missing:z.array(bounded(1000)).max(100),required_areas:z.tuple([z.literal('projects'),z.literal('compliance')]),
  next_step:z.enum(['review_sites','confirm_details']),source_trigger_ref:bounded(240)
});
// BrowserTaskV1 server association is deliberately separate from model Task.
// No reusable capability or principal accepted by any TOOL_SCHEMAS input.
export const BrowserTaskV1=object({...taskFields,actor_ref:uuid,capability_ref:uuid,manifest_ref:uuid,state_ref:uuid})
  .refine(consistentPrivacy,'Privacy mode mismatch');
const common=['DISABLED','ATTENDED_ONLY','NOT_AUTHENTICATED','NOT_FOUND','FORBIDDEN','REVOKED','BUSY','RESOURCE_LIMIT','SERVICE_UNAVAILABLE','CAPABILITY_EXPIRED','BAD_INPUT','IDEMPOTENCY_CONFLICT'];
const additional={
  browser_navigate:['SITE_BLOCKED','ADDRESS_BLOCKED','REVIEW_REQUIRED'],
  browser_act:['CONTROL_HELD','OBSERVATION_STALE','PRIVATE_INPUT_REQUIRED','REVIEW_REQUIRED','ADAPTER_REQUIRED'],
  browser_fill_login:['LOGIN_NOT_AVAILABLE','LOGIN_ORIGIN_MISMATCH','LOGIN_FIELDS_CHANGED','VAULT_UNAVAILABLE','PRIVATE_INPUT_REQUIRED'],
  browser_prepare_action:['REVIEW_UNAVAILABLE','AMOUNT_UNKNOWN','OBSERVATION_STALE'],
  browser_stage_upload:['PROJECT_FILE_REQUIRED','FILE_FORBIDDEN','FILE_CHANGED','FILE_TOO_LARGE'],
};
export const ERROR_CODES=Object.freeze([...new Set([...common,...Object.values(additional).flat()].map(x=>'BROWSER_'+x))]);
const retryable=new Set(['BROWSER_BUSY','BROWSER_RESOURCE_LIMIT','BROWSER_SERVICE_UNAVAILABLE']);
// Fixed public messages only. Callers cannot send exception/page/HTTP strings.
export const ERROR_MESSAGES=Object.freeze(Object.fromEntries(ERROR_CODES.map(c=>[c,c])));
export const ErrorV1=object({ok:z.literal(false),code:z.enum(ERROR_CODES),message:z.enum(ERROR_CODES),retryable:z.boolean(),task_id:uuid.nullable()})
  .refine(x=>x.message===ERROR_MESSAGES[x.code]&&(!x.retryable||retryable.has(x.code)),'Unsafe error');
export function errorEnvelope(code,task_id=null,canRetry=false) {
  return {isError:true,content:[{type:'text',text:JSON.stringify(ErrorV1.parse({ok:false,code,message:ERROR_MESSAGES[code],retryable:canRetry,task_id}))}]};
}
const T={task_id:uuid}, O={...T,observation_id:uuid}, I={...O,idempotency_key:uuid};
const act={...I,ref};
const input={
  browser_open:object(T),browser_status:object(T),browser_observe:object(T),
  browser_navigate:object({...I,url}),
  browser_act:z.discriminatedUnion('operation',[
    object({...act,operation:z.literal('click')}),object({...act,operation:z.literal('fill'),value:text(4000)}),
    object({...act,operation:z.literal('select'),value:text(4000)}),object({...act,operation:z.literal('check'),checked:z.boolean()}),
    object({...act,operation:z.literal('scroll'),direction:z.enum(['up','down'])}),
    object({...act,operation:z.literal('key'),key:z.enum(['Tab','Shift+Tab','Enter','Escape'])})]),
  browser_list_logins:object(T),browser_fill_login:object({...I,login_id:uuid}),
  browser_prepare_action:object({...I,ref,kind:z.enum(['login','lookup','save_page','submit','pay','sign','upload']),summary:bounded(1000)}),
  browser_request_take_over:object({...T,reason:z.enum(['login','two_factor','captcha','unsupported_step','review'])}),
  browser_action_status:object({...T,action_id:uuid}),browser_list_downloads:object(T),
  browser_stage_upload:object({...I,file_id:bounded(120),ref}),
  browser_close:object({...T,reason:z.enum(['finished','cancelled'])}),
};
const ok={ok:z.literal(true)};
const pending=object({...ok,action_id:uuid,state:z.literal('pending'),needs_owner:z.boolean(),expires_at:iso});
const download=object({download_id:uuid,name:bounded(256),mime:z.enum(['application/pdf','image/png','image/jpeg']),bytes:int.max(25*1024*1024),private:z.boolean(),state:z.enum(['quarantined','saved','rejected'])})
  .refine(x=>!x.private||x.name==='Private browser file.','Private name must be fixed');
const output={
  browser_open:object({...ok,task:TaskV1,queue_position:positive.max(8).nullable()}),
  browser_status:object({...ok,task:TaskV1,pending_action_id:uuid.nullable(),last_result:z.enum(['none','succeeded','failed','unknown'])}),
  browser_observe:ObservationV1,
  browser_navigate:object({...ok,task:TaskV1,result:z.enum(['loaded','waiting_for_review']),action_id:uuid.nullable()}),
  browser_act:object({...ok,result:z.enum(['done','waiting_for_review','needs_take_over']),action_id:uuid.nullable(),document_epoch:int}),
  browser_list_logins:object({...ok,logins:z.array(object({id:uuid,label:bounded(160),origin,can_use:z.boolean()})).max(128)}),
  browser_fill_login:object({...ok,status:z.literal('private'),login_filled:z.literal(true)}),
  browser_prepare_action:pending,browser_request_take_over:object({...ok,task:TaskV1,requested:z.literal(true)}),
  browser_action_status:object({...ok,action_id:uuid,state:z.enum(['pending','approved','armed','executing','succeeded','denied','expired','stale','failed','unknown']),
    result_code:z.enum([...ERROR_CODES,'CONFIRMED','NOT_CONFIRMED','UNKNOWN']).nullable(),needs_person:z.boolean()}),
  browser_list_downloads:object({...ok,downloads:z.array(download).max(128)}),browser_stage_upload:pending,
  browser_close:object({...ok,task_id:uuid,state:z.literal('closed')}),
};
export const TOOL_NAMES=Object.freeze(Object.keys(input));
export const TOOL_SCHEMAS=Object.freeze(Object.fromEntries(TOOL_NAMES.map(name=>[name,Object.freeze({
  input:input[name],output:z.union([output[name],ErrorV1]),
  // JSON Schema is exported for later SDK registration; strict object unions
  // retain additionalProperties:false. Contextual refinements still run here.
  inputSchema:z.toJSONSchema(input[name]),outputSchema:z.toJSONSchema(z.union([output[name],ErrorV1])),
  errors:Object.freeze([...common,...(additional[name]??[])].map(x=>'BROWSER_'+x)),
})])));
export function validateInput(name,value) {
  if(!Object.hasOwn(TOOL_SCHEMAS,name)) throw new Error('BROWSER_BAD_INPUT');
  return TOOL_SCHEMAS[name].input.parse(value);
}
export function validateOutput(name,value) {
  if(!Object.hasOwn(TOOL_SCHEMAS,name)) throw new Error('BROWSER_BAD_INPUT');
  return TOOL_SCHEMAS[name].output.parse(value);
}

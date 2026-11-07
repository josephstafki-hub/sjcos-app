/** Frozen Phase 1 wire schemas. Client-safe; parsing never grants authority. */
import {z} from 'zod';
const o=z.strictObject;
export const UUID=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const UInt=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const pos=UInt.min(1), utc=z.iso.datetime(), hex=z.string().regex(/^[0-9a-f]{64}$/);
const txt=n=>z.string().max(n).refine(x=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(x));
const bytes=(n)=>txt(n).refine(x=>new TextEncoder().encode(x).length<=n);
const origin=z.string().max(255).regex(/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/).refine(x=>{try{return new URL(x).origin===x&&!x.includes('..');}catch{return false;}});
const fields={task_id:UUID,run_id:UUID,state:z.enum(['queued','starting','active','paused','closed','failed']),control:z.enum(['agent','person','none']),private:z.boolean(),privacy_mode:z.enum(['public','private','delegated_secret']),allowed_sites:z.array(origin).max(32).refine(x=>new Set(x).size===x.length),required_areas:z.array(txt(120).min(1)).min(1).max(32).refine(x=>new Set(x).size===x.length),manifest_revision:pos,read_manifest_revision:UInt,control_epoch:UInt,document_epoch:UInt,attention:z.enum(['none','person','joe','check_result'])};
const privacy=x=>x.private===(x.privacy_mode!=='public');
export const Task=o(fields).refine(privacy);
export const TaskDraft=o({...fields,run_id:z.null()}).refine(privacy);
export const TaskUI=z.union([Task,TaskDraft]);
export const TaskMetadata=o({revision:pos,context_generation:UInt});
export const TaskSafe=o({id:UUID,current_run_id:UUID.nullable(),state:fields.state,private:z.boolean(),privacy_mode:fields.privacy_mode,vault_dependency:z.enum(['none','fill','restore']),manifest_revision:pos,read_manifest_revision:UInt,control_epoch:UInt,document_epoch:UInt,controller_boot_id:UUID.nullable(),context_generation:UInt,revision:pos,attention:fields.attention}).refine(privacy);
const old=['DISABLED','ATTENDED_ONLY','NOT_AUTHENTICATED','NOT_FOUND','FORBIDDEN','REVOKED','BUSY','RESOURCE_LIMIT','SERVICE_UNAVAILABLE','CAPABILITY_EXPIRED','BAD_INPUT','IDEMPOTENCY_CONFLICT','SITE_BLOCKED','ADDRESS_BLOCKED','REVIEW_REQUIRED','CONTROL_HELD','OBSERVATION_STALE','PRIVATE_INPUT_REQUIRED','ADAPTER_REQUIRED','LOGIN_NOT_AVAILABLE','LOGIN_ORIGIN_MISMATCH','LOGIN_FIELDS_CHANGED','VAULT_UNAVAILABLE','REVIEW_UNAVAILABLE','AMOUNT_UNKNOWN','PROJECT_FILE_REQUIRED','FILE_FORBIDDEN','FILE_CHANGED','FILE_TOO_LARGE'];
export const PHASE1_RESULT_CODES=Object.freeze(['PHASE1_READ_ONLY','REVIEW_PENDING','REVIEW_STALE','STREAM_STALE','CONTROL_EXPIRED','QUEUE_FULL','OFFER_EXPIRED','READ_EXPIRED','READ_PROVENANCE_UNKNOWN','FRAME_TOO_LARGE','RATE_LIMIT','AUTH_EXPIRED','LATCHED'].map(x=>'BROWSER_'+x));
export const ERROR_CODES=Object.freeze([...old.map(x=>'BROWSER_'+x),...PHASE1_RESULT_CODES]);
export const ERROR_MESSAGES=Object.freeze(Object.fromEntries(ERROR_CODES.map(x=>[x,x])));
export const RETRYABLE_CODES=Object.freeze(['BROWSER_BUSY','BROWSER_RESOURCE_LIMIT','BROWSER_SERVICE_UNAVAILABLE']);
const statuses={DISABLED:503,ATTENDED_ONLY:403,NOT_AUTHENTICATED:401,NOT_FOUND:404,FORBIDDEN:403,REVOKED:403,BUSY:429,RESOURCE_LIMIT:429,SERVICE_UNAVAILABLE:503,CAPABILITY_EXPIRED:410,BAD_INPUT:400,IDEMPOTENCY_CONFLICT:409,SITE_BLOCKED:422,ADDRESS_BLOCKED:422,REVIEW_REQUIRED:409,CONTROL_HELD:409,OBSERVATION_STALE:409,PRIVATE_INPUT_REQUIRED:422,ADAPTER_REQUIRED:422,LOGIN_NOT_AVAILABLE:422,LOGIN_ORIGIN_MISMATCH:409,LOGIN_FIELDS_CHANGED:409,VAULT_UNAVAILABLE:503,REVIEW_UNAVAILABLE:422,AMOUNT_UNKNOWN:422,PROJECT_FILE_REQUIRED:422,FILE_FORBIDDEN:403,FILE_CHANGED:409,FILE_TOO_LARGE:413,PHASE1_READ_ONLY:422,REVIEW_PENDING:409,REVIEW_STALE:409,STREAM_STALE:409,CONTROL_EXPIRED:410,QUEUE_FULL:429,OFFER_EXPIRED:410,READ_EXPIRED:410,READ_PROVENANCE_UNKNOWN:422,FRAME_TOO_LARGE:413,RATE_LIMIT:429,AUTH_EXPIRED:401,LATCHED:503};
export const HTTP_STATUS=Object.freeze(Object.fromEntries(Object.entries(statuses).map(([k,v])=>['BROWSER_'+k,v])));
export const RESULT_CATALOG=Object.freeze(Object.fromEntries(ERROR_CODES.map(code=>[code,Object.freeze({message:ERROR_MESSAGES[code],status:HTTP_STATUS[code],retryable:RETRYABLE_CODES.includes(code)})])));
export const WebError=o({ok:z.literal(false),code:z.enum(ERROR_CODES),message:z.enum(ERROR_CODES),retryable:z.boolean()}).refine(x=>x.message===ERROR_MESSAGES[x.code]&&(!x.retryable||RETRYABLE_CODES.includes(x.code)));
export function webError(code,retryable=false){return WebError.parse({ok:false,code,message:ERROR_MESSAGES[code],retryable});}
export const ReviewNotice=o({id:UUID,task_id:UUID,original_run_id:UUID.nullable(),revision:pos,kind:z.enum(['public_read','resource_read','write_blocked','final_blocked']),state:z.enum(['pending','closed','expired']),server_deadline:utc.nullable(),result_code:z.enum(ERROR_CODES).nullable(),read_revision:UInt.nullable()});
export const QueueOffer=o({task_id:UUID,queue_position:pos.max(8).nullable(),queue_expires_at:utc.nullable(),offer_expires_at:utc.nullable()});
export const OwnerBrowserReviewClaim=o({kind:z.literal('browser_owner_review'),claim_id:UUID,viewing_user_id:UUID,viewing_session_id:UUID,local_thread_id:UUID.nullable(),task_id:UUID,action_id:UUID.nullable(),original_run_id:UUID,task_principal_user_id:UUID,task_conversation_id:UUID,revision:pos,expires_at:utc});
export const Viewport=o({width:z.literal(1280),height:z.literal(800)});
const frame={stream_id:UUID,stream_generation:pos,frame_id:UUID,seq:UInt,control_epoch:UInt,document_epoch:UInt,viewport:Viewport,width:pos.max(1280),height:pos.max(800)};
export const Frame=o({...frame,jpeg_base64:z.string().max(218456).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)}).refine(x=>x.jpeg_base64.length/4*3-(x.jpeg_base64.endsWith('==')?2:x.jpeg_base64.endsWith('=')?1:0)<=160*1024);
export const EVENT_NAMES=Object.freeze(['state','frame','action','file','reauth','closed']);
export const EventPayloads=Object.freeze({state:o({task:TaskUI,revision:pos,context_generation:UInt,queue_position:pos.max(8).nullable(),offer_expires_at:utc.nullable(),idle_closes_at:utc.nullable(),watching_owner:z.boolean(),private_view_status:z.enum(['required','pending_audit','authorized','unavailable']).optional(),server_time:utc,stream_id:UUID.optional(),stream_generation:pos.optional()}),frame:Frame,action:o({review:ReviewNotice.nullable(),revision:pos}),file:o({available:z.literal(false)}),reauth:o({code:z.enum(ERROR_CODES),deadline:utc}),closed:o({code:z.enum(['BROWSER_OK',...ERROR_CODES]),revision:pos})});
export function validateEvent(name,payload){if(!Object.hasOwn(EventPayloads,name))throw Error('BROWSER_BAD_INPUT');return EventPayloads[name].parse(payload);}
const modifiers=z.array(z.enum(['Alt','Control','Meta','Shift'])).max(4).refine(x=>new Set(x).size===x.length);
const xy={x:z.number().finite().min(0).lt(1280),y:z.number().finite().min(0).lt(800)};
export const InputEvent=z.discriminatedUnion('type',[
 o({type:z.literal('pointer'),phase:z.enum(['down','up','move']),...xy,button:z.union([z.literal(0),z.literal(1),z.literal(2)]),buttons:UInt.max(7),modifiers}),
 o({type:z.literal('wheel'),...xy,delta_x:z.number().finite().min(-1200).max(1200),delta_y:z.number().finite().min(-1200).max(1200)}),
 o({type:z.literal('key'),phase:z.enum(['down','up']),key:txt(40).min(1),code:z.string().regex(/^(?:Key[A-Z]|Digit[0-9]|Space|Tab|Enter|Escape|Backspace|Delete|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown|ShiftLeft|ShiftRight)$/),modifiers}).refine(x=>!x.modifiers.some(m=>['Control','Meta','Alt'].includes(m))&&!/^F\d+$/.test(x.key)&&!['PrintScreen','ContextMenu'].includes(x.key)&&(/^[A-Za-z0-9]$/.test(x.key)||['Tab','Enter','Escape','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Shift',' '].includes(x.key))),
 o({type:z.literal('ime_commit'),text:bytes(4096)}),o({type:z.literal('type_answer'),answer_id:UUID,confirmed_revision:pos})]);
export const ManualInput=o({viewer_id:UUID,device_secret:z.string().regex(/^[A-Za-z0-9_-]{43}$/),control_token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),stream_id:UUID,stream_generation:pos,frame_id:UUID,document_epoch:UInt,control_epoch:UInt,seq:pos,idempotency_key:UUID,event:InputEvent});
export const CONTROL_OPERATIONS=Object.freeze(['take_over','done','give_back','resume','stop','fresh_browser','pause','back','forward','reload','switch_tab']);
export const ControlMessage=o({action:z.enum(CONTROL_OPERATIONS),viewer_id:UUID,device_secret:z.string().regex(/^[A-Za-z0-9_-]{43}$/),expected_epoch:UInt,idempotency_key:UUID,expected_document_epoch:UInt.optional(),context_generation:UInt.optional(),read_manifest_revision:UInt.optional(),target_id:txt(160).min(1).optional()}).refine(x=>!['back','forward','reload','switch_tab'].includes(x.action)||(['expected_document_epoch','context_generation','read_manifest_revision'].every(k=>Number.isSafeInteger(x[k]))&&(x.action!=='switch_tab'||!!x.target_id)));
export const RPC_METHODS=Object.freeze(['admit','join','leave','presence','sites','control','manual_input','health','read_state','read_manifest','read_review','read_answers','read_availability','read_in_use','stream_open','stream_close']);
// RPC payload is an exact route-body / persisted proof pair. Per-method schemas
// must be registered by the server; no arbitrary method, CDP or authority boolean.
export const WebEnvelopeV1=o({v:z.literal(1),method:z.enum(RPC_METHODS),task_id:UUID.nullable(),original_run_id:UUID.nullable(),viewer_id:UUID.nullable(),boot_id:UUID,command_id:UUID,sequence:pos,issued_at:utc,expires_at:utc,nonce:UUID,body_digest:hex,payload:o({proof_id:UUID.nullable(),body:z.record(z.string(),z.unknown())}),signature:hex}).refine(x=>Date.parse(x.expires_at)>Date.parse(x.issued_at)&&Date.parse(x.expires_at)-Date.parse(x.issued_at)<=5000&&new TextEncoder().encode(JSON.stringify(x)).length<=32768).superRefine((x,ctx)=>{const result=RPCPayloads[x.method].safeParse(x.payload);if(!result.success)ctx.addIssue({code:'custom',message:'Invalid method payload'});});
export const BinaryHeader=o({v:z.literal(1),kind:z.enum(['frame','review_image']),viewer_id:UUID,task_id:UUID,boot_id:UUID,...frame,context_generation:UInt,byte_length:pos.max(300*1024),sha256:hex,signature:hex}).refine(x=>x.byte_length<=(x.kind==='frame'?160:300)*1024);

export const OriginManifest=o({v:z.literal(1),entries:z.array(o({origin,role:z.enum(['document','identity','resource'])})).min(1).max(32)}).refine(x=>new Set(x.entries.map(e=>e.origin)).size===x.entries.length&&x.entries.filter(e=>e.role!=='resource').length<=8&&x.entries.filter(e=>e.role==='resource').length<=24);
const publicUrl=bytes(2048).min(1).refine(x=>{try{const u=new URL(x);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&(!u.port||u.port==='443');}catch{return false;}});
export const ReadProposal=o({v:z.literal(1),entries:z.array(o({url:publicUrl,role:z.enum(['document','resource']),source:z.enum(['person','agent','page']),static_rule_id:txt(80).min(1).optional()})).min(1).max(192)});
export const ReadEntry=o({id:UUID,role:z.enum(['document','resource']),method:z.enum(['GET','HEAD']),canonical_url:publicUrl,headers_schema_id:z.literal('anonymous_public_v1'),value_schema:o({v:z.literal(1),kind:z.literal('exact_public'),query:z.array(o({key:txt(2048),value:txt(2048)})).max(128),static_rule_id:txt(80).nullable()}),provenance:o({v:z.literal(1),source:z.enum(['person','agent','page']),classification:z.literal('public_nonbusiness'),source_ref:UUID.nullable()}),approved_by:UUID,approved_session_id:UUID,approved_at:utc,expires_at:utc,max_uses:pos.max(32),parent_document_epoch:UInt,release_action_id:z.null()}).refine(e=>(e.role!=='document'||e.max_uses===1)&&Date.parse(e.expires_at)>Date.parse(e.approved_at)&&Date.parse(e.expires_at)-Date.parse(e.approved_at)<=300000);
export const ReadManifestV1=o({v:z.literal(1),revision:pos,initial_entry_id:UUID,entries:z.array(ReadEntry).min(1).max(192),digest:hex}).refine(x=>new TextEncoder().encode(JSON.stringify(x)).length<=65536&&new Set(x.entries.map(e=>e.id)).size===x.entries.length&&x.entries.some(e=>e.id===x.initial_entry_id&&e.role==='document')&&x.entries.filter(e=>e.role==='document').length<=64&&x.entries.filter(e=>e.role==='resource').length<=128);
export const ReadCandidate=o({id:UUID,url:publicUrl,role:z.enum(['document','resource']),source:z.enum(['person','agent','page']),code:z.enum(ERROR_CODES),server_deadline:utc.nullable(),parent_document_epoch:UInt});
export const ReadConsumeProof=o({v:z.literal(1),task_id:UUID,original_run_id:UUID,boot_id:UUID,context_generation:UInt,task_origins_revision:pos,manifest_revision:pos,manifest_digest:hex,entry_id:UUID,parent_document_epoch:UInt,request_hmac:hex,flow_nonce:UUID,listener_generation:pos,use_ordinal:pos,expires_at:utc,consume_seq:pos,checkpoint_ack_id:txt(120).regex(/^[A-Za-z0-9_-]+$/)});
export const ReadDispatchV1=o({v:z.literal(1),purpose:z.literal('browser-phase1-read-dispatch'),proof:ReadConsumeProof,request:o({method:z.enum(['GET','HEAD']),url:publicUrl,kind:z.enum(['document','resource']),bodySha256:hex,requestDigest:hex}),decision_id:UUID,issued_at:utc,expires_at:utc,signature:z.string().regex(/^[A-Za-z0-9+/]{86}==$/)}).refine(x=>Date.parse(x.expires_at)>Date.parse(x.issued_at)&&Date.parse(x.expires_at)-Date.parse(x.issued_at)<=60000&&Date.parse(x.expires_at)<=Date.parse(x.proof.expires_at));
export const InputEpochs=o({control_epoch:UInt,document_epoch:UInt,stream_generation:pos,stream_id:UUID});
export const ConfirmedAnswer=o({id:UUID,revision:pos,field_key:txt(120).min(1),label:txt(300).min(1),value:bytes(4000),source_message_id:UUID,confirmed_at:utc});
// Metadata responses reserve 2768 bytes for the signed RPC envelope.
export const PageRequest=o({cursor:bytes(256).min(1).optional(),limit:pos.max(20).optional()});
export const MetadataPage=o({items:z.array(z.unknown()).max(20),next_cursor:bytes(256).min(1).nullable(),revision:pos});
export const ReadManifestPage=MetadataPage.extend({items:z.array(ReadEntry).max(20)});
export const ReadCandidatePage=MetadataPage.extend({items:z.array(ReadCandidate).max(20)});
export const ConfirmedAnswerPage=MetadataPage.extend({items:z.array(ConfirmedAnswer).max(20)});
export const RPCPayloads=Object.freeze({
 admit:o({proof_id:UUID,body:o({conversation_id:UUID,project_id:UUID.nullable(),task_kind:z.enum(['public_research','permit','invoice','purchase']),purpose:txt(500).min(1),origins:OriginManifest,initial_read:ReadManifestV1,idempotency_key:UUID})}),
 join:o({proof_id:UUID,body:o({session_id:UUID,device_hash:hex,role:z.enum(['initiator','owner_review']),private_view:z.boolean(),idempotency_key:UUID})}),
 leave:o({proof_id:UUID,body:o({viewer_id:UUID,idempotency_key:UUID})}),
 presence:o({proof_id:UUID,body:o({viewer_id:UUID,visible:z.boolean(),generation:pos,idempotency_key:UUID})}),
 sites:o({proof_id:UUID,body:o({viewer_id:UUID,expected_revision:pos,manifest:OriginManifest,idempotency_key:UUID})}),
 control:o({proof_id:UUID,body:ControlMessage}),manual_input:o({proof_id:UUID,body:ManualInput}),
 health:o({proof_id:z.null(),body:o({})}),
 read_state:o({proof_id:UUID,body:o({scope:z.enum(['task','action','files'])})}),
 read_manifest:o({proof_id:UUID,body:PageRequest}),read_review:o({proof_id:UUID,body:o({action_id:UUID.nullable(),...PageRequest.shape})}),read_answers:o({proof_id:UUID,body:PageRequest}),read_availability:o({proof_id:UUID,body:o({})}),read_in_use:o({proof_id:UUID,body:PageRequest}),
 stream_open:o({proof_id:UUID,body:o({stream_id:UUID,stream_generation:pos,expires_at:utc})}),stream_close:o({proof_id:UUID,body:o({stream_id:UUID,stream_generation:pos,planned:z.boolean()})})
});
export function validateRPC(value){const x=WebEnvelopeV1.parse(value);RPCPayloads[x.method].parse(x.payload);return x;}

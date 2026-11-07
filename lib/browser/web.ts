import 'server-only';
import {randomBytes,randomUUID,createHash,createHmac} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {pool} from '@/lib/db';
import {readBrowserCookieSession,validateWebSession,browserSessionSecretReady,type WebSessionIdentity} from '@/lib/web-sessions';
import {evaluatePhase1Flags} from './phase-flags.mjs';
import {TaskUI,ReviewNotice,OriginManifest,UUID,ConfirmedAnswer,ReadManifestV1,ControlMessage,ManualInput} from './phase1-contracts.mjs';
import * as repo from './repository.mjs';
import {authorizeManualInput} from './privacy.mjs';
import {buildReadManifest} from './read-manifest.mjs';
import {createBrowserWebHandler,digest,equal,fail,InputDedupe,RateWindow,PRIVATE_HEADERS} from './web-transport.mjs';
import {createEventStream,presentationFrame,SSE_HEADERS} from './live-view.mjs';
import {UnixWebController,type WebController,type RpcMethod,type RpcPayload} from './web-rpc';
// SQL rows are private to this adapter. Never spread them into a web response.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row=Record<string,any>;
type Session=WebSessionIdentity;
type Context={user:Row;task:Row|null;viewer:Row|null;claim:Row|null;objectId:string|null};
type Call={operation:string;request:Request;session:Session;context:Context;body:Row|null;flags:Row};
type PublicReadPolicy={facts:(task:Row)=>Promise<string[]>;classifyPublicUrl:(url:string,context:unknown)=>boolean};
const tokenHash=(secret:string)=>createHash('sha256').update(secret).digest();
const iso=(value:unknown)=>value instanceof Date?value.toISOString():typeof value==='string'?new Date(value).toISOString():null;
function epoch(value:unknown){return typeof value==='number'?value:value instanceof Date?value.getTime():typeof value==='string'?Date.parse(value):0;}
function asTask(t:Row){return TaskUI.parse({task_id:t.id,run_id:t.current_run_id??null,state:t.state,control:t.controller_user_id?'person':t.state==='active'?'agent':'none',private:t.private,privacy_mode:t.privacy_mode,allowed_sites:t.origins.entries.map((e:Row)=>e.origin),required_areas:t.required_areas,manifest_revision:Number(t.manifest_revision),read_manifest_revision:Number(t.read_manifest_revision??0),control_epoch:Number(t.control_epoch),document_epoch:Number(t.document_epoch),attention:t.attention});}
const metadata=(t:Row)=>({revision:Number(t.revision),context_generation:Number(t.context_generation)});
function requiredAreas(kind:string,project:unknown,lead:unknown){return [...new Set(['ai',...(kind==='permit'?['projects','compliance']:kind==='invoice'?['invoices']:kind==='purchase'?['purchase_orders']:[]),...(project?['projects']:[]),...(lead?['leads']:[])])];}
function areas(user:Row,required:string[]){if(!['owner','staff'].includes(user.role))fail('BROWSER_FORBIDDEN');if(user.role==='staff'&&!required.every(a=>user.permissions?.includes(a)))fail('BROWSER_FORBIDDEN');}
/** Explicit dependencies enable fake-controller tests, with no production bypass.
 * publicReadPolicy is an installation-owned reviewed classifier, NEVER route JSON.
 */
export function createWebsiteAdapter({db,controller,key,publicReadPolicy}:{db:Pool;controller:WebController;key:Buffer;publicReadPolicy?:PublicReadPolicy}){
 const activeStreams=new Set<string>();
 const inputDedupe=new InputDedupe(key),inputRate=new RateWindow({limit:60}),moveRate=new RateWindow({limit:30});
 const one=async(sql:string,args:unknown[]=[])=>{const {rows}=await db.query(sql,args);return rows[0]??null;};
 const loadTask=async(id:string)=>{const row=await one(`SELECT t.*,coalesce((SELECT max(revision) FROM browser_read_manifests WHERE task_id=t.id),0) read_manifest_revision FROM browser_tasks t WHERE t.id=$1`,[id]);if(row)for(const k of ['control_epoch','document_epoch','context_generation','revision','read_manifest_revision']){row[k]=Number(row[k]);if(!Number.isSafeInteger(row[k]))fail('BROWSER_SERVICE_UNAVAILABLE');}return row;};
 async function settings(){const {rows}=await db.query(`SELECT key,value,updated_at FROM app_settings WHERE key LIKE 'browser.%'`);return {values:Object.fromEntries(rows.map(r=>[r.key,r.value])),revision:Math.max(1,...rows.map(r=>epoch(r.updated_at)))};}
 async function flags(session:Session){const user=await one('SELECT id,role,active,permissions FROM users WHERE id=$1',[session.userId]);return evaluatePhase1Flags({settings:(await settings()).values,env:process.env,user});}
 async function ownThread(id:string,userId:string){if(!UUID.safeParse(id).success||!await one(`SELECT id FROM ai_conversations WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`,[id,userId]))fail('BROWSER_NOT_FOUND');}
 async function records(task:Row){if(task.project_id&&!await one('SELECT id FROM projects WHERE id=$1',[task.project_id]))fail('BROWSER_REVOKED');if(task.lead_slug&&!await one('SELECT slug FROM leads WHERE slug=$1',[task.lead_slug]))fail('BROWSER_REVOKED');await ownThread(task.conversation_id,task.initiator_user_id);}
 async function authorize({request,session,path}:{request:Request;session:Session;path:string}):Promise<Context>{
  if(!await validateWebSession(session))fail('BROWSER_AUTH_EXPIRED');
  const user=await one('SELECT id,role,active,permissions FROM users WHERE id=$1',[session.userId]);if(!user?.active||!['staff','owner'].includes(user.role))fail('BROWSER_FORBIDDEN');areas(user,['ai']);
  if(['/settings','/in-use'].includes(path)&&user.role!=='owner')fail('BROWSER_FORBIDDEN');
  const match=path.match(/^\/(tasks|sessions|actions|artifacts)\/([^/]+)/),objectId=match?.[2]??null;
  let task:Row|null=null,claim:Row|null=null,viewer:Row|null=null;
  if(objectId){UUID.parse(objectId);let taskId=objectId;
   if(match![1]==='actions'){const action=await one(`SELECT task_id FROM browser_commands WHERE safe_result->'review'->>'id'=$1 UNION ALL SELECT task_id FROM browser_actions WHERE id::text=$1 LIMIT 1`,[objectId]);if(!action)fail('BROWSER_NOT_FOUND');taskId=action.task_id;}
   if(match![1]==='artifacts')fail('BROWSER_NOT_FOUND'); // Phase 1 creates no artifacts; Range/HEAD still authenticated above.
   task=await loadTask(taskId);if(!task)fail('BROWSER_NOT_FOUND');areas(user,task.required_areas);await records(task);
   if(task.initiator_user_id!==user.id){if(user.role!=='owner')fail('BROWSER_NOT_FOUND');
    const claimId=request.headers.get('x-sjc-browser-claim');if(!path.endsWith('/join')){if(!UUID.safeParse(claimId).success)fail('BROWSER_NOT_FOUND');claim=await one(`SELECT * FROM browser_owner_views WHERE claim_id=$1 AND task_id=$2 AND viewing_owner_user_id=$3 AND web_session_id=$4 AND revoked_at IS NULL AND expires_at>now()`,[claimId,task.id,user.id,session.sid]);if(!claim||claim.original_run_id!==task.current_run_id)fail('BROWSER_NOT_FOUND');}
   }
   const viewerId=request.headers.get('x-sjc-browser-viewer'),device=request.headers.get('x-sjc-browser-device');
   if(viewerId||device){if(!UUID.safeParse(viewerId).success||!device||! /^[A-Za-z0-9_-]{43}$/.test(device))fail('BROWSER_FORBIDDEN');viewer=await loadViewer(task,session,viewerId!,device);}
   if(path.match(/\/(events|frame)$/)){if(!viewer)fail('BROWSER_FORBIDDEN');if(task.private&&viewer.joined_role==='owner_review'&&(!viewer.owner_private_view_authorized_at||Number(viewer.owner_private_context_generation)!==Number(task.context_generation)))fail('BROWSER_FORBIDDEN');}
  }
  return {user,task,viewer,claim,objectId};
 }
 async function loadViewer(task:Row,session:Session,id:string,device:string,allowHidden=false){const v=await one(`SELECT * FROM browser_viewers WHERE id=$1 AND task_id=$2 AND web_session_id=$3 AND user_id=$4 AND left_at IS NULL`,[id,task.id,session.sid,session.userId]);if(!v||!equal(v.device_secret_hash.toString('hex'),tokenHash(device).toString('hex')))fail('BROWSER_FORBIDDEN');if(!allowHidden&&epoch(v.visible_until)<=Date.now())fail('BROWSER_ATTENDED_ONLY');return v;}
 async function transaction<T>(fn:(c:PoolClient)=>Promise<T>){const c=await db.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async function proof(c:PoolClient,ctx:Context,session:Session,op:string,body:Row,viewer:Row|null=ctx.viewer,extra:Row={}){
  if(!await validateWebSession(session))fail('BROWSER_AUTH_EXPIRED');areas((await one('SELECT role,permissions FROM users WHERE id=$1 AND active',[session.userId]))??{},ctx.task?.required_areas??['ai']);
  if(ctx.task)await c.query('SELECT id FROM browser_tasks WHERE id=$1 FOR UPDATE',[ctx.task.id]);
  const d=Buffer.from(digest(key,{task:ctx.task?.id??null,session:session.sid,viewer:viewer?.id??null,op,body}),'hex');
  const {rows}=await c.query(`INSERT INTO browser_web_commands(task_id,session_id,viewer_id,operation,idempotency_key,body_digest,safe_result,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '5 seconds') ON CONFLICT(session_id,operation,idempotency_key) DO NOTHING RETURNING id`,[ctx.task?.id??null,session.sid,viewer?.id??null,op,body.idempotency_key,d,JSON.stringify(extra)]);
  const old=rows[0]??(await c.query('SELECT id,body_digest,task_id,viewer_id FROM browser_web_commands WHERE session_id=$1 AND operation=$2 AND idempotency_key=$3',[session.sid,op,body.idempotency_key])).rows[0];
  if(!old||(old.body_digest&&!equal(old.body_digest.toString('hex'),d.toString('hex')))||(old.task_id&&old.task_id!==ctx.task?.id))fail('BROWSER_IDEMPOTENCY_CONFLICT');return {id:old.id,d};
 }
 async function rpc<M extends RpcMethod>(method:M,t:Row,v:Row|null,payload:RpcPayload<M>){if(!t.controller_boot_id)fail('BROWSER_SERVICE_UNAVAILABLE');return controller.call(method,{task_id:t.id,original_run_id:t.current_run_id??null,viewer_id:v?.id??null,boot_id:t.controller_boot_id},payload);}
 async function viewerFor(call:Call){const b=call.body!,v=call.context.viewer;if(v){if(b.viewer_id&&b.viewer_id!==v.id||b.device_secret&&!equal(v.device_secret_hash.toString('hex'),tokenHash(b.device_secret).toString('hex')))fail('BROWSER_FORBIDDEN');return v;}if(!b.viewer_id||!b.device_secret)fail('BROWSER_FORBIDDEN');return loadViewer(call.context.task!,call.session,b.viewer_id,b.device_secret,call.operation==='presence'||call.operation==='leave');}
 async function taskResult(id:string){const t=await loadTask(id);if(!t)fail('BROWSER_NOT_FOUND');return {task:asTask(t),...metadata(t)};}
 async function makeManifest(task:Row,session:Session,proposal:unknown,expected:number){if(!publicReadPolicy)fail('BROWSER_READ_PROVENANCE_UNKNOWN');return buildReadManifest({proposal,expectedRevision:expected,actorProof:{task,confirmedFacts:{values:await publicReadPolicy!.facts(task),classifyPublicUrl:publicReadPolicy!.classifyPublicUrl},key:createHmac('sha256',key).update('browser-phase1-read-manifest-key').digest(),userId:session.userId,sessionId:session.sid,sessionExpiresAt:session.exp*1000,authorize:()=>true}});}
 async function currentManifest(id:string){const row=await one('SELECT public_entries,revision,initial_entry_id,manifest_hmac FROM browser_read_manifests WHERE task_id=$1 AND revoked_at IS NULL ORDER BY revision DESC LIMIT 1',[id]);if(!row)fail('BROWSER_READ_EXPIRED');return ReadManifestV1.parse({v:1,revision:Number(row.revision),initial_entry_id:row.initial_entry_id,entries:row.public_entries,digest:row.manifest_hmac.toString('hex')});}
 async function review(t:Row,objectId?:string|null){const row=await one(`SELECT safe_result->'review' review FROM browser_commands WHERE task_id=$1 AND operation='prepare' AND ($2::text IS NULL OR safe_result->'review'->>'id'=$2) ORDER BY created_at DESC LIMIT 1`,[t.id,objectId??null]);if(row?.review)return ReviewNotice.parse(row.review);if(!objectId)return null;const retained=await one('SELECT id,run_id FROM browser_actions WHERE id=$1 AND task_id=$2',[objectId,t.id]);return retained?ReviewNotice.parse({id:retained.id,task_id:t.id,original_run_id:retained.run_id??t.current_run_id,revision:Number(t.revision),kind:'final_blocked',state:'closed',server_deadline:null,result_code:'BROWSER_PHASE1_READ_ONLY',read_revision:null}):null;}
 async function execute(call:Call):Promise<Row|Response>{const {operation,request,session,context:ctx,flags:effective}=call,b=call.body??{},t=ctx.task!,now=()=>new Date().toISOString();
  switch(operation){
   case 'availability':return {enabled:effective.enabled,staff_enabled:effective.staff_enabled,can_start:effective.can_start,reason_code:effective.reason_code,revision:(await settings()).revision};
   case 'tasks':{const conversation=new URL(request.url).searchParams.get('conversation_id')!;await ownThread(conversation,session.userId);const {rows}=await db.query(`SELECT t.*,coalesce((SELECT max(revision) FROM browser_read_manifests WHERE task_id=t.id),0) read_manifest_revision FROM browser_tasks t WHERE conversation_id=$1 AND initiator_user_id=$2 ORDER BY created_at DESC LIMIT 20`,[conversation,session.userId]);for(const row of rows){areas(ctx.user,row.required_areas);await records(row);}return {tasks:rows.map(asTask),snapshots:[],revision:Math.max(1,...rows.map(r=>Number(r.revision)))};}
   case 'in_use':{const {rows}=await db.query(`SELECT t.id task_id,u.name person_label,t.task_kind,p.name project_label,t.state,t.revision FROM browser_tasks t JOIN users u ON u.id=t.initiator_user_id LEFT JOIN projects p ON p.id=t.project_id WHERE t.state IN ('starting','active','paused') ORDER BY t.created_at LIMIT 2`);return {items:rows.map(r=>({...r,revision:Number(r.revision)}))};}
   case 'create':{
    await ownThread(b.conversation_id,session.userId);const origins=OriginManifest.parse({v:1,entries:b.origins});const draft={origins,private:false,privacy_mode:'public',document_epoch:0,read_manifest_revision:0};areas(ctx.user,requiredAreas(b.task_kind,b.project_id,b.lead_slug));
    if(!b.read_proposal.entries.some((e:Row)=>e.url===b.initial_url&&e.role==='document'))fail('BROWSER_BAD_INPUT');
    const initial=ReadManifestV1.parse(await makeManifest(draft,session,b.read_proposal,0));
    const result=await transaction(c=>repo.browserWebAdmit(c,{conversation:b.conversation_id,project:b.project_id??null,kind:b.task_kind,manifest:{purpose:b.purpose,origins,initial_read:initial,...(b.lead_slug?{lead_slug:b.lead_slug}:{})},session:session.sid,i:b.idempotency_key,d:Buffer.from(digest(key,b),'hex')}));return taskResult(result.id);
   }
   case 'status':return {...await taskResult(t.id),active_run_id:t.current_run_id,available_controls:t.state==='closed'||t.state==='failed'?[]:t.private?['take_over','done','stop','fresh_browser']:['take_over','pause','stop'],pending_action:await review(t),downloads:[],queue_position:null,server_time:now()};
   case 'join':{
    if(b.mode==='initiator'&&t.initiator_user_id!==session.userId)fail('BROWSER_NOT_FOUND');if(b.mode==='owner_review'&&ctx.user.role!=='owner')fail('BROWSER_FORBIDDEN');
    const device=ctx.viewer?request.headers.get('x-sjc-browser-device')!:createHmac('sha256',key).update('browser-device-v1\0'+session.sid+'\0'+t.id+'\0'+b.idempotency_key).digest('base64url'),hash=tokenHash(device);let claim:unknown;
    const joined=await transaction(async c=>{if(b.mode==='owner_review'){
      await proof(c,{...ctx,viewer:null},session,'watch',b,null);claim=await repo.browserWebOwnerView(c,{tid:t.id,aid:b.action_id??null,session:session.sid,local_thread:b.local_thread_id??null,i:b.idempotency_key});
     }
     const p=await proof(c,{...ctx,viewer:null},session,'join',b,null,{device_secret_hash:hash.toString('hex')});return repo.browserWebJoin(c,{tid:t.id,session:session.sid,device_hash:hash,role:b.mode,private_view:b.private_view===true,i:b.idempotency_key,d:p.d});});
    return {...joined,device_secret:device,...await taskResult(t.id),available_controls:t.private?['take_over','done','stop','fresh_browser']:['take_over','pause','stop'],pending_action:await review(t),queue_position:null,server_time:now(),...(claim?{owner_review_claim:claim}:{})};
   }
   case 'leave':{const v=await viewerFor(call);return transaction(async c=>{await proof(c,ctx,session,'leave',b,v);const result=await repo.browserWebLeave(c,{vid:v.id,i:b.idempotency_key});if(v.joined_role==='owner_review')await c.query(`UPDATE browser_owner_views SET revoked_at=now(),revision=revision+1 WHERE task_id=$1 AND web_session_id=$2 AND revoked_at IS NULL`,[t.id,session.sid]);return result;});}
   case 'presence':{const v=await viewerFor(call);if(Number(t.control_epoch)!==b.expected_epoch)fail('BROWSER_STREAM_STALE');return transaction(async c=>{await proof(c,ctx,session,'presence',b,v,b.host_context);return {...await repo.browserWebPresence(c,{vid:v.id,visible:b.visible,generation:Number(v.stream_generation),i:b.idempotency_key}),server_time:now()};});}
   case 'start':{const v=ctx.viewer;if(!v||v.joined_role!=='initiator')fail('BROWSER_ATTENDED_ONLY');const op=t.queue_offer_expires_at?'accept':'request';await transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(1150001)');const p=await proof(c,ctx,session,op==='accept'?'accept_offer':'queue',b,v,{boot_id:t.controller_boot_id});return repo.browserWebQueue(c,{tid:t.id,vid:v.id,op,i:b.idempotency_key,d:p.d});});return {...await taskResult(t.id),run_id:t.current_run_id};}
   case 'decline':{if(!ctx.viewer||ctx.viewer.joined_role!=='initiator'||t.state!=='queued')fail('BROWSER_OFFER_EXPIRED');const v=ctx.viewer;await transaction(async c=>{const p=await proof(c,ctx,session,'close',b,v);return repo.browserWebControl(c,{tid:t.id,vid:v.id,op:'stop',epoch:Number(t.control_epoch),i:b.idempotency_key,d:p.d});});return taskResult(t.id);}
   case 'sites':{const v=await viewerFor(call);const manifest=OriginManifest.parse({v:1,entries:[...t.origins.entries,{origin:b.origin,role:b.role}]});await transaction(async c=>{const p=await proof(c,ctx,session,'publish_manifest',b,v);return repo.browserWebSites(c,{tid:t.id,vid:v.id,expected_revision:b.expected_revision,manifest,i:b.idempotency_key,d:p.d});});return taskResult(t.id);}
   case 'reads_get':{const row=await one(`SELECT revision,public_entries,manifest_hmac,expires_at FROM browser_read_manifests WHERE task_id=$1 AND revoked_at IS NULL ORDER BY revision DESC LIMIT 1`,[t.id]);return {revision:Number(row?.revision??0),digest:row?.manifest_hmac?.toString('hex')??null,expires_at:iso(row?.expires_at),entries:row?.public_entries??[],candidates:[],server_time:now()};}
   case 'reads':{const v=await viewerFor(call);const manifest=b.decision==='deny'?await currentManifest(t.id):await makeManifest(t,session,b.proposal,b.expected_revision);return transaction(async c=>{const p=await proof(c,ctx,session,'review',b,v);return repo.browserWebReads(c,{tid:t.id,vid:v.id,expected_revision:b.expected_revision,proposal:manifest,decision:b.decision,i:b.idempotency_key,d:p.d});});}
   case 'answers_get':return {revision:Number(t.revision),answers:t.confirmed_answers.map((a:unknown)=>ConfirmedAnswer.parse(a))};
   case 'answers':{
    if(ctx.user.id!==t.initiator_user_id)fail('BROWSER_FORBIDDEN');
    return transaction(async c=>{const locked=(await c.query('SELECT * FROM browser_tasks WHERE id=$1 FOR UPDATE',[t.id])).rows[0];if(Number(locked.revision)!==b.expected_revision)fail('BROWSER_REVIEW_STALE');const current:Row[]=locked.confirmed_answers;
     for(const p of b.proposal){const source=(await c.query(`SELECT m.content FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id WHERE m.id=$1 AND m.conversation_id=$2 AND m.role='user' AND c.owner_user_id=$3 AND c.deleted_at IS NULL`,[p.source_message_id,t.conversation_id,session.userId])).rows[0];if(!source||typeof source.content!=='string'||!source.content.includes(p.value))fail('BROWSER_READ_PROVENANCE_UNKNOWN');}
     const answers=current.filter(a=>!b.proposal.some((p:Row)=>p.field_key===a.field_key&&p.source_message_id===a.source_message_id));if(b.decision==='confirm')for(const p of b.proposal)answers.push({id:randomUUID(),revision:b.expected_revision+1,field_key:p.field_key,label:p.field_key,value:p.value,source_message_id:p.source_message_id,confirmed_at:now()});
     const p=await proof(c,ctx,session,'review',b);const old=(await c.query('SELECT state,safe_result FROM browser_web_commands WHERE id=$1',[p.id])).rows[0];if(old.state==='succeeded')return old.safe_result.response;
     await c.query('UPDATE browser_tasks SET confirmed_answers=$2,revision=revision+1 WHERE id=$1',[t.id,JSON.stringify(answers.map(a=>ConfirmedAnswer.parse(a)))]);const response={revision:b.expected_revision+1,answers};await c.query(`UPDATE browser_web_commands SET state='succeeded',safe_result=jsonb_build_object('response',$2::jsonb) WHERE id=$1`,[p.id,JSON.stringify(response)]);return response;});
   }
   case 'control':{
    const v=await viewerFor(call);if(Number(t.control_epoch)!==b.expected_epoch)fail('BROWSER_REVIEW_STALE');if(b.action==='give_back'||b.action==='resume'&&t.private)fail('BROWSER_PHASE1_READ_ONLY');
    const {confirmed,...wire}=b;const op=({take_over:'takeover',done:'release',stop:'close'} as Row)[b.action]??b.action;
    const p=await transaction(c=>proof(c,ctx,session,op,b,v,{confirmed:b.confirmed===true}));
    const result=await rpc('control',t,v,{proof_id:p.id,body:ControlMessage.parse(wire)}); // A must execute D's enterPrivate / drain before returning ACK.
    const rawExtra=(result.proof_metadata??{}) as Row;const extra=Object.fromEntries(['drained','context_generation','control_epoch','stream_generation','fenced','old_generation','new_boot_id'].filter(k=>Object.hasOwn(rawExtra,k)).map(k=>[k,rawExtra[k]]));if(['take_over','fresh_browser'].includes(b.action)&&(extra.drained!==true||Number(extra.context_generation)!==Number(t.context_generation)))fail('BROWSER_PRIVATE_INPUT_REQUIRED');
    const controlToken=b.action==='take_over'?createHmac('sha256',key).update('browser-control-v1\0'+session.sid+'\0'+p.id).digest('base64url'):null;
    await transaction(async c=>{if(!await validateWebSession(session))fail('BROWSER_AUTH_EXPIRED');await c.query(`UPDATE browser_web_commands SET safe_result=coalesce(safe_result,'{}')||$2::jsonb WHERE id=$1 AND state='accepted' AND expires_at>clock_timestamp()`,[p.id,JSON.stringify({...extra,...(controlToken?{control_token_hash:tokenHash(controlToken).toString('hex')}:{})})]);return repo.browserWebControl(c,{tid:t.id,vid:v.id,op:b.action,epoch:Number(extra.control_epoch??b.expected_epoch),i:b.idempotency_key,d:p.d});});
    return {...await taskResult(t.id),...(controlToken?{control_token:controlToken,expires_at:new Date(Math.min(session.exp*1000,Date.now()+15000)).toISOString()}:{})};
   }
   case 'input_private':{
    const v=await viewerFor(call);inputRate.take(v.id);if(b.event.type==='pointer'&&b.event.phase==='move')moveRate.take(v.id);
    if(!equal(t.control_token_hash?.toString('hex'),tokenHash(b.control_token).toString('hex'))||t.controller_user_id!==session.userId||!equal(t.controller_device_hash?.toString('hex'),v.device_hash.toString('hex')))fail('BROWSER_CONTROL_EXPIRED');
    return inputDedupe.run(session.sid+':'+v.id+':'+b.stream_generation,b,async()=>{
     const barrier=await one(`SELECT safe_result FROM browser_web_commands WHERE task_id=$1 AND session_id=$2 AND viewer_id=$3 AND operation='takeover' AND state='succeeded' AND safe_result->>'control_token_hash'=$4 AND safe_result->>'context_generation'=$5 ORDER BY created_at DESC LIMIT 1`,[t.id,session.sid,v.id,tokenHash(b.control_token).toString('hex'),String(t.context_generation)]);
     authorizeManualInput({task:t,viewer:{id:v.id,web_session_id:session.sid,present_until:epoch(v.visible_until),expires_at:session.exp*1000,consented:v.joined_role==='initiator'||!!v.owner_private_view_authorized_at,session_valid:true,stream_id:v.stream_id,stream_generation:Number(v.stream_generation),last_frame_uuid:v.last_frame_uuid},control:{drained:barrier?.safe_result?.drained===true,context_generation:Number(t.context_generation),control_epoch:Number(t.control_epoch),holder_viewer_id:v.id,web_session_id:session.sid,expires_at:epoch(t.control_expires_at),claimSequence:()=>b.seq>Number(v.input_seq)},frame:{id:b.frame_id,viewer_id:v.id,context_generation:Number(t.context_generation),document_epoch:b.document_epoch,control_epoch:b.control_epoch,stream_id:b.stream_id,stream_generation:b.stream_generation,expires_at:epoch(v.visible_until)},event:b.event,now:Date.now()});
     const p=await transaction(async c=>{const p=await proof(c,ctx,session,'input',b,v,{control_token_hash:tokenHash(b.control_token).toString('hex')});await repo.browserWebInput(c,{tid:t.id,vid:v.id,frame:b.frame_id,epochs:{control_epoch:b.control_epoch,document_epoch:b.document_epoch,stream_id:b.stream_id,stream_generation:b.stream_generation},seq:b.seq,i:b.idempotency_key,d:p.d});return p;});
     await rpc('manual_input',t,v,{proof_id:p.id,body:ManualInput.parse(b)});return {accepted_seq:b.seq};
    });
   }
   case 'events':case 'frame':{
    const v=ctx.viewer!;const binding={task_id:t.id,viewer_id:v.id,boot_id:t.controller_boot_id,stream_id:v.stream_id,stream_generation:Number(v.stream_generation),context_generation:Number(t.context_generation)};
    const fresh=async()=>{const context=await authorize({request,session,path:new URL(request.url).pathname.replace('/api/agent-browser','')});const f=await flags(session);if(!f.can_start)fail('BROWSER_DISABLED');if(Number(context.task?.control_epoch)!==Number(t.control_epoch)||Number(context.task?.document_epoch)!==Number(t.document_epoch)||context.task?.private!==t.private||context.task?.controller_boot_id!==binding.boot_id||Number(context.task?.context_generation)!==binding.context_generation||context.viewer?.stream_id!==binding.stream_id||Number(context.viewer?.stream_generation)!==binding.stream_generation)fail('BROWSER_STREAM_STALE');return {state:{task:asTask(context.task!),...metadata(context.task!),queue_position:null,offer_expires_at:iso(context.task!.queue_offer_expires_at),idle_closes_at:null,watching_owner:!!context.claim,server_time:now()},action:{review:await review(context.task!),revision:Number(context.task!.revision)}};};
    const p=await transaction(c=>proof(c,ctx,session,'presence',{idempotency_key:randomUUID()},v,{conversation_id:t.conversation_id,claim_id:ctx.claim?.claim_id}));
    await rpc('stream_open',t,v,{proof_id:p.id,body:{stream_id:binding.stream_id,stream_generation:binding.stream_generation,expires_at:new Date(Math.min(session.exp*1000,Date.now()+60000)).toISOString()}});
    if(operation==='frame'){
     // Single current frame, no token/query/Range support. No cached fallback.
     if(request.headers.has('range'))fail('BROWSER_BAD_INPUT');
     const frame=await new Promise<{header:Row;bytes:Buffer}>((resolve,reject)=>{let stopped=false;let stop:()=>void=()=>{stopped=true;};const timer=setTimeout(()=>{stop();reject(Error('BROWSER_STREAM_STALE'));},2000);controller.frames(binding,value=>{clearTimeout(timer);stop();resolve(value as {header:Row;bytes:Buffer});},()=>{clearTimeout(timer);stop();reject(Error('BROWSER_STREAM_STALE'));}).then(f=>{if(stopped)f();else stop=f;}).catch(reject);});await fresh();return new Response(new Uint8Array(frame.bytes),{headers:{...PRIVATE_HEADERS,'Content-Type':'image/jpeg'}});
    }
    if(activeStreams.has(v.id))fail('BROWSER_RESOURCE_LIMIT');activeStreams.add(v.id);
    let stream:ReadableStream;try{stream=await createEventStream({authorize:fresh,expiresAt:session.exp*1000,revision:Number(t.revision),signal:request.signal,initial:{task:asTask(t),...metadata(t),queue_position:null,offer_expires_at:iso(t.queue_offer_expires_at),idle_closes_at:null,watching_owner:!!ctx.claim,server_time:now()},subscribe:async(emit:(name:string,value:unknown)=>void)=>controller.frames(binding,value=>{emit('frame',presentationFrame(value as {header:Row;bytes:Buffer}));},()=>{emit('closed',{code:'BROWSER_STREAM_STALE',revision:Number(t.revision)});}),onClose:async(planned:boolean)=>{activeStreams.delete(v.id);try{const p=await transaction(c=>proof(c,ctx,session,'presence',{idempotency_key:randomUUID()},v));await rpc('stream_close',t,v,{proof_id:p.id,body:{stream_id:binding.stream_id,stream_generation:binding.stream_generation,planned}});}catch{/* No exception text/page data enters the stream. */}}});}catch(e){activeStreams.delete(v.id);throw e;}return new Response(stream,{headers:SSE_HEADERS});
   }
   case 'review':{const notice=await review(t,ctx.objectId);if(!notice)fail('BROWSER_NOT_FOUND');return {review:notice,task_id:t.id,revision:notice!.revision,outcome_code:notice!.result_code??'BROWSER_PHASE1_READ_ONLY',server_deadline:notice!.server_deadline};}
   case 'decision':{const notice=await review(t,ctx.objectId);if(!notice)fail('BROWSER_NOT_FOUND');if(b.expected_revision!==notice!.revision)fail('BROWSER_REVIEW_STALE');if(b.decision!=='deny'||!['write_blocked','final_blocked'].includes(notice!.kind))fail('BROWSER_PHASE1_READ_ONLY');await transaction(async c=>{const p=await proof(c,ctx,session,'review',b);const closed=ReviewNotice.parse({...notice,state:'closed',revision:notice!.revision+1,result_code:'BROWSER_PHASE1_READ_ONLY'});const changed=await c.query(`UPDATE browser_commands SET safe_result=jsonb_set(safe_result,'{review}',$2::jsonb) WHERE task_id=$1 AND safe_result->'review'->>'id'=$3 AND safe_result->'review'->>'revision'=$4`,[t.id,JSON.stringify(closed),notice!.id,String(notice!.revision)]);if(changed.rowCount!==1)fail('BROWSER_REVIEW_STALE');await c.query(`UPDATE browser_web_commands SET state='succeeded' WHERE id=$1`,[p.id]);});return {action_id:notice!.id,state:'closed',result_code:'BROWSER_PHASE1_READ_ONLY'};}
   case 'artifact':fail('BROWSER_NOT_FOUND');break;
   case 'settings_get':case 'settings':{
    if(ctx.user.role!=='owner')fail('BROWSER_FORBIDDEN');const current=await settings();if(operation==='settings'){
     if(current.revision!==b.expected_revision)fail('BROWSER_REVIEW_STALE');
     await transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(1150002)');const fresh=await settings();if(fresh.revision!==b.expected_revision)fail('BROWSER_REVIEW_STALE');for(const [key,value]of Object.entries({'browser.enabled':String(b.enabled),'browser.staff_enabled':String(b.staff_enabled),'browser.pilot_user_ids':JSON.stringify(b.pilot_user_ids),'browser.takeover_confirm_suppressed_user_ids':JSON.stringify(b.suppress_own_takeover_confirm?[session.userId]:[])}))await c.query('UPDATE app_settings SET value=$2,updated_at=clock_timestamp() WHERE key=$1',[key,value]);});
    }const s=await settings();return {flags:evaluatePhase1Flags({settings:s.values,env:process.env,user:ctx.user as never}).flags,pilot_user_ids:JSON.parse(s.values['browser.pilot_user_ids']??'[]'),takeover_confirm_suppressed_user_ids:JSON.parse(s.values['browser.takeover_confirm_suppressed_user_ids']??'[]'),revision:s.revision};
   }
   default:fail('BROWSER_PHASE1_READ_ONLY');
  }
  throw Error('BROWSER_PHASE1_READ_ONLY');
 }
 return {session:async()=>readBrowserCookieSession(),authorize,flags,execute};
}
let handler:((request:Request)=>Promise<Response>)|null=null;
/** One route entry point: never DAL React cache, redirects, bearer or legacy JWT. */
export async function requireBrowserWebRequest(request:Request):Promise<Response>{
 if(!browserSessionSecretReady())return new Response(JSON.stringify({ok:false,code:'BROWSER_DISABLED',message:'BROWSER_DISABLED',retryable:false}),{status:503,headers:{...PRIVATE_HEADERS,'Content-Type':'application/json'}});
 if(!handler){const key=Buffer.from(process.env.SJC_BROWSER_WEB_RPC_KEY??'','hex'),responseKey=Buffer.from(process.env.SJC_BROWSER_WEB_RESPONSE_KEY??'','hex'),frameKey=Buffer.from(process.env.SJC_BROWSER_FRAME_KEY??'','hex');
  if([key,responseKey,frameKey].some(k=>k.length!==32))return new Response(JSON.stringify({ok:false,code:'BROWSER_DISABLED',message:'BROWSER_DISABLED',retryable:false}),{status:503,headers:{...PRIVATE_HEADERS,'Content-Type':'application/json'}});
  const origin=new URL(process.env.NEXT_PUBLIC_APP_URL??'https://os.sjcarpentryllc.com').origin;
  handler=createBrowserWebHandler({origin,csrfKey:process.env.SESSION_SECRET,...createWebsiteAdapter({db:pool,controller:new UnixWebController(key,responseKey,frameKey),key})});
 }
 return handler!(request);
}

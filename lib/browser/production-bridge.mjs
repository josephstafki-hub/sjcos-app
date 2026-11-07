/** Trusted installation bridge. Inputs are protected server adapters, never
 * callbacks/SQL/authority booleans supplied by routes or model arguments. */
import {UUID} from './phase1-contracts.mjs';
import {withDeadline} from './timers.mjs';
import {PROFILE_TOOLS} from '../../mcp/browser-profile-tools.mjs';
import {createPhase1ReadAuthority} from './read-authority.mjs';
import {createGateAuthority} from './controller-gate.mjs';
const fail=()=>{throw Error('BROWSER_FORBIDDEN');};
/** Explicit pool/client; no connection URL or environment fallback. */
export function committedTransaction(pool){
 if(typeof pool?.connect!=='function')fail();
 return async fn=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}};
}
/** A durable adapter must reconcile reservations/runs on every start, including
 * a retry. SQL attachment and supervisor activation remain separate commits;
 * fail/release compensate either crash window; no automatic runner replay. */
export function createAttendedAdmission(io){
 for(const k of ['reconcile','check','reserve','attach','issue','spawn','register','activate','fail','release'])if(typeof io?.[k]!=='function')fail();
 const locks=new Map(),completed=new Map();
 return {async start(request){
  for(const k of ['task_id','viewer_id','idempotency_key'])UUID.parse(request[k]);
  const id=request.task_id,prior=locks.get(id)??Promise.resolve();let unlock;const lock=new Promise(r=>unlock=r);locks.set(id,lock);await prior;
  let reservation,run,child,reserving=false;const controller=new AbortController();
  try{
   await io.reconcile(request);
   const checked=await io.check(request);
   if(checked?.present!==true||checked.profile!=='browser'||checked.agent!=='claude'||checked.launch_source!=='panel_web')throw Error('BROWSER_ATTENDED_ONLY');
   const cacheKey=id+':'+request.viewer_id+':'+request.idempotency_key;
   if(completed.has(cacheKey))return completed.get(cacheKey);
   const result=await withDeadline(async signal=>{
    const active=()=>{if(signal.aborted)throw Error('BROWSER_TIMEOUT');};
    reserving=true;reservation=await io.reserve(request,{signal});active();
    run=await io.attach(request,reservation,{signal});active();
    const capability=await io.issue(request,run,reservation,{signal});active();
    child=await io.spawn(request,run,capability,{signal});active();
    await io.register(request,run,child,capability,{signal});active();
    await io.activate(request,run,reservation,{signal});active();
    return {run_id:UUID.parse(run.run_id),...await io.result?.(request,run,reservation)};
   },{ms:20000,signal:controller.signal});
   if(completed.size>=256)completed.delete(completed.keys().next().value);completed.set(cacheKey,result);return result;
  }catch(e){
   controller.abort();if(child)await io.cancel?.(child).catch(()=>{});
   // Even a lost reserve/attach reply is reconciled by task, not replayed.
   if(reserving){await io.fail(request,run).catch(()=>{});await io.release(request,reservation).catch(()=>{});}throw e;
  }finally{unlock();if(locks.get(id)===lock)locks.delete(id);}
 }};
}
/** Exact confirmed-record projections: readers return confirmed facts ONLY.
 * Do not pass ordinary get_project/get_lead JSON through this adapter. */
export function createProfileBridge({task,authorize,records={},question}){
 if(!task||typeof authorize!=='function')fail();
 return async(kind,name,raw)=>{
  const schema=PROFILE_TOOLS[kind]?.[name];if(!schema||await authorize(task)!==true)fail();
  const input=schema.input.parse(raw);let value;
  if(kind==='sjcos'&&name==='get_operating_context')value={browser_rules_version:1,required_areas:task.required_areas};
  else if(kind==='sjcos'&&name==='get_project'){
   if(input.project_id!==task.project_id||typeof records.project!=='function')fail();
   const f=await records.project(task.project_id,task);value={id:task.project_id,confirmed_facts:{address:f.address??null,scope:f.scope??null,permit_checklist:f.permit_checklist??[],license_facts:f.license_facts??[]}};
  }else if(kind==='sjcos'&&name==='get_lead'){
   if(input.slug!==task.lead_slug||typeof records.lead!=='function')fail();const f=await records.lead(task.lead_slug,task);value={slug:task.lead_slug,confirmed_facts:{address:f.address??null,scope:f.scope??null}};
  }else if(kind==='sjcos'&&name==='get_work_item'){
   if(input.id!==task.work_item_id||typeof records.workItem!=='function')fail();const f=await records.workItem(task.work_item_id,task);value={id:task.work_item_id,status:f.status,due_at:f.due_at,type:f.type};
  }else if(kind==='interact'&&name==='ask_owner'){
   if(typeof question!=='function'||!UUID.safeParse(task.initiator_user_id).success||!UUID.safeParse(task.id).success)fail();
   value=await question({task_id:task.id,user_id:task.initiator_user_id,conversation_id:task.conversation_id,question:input.question});
  }else fail();
  const result=schema.output.parse(value);if(await authorize(task)!==true)fail();return result;
 };
}
/** Read consume cannot bypass a committed transaction or independent audit ACK.
 * contextFor is freshly resolved server state, never a route's public label. */
export function createProductionReadBridge({contextFor,transaction,audit,manifestKey,requestKey,dispatchPrivateKey,dispatchPublicKey,journal,gate={},now,monotonicNow}){
 if(typeof transaction!=='function'||typeof contextFor!=='function'||typeof audit?.anchorReadIntent!=='function'||typeof journal?.claim!=='function')fail();
 const repository={transaction};
 const authority=createPhase1ReadAuthority({contextFor,repository,audit,manifestKey,requestKey,dispatchPrivateKey,dispatchPublicKey,journal,now,monotonicNow});
 return {...authority,authority,...(gate.networkConfig?{handle:createGateAuthority({...gate,phase:1,authority})}:{})};
}

/** Bind factory IO to durable authority without giving Chromium any SQL client.
 * db uses committed website/service bridges and resolves fresh human authority.
 * rotation uses the committed viewer stream, NOT an extra SQL increment. */
export function createServiceIO({factory,db,common}){
 const io={...common,...db};
 for(const k of ['browser','deliverInput','fence','release','cancelAndDrainCommands','cancelObservations','stopAndAckScreencast','drainPublicOutputs','stopInputAndCapture']){
  if(typeof factory?.[k]!=='function')fail();io[k]=factory[k].bind(factory);
 }
 io.privacyIO=async r=>({
  readTask:()=>db.readTask(r),persistPrivate:args=>db.persistPrivate(r,args),
  cancelAndDrainCommands:()=>factory.cancelAndDrainCommands(r),cancelObservations:()=>factory.cancelObservations(r),
  stopAndAckScreencast:()=>factory.stopAndAckScreencast(r),drainPublicOutputs:()=>factory.drainPublicOutputs(r),
  rotatePrivateHandles:async saved=>{
   const stream=await db.committedPrivateStream(r,saved);
   if(!Number.isSafeInteger(stream?.stream_generation)||stream.stream_generation<1)fail();
   return factory.rotatePrivateHandles(r,{...saved,stream_generation:stream.stream_generation});
  },
  ackPrivate:binding=>factory.ackPrivate(r,{...binding,privacy_mode:'private'}),
 });return io;
}

/** Fixed metadata/control handlers. consumeProof (RPC) and authorizeWeb (here)
 * are independent mandatory checks. No metadata method invokes raw CDP. */
export function createControllerHandlers({service,authorizeWeb,readMetadata,key,streamOpen,streamClose,readTask,afterControl}){
 if(!service||typeof authorizeWeb!=='function'||typeof readMetadata!=='function'||!(key instanceof Uint8Array)||key.length!==32)fail();
 const checked=async x=>{if(await authorizeWeb(x)!==true)fail();};
 const handlers={};
 for(const method of ['read_manifest','read_review','read_answers','read_in_use'])handlers[method]=async x=>{
  await checked(x);const data=await readMetadata(x);await checked(x);
  const {cursor,limit}=x.payload.body;return service.page({request:{cursor,limit},items:data.items,revision:data.revision,key,scope:{task_id:x.task_id,viewer_id:x.viewer_id,method,action_id:x.payload.body.action_id??null}});
 };
 handlers.presence=async x=>{await checked(x);const task=await readTask(x);service.attendance(x.task_id,task.present_until);return {ok:true};};
 handlers.control=async x=>{
  await checked(x);const op=x.payload.body.action,r=service.contexts.get(x.task_id);if(!r)throw Error('BROWSER_REVOKED');
  if(['back','forward','reload','switch_tab'].includes(op))return service.navigate(x.task_id,x.payload.body,x,async()=>{await checked(x);return true;});
  if(op==='take_over')return {proof_metadata:await service.takeOver(x.task_id,x)};
  if(op==='done'||op==='pause'){
   if(await service.io.stopInputAndCapture(r)!==true)fail();
   // B commits the web control after this ACK. Do not perform a second SQL
   // transition here: it would invalidate B's current viewer/epoch proof.
   r.commandsFenced=true;r.task.state='paused';
   return {proof_metadata:{drained:true,fenced:true,context_generation:r.task.context_generation}};
  }
  if(op==='stop'){await service.close(x.task_id,'closed','BROWSER_REVOKED',true);return {proof_metadata:{drained:true,context_generation:r.task.context_generation}};}
  if(op==='fresh_browser'){
   // Web commits the actual fresh operation only after this destruction ACK.
   r.outputFence.fence();r.commandsFenced=true;for(const c of r.observations)c.abort();r.registry.clear();r.fenced=true;
   await service.io.fence(r);await r.context.close();await service.io.release(r);service.contexts.delete(x.task_id);
   const {randomUUID}=await import('node:crypto');return {proof_metadata:{drained:true,fenced:true,context_generation:r.task.context_generation,old_generation:r.task.context_generation,new_boot_id:randomUUID()}};
  }
  if(op==='resume'){
   if(r.task.private)throw Error('BROWSER_PHASE1_READ_ONLY');
   if(typeof afterControl!=='function')fail();return afterControl(x); // new immutable turn; no old capability revival
  }
  throw Error('BROWSER_PHASE1_READ_ONLY');
 };
 handlers.manual_input=async x=>{await checked(x);await service.manualInput(x.task_id,x);return {accepted_seq:x.payload.body.seq};};
 handlers.stream_open=async x=>{await checked(x);if(typeof streamOpen!=='function')fail();return streamOpen(x);};
 handlers.stream_close=async x=>{await checked(x);if(typeof streamClose!=='function')fail();return streamClose(x);};
 for(const method of ['admit','join','leave','sites','read_state','read_availability','health'])handlers[method]=async x=>{await checked(x);return readMetadata(x);};
 return handlers;
}

/** Trusted exact public catalog. Proposal provenance, owner identity, company
 * facts and same-origin membership never classify an arbitrary URL as public. */
export function confirmedFactsFromCatalog({values,publicUrls}){
 if(!Array.isArray(values)||values.some(x=>typeof x!=='string')||!Array.isArray(publicUrls)||publicUrls.some(x=>typeof x!=='string'))fail();
 const urls=new Set(publicUrls),facts=Object.freeze([...values]);
 return Object.freeze({values:facts,classifyPublicUrl:url=>urls.has(url)});
}

/** Concrete website-only attached-run writer. The launch broker is protected
 * installation IO; spawnHeld MUST not release runner fd3 until activate. The
 * website transaction cannot be reached via ordinary Ask admission. */
export function createWebsiteStart({transaction,proofKey,supervisor,runner,authorizeRecord,reconcile}){
 if(typeof transaction!=='function'||!(proofKey instanceof Uint8Array)||proofKey.length!==32||typeof authorizeRecord!=='function'||typeof reconcile!=='function')fail();
 for(const k of ['spawnHeld','register','bindCapability','release','cancel'])if(typeof runner?.[k]!=='function')fail();
 const requestContext=new Map();
 const transactionTask=async(request,fn)=>transaction(async c=>{
  const {rows}=await c.query('SELECT * FROM browser_tasks WHERE id=$1 FOR UPDATE',[request.task_id]);const task=rows[0];if(!task)fail();
  const viewer=(await c.query('SELECT (browser_p1_viewer(t,$2)).* FROM browser_tasks t WHERE t.id=$1',[request.task_id,request.viewer_id])).rows[0];
  if(!viewer||viewer.joined_role!=='initiator'||viewer.web_session_id!==requestContext.get(request.task_id)?.session.sid||viewer.user_id!==task.initiator_user_id||await authorizeRecord(c,task,viewer)!==true)fail();
  return fn(c,task,viewer);
 });
 const proof=async(c,task,viewer,op,request,metadata={})=>{
  const {randomUUID,createHmac}=await import('node:crypto'),{canonical}=await import('./acceptance-attestation.mjs');
  const i=randomUUID(),d=createHmac('sha256',proofKey).update('browser-phase1-launch\0').update(canonical({task_id:task.id,viewer_id:viewer.id,op,request_id:request.idempotency_key,metadata})).digest();
  await c.query("INSERT INTO browser_web_commands(task_id,session_id,viewer_id,operation,idempotency_key,body_digest,safe_result,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '5 seconds')",[task.id,viewer.web_session_id,viewer.id,op,i,d,JSON.stringify(metadata)]);return i;
 };
 const admission=createAttendedAdmission({
  reconcile,
  check:request=>transactionTask(request,async(_c,t)=>{
   if(!['starting','active'].includes(t.state)||t.private)fail();
   return {present:true,profile:'browser',agent:'claude',launch_source:'panel_web'};
  }),
  reserve:request=>supervisor('reserve',request),
  attach:(request,reservation)=>transactionTask(request,async(c,t,v)=>{
   // A lost activation reply is reconciled from the immutable attached run.
   if(t.current_run_id)throw Error('BROWSER_REVIEW_PENDING');
   const {browserWebAttachRun}=await import('./repository.mjs');
   const r=(await c.query("INSERT INTO dev_agent_runs(agent,prompt,status,conversation_id,profile,principal_user_id,launch_source,browser_task_id,with_mcp,mode,effort) VALUES('claude',$1,'pending',$2,'browser',$3,'panel_web',$4,true,'default','high') RETURNING id",[t.purpose,t.conversation_id,t.initiator_user_id,t.id])).rows[0];
   const i=await proof(c,t,v,'attach_run',request,{reservation_id:reservation.reservation_id});
   const task=await browserWebAttachRun(c,{tid:t.id,rid:r.id,vid:v.id,expected_epoch:Number(t.control_epoch),i});return {run_id:r.id,task};
  }),
  issue:async()=>({}), // SQL capability is issued only for the held actual PID below.
  spawn:(_request,run)=>runner.spawnHeld(run),
  register:(request,run,child)=>transactionTask(request,async(c,t,v)=>{
   const {browserWebCapability}=await import('./repository.mjs');
   const binding=await runner.register(run,child);
   const i=await proof(c,t,v,'capability',request,{process_binding:binding});
   const issued=await browserWebCapability(c,{tid:t.id,rid:run.run_id,vid:v.id,server_kind:'browser',process_binding:binding,i});
   // The protected broker stores the hash, never sends a key into CLI argv/env.
   await runner.bindCapability(run,child,issued);return issued;
  }),
  activate:async(request,run,reservation)=>{await supervisor('activate',request,reservation);await runner.release(run);},
  cancel:child=>runner.cancel(child),release:(request,reservation)=>supervisor('release',request,reservation),
  fail:request=>transaction(async c=>{
   const t=(await c.query('SELECT * FROM browser_tasks WHERE id=$1 FOR UPDATE',[request.task_id])).rows[0];if(!t||['closed','failed'].includes(t.state))return;
   await c.query("UPDATE browser_tasks SET current_run_id=NULL,state='failed',failure_code='BROWSER_SERVICE_UNAVAILABLE',closed_at=clock_timestamp(),control_epoch=control_epoch+1,revision=revision+1 WHERE id=$1",[t.id]);
   await c.query("UPDATE browser_task_runs SET capability_revoked_at=coalesce(capability_revoked_at,clock_timestamp()),disposition=CASE WHEN disposition='running' THEN 'crashed' ELSE disposition END,ended_at=coalesce(ended_at,clock_timestamp()) WHERE task_id=$1",[t.id]);
  }),
 });
 return async({task,viewer,session,idempotency_key})=>{
  // Actual B cookie/session objects are only association locators; all are reread.
  if(requestContext.has(task.id))throw Error('BROWSER_BUSY');requestContext.set(task.id,{session});
  try{return await admission.start({task_id:task.id,viewer_id:viewer.id,idempotency_key});}finally{requestContext.delete(task.id);}
 };
}

/** Configured owner identity and controller provenance, no page fields. Unknown
 * state reasons stay null; only a current guarded runtime can attest them. */
export function createWebsiteProjection({transaction,ownerId,runtimeProjection}){
 UUID.parse(ownerId);if(typeof transaction!=='function'||typeof runtimeProjection!=='function')fail();
 return async({task,viewer,session})=>transaction(async c=>{
  const t=(await c.query('SELECT * FROM browser_tasks WHERE id=$1',[task.id])).rows[0];if(!t)fail();
  const owner=(await c.query("SELECT name FROM users WHERE id=$1 AND role='owner' AND active",[ownerId])).rows[0];
  const watching=(await c.query("SELECT EXISTS(SELECT 1 FROM browser_viewers v JOIN browser_owner_views o ON o.task_id=v.task_id AND o.web_session_id=v.web_session_id WHERE v.task_id=$1 AND v.joined_role='owner_review' AND v.left_at IS NULL AND v.visible_until>clock_timestamp() AND o.revoked_at IS NULL AND o.expires_at>clock_timestamp()) AS present",[t.id])).rows[0]?.present===true;
  const runtime=await runtimeProjection({task_id:t.id,boot_id:t.controller_boot_id,context_generation:Number(t.context_generation)});
  const reasons=['queue_expired','offer_expired','idle_closed','turn_ended','owner_paused','absent','crashed','latched','unknown'];
  const held=t.controller_user_id&&new Date(t.control_expires_at).getTime()>Date.now();
  const controller=!held?'none':t.controller_user_id===session.userId?(viewer&&Buffer.from(t.controller_device_hash).equals(Buffer.from(viewer.device_hash))?'self':'other_device'):t.controller_user_id===ownerId?'owner':'other_person';
  return {state_reason:reasons.includes(runtime?.state_reason)?runtime.state_reason:null,reason_code:null,
   idle_closes_at:runtime?.idle_closes_at??null,controller,window_count:Number.isInteger(runtime?.window_count)&&runtime.window_count>=0&&runtime.window_count<=2?runtime.window_count:null,
   watching_owner:watching,owner_label:typeof owner?.name==='string'?owner.name.slice(0,120):null};
 });
}

/** Owner-side retention dependencies only. The narrow controller must never
 * call this: runBrowserRetention verifies the actual owner LOGIN each batch. */
export async function retentionDependencies(config){
 const d=typeof config?.retention==='function'?await config.retention():config?.retention;
 if(typeof d?.transaction!=='function'||!d.cache)fail();
 for(const k of ['tombstone','invalidate','purge','complete'])if(typeof d.cache[k]!=='function')fail();
 return {...d,limit:Math.min(100,Number.isSafeInteger(d.limit)&&d.limit>0?d.limit:100)};
}
/** Bounded nonoverlapping minute job for a separately provisioned owner process.
 * No scheduling in controller, no immediate unbounded catch-up, no hidden retry. */
export function scheduleRetention({run,onError,setTimer=setTimeout,clearTimer=clearTimeout}){
 if(typeof run!=='function'||typeof onError!=='function')fail();
 let closed=false,timer,running=Promise.resolve();
 const schedule=()=>{if(!closed)timer=setTimer(()=>{if(closed)return;running=Promise.resolve().then(run).catch(onError).finally(schedule);},60000);};
 schedule();return {close:async()=>{closed=true;clearTimer(timer);await running;}};
}

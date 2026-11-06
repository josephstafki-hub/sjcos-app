import {askHealthCause} from './ask-health.mjs';
import path from 'node:path';
import {readDeployment,enableDeployment,deploymentDirectory,requireSeparateDeployment} from './ask-deployment-state.mjs';
import { lstat, open } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
const journalScope=new AsyncLocalStorage();
import { randomUUID, createHash } from 'node:crypto';
import { withLedgerLock, configuredAuthority, synchronizeLedger, makeIntent, appendLocal, validateChain, readLocal, PAUSED } from './canvas-deletion-ledger.mjs';
export { PAUSED };
export function journalOptions(deadline=Infinity){return {dir:journalDirectory(),authority:configuredAuthority(process.env,deadline),deadline};}
export function journalDirectory(){return process.env.SJC_CANVAS_DELETION_LEDGER_DIR??path.join(process.cwd(),'drafts','ask-deletion-journal');}
async function diskEvidence(dir){
 // Even an incomplete intent is a fence. Do not truncate it to infer virgin state.
 for(const file of ['deletion-enabled','intents.jsonl']){
  try{const st=await lstat(path.join(dir,file));if(st.isSymbolicLink()||!st.isFile())return true;
   if(file==='deletion-enabled'||(file==='intents.jsonl'&&st.size>0))return true;
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }return false;
}
async function latch(pool,dir){
 const file=path.join(dir,'deletion-enabled');
 let f;try{f=await open(file,'wx',0o600);}catch(e){
  if(e.code!=='EEXIST')throw e;
  const st=await lstat(file);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077))throw Error('JOURNAL_BINDING');
 }
 if(f){try{await f.writeFile('1\n');await f.sync();}finally{await f.close();}
  const d=await open(dir,'r');try{await d.sync();}finally{await d.close();}
 }
 await pool.query('UPDATE ask_canvas_maintenance SET deletion_enabled=true WHERE singleton');
}
async function deletionState(pool){
 await capabilities(pool);
 const r=(await pool.query(`SELECT deletion_enabled,checkpoint_sequence,
 EXISTS(SELECT 1 FROM ai_conversations WHERE deleted_at IS NOT NULL OR deletion_sequence IS NOT NULL) AS evidence
 FROM ask_canvas_maintenance WHERE singleton`)).rows[0];
 if(!r)throw Error('ASK_THREAD_PRIVACY_REQUIRED');
 return r.deletion_enabled||Number(r.checkpoint_sequence)>0||r.evidence;
}
export async function deletionCapabilities(pool){
 // withAskJournal already verified the fresh authority for this invocation.
 const scope=journalScope.getStore();
 return {deleteAvailable:process.env.SJC_ASK_THREAD_DELETE_ACCEPTED==='1'&&scope?.pool===pool&&scope.active&&scope.verified===true};
}
export async function capabilities(db){
 const ids=(await db.query('SELECT id FROM schema_migrations WHERE id BETWEEN 100 AND 109 ORDER BY id')).rows.map(r=>r.id);
 if(!ids.includes(100)||!ids.includes(105))throw Error('ASK_THREAD_PRIVACY_REQUIRED');
 // Later intent kinds require their own extension. Never silently skip them.
 return {thread:true,canvas:ids.includes(106),files:ids.includes(108)};
}
async function transaction(pool,fn){const db=pool.connect?await pool.connect():pool;try{await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='500ms'");await db.query("SET LOCAL lock_timeout='500ms'");const r=await fn(db);await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}finally{if(db!==pool)db.release();}}
export async function closeGate(pool,code='RECOVERY_REQUIRED'){
 await pool.query(`UPDATE ask_canvas_maintenance SET recovery_ready=false,health_code=$1,blocked_since=COALESCE(blocked_since,now()) WHERE singleton`,[code]);
}
export async function acquireLease(pool){
 const owner=randomUUID();const r=(await pool.query(`UPDATE ask_canvas_maintenance SET lease_owner=$1,lease_expires_at=clock_timestamp()+interval '30 seconds',fencing_token=fencing_token+1,heartbeat_at=clock_timestamp(),recovery_ready=false,recovery_epoch=$1 WHERE singleton AND (lease_expires_at IS NULL OR lease_expires_at<clock_timestamp()) RETURNING fencing_token`,[owner])).rows[0];
 if(!r)throw Error('ASK_MAINTENANCE_BUSY');return {owner,token:r.fencing_token};
}
export async function checkLease(db,lease){
 const r=(await db.query(`SELECT 1 FROM ask_canvas_maintenance WHERE singleton AND lease_owner=$1 AND fencing_token=$2 AND lease_expires_at>clock_timestamp() FOR UPDATE`,[lease.owner,lease.token])).rows[0];
 if(!r)throw Error('ASK_STALE_LEASE');
}
async function replay(db,e,lease){
 await checkLease(db,lease);
 // Cancel before tombstone: in-flight late writes then fail the DB guard.
 const id=e.opaque_ids[0];
 if(e.entity_type==='canvas'){
  if(!(await capabilities(db)).canvas)throw Error('ASK_THREAD_PRIVACY_REQUIRED');
  await db.query(`SELECT set_config('sjcos.ask_purge','yes',true)`);
  const row=(await db.query(`UPDATE ask_canvases SET deleted_at=$2,purge_after=$3,deletion_sequence=$4 WHERE id=$1 AND (deletion_sequence IS NULL OR deletion_sequence>$4) RETURNING *`,[id,e.deleted_at,e.purge_after,e.sequence])).rows[0];
  if(row){
   await db.query(`INSERT INTO ask_canvas_requests(conversation_id,request_id,owner_user_id,actor_user_id,action,input_hash,effective_policy_hash,canvas_id,version) VALUES($1,$2,$3,$3,'delete',$4,$5,$6,$7)`,[row.conversation_id,e.operation_uuid,row.owner_user_id,createHash('sha256').update(JSON.stringify(['delete',row.id,e.operation_uuid])).digest('hex'),row.baseline_hash,row.id,row.latest_version]);
   await db.query(`INSERT INTO ask_canvas_events(conversation_id,owner_user_id,canvas_id,version,actor_user_id,kind) VALUES($1,$2,$3,$4,$2,'deleted')`,[row.conversation_id,row.owner_user_id,row.id,row.latest_version]);}
  return;
 }
 await db.query(`SELECT set_config('sjcos.ask_purge','yes',true)`);
 await db.query(`UPDATE dev_agent_runs SET cancellation_requested=true,status='error',updated_at=clock_timestamp() WHERE conversation_id=$1 AND status IN ('pending','running')`,[id]);
 await db.query('SELECT erase_ask_reply_copies($1)',[id]);
 await db.query(`UPDATE owner_replies SET body='[deleted]',answer=NULL,state='failed',error=NULL WHERE conversation_id=$1`,[id]);
 await db.query(`UPDATE owner_grants SET reason='Private Ask permission',scope='{}',audit='[]',status='revoked' WHERE conversation_id=$1 OR run_id IN (SELECT id FROM dev_agent_runs WHERE conversation_id=$1)`,[id]);
 await db.query(`UPDATE ai_conversations SET deleted_at=$2,purge_after=$3,deletion_sequence=$4 WHERE id=$1 AND (deletion_sequence IS NULL OR deletion_sequence>$4)`,[id,e.deleted_at,e.purge_after,e.sequence]);
}
// Every entrypoint re-queries live authority. No cached receipt can open access.
// The OS lock excludes delete acknowledgements throughout the recovery epoch.
export async function recoverThreads(pool,options=journalOptions()){
 const {dir,authority}=options;
 const deploymentDir=options.deploymentDir??deploymentDirectory();
 const deployment=await readDeployment(deploymentDir);
 await requireSeparateDeployment(dir,deploymentDir);
 if(deployment.ledger&&deployment.ledger!==authority.id)throw Error('JOURNAL_AUTHORITY_IDENTITY');
 await capabilities(pool);
 await closeGate(pool);
 const lease=await acquireLease(pool);
 try{
  const checkpoint=(await pool.query(`SELECT ledger_id,checkpoint_sequence,checkpoint_hash FROM ask_canvas_maintenance WHERE singleton`)).rows[0];
  if(checkpoint.ledger_id&&checkpoint.ledger_id!==authority.id)throw Error('JOURNAL_AUTHORITY_IDENTITY');
  const {entries,live}=await synchronizeLedger(dir,authority);
  if(deployment.ledger||entries.length||await deletionState(pool)||process.env.SJC_ASK_THREAD_DELETE_ACCEPTED==='1'){
   await enableDeployment(deploymentDir,authority.id);await latch(pool,dir);
  }
  if(Number(checkpoint.checkpoint_sequence)>live.sequence)throw Error('JOURNAL_STALE_AUTHORITY');
  // Startup replay is bounded: a backlog takes successive ticks, keeping Ask
  // closed until caught up. A restored DB checkpoint is never freshness proof.
  const cp=Number(checkpoint.checkpoint_sequence);
  if(cp>0&&entries[cp-1]?.checksum!==checkpoint.checkpoint_hash)throw Error('JOURNAL_CHECKPOINT_MISMATCH');
  let processed=0;const start=Date.now();
  for(const e of entries.slice(cp,cp+50)){
   if(Date.now()-start>1500||Date.now()>(options.deadline??Infinity)-100)throw Error('ASK_REPLAY_PENDING');
   await transaction(pool,async db=>{
    await replay(db,e,lease);
    await db.query(`UPDATE ask_canvas_maintenance SET ledger_id=$1,checkpoint_sequence=$2,checkpoint_hash=$3 WHERE singleton`,[authority.id,e.sequence,e.checksum]);
   });processed++;
  }
  if(cp+processed<entries.length)throw Error('ASK_REPLAY_PENDING');
  const end=await authority.read();
  const head=validateChain(end.entries);
  if(end.ledger_id!==authority.id||end.sequence!==live.sequence||end.head_hash!==live.head_hash||head.sequence!==end.sequence||head.head_hash!==end.head_hash)throw Error('JOURNAL_EPOCH_CHANGED');
  await transaction(pool,async db=>{await checkLease(db,lease);await db.query(`UPDATE ask_canvas_maintenance SET recovery_ready=true,ledger_id=$1,checkpoint_sequence=$2,checkpoint_hash=$3,health_code=NULL,blocked_since=NULL,heartbeat_at=clock_timestamp() WHERE singleton`,[authority.id,live.sequence,live.head_hash]);});
  return {lease,sequence:live.sequence,head_hash:live.head_hash};
 }catch(e){await closeGate(pool,askHealthCause(e));throw e;}finally{
  await pool.query(`UPDATE ask_canvas_maintenance SET lease_expires_at=NULL WHERE singleton AND lease_owner=$1 AND fencing_token=$2`,[lease.owner,lease.token]);
 }
}
export async function withAskJournal(pool,fn,options,deadline=Infinity){
 const current=journalScope.getStore();if(current?.active&&current.pool===pool)return fn();
 let admitted=false;
 try{
  const dir=options?.dir??journalDirectory();
  return await withLedgerLock(dir,async()=>{
   const deployment=await readDeployment(options?.deploymentDir??deploymentDirectory());
   await requireSeparateDeployment(dir,deployment.dir);
   const state=await deletionState(pool),evidence=await diskEvidence(dir);
   const enabling=process.env.SJC_ASK_THREAD_DELETE_ACCEPTED==='1';
   let opts,verified=false;
   try{opts=options??journalOptions(deadline);}catch(e){
    if(deployment.ledger||state||evidence||enabling||Object.keys(process.env).some(k=>/^SJC_CANVAS_(?:AUTHORITY_|LEDGER_ID|JOURNAL_KEY)/.test(k)&&process.env[k])){await closeGate(pool,'JOURNAL_NOT_CONFIGURED');throw e;}
    await pool.query(`UPDATE ask_canvas_maintenance SET recovery_ready=true,health_code='JOURNAL_NOT_CONFIGURED',blocked_since=NULL,heartbeat_at=clock_timestamp() WHERE singleton AND NOT deletion_enabled`);
   }
   if(opts){await recoverThreads(pool,opts);verified=true;}
   const scope={pool,active:true,verified};admitted=true;
   try{return await journalScope.run(scope,fn);}finally{scope.active=false;}
  },Math.max(1,Math.min(9000,deadline-Date.now())));
 }catch(e){if(admitted)throw e;
  await closeGate(pool,askHealthCause(e)).catch(()=>{});
  throw Error(PAUSED,{cause:e});
 }
}
export async function deleteThread(pool,threadId,operation,options,principalId){return deleteEntity(pool,threadId,operation,options,principalId,'thread');}
export async function deleteCanvas(pool,id,operation,options,principalId,authorize){return deleteEntity(pool,id,operation,options,principalId,'canvas',authorize);}
async function deleteEntity(pool,threadId,operation,options,principalId,entityType,authorize){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operation??''))throw Error('ASK_THREAD_UNAVAILABLE');
 const dir=options?.dir??journalDirectory();
 // Disabled Delete needs neither a journal nor private entity reads.
 if(process.env.SJC_ASK_THREAD_DELETE_ACCEPTED!=='1'&&!(await diskEvidence(dir))&&!(await deletionState(pool)))throw Error('DELETE_NOT_READY');
 return withLedgerLock(dir,async()=>{
  // Dedicated title-free status command. Never expose tombstones via ordinary
  // actor-scoped readers. Principal comes only from the authenticated adapter.
  const owned=principalId?(await pool.query(entityType==='thread'?'SELECT id,deleted_at,deletion_sequence FROM ai_conversations WHERE id=$1 AND owner_user_id=$2':'SELECT id,deleted_at,deletion_sequence FROM ask_canvases WHERE id=$1 AND owner_user_id=$2',[threadId,principalId])).rows[0]:null;
  if(principalId&&!owned)throw Error('ASK_THREAD_UNAVAILABLE');
  let entries=await readLocal(dir);
  const previous=entries.find(e=>e.operation_uuid===operation);
  if(previous&&(previous.opaque_ids[0]!==threadId||previous.entity_type!==entityType))throw Error('ASK_THREAD_UNAVAILABLE');
  if(previous&&owned?.deleted_at&&Number(owned.deletion_sequence)===previous.sequence)return {ok:true,state:'deleted'};
  if(!previous&&!owned?.deleted_at&&process.env.SJC_ASK_THREAD_DELETE_ACCEPTED!=='1')throw Error('DELETE_NOT_READY');
  let opts;try{opts=options??journalOptions();await recoverThreads(pool,opts);}catch(e){
   await closeGate(pool,'JOURNAL_UNAVAILABLE').catch(()=>{});
   if(previous)return {ok:true,state:'pending'};throw Error(PAUSED,{cause:e});
  }
  if(!previous&&authorize){const scope={pool,active:true,verified:true};try{await journalScope.run(scope,authorize);}finally{scope.active=false;}}
  await closeGate(pool,'DELETING');
  try{
   let live;({entries,live}=await synchronizeLedger(dir,opts.authority));
   const existing=entries.find(e=>e.opaque_ids[0]===threadId&&e.entity_type===entityType);
   // Different operation on an already fenced entity is not a new deletion.
   if(existing&&existing.operation_uuid!==operation)throw Error('ASK_THREAD_UNAVAILABLE');
   const e=makeIntent(entries,threadId,operation,new Date(),entityType);
   await enableDeployment(opts.deploymentDir??deploymentDirectory(),opts.authority.id);
   await latch(pool,dir);
   if(!entries.some(x=>x.operation_uuid===operation)){await appendLocal(dir,e);entries=[...entries,e];}
   if(live.sequence<entries.length)await opts.authority.advance(live,entries);
   await recoverThreads(pool,opts);
   return {ok:true,state:'deleted'};
  }catch(e){await closeGate(pool,'JOURNAL_DURABILITY_FAILED');
   if(e.message==='ASK_THREAD_UNAVAILABLE')throw e;
   // Once an intent is local, report only pending; never claim durability.
   if((await readLocal(dir)).some(e=>e.operation_uuid===operation&&e.opaque_ids[0]===threadId))return {ok:true,state:'pending'};
   throw Error(PAUSED,{cause:e});
  }
 });
}
export async function maintainThreads(pool,options,filePhase){
 try { return await maintainThreadsChecked(pool,options,filePhase); } catch(e) {
  await closeGate(pool,askHealthCause(e)).catch(()=>{}); throw e;
 }
}
async function maintainThreadsChecked(pool,options,filePhase){
 const invocationStarted=Date.now(),deadline=invocationStarted+1800;
 let opts=options;
 if(!opts){
  try{opts=journalOptions(deadline);}catch{
   // Only the verified virgin state may report a warning. Keep this probe
   // inside the same original maintenance time budget, without a second replay.
   await withAskJournal(pool,async()=>{},undefined,deadline);
   return {ok:true,purged:0,warning:'JOURNAL_NOT_CONFIGURED'};
  }
 }
 return withLedgerLock(opts.dir,async()=>{
  await recoverThreads(pool,opts);
  const lease=await acquireLease(pool);let purged=0;const start=invocationStarted;
  try{
   if((await capabilities(pool)).canvas){
    const reconciled=await transaction(pool,async db=>{await checkLease(db,lease);return (await db.query('SELECT reconcile_ask_canvas_usage($1,$2) AS ready',[lease.owner,lease.token])).rows[0].ready;});
    if(!reconciled){await transaction(pool,async db=>{await checkLease(db,lease);await db.query('UPDATE ask_canvas_maintenance SET recovery_ready=true,heartbeat_at=clock_timestamp() WHERE singleton');});return {ok:true,purged:0,reconciling:true};}
   }
   if(filePhase&&(await capabilities(pool)).files)await filePhase(pool,lease,checkLease,deadline);
   while(purged<50&&Date.now()-start<1500){
    const changed=await transaction(pool,async db=>{
     await checkLease(db,lease);
     const row=(await db.query(`SELECT id,purge_after FROM ai_conversations WHERE deleted_at IS NOT NULL AND purged_at IS NULL AND purge_after<=clock_timestamp() AND NOT purge_hold ORDER BY purge_after,id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
     if(!row){
      if(purged>0||!(await capabilities(db)).canvas)return false;
      await db.query('SELECT pg_advisory_xact_lock(106,1)');
      const canvas=(await db.query(`SELECT c.id FROM ask_canvases c JOIN ai_conversations t ON t.id=c.conversation_id WHERE c.deleted_at IS NOT NULL AND c.purged_at IS NULL AND c.purge_after<=clock_timestamp() AND (c.hold_until IS NULL OR c.hold_until<=clock_timestamp()) AND NOT t.purge_hold ORDER BY c.purge_after,c.id LIMIT 1 FOR UPDATE OF c SKIP LOCKED`)).rows[0];
      if(!canvas){await db.query(`DELETE FROM ask_canvas_rate_windows WHERE (actor_user_id,action_bucket,window_start) IN (SELECT actor_user_id,action_bucket,window_start FROM ask_canvas_rate_windows WHERE window_start<now()-interval '24 hours' ORDER BY window_start LIMIT 40)`);return false;}
      await db.query(`SELECT set_config('sjcos.ask_purge','yes',true)`);
      await db.query(`UPDATE ask_canvas_versions SET title=NULL,summary=NULL,change_note=NULL,source_text=NULL,canonical_content=NULL,purged_at=clock_timestamp() WHERE (canvas_id,version) IN (SELECT canvas_id,version FROM ask_canvas_versions WHERE canvas_id=$1 AND purged_at IS NULL ORDER BY version LIMIT 40)`,[canvas.id]);
      await db.query(`UPDATE ask_canvases SET purged_at=clock_timestamp() WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM ask_canvas_versions WHERE canvas_id=$1 AND purged_at IS NULL)`,[canvas.id]);
      await db.query(`UPDATE ask_canvas_maintenance SET canvas_cursor=$1,canvas_checkpoint=canvas_checkpoint+1 WHERE singleton`,[canvas.id]);
      await checkLease(db,lease);return 'canvas';
     }
     await db.query(`SELECT set_config('sjcos.ask_purge','yes',true)`);
     await db.query(`UPDATE run_steers SET body='[deleted]' WHERE run_id IN (SELECT id FROM dev_agent_runs WHERE conversation_id=$1)`,[row.id]);
     await db.query(`DELETE FROM ai_messages WHERE conversation_id=$1`,[row.id]);
     // Keep IDs/provenance shells; no saved files or filesystem paths touched.
     await db.query(`UPDATE dev_agent_runs SET prompt='[deleted]',page_context=NULL,answer=NULL,activity=NULL,session_id=NULL,spoken_answer=NULL WHERE conversation_id=$1`,[row.id]);
     await db.query(`UPDATE agent_interactions SET payload='{}',response=NULL WHERE conversation_id=$1`,[row.id]);
     await db.query(`UPDATE ai_conversations SET title='[deleted]',claude_session_id=NULL,purged_at=clock_timestamp() WHERE id=$1`,[row.id]);
     await checkLease(db,lease);
     await db.query(`UPDATE ask_canvas_maintenance SET cursor_due_at=$1,cursor_id=$2,heartbeat_at=clock_timestamp() WHERE singleton`,[row.purge_after,row.id]);return true;
    });if(!changed)break;purged++;if(changed==='canvas')break;
   }
   await transaction(pool,async db=>{await checkLease(db,lease);await db.query(`UPDATE ask_canvas_maintenance SET recovery_ready=true,heartbeat_at=clock_timestamp() WHERE singleton`);});
   return {ok:true,purged};
  }catch(e){await closeGate(pool,'MAINTENANCE_FAILED');throw e;}finally{await pool.query(`UPDATE ask_canvas_maintenance SET lease_expires_at=NULL WHERE singleton AND lease_owner=$1 AND fencing_token=$2`,[lease.owner,lease.token]);}
 },Math.max(1,deadline-Date.now()));
}

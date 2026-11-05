import { AsyncLocalStorage } from 'node:async_hooks';
const journalScope=new AsyncLocalStorage();
import { randomUUID } from 'node:crypto';
import { withLedgerLock, configuredAuthority, synchronizeLedger, makeIntent, appendLocal, validateChain, PAUSED } from './canvas-deletion-ledger.mjs';
export { PAUSED };
export function journalOptions(deadline=Infinity){return {dir:process.env.SJC_CANVAS_DELETION_LEDGER_DIR,authority:configuredAuthority(process.env,deadline),deadline};}
export async function capabilities(db){
 const ids=(await db.query('SELECT id FROM schema_migrations WHERE id BETWEEN 100 AND 109 ORDER BY id')).rows.map(r=>r.id);
 if(!ids.includes(100)||!ids.includes(105))throw Error('ASK_THREAD_PRIVACY_REQUIRED');
 // Later intent kinds require their own extension. Never silently skip them.
 return {thread:true,canvas:ids.includes(106),files:ids.includes(107)};
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
 await db.query(`SELECT set_config('sjcos.ask_purge','yes',true)`);
 await db.query(`UPDATE dev_agent_runs SET cancellation_requested=true,status='error',updated_at=clock_timestamp() WHERE conversation_id=$1 AND status IN ('pending','running')`,[id]);
 await db.query(`UPDATE ai_conversations SET deleted_at=$2,purge_after=$3,deletion_sequence=$4 WHERE id=$1 AND (deletion_sequence IS NULL OR deletion_sequence>$4)`,[id,e.deleted_at,e.purge_after,e.sequence]);
}
// Every entrypoint re-queries live authority. No cached receipt can open access.
// The OS lock excludes delete acknowledgements throughout the recovery epoch.
export async function recoverThreads(pool,options=journalOptions()){
 const {dir,authority}=options;
 await capabilities(pool);
 await closeGate(pool);
 const lease=await acquireLease(pool);
 try{
  const checkpoint=(await pool.query(`SELECT ledger_id,checkpoint_sequence,checkpoint_hash FROM ask_canvas_maintenance WHERE singleton`)).rows[0];
  if(checkpoint.ledger_id&&checkpoint.ledger_id!==authority.id)throw Error('JOURNAL_AUTHORITY_IDENTITY');
  const {entries,live}=await synchronizeLedger(dir,authority);
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
 }catch(e){await closeGate(pool,e.message);throw e;}finally{
  await pool.query(`UPDATE ask_canvas_maintenance SET lease_expires_at=NULL WHERE singleton AND lease_owner=$1 AND fencing_token=$2`,[lease.owner,lease.token]);
 }
}
export async function withAskJournal(pool,fn,options){
 const current=journalScope.getStore();if(current?.active&&current.pool===pool)return fn();
 let opts;try{opts=options??journalOptions();}catch(e){await closeGate(pool,'JOURNAL_NOT_CONFIGURED');throw Error(PAUSED,{cause:e});}
 let admitted=false;
 try{return await withLedgerLock(opts.dir,async()=>{await recoverThreads(pool,opts);admitted=true;const scope={pool,active:true};try{return await journalScope.run(scope,fn);}finally{scope.active=false;}});}
 catch(e){if(!admitted){await closeGate(pool,'JOURNAL_UNAVAILABLE');throw Error(PAUSED,{cause:e});}throw e;}
}
export async function deleteThread(pool,threadId,operation,options,principalId){
 // Deployment acceptance is independent of every Canvas flag. Until the full
 // recovery matrix is accepted there is no physical-delete fallback.
 if(process.env.SJC_ASK_THREAD_DELETE_ACCEPTED!=='1')throw Error('Chat deletion is not ready yet. Try again later.');
 const opts=options??journalOptions();
 return withLedgerLock(opts.dir,async()=>{
  await recoverThreads(pool,opts);
  if(principalId && !(await pool.query('SELECT 1 FROM ai_conversations WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL',[threadId,principalId])).rows.length)throw Error('ASK_THREAD_UNAVAILABLE');
  await closeGate(pool,'DELETING');
  try{
   let {entries,live}=await synchronizeLedger(opts.dir,opts.authority);
   const e=makeIntent(entries,threadId,operation);
   if(!entries.some(x=>x.operation_uuid===e.operation_uuid)){await appendLocal(opts.dir,e);entries=[...entries,e];}
   // A local intent is already a durable denial fence. Failures stay closed.
   if(live.sequence<entries.length)await opts.authority.advance(live,entries);
   await recoverThreads(pool,opts);
   return {ok:true,operation_uuid:e.operation_uuid};
  }catch(e){await closeGate(pool,'JOURNAL_DURABILITY_FAILED');throw Error("Deleting didn't finish. The chat stays hidden until it does. Try again.",{cause:e});}
 });
}
export async function maintainThreads(pool,options){
 const invocationStarted=Date.now(),deadline=invocationStarted+1800;const opts=options??journalOptions(deadline);return withLedgerLock(opts.dir,async()=>{
  await recoverThreads(pool,opts);
  const lease=await acquireLease(pool);let purged=0;const start=invocationStarted;
  try{
   while(purged<50&&Date.now()-start<1500){
    const changed=await transaction(pool,async db=>{
     await checkLease(db,lease);
     const row=(await db.query(`SELECT id,purge_after FROM ai_conversations WHERE deleted_at IS NOT NULL AND purged_at IS NULL AND purge_after<=clock_timestamp() AND NOT purge_hold ORDER BY purge_after,id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
     if(!row)return false;
     await db.query(`SELECT set_config('sjcos.ask_purge','yes',true)`);
     await db.query(`UPDATE run_steers SET body='[deleted]' WHERE run_id IN (SELECT id FROM dev_agent_runs WHERE conversation_id=$1)`,[row.id]);
     await db.query(`DELETE FROM ai_messages WHERE conversation_id=$1`,[row.id]);
     // Keep IDs/provenance shells; no saved files or filesystem paths touched.
     await db.query(`UPDATE dev_agent_runs SET prompt='[deleted]',page_context=NULL,answer=NULL,activity=NULL,session_id=NULL,spoken_answer=NULL WHERE conversation_id=$1`,[row.id]);
     await db.query(`UPDATE agent_interactions SET payload='{}',response=NULL WHERE conversation_id=$1`,[row.id]);
     await db.query(`UPDATE ai_conversations SET title='[deleted]',claude_session_id=NULL,purged_at=clock_timestamp() WHERE id=$1`,[row.id]);
     await checkLease(db,lease);
     await db.query(`UPDATE ask_canvas_maintenance SET cursor_due_at=$1,cursor_id=$2,heartbeat_at=clock_timestamp() WHERE singleton`,[row.purge_after,row.id]);return true;
    });if(!changed)break;purged++;
   }
   await transaction(pool,async db=>{await checkLease(db,lease);await db.query(`UPDATE ask_canvas_maintenance SET recovery_ready=true,heartbeat_at=clock_timestamp() WHERE singleton`);});
   return {ok:true,purged};
  }catch(e){await closeGate(pool,'MAINTENANCE_FAILED');throw e;}finally{await pool.query(`UPDATE ask_canvas_maintenance SET lease_expires_at=NULL WHERE singleton AND lease_owner=$1 AND fencing_token=$2`,[lease.owner,lease.token]);}
 },1800);
}

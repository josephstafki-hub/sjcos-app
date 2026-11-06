import "server-only";
import { normalizeAskFailure } from "@/lib/ask-result-codes";
import path from 'node:path';
import type { QueryResult, QueryResultRow, PoolClient } from 'pg';
import { pool } from '@/lib/db';
import { readSession } from '@/lib/session';
import { withAskJournal, deleteThread, deletionCapabilities } from '@/lib/ask-thread-journal.mjs';

/** Verified server session only; caller supplied IDs/roles never establish it. */
export async function threadPrincipal() {
 const session=await readSession();
 const authAt=session?.authAt??session?.iat;
 if(!session?.userId||typeof authAt!=='number')throw Error('ASK_SIGN_IN_REQUIRED');
 const person=(await pool.query(`SELECT id,role,active,permissions,
 EXISTS(SELECT 1 FROM session_revocations r WHERE r.user_id=u.id AND r.revoked_before>to_timestamp($2)) AS revoked
 FROM users u WHERE id=$1`,[session.userId,authAt])).rows[0];
 if(!person||!person.active||person.revoked)throw Error('ASK_SESSION_REVOKED');
 if(person.role!=='owner'&&!(person.role==='staff'&&person.permissions?.includes('ai')))throw Error('ASK_ACCESS_DENIED');
 return person as {id:string;role:'owner'|'staff'};
}
/** The OS journal lock covers the entire transaction, including its commit.
 * RLS uses only this verified website actor; narrow session_user cannot spoof it.
 * No DB transaction/row lock spans the remote authority round trip.
 * The actor GUC alone is not authorization when the DB login bypasses RLS:
 * callers must also use explicit self predicates or exact access guards.
 * tests/ask-private-query-scan.test.mjs pins that reviewed caller inventory. */
export async function threadQuery<T extends QueryResultRow=QueryResultRow>(sql:string,params?:unknown[]):Promise<QueryResult<T>> {
 const person=await threadPrincipal();
 return withAskJournal(pool,async()=>{
  const c=await pool.connect();try{
   await c.query('BEGIN');
   await c.query(`SELECT set_config('sjcos.ask_actor',$1,true)`,[person.id]);
   const result=await c.query<T>(sql,params);
   await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 });
}
export async function threadQueryOne<T extends QueryResultRow=QueryResultRow>(sql:string,params?:unknown[]):Promise<T|null>{return (await threadQuery<T>(sql,params)).rows[0]??null;}
export async function requireThreadAccess(id:string,principal?:{id:string},db?:PoolClient){
 const person=await threadPrincipal();if(principal&&principal.id!==person.id)throw Error('ASK_ACCESS_DENIED');
 const sql=`SELECT id,owner_user_id,claude_session_id FROM ai_conversations WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`;
 const row=db?(await db.query(sql,[id,person.id])).rows[0]:await threadQueryOne(sql,[id,person.id]);
 if(!row)throw Error('ASK_THREAD_UNAVAILABLE');return row;
}
export async function requireRunThreadAccess(id:string){
 const person=await threadPrincipal();
 const run=await threadQueryOne<{conversation_id:string|null;principal_user_id:string|null}>(`SELECT conversation_id,principal_user_id FROM dev_agent_runs WHERE id=$1 AND principal_user_id=$2`,[id,person.id]);
 if(!run?.conversation_id||run.principal_user_id!==person.id)throw Error('ASK_THREAD_UNAVAILABLE');
 await requireThreadAccess(run.conversation_id,person);return person;
}
export async function requireInteractionThreadAccess(id:string){
 const person=await threadPrincipal();
 const row=await threadQueryOne<{run_id:string|null;conversation_id:string|null}>(`SELECT run_id,conversation_id FROM agent_interactions WHERE id=$1 AND EXISTS(SELECT 1 FROM ai_conversations c WHERE c.id=conversation_id AND c.owner_user_id=$2 AND c.deleted_at IS NULL)`,[id,person.id]);
 if(!row?.run_id||!row.conversation_id)throw Error('ASK_THREAD_UNAVAILABLE');
 return requireRunThreadAccess(row.run_id);
}
export async function deleteOwnedThread(id:string,operationId:string){
 // Recovery/deletion is opaque maintenance; recheck person and thread under
 // the journal lock in the command before writing the intent.
 const person=await threadPrincipal();
 return deleteThread(pool,id,operationId,undefined,person.id);
}

/** Exact source ownership before opening an Ask upload or extracted sidecar.
 * Keep the OS fence through byte extraction; no DB row lock spans fs work. */
export async function withThreadAttachmentAccess<T>(file:string,read:()=>Promise<T>):Promise<T>{
 const person=await threadPrincipal(),root=path.join(process.cwd(),'uploads','ai-chat');
 const canonical=path.resolve(file);
 if(!canonical.startsWith(root+path.sep))throw Error('ASK_ATTACHMENT_UNAVAILABLE');
 return withAskJournal(pool,async()=>{
  const refs=(await pool.query(`SELECT
   EXISTS(SELECT 1 FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id WHERE c.owner_user_id=$1 AND c.deleted_at IS NULL AND m.attachments @> $2::jsonb) AS live,
   EXISTS(SELECT 1 FROM ai_messages m WHERE m.attachments @> $2::jsonb) AS attached`,[person.id,JSON.stringify([{path:canonical}])])).rows[0];
  const stamp=Number(path.basename(canonical).match(/^(\d{13})-/)?.[1]);
  const pending=canonical.startsWith(path.join(root,person.id)+path.sep)&&Number.isSafeInteger(stamp)&&Date.now()-stamp>=0&&Date.now()-stamp<86400000;
  if(!refs.live&&(refs.attached||!pending))throw Error('ASK_ATTACHMENT_UNAVAILABLE');
  return read();
 });
}

/** Serialize fixed failure codes only. Internal exceptions/causes never cross
 * a public action or RPC boundary. Keep the journal fence through callbacks. */
export function askFailure(error: unknown): import('./ask-result-codes').AskFailure {
 return normalizeAskFailure(error);
}
export async function askBoundary<T>(callback:()=>Promise<T>, rethrow?:(error:unknown)=>boolean):Promise<T|import('./ask-result-codes').AskFailure>{
 try{await threadPrincipal();return await withAskJournal(pool,callback);}catch(error){if(rethrow?.(error))throw error;return askFailure(error);}
}
export async function askThreadCapabilities():Promise<import('./ask-result-codes').AskThreadCapabilities>{return deletionCapabilities(pool);}

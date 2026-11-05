import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { cookies } from "next/headers";
import { pool } from "@/lib/db";
import { readSession } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/session-window";
import { profileFor } from "@/lib/authority/run-profile.mjs";

export type AskLaunchSource = "panel_web" | "panel_mobile" | "panel_voice";
export type LaunchSource = "legacy" | AskLaunchSource | "telegram" | "background";
const sourceContext = new AsyncLocalStorage<AskLaunchSource>();
/** Only trusted route adapters call this; never accept it from action JSON. */
export function withAskLaunchSource<T>(source: AskLaunchSource, callback: () => T): T {
  return sourceContext.run(source,callback);
}
export async function currentAskLaunchSource(): Promise<AskLaunchSource> {
  return sourceContext.getStore() ?? ((await cookies()).get(SESSION_COOKIE) ? "panel_web" : "panel_mobile");
}
export type AskRunInput = {
  conversationId: string; prompt: string; pageContext?: string; agent?: string;
  model?: string | null; mode?: string; effort?: string; withMcp: boolean;
  subjectWorkItemId?: string; orchestrationTaskId?: string; activity?: string | null;
  requestedProfile?: "operator" | "business" | "browser";
  continuationOfRunId?: string; resumeSessionId?: string;
};
/** Sole admitted-run insertion boundary. 0105 plugs its thread/recovery gate
 * here before enabling panel admission; 0100 alone deliberately fails closed.
 * No Browser launch in slice A: strict runtime/rendezvous is a later gate. */
export async function admitAskRun(input: AskRunInput, source: AskLaunchSource): Promise<{id:string;profile:"operator"|"business";principalUserId:string;principalRole:"owner"|"staff"}> {
  if (!["panel_web","panel_mobile","panel_voice"].includes(source)) throw new Error("ASK_INVALID_SOURCE");
  if (input.requestedProfile === "browser") throw new Error("BROWSER_DISABLED");
  const session=await readSession();
  const authAt=session?.authAt??session?.iat;
  if (!session?.userId || typeof authAt!=="number") throw new Error("ASK_SIGN_IN_REQUIRED");
  if (source==='panel_web' && !(await cookies()).get(SESSION_COOKIE)) throw new Error('ASK_COOKIE_REQUIRED');
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const person=(await c.query(`SELECT u.* FROM users u WHERE u.id=$1 AND u.active
      AND NOT EXISTS(SELECT 1 FROM session_revocations r WHERE r.user_id=u.id AND r.revoked_before>to_timestamp($2)) FOR SHARE`,[session.userId,authAt])).rows[0];
    if(!person || !['owner','staff'].includes(person.role) || (person.role==='staff'&&!person.permissions?.includes('ai'))) throw new Error('ASK_ACCESS_DENIED');
    if(session.sid){
      const s=(await c.query(`SELECT id FROM web_sessions WHERE id=$1 AND user_id=$2 AND generation=$3 AND auth_at=to_timestamp($4) AND revoked_at IS NULL AND expires_at>now() FOR SHARE`,[session.sid,person.id,session.generation,authAt])).rows[0];
      if(!s)throw new Error('ASK_SESSION_REVOKED');
    }
    // Do not add/backfill privacy fields here. Missing 0105 is an explicit
    // release dependency, never an implicit ownership guess for legacy rows.
    const thread=(await c.query(`SELECT c.claude_session_id,to_jsonb(c) AS record FROM ai_conversations c WHERE c.id=$1 FOR UPDATE`,[input.conversationId])).rows[0];
    if(!thread || !Object.hasOwn(thread.record,'owner_user_id'))throw new Error('ASK_THREAD_PRIVACY_REQUIRED');
    if(thread.record.owner_user_id!==person.id || thread.record.deleted_at)throw new Error('ASK_THREAD_UNAVAILABLE');
    if(input.resumeSessionId && input.resumeSessionId!==thread.claude_session_id)throw new Error('ASK_RESUME_MISMATCH');
    const profile=profileFor({role:person.role,active:person.active},input.requestedProfile) as 'operator'|'business';
    const {rows}=await c.query(`INSERT INTO dev_agent_runs(agent,prompt,page_context,status,conversation_id,model,mode,effort,subject_work_item_id,with_mcp,orchestration_task_id,profile,principal_user_id,activity,launch_source,continuation_of_run_id)
      VALUES($1,$2,$3,CASE WHEN $1='claude' THEN 'pending' ELSE 'running' END,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,[input.agent??'claude',input.prompt,input.pageContext??null,input.conversationId,input.model??null,input.mode??'acceptEdits',input.effort??'default',input.subjectWorkItemId??null,input.withMcp,input.orchestrationTaskId??null,profile,person.id,input.activity??null,source,input.continuationOfRunId??null]);
    await c.query('COMMIT'); return {id:rows[0].id,profile,principalUserId:person.id,principalRole:person.role};
  } catch(e){await c.query('ROLLBACK');throw e;} finally{c.release();}
}

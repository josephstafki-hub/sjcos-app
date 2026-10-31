"use server";
import { requireAccess, canOpen } from "@/lib/dal";
import { query, queryOne } from "@/lib/db";
import { resolveRunEntity } from "@/lib/run-focus";
import { effectEvidence, visibleChangeFields, type RunReview } from "@/lib/agent-review";
export async function loadRunReview(runId:string):Promise<RunReview|null> {
  const user=await requireAccess('ai');
  const run=await queryOne<{id:string;status:string;activity:string|null;seconds:number;token_usage:Record<string,unknown>|null;principal_user_id:string|null}>(
    `SELECT id, status, activity, GREATEST(0,extract(epoch FROM updated_at-created_at)::int) AS seconds, token_usage, principal_user_id FROM dev_agent_runs WHERE id=$1`,[runId]);
  if(!run||(user.role!=='owner'&&run.principal_user_id!==user.id))return null;
  const {rows}=await query<{id:string;entity_kind:string;entity_id:string|null;action:string;source:string;detail:Record<string,unknown>;created_at:string}>(
    `SELECT id::text,entity_kind,entity_id,action,source,detail,created_at::text FROM run_effects WHERE run_id=$1 ORDER BY id LIMIT 100`,[runId]);
  const changes=[];
  for(const row of rows) {
    // Financial and document diffs stay owner-only; staff can inspect their log.
    if(user.role!=='owner')continue;
    const focus=row.entity_id?await resolveRunEntity(row.entity_kind,row.entity_id):null;
    if(focus&&!canOpen(user,focus.href))continue;
    changes.push({id:row.id,label:focus?.label??row.entity_kind.replace(/_/g,' '),href:focus?.href??null,action:row.action,evidence:effectEvidence(row),at:row.created_at,fields:visibleChangeFields(row.detail)});
  }
  return {runId,status:run.status,log:run.activity??'',durationSeconds:run.seconds,toolCount:typeof run.token_usage?.tool_count==='number'?run.token_usage.tool_count:null,changes};
}

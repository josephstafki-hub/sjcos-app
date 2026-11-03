/** Owner-side worker called by the authenticated cron route, never by a narrow
 * login. Claim commits separately; effects and fenced acknowledgment commit together.
 * A process crash rolls back every effect; an expired claim is safe to reclaim. */
import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {applyCompleteConsultFindings} from '../consult/findings.ts';
import {cleanupConsultUploads} from '../consult/uploads.ts';
export async function enqueueConsultFindings(c:PoolClient,id:string,generation:number){
 const visit=(await c.query('SELECT status,completion_generation FROM consults WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(!visit||visit.status!=='complete')return {ok:false as const,code:'consult_not_complete'};
 if(Number(visit.completion_generation)!==generation)return {ok:false as const,code:'rebase_required'};
 const row=(await c.query(`INSERT INTO consult_findings_jobs(consult_id,generation) VALUES($1,$2)
 ON CONFLICT(consult_id,generation) DO UPDATE SET status=CASE WHEN consult_findings_jobs.status='failed' THEN 'queued' ELSE consult_findings_jobs.status END,
 available_at=CASE WHEN consult_findings_jobs.status='failed' THEN now() ELSE consult_findings_jobs.available_at END RETURNING status,result`,[id,generation])).rows[0];
 return {ok:true as const,generation,...row};
}
export async function claimConsultFindings(c:PoolClient){
 return (await c.query(`WITH candidate AS (SELECT consult_id,generation FROM consult_findings_jobs
 WHERE (status='queued' AND available_at<=clock_timestamp()) OR (status='leased' AND lease_until<clock_timestamp())
 ORDER BY available_at,consult_id LIMIT 1 FOR UPDATE SKIP LOCKED)
 UPDATE consult_findings_jobs j SET status='leased',attempts=attempts+1,lease_token=$1,lease_until=clock_timestamp()+interval '2 minutes'
 FROM candidate x WHERE j.consult_id=x.consult_id AND j.generation=x.generation RETURNING j.*`,[randomUUID()])).rows[0];
}
export async function executeConsultFindings(c:PoolClient,job:{consult_id:string;generation:string;lease_token:string}){
 await c.query('BEGIN');
 try{
  // Same lock order as commands, before locking the job fence.
  await c.query('SELECT p.id FROM projects p JOIN consults v ON v.project_id=p.id WHERE v.id=$1 FOR UPDATE OF p',[job.consult_id]);
  const v=(await c.query('SELECT status,completion_generation FROM consults WHERE id=$1 FOR UPDATE',[job.consult_id])).rows[0];
  const held=(await c.query(`SELECT * FROM consult_findings_jobs WHERE consult_id=$1 AND generation=$2 AND lease_token=$3 AND status='leased' AND lease_until>clock_timestamp() FOR UPDATE`,[job.consult_id,job.generation,job.lease_token])).rows[0];
  if(!held){await c.query('ROLLBACK');return {ok:false,code:'lease_lost'};}
  if(v.status!=='complete'||String(v.completion_generation)!==String(job.generation)){
   await c.query("UPDATE consult_findings_jobs SET status='obsolete',lease_token=NULL,lease_until=NULL WHERE consult_id=$1 AND generation=$2",[job.consult_id,job.generation]);await c.query('COMMIT');return {ok:false,code:'rebase_required'};
  }
  await c.query('SAVEPOINT effects');
  try{
   const result=await applyCompleteConsultFindings(c,{consult_id:job.consult_id,expected_generation:Number(job.generation),operation_id:randomUUID()});
   // clock_timestamp, not transaction now(): a late executor cannot commit effects.
   const ack=await c.query(`UPDATE consult_findings_jobs SET status='done',result=$4,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE consult_id=$1 AND generation=$2 AND lease_token=$3 AND lease_until>clock_timestamp() RETURNING consult_id`,[job.consult_id,job.generation,job.lease_token,result]);
   if(!ack.rowCount){await c.query('ROLLBACK');return {ok:false,code:'lease_lost'};}
   await c.query(`UPDATE work_items SET status='done',completed_at=now() WHERE source_kind='consult' AND source_id=$1 AND status NOT IN ('done','cancelled')`,[`${job.consult_id}:repair:findings`]);
   await c.query('COMMIT');return {ok:true,result};
  }catch(e){
   await c.query('ROLLBACK TO SAVEPOINT effects');
   const failed=held.attempts>=5;
   await c.query(`UPDATE consult_findings_jobs SET status=$4,last_error=$5,available_at=now()+least(3600,power(2,least(attempts,10))*15)*interval '1 second',lease_token=NULL,lease_until=NULL WHERE consult_id=$1 AND generation=$2 AND lease_token=$3`,[job.consult_id,job.generation,job.lease_token,failed?'failed':'queued',(e instanceof Error?e.message:'apply_failed').slice(0,500)]);
   if(failed)await c.query(`INSERT INTO work_items(title,project_id,assignee_key,source_kind,source_id,created_by)
 SELECT 'Couldn''t apply consultation findings — try again',project_id,(SELECT id::text FROM users WHERE role='owner' AND active ORDER BY created_at LIMIT 1),'consult',$2,'consult' FROM consults WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM work_items WHERE source_kind='consult' AND source_id=$2)`,[job.consult_id,`${job.consult_id}:repair:findings`]);
   await c.query('COMMIT');return {ok:false,code:failed?'apply_failed':'retry_scheduled'};
  }
 }catch(e){await c.query('ROLLBACK');throw e;}
}
/** Sweep forgotten Close without completing a visit or advancing a stage. */
export async function maintainConsults(c:PoolClient,root:string){
 await c.query('BEGIN');try{
  await c.query('SELECT pg_advisory_xact_lock(771078)');
  await cleanupConsultUploads(c,root);
  await c.query(`INSERT INTO work_items(title,project_id,assignee_key,due_at,source_kind,source_id,created_by)
 SELECT 'Finish in-home consultation',project_id,conducted_by::text,
 (d+CASE extract(isodow FROM d) WHEN 5 THEN 3 WHEN 6 THEN 2 ELSE 1 END)::timestamp AT TIME ZONE 'America/Chicago',
 'consult',v.id||':finish:visit','consult' FROM consults v, LATERAL(SELECT (scheduled_at AT TIME ZONE 'America/Chicago')::date d) day
 WHERE status IN ('in_progress','captured','incomplete') AND scheduled_at<now()-interval '12 hours'
 AND NOT EXISTS(SELECT 1 FROM work_items WHERE source_kind='consult' AND source_id=v.id||':finish:visit')`);
  await c.query(`INSERT INTO work_items(title,project_id,assignee_key,due_at,source_kind,source_id,created_by)
 SELECT 'Schedule return consultation',v.project_id,(SELECT id::text FROM users WHERE role='owner' AND active ORDER BY created_at LIMIT 1),
 (e.evidence->>'return_day')::date::timestamp AT TIME ZONE 'America/Chicago','consult',v.id||':return:visit','consult'
 FROM consults v JOIN consult_close_evidence e ON e.consult_id=v.id WHERE v.status<>'cancelled'
 AND EXISTS(SELECT 1 FROM jsonb_each(e.evidence->'skips') s WHERE s.value->>'reason'='Get on return visit')
 AND NOT EXISTS(SELECT 1 FROM work_items WHERE source_kind='consult' AND source_id=v.id||':return:visit')`);
  await c.query(`UPDATE work_items w SET due_at=(e.evidence->>'return_day')::date::timestamp AT TIME ZONE 'America/Chicago'
   FROM consult_close_evidence e JOIN consults v ON v.id=e.consult_id
   WHERE w.source_kind='consult' AND w.source_id=v.id||':return:visit' AND w.status NOT IN ('done','cancelled') AND v.status<>'cancelled'
   AND e.evidence->>'return_day' IS NOT NULL AND w.due_at IS DISTINCT FROM (e.evidence->>'return_day')::date::timestamp AT TIME ZONE 'America/Chicago'`);
  await c.query('COMMIT');return {ok:true};
 }catch(e){await c.query('ROLLBACK');throw e;}
}

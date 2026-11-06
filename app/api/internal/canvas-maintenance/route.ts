import { askHealthDiagnosis } from '@/lib/ask-health.mjs';
import { timingSafeEqual } from 'node:crypto';
import { refreshSourcedWorkItem } from '@/lib/obligations/work-items';
import { completeWorkItem } from '@/lib/completion/complete';
import type { Run } from '@/lib/commands/core';
import { pool } from '@/lib/db';
import { maintainThreads } from '@/lib/ask-thread-journal.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function reportHealth(failed:boolean){
 const c=await pool.connect();try{
  await c.query('BEGIN');
  const lock=(await c.query('SELECT pg_try_advisory_xact_lock(105005) AS ok')).rows[0];
  if(!lock.ok){await c.query('ROLLBACK');return;}
  const state=(await c.query(`SELECT health_code,deletion_enabled,recovery_ready,
   (heartbeat_at IS NULL OR heartbeat_at<now()-interval '15 minutes') AS late,
   (blocked_since<now()-interval '15 minutes' AND NOT recovery_ready) AS blocked,
   (SELECT count(*)::int FROM ai_conversations WHERE purged_at IS NULL AND purge_after<now()-interval '15 minutes' AND NOT purge_hold) AS overdue
   FROM ask_canvas_maintenance WHERE singleton`)).rows[0];
  const run:Run=async <T=Record<string,unknown>>(sql:string,params?:unknown[])=>(await c.query(sql,params)).rows as T[];
  if(state.health_code==='JOURNAL_NOT_CONFIGURED'&&!state.deletion_enabled&&state.recovery_ready){
   await c.query('COMMIT');return; // owner status JSON carries the warning, not an outage
  }
  const diagnosis=askHealthDiagnosis(state.health_code);
  if(failed||state.late||state.blocked||state.overdue){
   await refreshSourcedWorkItem(run,{sourceKind:'maintenance',sourceId:'canvas-maintenance-health',provider:'sjcos',title:'Check chat recovery',body:`Chat recovery needs checking. Codes: ${diagnosis?.code??(failed?'RECOVERY_FAILED':state.blocked?'RECOVERY_BLOCKED':state.late?'HEARTBEAT_LATE':'PURGE_OVERDUE')}. ${diagnosis?.message??''} Overdue count: ${state.overdue}.`,status:'waiting_on_human',priority:'high',createdBy:'canvas-maintenance',recurring:true,requiresApproval:false});
  }else{
   const row=(await c.query(`SELECT id FROM work_items WHERE source_kind='maintenance' AND source_id='canvas-maintenance-health' AND status NOT IN ('done','cancelled') ORDER BY created_at DESC LIMIT 1`)).rows[0];
   if(row)await completeWorkItem(run,{workItemId:row.id,principal:{kind:'service',name:'cron:canvas-maintenance'},evidence:{kind:'manual',actor:'cron:canvas-maintenance',reason:'Live independent authority verified; recovery ready and retention caught up.'}});
  }
  await c.query('COMMIT');
 }catch{await c.query('ROLLBACK');}finally{c.release();}
}
export async function POST(req:Request){
 const expected=process.env.CRON_SECRET;
 const supplied=req.headers.get('authorization')??'';
 const wanted=`Bearer ${expected}`;
 if(!expected||Buffer.byteLength(supplied)!==Buffer.byteLength(wanted)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(wanted)))return Response.json({error:'Unauthorized'},{status:401});
 try{const result=await maintainThreads(pool);await reportHealth(false);return Response.json(result);}
 catch{await reportHealth(true);return Response.json({ok:false,code:'ASK_PAUSED'},{status:503});}
}

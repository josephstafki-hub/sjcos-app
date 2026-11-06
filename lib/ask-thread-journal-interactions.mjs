import {withAskJournal} from './ask-thread-journal.mjs';
/** Authenticated internal route ONLY. Context belongs to the closed stdio
 * adapter; this is not principalPayload, HTTP MCP headers, or model JSON. */
export async function interactionCommand(pool,action,input,context,options){
 return withAskJournal(pool,async()=>{
  const db=pool.connect?await pool.connect():pool;
  try{
   await db.query('BEGIN');
   const run=(await db.query(`SELECT r.id,r.agent,r.conversation_id,r.principal_user_id,r.profile,r.launch_source,r.with_mcp,
    extract(epoch FROM r.created_at)::bigint::text AS started_s
    FROM dev_agent_runs r JOIN ai_conversations c ON c.id=r.conversation_id JOIN users u ON u.id=r.principal_user_id
    WHERE r.id=$1 AND r.conversation_id=$2 AND r.principal_user_id=$3 AND r.profile=$4
    AND extract(epoch FROM r.created_at)::bigint=$5 AND r.status IN ('pending','running') AND NOT r.cancellation_requested
    AND r.launch_source IN ('panel_web','panel_mobile','panel_voice') AND c.owner_user_id=u.id AND c.deleted_at IS NULL
    AND u.active AND (u.role='owner' OR (u.role='staff' AND 'ai'=ANY(u.permissions) AND r.profile='business'))
    AND NOT EXISTS(SELECT 1 FROM session_revocations v WHERE v.user_id=u.id AND v.revoked_before>r.created_at)
    FOR SHARE OF r,c,u`,[context.run_id,context.conversation_id,context.principal_user_id,context.run_profile,context.run_started_s])).rows[0];
   if(context.transport!=='runner_stdio'||!run)throw Error('RUN_CONTEXT_REQUIRED');
   if(action==='create'){
    await db.query(`INSERT INTO agent_interactions(id,run_id,conversation_id,agent,kind,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[input.id,run.id,run.conversation_id,run.agent,input.kind,JSON.stringify(input.payload)]);
    await db.query('COMMIT');return {ok:true,id:input.id};
   }
   const row=(await db.query(`SELECT id,status,response FROM agent_interactions WHERE id=$1 AND run_id=$2 AND conversation_id=$3 FOR UPDATE`,[input.id,run.id,run.conversation_id])).rows[0];
   if(!row)throw Error('RUN_CONTEXT_REQUIRED');
   if(action==='expire')await db.query(`UPDATE agent_interactions SET status='expired' WHERE id=$1 AND status='pending'`,[input.id]);
   else if(action!=='poll')throw Error('INVALID_INPUT');
   await db.query('COMMIT');return {ok:true,interaction:row};
  }catch(e){await db.query('ROLLBACK');throw e;}finally{if(db!==pool)db.release();}
 },options);
}

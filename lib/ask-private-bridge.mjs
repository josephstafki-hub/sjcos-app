import {AsyncLocalStorage} from 'node:async_hooks';
import {withAskJournal} from './ask-thread-journal.mjs';
const scope=new AsyncLocalStorage();
export const privateRunner=()=>scope.getStore()??null;
// Only the closed stdio adapter supplies this tuple. The service bearer and
// ordinary principal fields do not establish a private-source capability.
export async function withPrivateRunner(pool,context,fn,options){
 if(!context)return scope.run(null,fn);
 return withAskJournal(pool,async()=>{
  if(context.transport!=='runner_stdio'||Object.keys(context).sort().join(',')!=='conversation_id,principal_user_id,run_id,run_profile,run_started_s,transport'||
   ![context.run_id,context.conversation_id,context.principal_user_id].every(id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))||
   !['operator','business'].includes(context.run_profile)||!Number.isSafeInteger(context.run_started_s)||context.run_started_s<=0)throw Error('ASK_THREAD_UNAVAILABLE');
  const run=(await pool.query(`SELECT r.id FROM dev_agent_runs r
   JOIN ai_conversations c ON c.id=r.conversation_id JOIN users u ON u.id=r.principal_user_id
   WHERE r.id=$1 AND r.conversation_id=$2 AND r.principal_user_id=$3 AND r.profile=$4
   AND extract(epoch FROM r.created_at)::bigint=$5 AND r.status IN ('pending','running') AND NOT r.cancellation_requested
   AND r.launch_source IN ('panel_web','panel_mobile','panel_voice') AND c.owner_user_id=u.id AND c.deleted_at IS NULL
   AND u.active AND (u.role='owner' OR (u.role='staff' AND 'ai'=ANY(u.permissions) AND r.profile='business'))
   AND NOT EXISTS(SELECT 1 FROM session_revocations v WHERE v.user_id=u.id AND v.revoked_before>r.created_at)`,
   [context.run_id,context.conversation_id,context.principal_user_id,context.run_profile,context.run_started_s])).rows[0];
  if(!run)throw Error('ASK_THREAD_UNAVAILABLE');
  const bound={...context,active:true};
  try{return await scope.run(bound,fn);}finally{bound.active=false;}
 },options);
}
export function privatePerson(){const s=privateRunner();return s?.active?s.principal_user_id:null;}

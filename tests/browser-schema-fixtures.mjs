import {randomUUID} from 'node:crypto';
import {seedPeople} from './phase0a-fixtures.mjs';
import {withSessionIdentity} from './_harness/testdb.mjs';
export const hash=Buffer.alloc(32,1);
export async function fixture(url,db,fn){
 const people=await seedPeople(db);
 return withSessionIdentity(url,'sjcos_test_website',async c=>{
  const ownerSid=(await c.query(`INSERT INTO web_sessions(user_id,auth_at,expires_at) VALUES($1,now(),now()+interval '1 hour') RETURNING id`,[people.owner.id])).rows[0].id;
  const staffSid=(await c.query(`INSERT INTO web_sessions(user_id,auth_at,expires_at) VALUES($1,now(),now()+interval '1 hour') RETURNING id`,[people.staff.id])).rows[0].id;
  const thread=(await c.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','Browser fixture',$1) RETURNING id`,[people.staff.id])).rows[0].id;
  const boot=randomUUID();
  const task=(await c.query(`INSERT INTO browser_tasks(initiator_user_id,conversation_id,purpose,required_areas,origins,state,initiating_web_session_id,controller_boot_id) VALUES($1,$2,'fixture',ARRAY['ai'],'{}','active',$3,$4) RETURNING *`,[people.staff.id,thread,staffSid,boot])).rows[0];
  const run=(await c.query(`INSERT INTO dev_agent_runs(prompt,profile,launch_source,with_mcp,principal_user_id,conversation_id,browser_task_id) VALUES('fixture','browser','panel_web',true,$1,$2,$3) RETURNING id`,[people.staff.id,thread,task.id])).rows[0].id;
  await c.query(`INSERT INTO browser_task_runs(task_id,run_id,initiator_user_id,conversation_id,launch_web_session_id) VALUES($1,$2,$3,$4,$5)`,[task.id,run,people.staff.id,thread,staffSid]);
  await c.query(`UPDATE browser_tasks SET current_run_id=$2 WHERE id=$1`,[task.id,run]);
  await c.query(`INSERT INTO browser_read_manifests(task_id,revision,task_origins_revision,public_entries,manifest_hmac,initial_entry_id,expires_at) VALUES($1,1,1,'[]',$2,$3,now()+interval '1 hour')`,[task.id,hash,randomUUID()]);
  const newAction=async({kind='submit',category='company_submission',amount=null,payee=null,currency=null,...patch}={})=>{
   const id=randomUUID();const cols={id,task_id:task.id,run_id:run,initiating_user_id:people.staff.id,kind,category,needs_owner:!['personal_login','delegated_login','personal_contact'].includes(category),snapshot_digest:hash,snapshot:{v:1},context_boot_id:boot,document_epoch:0,control_epoch:0,amount_cents:amount,payee,currency,review_mode:'buffered',request_digest:hash,dispatched_flow_nonce:randomUUID(),gate_generation:1,read_manifest_revision:1,read_manifest_digest:hash,...patch};
   const names=Object.keys(cols),values=Object.values(cols);
   return (await c.query(`INSERT INTO browser_actions(${names.join(',')},expires_at,request_deadline) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')},now()+interval '55 seconds',now()+interval '60 seconds') RETURNING *`,values)).rows[0];
  };
  const review=async(a,user=people.owner.id,sid=ownerSid)=>c.query(`INSERT INTO browser_action_reviews(action_id,snapshot_digest,action_revision,reviewer_user_id,reviewer_session_id,decision,idempotency_key,body_digest) VALUES($1,$2,1,$3,$4,'approved',$5,$2)`,[a.id,hash,user,sid,randomUUID()]);
  const grant=async(a,overrides={})=>{const g={actions:[a.kind==='pay'?'external_browser_pay':a.kind==='sign'?'external_browser_sign':'external_browser_submit'],target_kind:'browser_action',target_id:a.id,run_id:run,scope:{snapshot_digest:hash.toString('hex'),action_revision:'1',amount_cents:a.amount_cents,currency:a.currency,payee:a.payee},...overrides};return (await c.query(`INSERT INTO owner_grants(status,actions,target_kind,target_id,run_id,scope,max_uses,expires_at) VALUES('approved',$1,$2,$3,$4,$5,1,$6) RETURNING id`,[g.actions,g.target_kind,g.target_id,g.run_id,g.scope,a.expires_at])).rows[0].id;};
  const approve=async(a,g,user=people.owner.id,sid=ownerSid)=>c.query(`UPDATE browser_actions SET state='approved',approved_by_user_id=$2,approver_session_id=$3,approved_at=now(),approval_method='card',token_hash=$4,token_expires_at=least(expires_at,now()+interval '30 seconds'),owner_grant_id=$5 WHERE id=$1 RETURNING *`,[a.id,user,sid,hash,g]);
  await fn({c,people,ownerSid,staffSid,task,run,thread,boot,newAction,review,grant,approve});
 });
}
export function fakeEnvelope(purpose,bindings){return {version:1,purpose,bindings:{version:1,purpose,...bindings},ciphertext:'AQID',nonce:Buffer.alloc(12).toString('base64'),tag:Buffer.alloc(16).toString('base64'),wrapped_key:Buffer.alloc(32).toString('base64'),wrap_nonce:Buffer.alloc(12).toString('base64'),wrap_tag:Buffer.alloc(16).toString('base64'),key_id:'v1',wrap_revision:1};}

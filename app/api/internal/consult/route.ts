/** MCP bridge: service authentication binds the principal, fresh DB checks bind
 * current assignment. Agent proposals never call the person's answer command. */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool} from '@/lib/db';
import {servicePrincipal} from '@/lib/commands/db';
import {boundedBytes} from '@/lib/consult/http';
import {snapshot,schedule,hash} from '@/lib/consult/protocol';
import {proposeConsultAnswers} from '@/lib/consult/proposals';
import {consultScopeFacts,reconcileConsultFindings} from '@/lib/consult/findings';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 if(!servicePrincipal(req,'mcp:consult'))return Response.json({ok:false,error:{code:'unauthorized',message:'Sign in',retryable:false}},{status:401});
 const c=await pool.connect();try{
  const body=JSON.parse((await boundedBytes(req,256*1024)).toString());
  const actor=z.string().uuid().parse(body.principal_user_id);
  await c.query('BEGIN');
  const user=(await c.query('SELECT id,role,permissions FROM users WHERE id=$1 AND active',[actor])).rows[0];if(!user)throw new Error('forbidden');
  let target=body.consult_id??null;
  if(body.action==='get_consult_scope_facts'){
   const p=(await c.query('SELECT id FROM projects WHERE slug=$1',[z.string().parse(body.project_slug)])).rows[0];if(!p)throw new Error('not_found');
   target=(await c.query("SELECT id FROM consults WHERE project_id=$1 AND status<>'cancelled' ORDER BY scheduled_at DESC,id LIMIT 1",[p.id])).rows[0]?.id??null;
   if(!target&&user.role!=='owner')throw new Error('forbidden');
  }
  if(target)z.string().uuid().parse(target);
  const op=body.action==='record_consult_answers'?'propose_answers':body.action==='propose_consult_form_version'?'propose_form':body.action==='schedule_consult'?'schedule':body.action==='apply_consult_findings'?'apply':'read';
  const key=(await c.query('SELECT key_id FROM consult_context_keys WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1')).rows[0];if(!key)throw new Error('key_unavailable');
  const claims={kind:'in_home_consult',sub:actor,role:user.role,areas:user.permissions,mode:['schedule_consult','apply_consult_findings'].includes(body.action)?'person':'agent',operation:op,consult_id:target,iat:Number(body.principal_started_s)||0,exp:Date.now()/1000+120,run_id:body.run_id??randomUUID(),nonce:randomUUID()};
  // Do not replace the run's authentication time with now: revocation stays effective.
  const ctx=(await c.query('SELECT consult_mint_context($1,$2) v',[claims,key.key_id])).rows[0].v;
  await c.query('SELECT consult_verify_context($1,$2,$3)',[ctx,target,op]);
  if(body.operation_id){
   z.string().uuid().parse(body.operation_id);
   await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[actor]);
   const old=(await c.query('SELECT request_hash,result FROM consult_agent_requests WHERE actor=$1 AND operation_id=$2',[actor,body.operation_id])).rows[0];
   const fingerprint=hash({action:body.action,input:Object.fromEntries(Object.entries(body).filter(([k])=>!['run_id','principal_started_s','agent','principal_role','principal_profile','principal_name'].includes(k)))});
   if(old){if(old.request_hash!==fingerprint)throw new Error('idempotency_mismatch');await c.query('COMMIT');return Response.json({ok:true,data:old.result},{headers:{'Cache-Control':'no-store'}});}
  }
  let data:unknown;
  if(body.action==='get_consult')data=await snapshot(c,ctx,target);
  else if(body.action==='record_consult_answers')data=await proposeConsultAnswers(c,ctx,{consult_id:target,operation_id:body.operation_id,answers:body.answers});
  else if(body.action==='get_consult_scope_facts'){
   const p=(await c.query('SELECT id FROM projects WHERE slug=$1',[body.project_slug])).rows[0];
   data=await consultScopeFacts(async(sql,args)=>(await c.query(sql,args)).rows,p.id,z.string().parse(body.scope_key));
  }else if(body.action==='list_consults'){
   data=await c.query(`SELECT c.id,c.project_id,c.status,c.revision,c.completion_generation,c.scheduled_at FROM consults c JOIN projects p ON p.id=c.project_id WHERE ($1='owner' OR EXISTS(SELECT 1 FROM consult_assignments a WHERE a.consult_id=c.id AND a.user_id=$2 AND revoked_at IS NULL)) AND ($3::text IS NULL OR p.slug=$3) AND ($4::text IS NULL OR c.status=$4) AND ($5::timestamptz IS NULL OR c.scheduled_at>=$5) AND ($6::timestamptz IS NULL OR c.scheduled_at<=$6) ORDER BY c.scheduled_at DESC LIMIT 200`,[user.role,actor,body.project_slug??null,body.status??null,body.from??null,body.to??null]).then(r=>r.rows);
  }else if(['list_consult_forms','get_consult_form'].includes(body.action)){
   data=await c.query(`SELECT id,kind,key,version,checksum,definition FROM consult_form_versions WHERE status IN ('published','retired') AND ($1::text IS NULL OR kind=$1) AND ($2::text IS NULL OR key=$2) AND ($3::int IS NULL OR version=$3) ORDER BY key,version DESC LIMIT 200`,[body.kind??null,body.key??null,body.version??null]).then(r=>r.rows);
  }else if(body.action==='propose_consult_form_version'){
   if(body.definition?.key!==body.key)throw new Error('invalid_input');
   data={form_id:(await c.query('SELECT consult_propose_form($1,$2,$3) id',[ctx,body.definition,body.kind])).rows[0].id};
  }else if(body.action==='apply_consult_findings')data=await reconcileConsultFindings(c,ctx,{consult_id:target,expected_generation:body.expected_generation,operation_id:body.operation_id});
  else if(body.action==='schedule_consult'){
   if(user.role!=='owner')throw new Error('forbidden');
   const project=(await c.query('SELECT id FROM projects WHERE slug=$1',[body.project_slug])).rows[0];if(!project)throw new Error('not_found');
   const templates=(await c.query("SELECT id,definition FROM consult_form_versions WHERE kind='template' AND status='published' AND key=ANY($1)",[body.templates])).rows;
   if(templates.length!==new Set(body.templates).size)throw new Error('unknown_template');
   const keys=[...new Set([...templates.flatMap(t=>t.definition.modules.map((m:{module:string})=>m.module)),...(body.add_ons??[])])];
   const modules=(await c.query("SELECT id FROM consult_form_versions WHERE kind='module' AND status='published' AND key=ANY($1)",[keys])).rows;
   if(modules.length!==keys.length)throw new Error('unknown_module');
   data=await schedule(c,ctx,{project:project.id,visit_time:body.scheduled_for,visitor:body.conducted_by_user_id??actor,forms:[...templates,...modules].map(f=>f.id)});
  }else if(body.action==='attach_consult_photo'){
   const media=(await c.query(`SELECT m.id media_id,m.file_id FROM consult_media m JOIN consults c ON c.id=m.consult_id JOIN files f ON f.id=m.file_id WHERE m.consult_id=$1 AND m.file_id=$2 AND m.instance_id=$3 AND m.kind='photo' AND m.removed_at IS NULL AND c.photos_ok AND f.classification='consult_photo' AND m.field_key IS NOT DISTINCT FROM $4 AND m.shot_key IS NOT DISTINCT FROM $5`,[target,body.file_id,body.instance_id,body.field_key??null,body.shot_key??null])).rows[0];
   if(!media)throw new Error('consult_upload_required');data=media;
  }else throw new Error('unknown_action');
  if(body.operation_id)await c.query('INSERT INTO consult_agent_requests(actor,operation_id,request_hash,result) VALUES($1,$2,$3,$4)',[actor,body.operation_id,hash({action:body.action,input:Object.fromEntries(Object.entries(body).filter(([k])=>!['run_id','principal_started_s','agent','principal_role','principal_profile','principal_name'].includes(k)))}),JSON.stringify(data)]);
  await c.query('COMMIT');return Response.json({ok:true,data},{headers:{'Cache-Control':'no-store'}});
 }catch(e){await c.query('ROLLBACK');const code=(e as {code?:string}).code==='42501'?'forbidden':e instanceof z.ZodError?'invalid_input':e instanceof Error&&['not_found','forbidden','unknown_scope_key','complete_locked','idempotency_mismatch'].includes(e.message)?e.message:'invalid_request';
 return Response.json({ok:false,error:{code,message:code,retryable:false}},{status:code==='forbidden'?403:code==='not_found'?404:code==='complete_locked'?423:code==='idempotency_mismatch'?409:422});
 }finally{c.release();}
}

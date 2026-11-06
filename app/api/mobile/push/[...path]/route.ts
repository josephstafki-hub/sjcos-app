import { decrypt } from '@/lib/session';
import { z } from 'zod';
import { getUserFromRequest } from '@/lib/api-auth';
import { query, queryOne } from '@/lib/db';
import { userPrincipal } from '@/lib/commands/db';
import { resolvePhoneAction, resumePhoneEffects } from '@/lib/owner-actions';
import { pushSettings, recordAppMessage, deliverAppMessage, cleanupAppAlerts, shapePushMessage, notifyAppActionResult } from '@/lib/phone-push';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const token=z.string().regex(/^[0-9a-f]{32,512}$/i,'Invalid device token.');
const actionSchema=z.object({actionId:z.string().uuid(),messageId:z.string().uuid(),action:z.enum(['approve','decline','changes','hold','reply']),text:z.string().trim().min(1).max(4000).optional()});
async function handle(req:Request,context:{params:Promise<{path:string[]}>}) {
 try {
  const user=await getUserFromRequest(req);if(!user){
   const session=await decrypt(req.headers.get('authorization')?.replace(/^Bearer /i,''));
   return Response.json({error:session?'You are signed out.':'Sign in again to finish removing this phone.',code:session?'session_revoked':'session_expired_or_invalid',retryable:!session,deliveryStopped:!!session},{status:401});
  }
  const {path}=await context.params;const name=path.join('/');
  if(name==='devices') {
   if(!['owner','staff'].includes(user.role))return Response.json({error:"You don't have access to that."},{status:403});
   if(req.method==='POST') {
    const b=z.object({token,platform:z.enum(['ios','android']),environment:z.enum(['sandbox','production']),appVersion:z.string().max(100).optional(),build:z.string().max(100).optional(),deviceName:z.string().max(200).optional()}).parse(await req.json());
    const session=await decrypt(req.headers.get('authorization')?.replace(/^Bearer /i,''));
    const minted=session?.authAt??session?.iat;if(!minted||!session?.exp)return Response.json({error:'Sign in again to register this phone.'},{status:401});
    const row=await queryOne<{id:string}>(`INSERT INTO push_devices(user_id,token,platform,environment,app_version,build,device_name,session_auth_at,session_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8),to_timestamp($9)) ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id,session_auth_at=EXCLUDED.session_auth_at,session_expires_at=EXCLUDED.session_expires_at,platform=EXCLUDED.platform,environment=EXCLUDED.environment,app_version=EXCLUDED.app_version,build=EXCLUDED.build,device_name=EXCLUDED.device_name,last_seen_at=now(),disabled_at=NULL,disabled_reason=NULL,revoked_at=NULL WHERE push_devices.user_id=EXCLUDED.user_id OR push_devices.revoked_at IS NOT NULL RETURNING id`,[user.id,b.token,b.platform,b.environment,b.appVersion,b.build,b.deviceName,minted,session.exp]);
    if(!row)return Response.json({error:"Unregister this phone from its previous account first."},{status:409});
    return Response.json({ok:true,deviceId:row!.id});
   }
   if(req.method==='DELETE'){const b=z.object({token}).parse(await req.json());await query(`UPDATE push_devices SET disabled_at=now(),revoked_at=now(),disabled_reason='Removed from this phone' WHERE token=$1 AND user_id=$2`,[b.token,user.id]);return Response.json({ok:true});}
  }
  if(user.role!=='owner')return Response.json({error:"You don't have access to that."},{status:403});
  if(name==='settings'&&req.method==='GET')return Response.json(await pushSettings());
  if(name==='open'&&req.method==='GET')return Response.json(await cleanupAppAlerts());
  if(name==='test'&&req.method==='POST'){
   const b=z.object({token}).parse(await req.json());
   const d=await queryOne(`SELECT id FROM push_devices WHERE token=$1 AND user_id=$2 AND platform='ios' AND disabled_at IS NULL`,[b.token,user.id]);
   if(!d)return Response.json({error:'Register this phone first.'},{status:400});
   const m=await recordAppMessage({kind:'test',title:'Phone alerts are working',body:'SJC OS can reach this phone.',href:'/notifications'});await deliverAppMessage(m,b.token);return Response.json({ok:true,messageId:m.id});
  }
  if(name==='action'&&req.method==='POST'){
   const b=actionSchema.parse(await req.json());
   const exists=await queryOne(`SELECT id FROM owner_push_messages WHERE id=$1`,[b.messageId]);if(!exists)return Response.json({error:'That alert no longer exists.'},{status:404});
   const inserted=await queryOne(`INSERT INTO push_actions(id,message_id,user_id,action,text,lease_until) VALUES($1,$2,$3,$4,$5,now()+interval '2 minutes') ON CONFLICT DO NOTHING RETURNING generation`,[b.actionId,b.messageId,user.id,b.action,b.text]);
   let generation=Number(inserted?.generation);
   if(!inserted){
    const prior=await queryOne<{user_id:string;message_id:string;action:string;text:string|null;result:unknown;phase:string;evidence:unknown;busy:boolean}>(`SELECT *,lease_until>now() AS busy FROM push_actions WHERE id=$1`,[b.actionId]);
    if(!prior||prior.user_id!==user.id||prior.message_id!==b.messageId||prior.action!==b.action||(prior.text??null)!==(b.text??null))return Response.json({error:'That action id belongs to another request.'},{status:409});
    if(prior.result)return Response.json(prior.result);
    if(prior.busy)return Response.json({ok:false,message:'This answer is still being processed. Retry this same answer shortly.',outcome:'in_progress',retryable:true},{status:202});
    // SKIP LOCKED refuses a takeover while a domain transaction is still alive,
    // even when its wall-clock lease has expired during a database wait.
    const claim=await queryOne<{generation:number;phase:string;evidence:unknown}>(`WITH available AS (SELECT id FROM push_actions WHERE id=$1 AND result IS NULL AND lease_until<=now() FOR UPDATE SKIP LOCKED) UPDATE push_actions p SET generation=p.generation+1,lease_until=now()+interval '2 minutes' FROM available a WHERE p.id=a.id RETURNING p.generation,p.phase,p.evidence`,[b.actionId]);
    if(!claim)return Response.json({ok:false,message:'This answer is still being processed.',outcome:'in_progress',retryable:true},{status:202});
    generation=claim.generation;
    prior.phase=claim.phase;prior.evidence=claim.evidence;
    if(prior.phase==='effects_pending' && (prior.evidence as {resolution?:unknown})?.resolution){
     const result=await resumePhoneEffects(b.actionId,(prior.evidence as {resolution:Parameters<typeof resumePhoneEffects>[1]}).resolution,generation);
     return finish(result);
    }
    if(prior.phase!=='claimed'){
     const message=await queryOne<{decision_id:string|null;work_item_id:string|null}>(`SELECT decision_id,work_item_id FROM owner_push_messages WHERE id=$1`,[b.messageId]);
     const decision=message?.decision_id?await queryOne(`SELECT id,status,decided_at FROM decisions WHERE id=$1`,[message.decision_id]):null;
     const workItem=message?.work_item_id?await queryOne(`SELECT id,status,approval_status,blocked_reason FROM work_items WHERE id=$1`,[message.work_item_id]):null;
     const sends=await query(`SELECT id,state,provider_ref,provider_state,last_error FROM action_intents WHERE decision_id=$1 OR payload->>'work_item_id'=$2 ORDER BY created_at`,[message?.decision_id,message?.work_item_id]);
     return finish({ok:false,message:'Your answer was recorded, but completion needs a check. Open the record before taking another action.',outcome:'needs_review',needsReview:true,evidence:{...prior.evidence as object,decision,workItem,sends:sends.rows}});
    }
   }
   async function finish(result:unknown) {
    const saved=await queryOne<{result:unknown}>(`UPDATE push_actions SET result=$2::jsonb,phase=$4,lease_until=NULL WHERE id=$1 AND generation=$3 AND result IS NULL RETURNING result`,[b.actionId,JSON.stringify(result),generation,(result as {needsReview?:boolean}).needsReview?'needs_review':'completed']);
    if(saved)return Response.json(saved.result);
    const current=await queryOne<{result:unknown}>(`SELECT result FROM push_actions WHERE id=$1`,[b.actionId]);
    return current?.result?Response.json(current.result):Response.json({ok:false,message:'This answer is still being processed.',outcome:'in_progress',retryable:true},{status:202});
   }
   const result=await resolvePhoneAction({...b,generation},userPrincipal(user));
   const response=await finish(result);
   if(result.ok && ["approve","decline","hold"].includes(b.action))await notifyAppActionResult(b.messageId,result.message).catch(()=>undefined);
   return response;
  }
  if(path[0]==='messages'&&req.method==='GET'){
   await cleanupAppAlerts();
   if(path.length===2){const id=z.string().uuid().parse(path[1]);const row=await queryOne(`SELECT * FROM owner_push_messages WHERE id=$1`,[id]);if(!row)return Response.json({error:'That alert no longer exists.'},{status:404});const thread=await query(`SELECT * FROM owner_push_messages WHERE thread_key=$1 ORDER BY created_at,id`,[row.thread_key]);return Response.json({message:shapePushMessage(row),thread:thread.rows.map(shapePushMessage)});}
   const url=new URL(req.url),limit=z.coerce.number().int().min(1).max(100).parse(url.searchParams.get('limit')??50);
   let cursor:{at:string;id:string}|null=null;const before=url.searchParams.get('before');if(before){try{cursor=JSON.parse(Buffer.from(before,'base64url').toString());z.object({at:z.string().datetime(),id:z.string().uuid()}).parse(cursor);}catch{return Response.json({error:'Invalid cursor.'},{status:400});}}
   const {rows}=await query(`SELECT * FROM owner_push_messages WHERE reply_to_id IS NULL AND ($1::timestamptz IS NULL OR (created_at,id)<($1::timestamptz,$2::uuid)) ORDER BY created_at DESC,id DESC LIMIT $3`,[cursor?.at??null,cursor?.id??null,limit+1]);const page=rows.slice(0,limit);
   const replies=page.length?(await query(`SELECT * FROM owner_push_messages WHERE thread_key=ANY($1::text[]) AND reply_to_id IS NOT NULL ORDER BY created_at,id`,[page.map(r=>r.thread_key)])).rows:[];
   const shaped=new Map([...page,...replies].map(r=>[r.id,shapePushMessage(r)]));
   for(const r of replies){const parent=shaped.get(r.reply_to_id);if(parent)(parent.replies as unknown[]).push(shaped.get(r.id));}
   const last=page.at(-1);return Response.json({messages:page.map(r=>shaped.get(r.id)),nextCursor:rows.length>limit&&last?Buffer.from(JSON.stringify({at:new Date(last.created_at).toISOString(),id:last.id})).toString('base64url'):null});
  }
  return Response.json({error:'Unknown endpoint.'},{status:404});
 }catch(e){if(e instanceof z.ZodError||e instanceof SyntaxError)return Response.json({error:'Invalid request.'},{status:400});console.error('[phone-push] request failed',{code:(e as {code?:string}).code??'unknown'});return Response.json({error:'Something went wrong. Please try again.'},{status:500});}
}
export const GET=handle;export const POST=handle;export const DELETE=handle;

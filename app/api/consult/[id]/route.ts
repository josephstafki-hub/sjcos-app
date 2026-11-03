import { randomUUID } from 'node:crypto';
import { pool } from '@/lib/db';
import { readSession } from '@/lib/session';
import { getCurrentUser, can } from '@/lib/dal';
import { command, snapshot, schedule, publish } from '@/lib/consult/protocol';
import { z } from 'zod';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const bodySchema=z.strictObject({command:z.enum(['recovery_lease','prepare_device','recover_device','offline_lease','cancel','apply_findings','proposal_decision','ops','start','evidence','close','reopen','assign','schedule','publish_form','resolve_conflict']),input:z.unknown()});
async function handle(request:Request,id:string,write:boolean){
 const user=await getCurrentUser();
 if(!user)return Response.json({error_code:'signed_out'},{status:401});
 if(!can(user,'projects'))return Response.json({error_code:'access_denied'},{status:403});
 if(write){
  const origin=request.headers.get('origin');
  if(!origin||origin!==new URL(request.url).origin||request.headers.get('x-consult-csrf')!=='1'||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error_code:'csrf'},{status:403});
  if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error_code:'json_required'},{status:415});
 }
 const c=await pool.connect();
 try{
  const raw=write?await request.text():'';
  if(Buffer.byteLength(raw)>256*1024)return Response.json({error_code:'batch_too_large'},{status:413});
  const body=write?bodySchema.parse(JSON.parse(raw)):null;
  const global=body?.command==='schedule'||body?.command==='publish_form';
  const target=global?null:z.string().uuid().parse(id);
  if(global&&id!=='new')throw new Error('invalid_global_target');
  await c.query('BEGIN');
  // DAL and SQL verifier both check current DB user/permissions/revocation.
  const session=await readSession();
  if(!session)throw new Error('signed_out');
  const claims={kind:'in_home_consult',sub:user.id,role:user.role,areas:user.permissions,mode:'person',operation:body?.command??'read',consult_id:target,iat:session.authAt??session.iat??0,exp:Date.now()/1000+120,run_id:randomUUID(),nonce:body?.command==='ops'?(body.input as {nonce?:string})?.nonce:randomUUID()};
  const key=await c.query('SELECT key_id FROM consult_context_keys WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1');
  if(!key.rows.length)throw new Error('consult_key_unavailable');
  const context=(await c.query('SELECT consult_mint_context($1,$2) v',[claims,key.rows[0].key_id])).rows[0].v;
  const result=body?body.command==='schedule'?await schedule(c,context,body.input):body.command==='publish_form'?await publish(c,context,body.input):await command(c,context,target!,body.command,body.input):await snapshot(c,context,target!);
  await c.query('COMMIT');
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  await c.query('ROLLBACK');
  const message=error instanceof Error?error.message:'internal_error';
  const code=message.match(/update_required|idempotency_mismatch|rebase_required|complete_locked|conflict|sequence_gap|manifest_sequence_gap|manifest_blob_missing|manifest_initials_missing|unresolved_rejections|device_access_denied|owner_required|consult_key_unavailable/)?.[0];
  const status=/^(42|08|53|57|XX)/.test((error as {code?:string}).code??'')&&(error as {code?:string}).code!=='42501'?500:code==='update_required'?426:error instanceof z.ZodError?422:code==='complete_locked'?423:code==='device_access_denied'||code==='owner_required'||(error as {code?:string}).code==='42501'?403:code==='consult_key_unavailable'?503:code?409:422;
  return Response.json({error_code:code??(status===403?'access_denied':'invalid_command')},{status});
 }finally{c.release();}
}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return handle(request,(await params).id,false);}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return handle(request,(await params).id,true);}

import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {pool} from '../db';
import {getCurrentUser,can} from '../dal';
import {readSession} from '../session';
import type {ConsultContext} from './uploads';
export async function boundedBytes(req:Request,limit:number){
 if(Number(req.headers.get('content-length'))>limit)throw new Error('body_too_large');
 const chunks:Uint8Array[]=[];let size=0;const reader=req.body?.getReader();if(!reader)return Buffer.alloc(0);
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('body_too_large');}chunks.push(value);}}finally{reader.releaseLock();}
 return Buffer.concat(chunks);
}
export async function consultHttp(req:Request,id:string,operation:string,fn:(c:PoolClient,ctx:ConsultContext)=>Promise<unknown>){
 const user=await getCurrentUser();if(!user)return Response.json({error_code:'signed_out'},{status:401});
 if(!can(user,'projects'))return Response.json({error_code:'access_denied'},{status:403});
 if(req.method!=='GET'&&(req.headers.get('origin')!==new URL(req.url).origin||req.headers.get('x-consult-csrf')!=='1'||req.headers.get('sec-fetch-site')==='cross-site'))return Response.json({error_code:'csrf'},{status:403});
 const c=await pool.connect();try{
  await c.query('BEGIN');const session=await readSession();if(!session)throw new Error('signed_out');
  const key=(await c.query('SELECT key_id FROM consult_context_keys WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1')).rows[0];if(!key)throw new Error('consult_key_unavailable');
  const claims={kind:'in_home_consult',sub:user.id,role:user.role,areas:user.permissions,mode:'person',operation,consult_id:id,iat:session.authAt??session.iat??0,exp:Date.now()/1000+120,run_id:randomUUID(),nonce:randomUUID()};
  const ctx=(await c.query('SELECT consult_mint_context($1,$2) v',[claims,key.key_id])).rows[0].v;
  const result=await fn(c,ctx);await c.query('COMMIT');if(result instanceof Response)return result;return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){await c.query('ROLLBACK');const message=e instanceof Error?e.message:'';
  const code=/photo_permission_required|upload_access_denied|device_access_denied|upload_expired|idempotency_mismatch|complete_locked|rebase_required|invalid_part|invalid_image|parts_missing|hash_mismatch|body_too_large/.exec(message)?.[0]??'invalid_request';
  const status=(e as {code?:string}).code==='42501'||/permission|access_denied/.test(code)?403:code==='upload_expired'?410:code==='complete_locked'?423:code==='body_too_large'?413:/mismatch|rebase/.test(code)?409:422;
  return Response.json({error_code:code},{status});
 }finally{c.release();}
}

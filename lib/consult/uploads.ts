/** All calls require the caller's open transaction; acknowledge only after COMMIT.
 * Parts are bounded DB staging, never exposed through generic signed URLs. */
import type {PoolClient} from 'pg';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,rename,readFile,readdir,stat,unlink} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {z} from 'zod';
export type ConsultContext={key_id:string;payload:string;signature:string};
const uuid=z.string().uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/);
const inputSchema=z.strictObject({event_id:uuid,device_id:uuid,device_epoch:z.number().int().positive(),kind:z.enum(['photo','initials']),mime:z.enum(['image/jpeg','image/png','image/webp']),size:z.number().int().min(1).max(25*1048576),sha256:sha,instance_id:uuid,field_key:z.string().optional(),shot_key:z.string().optional()});
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export const PART_BYTES=1048576;
async function gate(c:PoolClient,ctx:ConsultContext,id:string){
 const actor=(await c.query('SELECT consult_verify_context($1,$2,$3) actor',[ctx,id,'upload'])).rows[0].actor;
 if(JSON.parse(ctx.payload).mode!=='person')throw new Error('person_required');
 const row=(await c.query('SELECT *,consult_photos_allowed(id) allowed_photos FROM consults WHERE id=$1 FOR UPDATE',[id])).rows[0];
 return {actor,row};
}
async function upload(c:PoolClient,ctx:ConsultContext,id:string,uploadId:string){
 uuid.parse(uploadId);const g=await gate(c,ctx,id);
 const u=(await c.query('SELECT * FROM consult_uploads WHERE id=$1 AND consult_id=$2 AND actor=$3 FOR UPDATE',[uploadId,id,g.actor])).rows[0];
 if(!u)throw new Error('upload_access_denied');
 const device=(await c.query('SELECT 1 FROM consult_devices WHERE consult_id=$1 AND device_id=$2 AND epoch=$3 AND user_id=$4 AND revoked_at IS NULL',[id,u.device_id,u.device_epoch,g.actor])).rows[0];
 if(!device)throw new Error('device_access_denied');
 if(u.status!=='committed' && new Date(u.expires_at).getTime()<=Date.now())throw new Error('upload_expired');
 return {...g,u};
}
export async function initConsultUpload(c:PoolClient,ctx:ConsultContext,id:string,input:unknown){
 const v=inputSchema.parse(input),{actor,row}=await gate(c,ctx,id);
 if(row.status==='complete')throw new Error('complete_locked');
 if(v.kind==='photo'&&!row.allowed_photos)throw new Error('photo_permission_required');
 if(!(await c.query('SELECT 1 FROM consult_devices WHERE consult_id=$1 AND device_id=$2 AND epoch=$3 AND user_id=$4 AND revoked_at IS NULL',[id,v.device_id,v.device_epoch,actor])).rowCount)throw new Error('device_access_denied');
 if(!(await c.query('SELECT 1 FROM consult_instances WHERE consult_id=$1 AND id=$2 AND removed_at IS NULL',[id,v.instance_id])).rowCount)throw new Error('unknown_instance');
 const old=(await c.query('SELECT * FROM consult_uploads WHERE consult_id=$1 AND event_id=$2 FOR UPDATE',[id,v.event_id])).rows[0];
 if(old){
  if(old.actor!==actor||old.sha256!==v.sha256||Number(old.size_bytes)!==v.size||old.kind!==v.kind||old.mime!==v.mime||old.instance_id!==v.instance_id||old.field_key!==(v.field_key??null)||old.shot_key!==(v.shot_key??null)||old.device_id!==v.device_id||Number(old.device_epoch)!==v.device_epoch)throw new Error('idempotency_mismatch');
  if(old.status!=='committed'&&new Date(old.expires_at).getTime()<=Date.now()){
   await c.query('DELETE FROM consult_upload_parts WHERE upload_id=$1',[old.id]);
   await c.query("UPDATE consult_uploads SET expires_at=now()+interval '48 hours',status='pending',epoch=$2,generation=$3 WHERE id=$1",[old.id,Number(row.consent_epoch)||1,row.completion_generation]);
  }
  return consultUploadStatus(c,ctx,id,old.id);
 }
 const uploadId=randomUUID();
 await c.query(`INSERT INTO consult_uploads(id,consult_id,actor,device_id,device_epoch,event_id,kind,mime,size_bytes,sha256,epoch,expires_at,status,instance_id,field_key,shot_key,generation)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '48 hours','pending',$12,$13,$14,$15)`,[uploadId,id,actor,v.device_id,v.device_epoch,v.event_id,v.kind,v.mime,v.size,v.sha256,Number(row.consent_epoch)||1,v.instance_id,v.field_key??null,v.shot_key??null,row.completion_generation]);
 return consultUploadStatus(c,ctx,id,uploadId);
}
export async function consultUploadStatus(c:PoolClient,ctx:ConsultContext,id:string,uid:string){
 const {u}=await upload(c,ctx,id,uid);const parts=(await c.query('SELECT n,sha256 FROM consult_upload_parts WHERE upload_id=$1 ORDER BY n',[uid])).rows;
 return {upload_id:uid,part_bytes:PART_BYTES,expires_at:u.expires_at,received_parts:parts,status:u.status,receipt:u.commit_receipt};
}
export async function putConsultPart(c:PoolClient,ctx:ConsultContext,id:string,uid:string,n:number,bytes:Buffer,hash:string){
 const {u,row}=await upload(c,ctx,id,uid);sha.parse(hash);
 if(row.status==='complete')throw new Error('complete_locked');
 if(u.status==='committed')throw new Error('already_committed');
 if(!Number.isInteger(n)||n<0||n>=Math.ceil(Number(u.size_bytes)/PART_BYTES)||bytes.length!==Math.min(PART_BYTES,Number(u.size_bytes)-n*PART_BYTES)||digest(bytes)!==hash)throw new Error('invalid_part');
 const old=(await c.query('SELECT sha256 FROM consult_upload_parts WHERE upload_id=$1 AND n=$2',[uid,n])).rows[0];
 if(old&&old.sha256!==hash)throw new Error('idempotency_mismatch');
 await c.query('INSERT INTO consult_upload_parts VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[uid,n,hash,bytes]);
 return {n,sha256:hash};
}
export async function commitConsultBlob(c:PoolClient,ctx:ConsultContext,id:string,uid:string,input:unknown,root=path.join(process.cwd(),'uploads')){
 await c.query('SELECT pg_advisory_xact_lock(771077)');
 const v=z.strictObject({event_id:uuid,sha256:sha}).parse(input);
 const {u,row,actor}=await upload(c,ctx,id,uid);
 if(v.sha256!==u.sha256||v.event_id!==u.event_id)throw new Error('idempotency_mismatch');
 if(u.kind==='photo'&&!row.allowed_photos)throw new Error('photo_permission_required');
 if(u.status==='committed')return u.commit_receipt;
 if(row.status==='complete')throw new Error('complete_locked');
 if(Number(u.generation)!==Number(row.completion_generation)||Number(u.epoch)!==Number(Number(row.consent_epoch)||1))throw new Error('rebase_required');
 const parts=(await c.query('SELECT n,bytes FROM consult_upload_parts WHERE upload_id=$1 ORDER BY n',[uid])).rows;
 if(parts.length!==Math.ceil(Number(u.size_bytes)/PART_BYTES)||parts.some((p,i)=>p.n!==i))throw new Error('parts_missing');
 const bytes=Buffer.concat(parts.map(p=>p.bytes));
 if(bytes.length!==Number(u.size_bytes)||digest(bytes)!==u.sha256)throw new Error('hash_mismatch');
 // Sharp sniffs and fully decodes, limits decompression bombs and strips metadata.
 const image=sharp(bytes,{limitInputPixels:40_000_000,failOn:'warning',animated:false});
 const meta=await image.metadata();
 const mime=({jpeg:'image/jpeg',png:'image/png',webp:'image/webp'} as Record<string,string>)[meta.format??''];
 if(!mime||mime!==u.mime||(meta.pages??1)>1)throw new Error('invalid_image');
 const safe=await image.rotate().toFormat(meta.format as 'jpeg'|'png'|'webp').toBuffer();
 if(safe.length>25*PART_BYTES)throw new Error('image_too_large');
 const safeHash=digest(safe),fileId=`consult-${uid}`,name=`${fileId}.blob`;
 await mkdir(root,{recursive:true});const dest=path.join(root,name);
 let existing:Buffer|null=null;try{existing=await readFile(dest);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(existing){if(digest(existing)!==safeHash)throw new Error('finalized_hash_mismatch');}
 else{
  const tmp=path.join(root,`${name}.${randomUUID()}.tmp`);const f=await open(tmp,'wx',0o600);
  try{await f.writeFile(safe);await f.sync();}finally{await f.close();}
  await rename(tmp,dest);const dir=await open(root,'r');try{await dir.sync();}finally{await dir.close();}
 }
 const project=(await c.query('SELECT slug FROM projects WHERE id=$1',[row.project_id])).rows[0];
 await c.query(`INSERT INTO files(id,project_key,type,name,tag,modified_label,size_label,storage_path,mime_type,sha256,classification)
 VALUES($1,$2,'img',$3,'In-home consultation','Today',$4,$3,$5,$6,$7)`,[fileId,project.slug,name,String(safe.length),mime,safeHash,u.kind==='photo'?'consult_photo':'consult_initials']);
 const receipt={file_id:fileId,media_id:uid};
 await c.query("UPDATE consult_uploads SET status='committed',file_id=$2,commit_receipt=$3 WHERE id=$1",[uid,fileId,receipt]);
 await c.query(`INSERT INTO consult_events(consult_id,event_id,actor,source,type,payload,payload_hash,server_revision,generation) VALUES($1,$2,$3,'typed','upload',$4,$5,$6,$7)`,[id,u.event_id,actor,receipt,u.sha256,Number(row.revision)+1,row.completion_generation]);
 await c.query(`INSERT INTO consult_media(id,consult_id,instance_id,field_key,shot_key,kind,file_id,sha256,taken_at,actor,event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9,$10)`,[uid,id,u.instance_id,u.field_key,u.shot_key,u.kind,fileId,u.sha256,actor,u.event_id]);
 if(u.kind==='initials'&&u.field_key==='client_initials'&&(await c.query("SELECT id FROM consult_instances WHERE consult_id=$1 AND id=$2 AND module_key='closing' AND removed_at IS NULL",[id,u.instance_id])).rowCount)await c.query('UPDATE consults SET client_ack_media_id=$2 WHERE id=$1',[id,uid]);
 await c.query('UPDATE consults SET revision=revision+1 WHERE id=$1',[id]);
 await c.query('DELETE FROM consult_upload_parts WHERE upload_id=$1',[uid]);return receipt;
}
/** Maintenance uses the same owner transaction. Hold advisory lock against commits
 * and remove only recognizable unreferenced files older than the staging TTL. */
export async function cleanupConsultUploads(c:PoolClient,root:string){
 await c.query('SELECT pg_advisory_xact_lock(771077)');
 await c.query("DELETE FROM consult_upload_parts WHERE upload_id IN (SELECT id FROM consult_uploads WHERE status<>'committed' AND expires_at<now())");
 await c.query("UPDATE consult_uploads SET status='expired' WHERE status IN ('pending','uploading') AND expires_at<now()");
 for(const name of await readdir(root).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;})){
  if(!/^consult-[a-f0-9-]{36}\.blob(?:\.[a-f0-9-]{36}\.tmp)?$/.test(name))continue;
  const file=path.join(root,name);if(Date.now()-(await stat(file)).mtimeMs<48*3600_000)continue;
  if(!(await c.query('SELECT 1 FROM files WHERE storage_path=$1',[name])).rowCount)await unlink(file);
 }
}

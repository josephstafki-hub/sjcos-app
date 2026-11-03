import type {PoolClient} from 'pg';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {ConsultContext} from './uploads.ts';
/** Assignment verification happens before even looking up storage. */
export async function readConsultMedia(c:PoolClient,ctx:ConsultContext,id:string,fileId:string,root=path.join(process.cwd(),'uploads')){
 await c.query('SELECT consult_verify_context($1,$2,$3)',[ctx,id,'read_media']);
 const row=(await c.query(`SELECT m.*,f.storage_path,f.mime_type,f.sha256 stored_sha256,f.classification,c.status,c.completion_generation,c.project_id,consult_photos_allowed(c.id) photos_ok,u.generation upload_generation FROM consult_media m JOIN files f ON f.id=m.file_id JOIN consults c ON c.id=m.consult_id JOIN consult_uploads u ON u.file_id=m.file_id JOIN consult_instances i ON i.id=m.instance_id WHERE m.consult_id=$1 AND m.file_id=$2 AND m.removed_at IS NULL AND i.removed_at IS NULL`,[id,fileId])).rows[0];
 if(!row||!['consult_photo','consult_initials'].includes(row.classification))throw new Error('not_found');
 if(row.kind!=='initials'&&!row.photos_ok)throw new Error('photo_permission_required');
 const bytes=await readFile(path.join(root,path.basename(row.storage_path)));
 const sha256=createHash('sha256').update(bytes).digest('hex');if(sha256!==row.stored_sha256)throw new Error('hash_mismatch');
 return {row,bytes,sha256};
}
/** In-process only. The sub-export action supplies its server-minted owner
 * envelope. No generic attachment or URL can call this bridge. */
export async function readConsultPhotoForExport(c:PoolClient,ctx:ConsultContext,fileId:string,root?:string){
 const claims=JSON.parse(ctx.payload);
 const actor=(await c.query('SELECT consult_verify_context($1,$2,$3) actor',[ctx,claims.consult_id,'read_media'])).rows[0].actor;
 if(claims.mode!=='person'||!(await c.query("SELECT 1 FROM users WHERE id=$1 AND role='owner' AND active",[actor])).rowCount)throw new Error('owner_required');
 const {row,bytes,sha256}=await readConsultMedia(c,ctx,claims.consult_id,fileId,root);
 if(row.status!=='complete'||String(row.upload_generation)!==String(row.completion_generation))throw new Error('consult_not_complete');
 if(!['photo','markup'].includes(row.kind))throw new Error('not_photo');
 return {bytes:new Uint8Array(bytes),sha256,mime:row.mime_type as 'image/jpeg'|'image/png'|'image/webp',source_file_id:fileId,source_revision:`${row.consult_id}:${row.completion_generation}:${row.id}`,project_id:row.project_id,consult_id:row.consult_id,shot_key:row.shot_key,instance_id:row.instance_id,exif_location_stripped:true as const};
}

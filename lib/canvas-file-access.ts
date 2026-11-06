import 'server-only';
import {pool} from '@/lib/db';
export const CANVAS_FILE_CSP="sandbox; default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
/** Call only with a principal from authenticated session/bearer or admitted runner. */
export async function resolveCanvasFilePolicy({principal,fileId,operation}:{principal:{id:string}|null;fileId:string;operation:string}){
 const f=(await pool.query('SELECT security_profile,canvas_policy,project_key FROM files WHERE id=$1',[fileId])).rows[0];
 if(!f)return null;if(!f.security_profile)return {ordinary:true};
 if(['publish','delivery','portal','signature'].includes(operation)||!principal)return null;
 const p=(await pool.query('SELECT id,role,active,permissions FROM users WHERE id=$1',[principal.id])).rows[0];
 const policy=f.canvas_policy;
 if(!p?.active||!['owner','staff'].includes(p.role)||!policy||!(await pool.query('SELECT 1 FROM projects WHERE slug=$1',[f.project_key])).rowCount)return null;
 if(p.role!=='owner'&&(!p.permissions.includes('projects')||policy.kind!=='staff'||policy.required_areas.some((k:string)=>!p.permissions.includes(k))))return null;
 if(policy.kind==='owner_only'&&p.id!==policy.owner_user_id)return null;
 return {ordinary:false,profile:'canvas_static_v1',policy};
}
/** SQL partition, applied before names, counts and pagination. */
export async function canvasFilePredicate(alias='f',principal?:{id:string}|null){
 if(!/^[a-z]+$/.test(alias))throw Error('INVALID_ALIAS');
 const user=principal===undefined?await (await import('./dal')).getCurrentUser():principal;
 const p=user?(await pool.query('SELECT id,role,active,permissions FROM users WHERE id=$1',[user.id])).rows[0]:null;
 if(!p?.active||!['owner','staff'].includes(p.role))return `${alias}.security_profile IS NULL`;
 const literal=(s:string)=>"'"+s.replace(/'/g,"''")+"'";
 const owner=`${alias}.canvas_policy->>'owner_user_id'=${literal(p.id)}`;
 const may=p.role==='owner'?`(${alias}.canvas_policy->>'kind'='staff' OR ${owner})`:p.permissions.includes('projects')?`(${alias}.canvas_policy->>'kind'='staff' AND ARRAY(SELECT jsonb_array_elements_text(${alias}.canvas_policy->'required_areas')) <@ ARRAY[${p.permissions.map(literal).join(',')}]::text[])`:'false';
 return `(${alias}.security_profile IS NULL OR (${alias}.security_profile='canvas_static_v1' AND ${may}))`;
}
/** Saved-file lifecycle never loads the private source thread. */
export async function canvasFileLifecycle(principal:{id:string},fileId:string,operation:'trash'|'restore'){
 const db=await pool.connect();try{
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(106,1)');
 const s=(await db.query('SELECT * FROM ask_canvas_file_saves WHERE reserved_file_id=$1 FOR UPDATE',[fileId])).rows[0];
 if(!s){await db.query('ROLLBACK');return null;}
 const user=(await db.query('SELECT id,role,active,permissions FROM users WHERE id=$1',[principal.id])).rows[0];
 if(!user?.active||!['owner','staff'].includes(user.role)||(s.policy.kind==='owner_only'&&s.policy.owner_user_id!==user.id)||(user.role==='staff'&&(!user.permissions.includes('projects')||s.policy.kind!=='staff'||s.policy.required_areas.some((k:string)=>!user.permissions.includes(k)))))throw Error('CANVAS_UNAVAILABLE');
 await db.query("SELECT set_config('sjcos.canvas_file_command','yes',true)");
 if(operation==='trash'){
 if(s.state!=='ready')throw Error('CANVAS_UNAVAILABLE');
 const {fileReferences}=await import('./file-trash');const run=async <T=Record<string,unknown>>(sql:string,args?:unknown[])=>(await db.query(sql,args)).rows as T[];
 if((await fileReferences(run,fileId)).length)throw Error('FILE_REFERENCED');
 await db.query(`INSERT INTO file_trash(file_id,project_slug,name,row,reason,deleted_by,purge_after) SELECT id,project_key,name,to_jsonb(f),'Removed from Files',$2,now()+interval '30 days' FROM files f WHERE id=$1 ON CONFLICT(file_id) DO UPDATE SET row=EXCLUDED.row,deleted_at=now(),purge_after=EXCLUDED.purge_after`,[fileId,'user:'+principal.id]);
 await db.query("UPDATE ask_canvas_file_saves SET state='trashed',file_id=NULL,updated_at=now() WHERE reserved_file_id=$1",[fileId]);
 await db.query('DELETE FROM files WHERE id=$1',[fileId]);
 }else{
 const t=(await db.query('SELECT * FROM file_trash WHERE file_id=$1 AND purge_after>now() FOR UPDATE',[fileId])).rows[0];
 if(!t||s.state!=='trashed')throw Error('FILE_RESTORE_CONFLICT');
 const live=await db.query("SELECT 1 FROM ask_canvas_file_saves WHERE canvas_id=$1 AND version=$2 AND project_id=$3 AND state IN ('pending','ready','failed')",[s.canvas_id,s.version,s.project_id]);
 const clash=await db.query('SELECT 1 FROM files WHERE project_key=$1 AND name=$2',[t.project_slug,t.name]);
 if(live.rowCount||clash.rowCount)throw Error('FILE_RESTORE_CONFLICT');
 const {readUpload}=await import('./uploads');const {digest}=await import('./project-file-writes.mjs');
 if(t.row.security_profile!=='canvas_static_v1'||digest(t.row.canvas_policy)!==digest(s.policy)||digest(await readUpload(t.row.storage_path))!==s.file_hash)throw Error('FILE_RESTORE_CONFLICT');
 await db.query('INSERT INTO files SELECT (jsonb_populate_record(NULL::files,row)).* FROM file_trash WHERE file_id=$1',[fileId]);
 await db.query("UPDATE ask_canvas_file_saves SET state='ready',file_id=reserved_file_id,updated_at=now() WHERE reserved_file_id=$1",[fileId]);
 await db.query('DELETE FROM file_trash WHERE file_id=$1',[fileId]);
 }
 await db.query('COMMIT');return {ok:true};
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
export async function canvasTrashList(projectSlug?:string,principal?:{id:string}|null){
 const predicate=await canvasFilePredicate('f',principal);
 return (await pool.query(`SELECT t.file_id,t.project_slug,t.name,t.reason,t.deleted_by,t.deleted_at,t.purge_after FROM file_trash t CROSS JOIN LATERAL jsonb_populate_record(NULL::files,t.row) f WHERE f.security_profile='canvas_static_v1' AND ${predicate} AND t.purge_after>now() AND ($1::text IS NULL OR t.project_slug=$1) ORDER BY t.deleted_at DESC`,[projectSlug??null])).rows;
}
/** Immutable static viewer/download; hash is checked before returning any bytes. */
export async function canvasSnapshotResponse(req:Request,fileId:string,principal:{id:string}|null){
 const access=await resolveCanvasFilePolicy({principal,fileId,operation:'read'});if(!access||access.ordinary)return new Response('Not found',{status:404});
 const s=(await pool.query(`SELECT f.name,f.storage_path,s.file_hash FROM files f JOIN ask_canvas_file_saves s ON s.file_id=f.id WHERE f.id=$1 AND s.state='ready'`,[fileId])).rows[0];if(!s)return new Response('Not found',{status:404});
 const {readUpload}=await import('./uploads'),{digest}=await import('./project-file-writes.mjs');let bytes:Buffer;try{bytes=await readUpload(s.storage_path);}catch{return new Response('Not found',{status:404});}
 if(bytes.length>1048576||digest(bytes)!==s.file_hash)return new Response('Not found',{status:404});
 return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'text/html; charset=utf-8','Content-Disposition':`${new URL(req.url).searchParams.get('download')==='1'?'attachment':'inline'}; filename="canvas.html"; filename*=UTF-8''${encodeURIComponent(s.name)}`,'Content-Security-Policy':CANVAS_FILE_CSP,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Cookie, Authorization'}});
}

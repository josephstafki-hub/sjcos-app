import 'server-only';
import {createHmac, timingSafeEqual, randomUUID} from 'node:crypto';
import {z} from 'zod';
import {canvasFileTransaction} from './ask-canvases';
import {validateCanvasSvg} from './canvas-content.mjs';
import {conversationProvenance} from './ask-context-provenance.mjs';
import {CLASSIFICATION_REGISTRY} from './canvas-classification.mjs';
import {hasAccess} from './area-access';
import {PERMISSIONS} from './permissions';
import {readSession} from './session';
import {UPLOAD_DIR} from './uploads';
import {cleanCanvasOrphans} from './canvas-deletion-ledger.mjs';
import {digest,normalizeFilename,removedAreas,snapshotHtml,writeImmutableBlob} from './project-file-writes.mjs';
import type {PoolClient} from 'pg';
const options=PERMISSIONS.filter(p=>p.key!=='ai'&&p.key!=='projects').map(({key,label})=>({key,label}));
const keys=options.map(o=>o.key);
const changed=(p:any):never=>{throw Object.assign(Error('SAVE_POLICY_CHANGED'),{code:'SAVE_POLICY_CHANGED',details:{save_policy:publicPolicy(p)}});};
const fail=(code:string):never=>{throw Object.assign(Error(code),{code});};
const area=z.string().refine(v=>keys.includes(v as typeof keys[number]));
const areas=z.array(area).max(21).refine(v=>new Set(v).size===v.length);
const base={project_slug:z.string().min(1).max(120),expected_policy_revision:z.string().regex(/^[a-f0-9]{64}$/)};
const saveSchema=z.object({...base,request_id:z.string().uuid(),filename:z.string().max(180).optional(),audience:z.discriminatedUnion('kind',[z.object({kind:z.literal('owner_only')}).strict(),z.object({kind:z.literal('staff'),required_areas:areas}).strict()]).optional(),declassification_ack:z.string().max(4096).optional(),save_another_copy:z.boolean().optional()}).strict();
const ackSchema=z.object({...base,removed_areas:areas}).strict();
function parse<T>(schema:z.ZodType<T>,input:unknown):T{const p=schema.safeParse(input);if(!p.success)fail('INVALID_INPUT');return p.data as T;}
async function epoch(){const s=await readSession();const e=s?.authAt??s?.iat;if(!e)fail('AUTH_REQUIRED');return e!;}
/** Same Projects-area rule as ordinary file routes; no per-project ACL exists.
 * Also retain the Save source's project binding and owned folder scope. */
async function destinationScope(db:PoolClient,a:any,c:any){
 if(!hasAccess(a.person,'projects'))fail('CANVAS_UNAVAILABLE');
 if(c.lead_id)throw Object.assign(Error('UNSUPPORTED_KIND'),{code:'UNSUPPORTED_KIND',details:{rule:'LEAD_DESTINATION'}});
 return (await db.query('SELECT f.entity_kind,f.entity_id FROM ai_conversations t LEFT JOIN ai_folders f ON f.id=t.folder_id AND f.owner_user_id=$2 WHERE t.id=$1 AND t.owner_user_id=$2',[c.conversation_id,a.person.id])).rows[0];
}
/** Authenticated read only: names/slugs, at most 20, no folder/contact/money data. */
export async function canvasSearchProjects(id:string,n:number,query:unknown){
 const q=parse(z.string().max(120),query).trim();
 return canvasFileTransaction(id,n,async(db,a,c)=>{
  const scope=await destinationScope(db,a,c);
  const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const rows=(await db.query<{slug:string;name:string}>(`SELECT slug,name FROM projects
   WHERE (name ILIKE $1 OR slug ILIKE $1) AND ($2::uuid IS NULL OR id=$2)
   AND ($3::text IS NULL OR slug=$3) ORDER BY lower(name),slug LIMIT 20`,[pattern,c.project_id,scope?.entity_kind==='project'?scope.entity_id:null])).rows;
  return rows.map(row=>({kind:'project' as const,slug:row.slug,name:row.name}));
 });
}
async function policy(db:PoolClient,a:any,c:any,v:any,slug:string){
 const scope=await destinationScope(db,a,c);
 if(scope?.entity_kind==='project'&&scope.entity_id!==slug)fail('CANVAS_UNAVAILABLE');
 const project=(await db.query('SELECT id,slug,name FROM projects WHERE slug=$1',[slug])).rows[0];
 if(!project||(c.project_id&&c.project_id!==project.id))fail('CANVAS_UNAVAILABLE');
 const p=await conversationProvenance({client:db,threadId:c.conversation_id});
 const complete=p.complete===true&&v.provenance_complete;
 const baseline=keys.filter(k=>!complete||[...c.required_areas,...v.baseline_areas,...(p.areas??[])].includes(k));
 if(a.person.role!=='owner'&&(!complete||baseline.some(k=>!a.person.permissions.includes(k))))fail('CANVAS_UNAVAILABLE');
 const catalog_version=digest(options),baseline_hash=digest(baseline);
 const policy_revision=digest([c.id,v.version,v.source_sha256,c.required_areas,c.classification_revision,v.provenance_manifest_hash,p.revision,p,CLASSIFICATION_REGISTRY.version,catalog_version,a.person.id,a.person.role,a.person.permissions,project.id,scope]);
 return {baseline_areas:baseline,baseline_source:complete?'tracked_context':'unknown_context',provenance_revision:p.revision,policy_revision,baseline_hash,catalog_version,area_options:options,project:{slug:project.slug,name:project.name},project_id:project.id,owner:a.person.role==='owner'};
}
function publicPolicy(p:any){const {project_id,...out}=p;return out;}
export async function canvasSavePolicy(id:string,n:number,slug:string){return canvasFileTransaction(id,n,async(db,a,c,v)=>publicPolicy(await policy(db,a,c,v,slug)));}
function sign(payload:string){if(!process.env.SESSION_SECRET)fail('INTERNAL_ERROR');return createHmac('sha256',process.env.SESSION_SECRET!).update('canvas-save:'+payload).digest();}
function binding(a:any,c:any,v:any,p:any,removed:string[],auth:number){return [a.person.id,auth,c.id,v.version,p.project_id,p.policy_revision,p.baseline_hash,removed];}
export async function canvasAcknowledge(id:string,n:number,input:unknown){const b=parse(ackSchema,input),auth=await epoch();return canvasFileTransaction(id,n,async(db,a,c,v)=>{
 if(a.person.role!=='owner')fail('CANVAS_UNAVAILABLE');const p=await policy(db,a,c,v,b.project_slug);
 if(p.policy_revision!==b.expected_policy_revision)changed(p);
 const removed=keys.filter(k=>b.removed_areas.includes(k));
 if(!removed.length||removed.some(k=>!p.baseline_areas.includes(k)))fail('INVALID_INPUT');
 const expires_at=Date.now()+300000,payload=Buffer.from(JSON.stringify([binding(a,c,v,p,removed,auth),expires_at])).toString('base64url');
 return {ok:true,token:payload+'.'+sign(payload).toString('base64url'),expires_at};
});}
function verify(token:string|undefined,expected:unknown){try{if(!token)throw 0;const [payload,mac,...rest]=token.split('.'),actual=Buffer.from(mac,'base64url'),wanted=sign(payload);if(rest.length||actual.length!==wanted.length||!timingSafeEqual(actual,wanted))throw 0;const [b,expiry]=JSON.parse(Buffer.from(payload,'base64url').toString());if(digest(b)!==digest(expected)||!Number.isFinite(expiry)||expiry<Date.now())throw 0;}catch{fail('SAVE_FAILED');}}
export async function canvasRender(id:string,n:number,input:unknown){const b=parse(z.object({svg:z.string()}).strict(),input);return canvasFileTransaction(id,n,async(db,a,c,v)=>{
 const valid=validateCanvasSvg(b.svg),svg=valid.svg,sha256=digest(svg);
 const old=(await db.query('SELECT sha256 FROM ask_canvas_derivatives WHERE canvas_id=$1 AND version=$2 AND renderer_version=$3',[id,n,v.renderer_version])).rows[0];
 if(old&&old.sha256!==sha256)fail('RENDERER_HASH_CONFLICT');
 if(!old)await db.query('INSERT INTO ask_canvas_derivatives(canvas_id,version,renderer_version,svg,sha256,byte_count) VALUES($1,$2,$3,$4,$5,$6)',[id,n,v.renderer_version,svg,sha256,Buffer.byteLength(svg)]);
 return {ok:true,canvas_id:id,version:n,renderer_version:v.renderer_version,sha256};
});}
async function drawing(db:PoolClient,id:string,v:any){const d=(await db.query('SELECT * FROM ask_canvas_derivatives WHERE canvas_id=$1 AND version=$2 AND renderer_version=$3 AND purged_at IS NULL',[id,v.version,v.renderer_version])).rows[0];if(!d)fail('EXPORT_NOT_READY');const svg=validateCanvasSvg(d.svg).svg;if(digest(svg)!==d.sha256)fail('SAVE_FAILED');return {...d,svg};}
export async function canvasDrawing(id:string,n:number){return canvasFileTransaction(id,n,async(db,a,c,v)=>({svg:(await drawing(db,id,v)).svg,title:v.title,version:n}));}
export async function canvasSave(id:string,n:number,input:unknown){
 const b=parse(saveSchema,input),auth=await epoch();
 const reserved=await canvasFileTransaction(id,n,async(db,a,c,v)=>{
 const p=await policy(db,a,c,v,b.project_slug);if(p.policy_revision!==b.expected_policy_revision)changed(p);
 if(a.person.role!=='owner'&&(b.audience!==undefined||b.declassification_ack!==undefined))fail('INVALID_INPUT');
 const audience=b.audience??(a.person.role==='owner'?{kind:'owner_only' as const}:{kind:'staff' as const,required_areas:p.baseline_areas});
 const selected=audience.kind==='staff'?keys.filter(k=>audience.required_areas.includes(k)):[],removed=audience.kind==='staff'?removedAreas(p.baseline_areas,selected):[];
 if(removed.length)verify(b.declassification_ack,binding(a,c,v,p,removed,auth));
 const effective={kind:audience.kind,required_areas:selected,owner_user_id:c.owner_user_id},policyHash=digest(effective),filename=normalizeFilename(v.title,n,b.filename),ackHash=b.declassification_ack?digest(b.declassification_ack):null;
 const inputHash=digest([id,n,p.project_id,filename,audience,p.policy_revision,removed,ackHash,b.save_another_copy===true]);
 const replay=(await db.query('SELECT s.*,r.input_hash AS replay_hash FROM ask_canvas_file_requests r JOIN ask_canvas_file_saves s USING(reserved_file_id) WHERE r.saver_user_id=$1 AND r.request_id=$2',[a.person.id,b.request_id])).rows[0];
 if(replay){if(replay.replay_hash!==inputHash)fail('IDEMPOTENCY_CONFLICT');if(replay.state!=='pending'&&replay.state!=='ready')fail('SAVE_POLICY_CONFLICT');return replay;}
 const prior=(await db.query('SELECT * FROM ask_canvas_file_saves WHERE canvas_id=$1 AND version=$2 AND project_id=$3 ORDER BY generation DESC FOR UPDATE',[id,n,p.project_id])).rows;
 let failedReadmit=false;const live=prior.find(r=>['pending','ready','failed'].includes(r.state));
 if(live?.state==='failed'){await db.query("UPDATE ask_canvas_file_saves SET state='removed',updated_at=now() WHERE reserved_file_id=$1",[live.reserved_file_id]);failedReadmit=true;}else if(live){if(live.policy_hash!==policyHash||live.filename!==filename||live.saver_user_id!==a.person.id)fail('SAVE_POLICY_CONFLICT');await db.query('INSERT INTO ask_canvas_file_requests(saver_user_id,request_id,input_hash,reserved_file_id) VALUES($1,$2,$3,$4)',[a.person.id,b.request_id,inputHash,live.reserved_file_id]);return live;}
 if(prior.length&&!b.save_another_copy&&!failedReadmit)fail('SAVE_POLICY_CONFLICT');
 const d=await drawing(db,id,v),html=snapshotHtml(v,d.svg);if(Buffer.byteLength(html)>1048576)fail('CONTENT_TOO_LARGE');
 const fileId='canvas-'+randomUUID(),generation=(prior[0]?.generation??0)+1;
 await db.query(`INSERT INTO ask_canvas_rate_windows VALUES($1,'save',to_timestamp(floor(extract(epoch FROM clock_timestamp())/60)*60),1) ON CONFLICT(actor_user_id,action_bucket,window_start) DO UPDATE SET accepted_count=ask_canvas_rate_windows.accepted_count+1`,[a.person.id]);
 const reserved=(await db.query(`INSERT INTO ask_canvas_file_saves(canvas_id,version,project_id,generation,reserved_file_id,saver_user_id,request_id,input_hash,policy,policy_hash,policy_revision,filename,storage_path,file_hash,source_hash,renderer_version,render_hash,removed_areas,ack_hash,ack_at,auth_epoch,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,CASE WHEN $19::text IS NULL THEN NULL ELSE now() END,$20,'pending') RETURNING *`,[id,n,p.project_id,generation,fileId,a.person.id,b.request_id,inputHash,JSON.stringify(effective),policyHash,p.policy_revision,filename,fileId+'.html',digest(html),v.source_sha256,v.renderer_version,d.sha256,removed,ackHash,auth])).rows[0];
 await db.query('INSERT INTO ask_canvas_file_requests(saver_user_id,request_id,input_hash,reserved_file_id) VALUES($1,$2,$3,$4)',[a.person.id,b.request_id,inputHash,reserved.reserved_file_id]);
 return reserved;
 });
 if(reserved.state==='ready')return saveResult(reserved,b.project_slug,true);
 const html=await canvasFileTransaction(id,n,async(db,a,c,v)=>{const p=await policy(db,a,c,v,b.project_slug);if(p.policy_revision!==reserved.policy_revision)changed(p);return snapshotHtml(v,(await drawing(db,id,v)).svg);});
 await writeImmutableBlob(UPLOAD_DIR,reserved.storage_path,html,reserved.file_hash);
 return canvasFileTransaction(id,n,async(db,a,c,v)=>{
 const p=await policy(db,a,c,v,b.project_slug);if(p.policy_revision!==reserved.policy_revision)changed(p);
 const s=(await db.query('SELECT * FROM ask_canvas_file_saves WHERE reserved_file_id=$1 FOR UPDATE',[reserved.reserved_file_id])).rows[0];if(s.state==='ready')return saveResult(s,b.project_slug,true);if(s.state!=='pending')fail('SAVE_POLICY_CONFLICT');
 await db.query("SELECT set_config('sjcos.canvas_file_command','yes',true)");
 await db.query(`INSERT INTO files(id,project_key,type,name,tag,ai_origin,modified_label,size_label,subtitle,ai_tags,storage_path,mime_type,sha256,client_visible,security_profile,canvas_policy,canvas_version) VALUES($1,$2,'doc',$3,'Canvas',true,'Just now',$4,$5,'{}',$6,'text/html',$7,false,'canvas_static_v1',$8,$9)`,[s.reserved_file_id,b.project_slug,s.filename,`${Buffer.byteLength(html)} B`,`Made by Claude · Version ${n} · Internal draft`,s.storage_path,s.file_hash,JSON.stringify(s.policy),n]);
 const ready=(await db.query("UPDATE ask_canvas_file_saves SET file_id=reserved_file_id,state='ready',updated_at=now() WHERE reserved_file_id=$1 RETURNING *",[s.reserved_file_id])).rows[0];
 await savedEvent(db,c,v,ready,p.project.name);
 return saveResult(ready,b.project_slug,false);
 });
}
function saveResult(s:any,slug:string,replayed:boolean){return {ok:true,file:{id:s.reserved_file_id,name:s.filename,project_slug:slug,version:s.version,href:`/api/files/${s.reserved_file_id}`},effective_policy:s.policy,policy_hash:s.policy_hash,policy_revision:s.policy_revision,generation:s.generation,replayed};}
/** Resume bounded recipes under the existing 0105 lease; no browser/session impersonation. */
export async function canvasFileMaintenance(store:any,lease:any,checkLease:any,deadline:number){
 const transaction=async(fn:(db:PoolClient)=>Promise<any>)=>{const db=await store.connect();try{await db.query('BEGIN');await checkLease(db,lease);await db.query("SELECT set_config('sjcos.ask_purge','yes',true)");await db.query('SELECT pg_advisory_xact_lock(106,1)');const out=await fn(db);await checkLease(db,lease);await db.query('COMMIT');return out;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}};
 const pending=await transaction(async db=>(await db.query("SELECT reserved_file_id FROM ask_canvas_file_saves WHERE state='pending' AND retry_at<=now() AND attempts<5 ORDER BY retry_at LIMIT 5")).rows);
 for(const row of pending){if(Date.now()>deadline-100)break;let recipe:any,html:string|undefined;
 try{
 recipe=await transaction(async db=>{
 const s=(await db.query("SELECT * FROM ask_canvas_file_saves WHERE reserved_file_id=$1 AND state='pending' FOR UPDATE",[row.reserved_file_id])).rows[0];if(!s)return null;
 const a=(await db.query(`SELECT *,EXISTS(SELECT 1 FROM session_revocations WHERE user_id=u.id AND revoked_before>to_timestamp($2)) AS revoked FROM users u WHERE id=$1`,[s.saver_user_id,Number(s.auth_epoch)])).rows[0];
 const flags=(await db.query("SELECT key,value FROM app_settings WHERE key IN ('canvas.diagrams_enabled','canvas.exports_enabled','canvas.staff_enabled')")).rows;
 const enabled=(key:string)=>flags.some(r=>r.key===key&&(r.value===true||r.value==='true'));
 if(!a?.active||!['owner','staff'].includes(a.role)||a.revoked||process.env.SJC_CANVAS_ENABLED!=='1'||!enabled('canvas.diagrams_enabled')||!enabled('canvas.exports_enabled')||(a.role==='staff'&&(!enabled('canvas.staff_enabled')||!a.permissions.includes('ai'))))fail('CANVAS_UNAVAILABLE');
 const c=(await db.query('SELECT c.* FROM ask_canvases c JOIN ai_conversations t ON t.id=c.conversation_id WHERE c.id=$1 AND c.deleted_at IS NULL AND t.deleted_at IS NULL AND c.owner_user_id=$2 AND t.owner_user_id=$2 FOR UPDATE OF c,t',[s.canvas_id,a.id])).rows[0];if(!c)fail('CANVAS_UNAVAILABLE');
 const v=(await db.query('SELECT * FROM ask_canvas_versions WHERE canvas_id=$1 AND version=$2 AND purged_at IS NULL',[s.canvas_id,s.version])).rows[0];if(!v)fail('CANVAS_UNAVAILABLE');
 const project=(await db.query('SELECT slug FROM projects WHERE id=$1',[s.project_id])).rows[0];if(!project)fail('CANVAS_UNAVAILABLE');
 const p=await policy(db,{person:a},c,v,project.slug);if(p.policy_revision!==s.policy_revision)fail('SAVE_POLICY_CHANGED');
 if(s.removed_areas.length&&Date.now()-Date.parse(s.ack_at)>300000)fail('SAVE_FAILED');
 const d=await drawing(db,s.canvas_id,v);html=snapshotHtml(v,d.svg);if(digest(html)!==s.file_hash||d.sha256!==s.render_hash||v.source_sha256!==s.source_hash)fail('SAVE_FAILED');
 await db.query("UPDATE ask_canvas_file_saves SET attempts=attempts+1,retry_at=now()+interval '1 minute' WHERE reserved_file_id=$1",[s.reserved_file_id]);
 return {...s,slug:project.slug};
 });if(!recipe)continue;
 await writeImmutableBlob(UPLOAD_DIR,recipe.storage_path,html!,recipe.file_hash);
 // Repeat all policy checks after filesystem work, including current provenance revision.
 await transaction(async db=>{
 const s=(await db.query("SELECT * FROM ask_canvas_file_saves WHERE reserved_file_id=$1 FOR UPDATE",[recipe.reserved_file_id])).rows[0];if(s.state!=='pending')return;
 const person=(await db.query('SELECT * FROM users WHERE id=$1 AND active AND NOT EXISTS(SELECT 1 FROM session_revocations WHERE user_id=$1 AND revoked_before>to_timestamp($2))',[s.saver_user_id,Number(s.auth_epoch)])).rows[0];
 const c=(await db.query('SELECT c.* FROM ask_canvases c JOIN ai_conversations t ON t.id=c.conversation_id WHERE c.id=$1 AND c.deleted_at IS NULL AND t.deleted_at IS NULL FOR UPDATE OF c,t',[s.canvas_id])).rows[0];
 const v=(await db.query('SELECT * FROM ask_canvas_versions WHERE canvas_id=$1 AND version=$2 AND purged_at IS NULL',[s.canvas_id,s.version])).rows[0];
 const flags=(await db.query("SELECT key,value FROM app_settings WHERE key IN ('canvas.diagrams_enabled','canvas.exports_enabled','canvas.staff_enabled')")).rows;const enabled=(key:string)=>flags.some(r=>r.key===key&&(r.value===true||r.value==='true'));
 if(process.env.SJC_CANVAS_ENABLED!=='1'||!enabled('canvas.diagrams_enabled')||!enabled('canvas.exports_enabled')||(person?.role==='staff'&&(!enabled('canvas.staff_enabled')||!person.permissions.includes('ai'))))fail('CANVAS_UNAVAILABLE');
 if(!person||!c||!v||(await policy(db,{person},c,v,recipe.slug)).policy_revision!==s.policy_revision)fail('SAVE_POLICY_CHANGED');
 await db.query("SELECT set_config('sjcos.canvas_file_command','yes',true)");
 await db.query(`INSERT INTO files(id,project_key,type,name,tag,ai_origin,modified_label,size_label,subtitle,ai_tags,storage_path,mime_type,sha256,client_visible,security_profile,canvas_policy,canvas_version) VALUES($1,$2,'doc',$3,'Canvas',true,'Just now',$4,$5,'{}',$6,'text/html',$7,false,'canvas_static_v1',$8,$9)`,[s.reserved_file_id,recipe.slug,s.filename,`${Buffer.byteLength(html!)} B`,`Made by Claude · Version ${s.version} · Internal draft`,s.storage_path,s.file_hash,JSON.stringify(s.policy),s.version]);
 await db.query("UPDATE ask_canvas_file_saves SET state='ready',file_id=reserved_file_id,updated_at=now() WHERE reserved_file_id=$1",[s.reserved_file_id]);
 await savedEvent(db,c,v,s,(await db.query('SELECT name FROM projects WHERE id=$1',[s.project_id])).rows[0].name);
 await db.query('UPDATE ask_canvas_maintenance SET save_cursor=$1,save_checkpoint=save_checkpoint+1 WHERE singleton',[s.reserved_file_id]);
 });
 }catch(e){const code=(e as any).code??(e as Error).message,terminal=['CANVAS_UNAVAILABLE','SAVE_POLICY_CHANGED','SAVE_FAILED'].includes(code);await transaction(async db=>{await db.query(`UPDATE ask_canvas_file_saves SET state=CASE WHEN $2 OR attempts>=5 THEN 'failed' ELSE 'pending' END,attempts=CASE WHEN $2 THEN 5 ELSE attempts END,failure_code=$3,retry_at=now()+make_interval(mins=>CASE attempts WHEN 0 THEN 1 WHEN 1 THEN 1 WHEN 2 THEN 5 WHEN 3 THEN 15 WHEN 4 THEN 60 ELSE 240 END) WHERE reserved_file_id=$1 AND state='pending'`,[row.reserved_file_id,terminal,terminal?code:'SAVE_FAILED']);});}
 }
 await transaction(async db=>{
 const expired=(await db.query(`SELECT t.file_id,t.row->>'storage_path' AS storage_path FROM file_trash t JOIN ask_canvas_file_saves s ON s.reserved_file_id=t.file_id WHERE t.purge_after<=now() AND s.state='trashed' ORDER BY t.purge_after LIMIT 5 FOR UPDATE OF t,s`)).rows;
 for(const trash of expired){await db.query('DELETE FROM file_trash WHERE file_id=$1',[trash.file_id]);await db.query("UPDATE ask_canvas_file_saves SET state='removed',updated_at=now() WHERE reserved_file_id=$1",[trash.file_id]);const refs=await db.query('SELECT 1 FROM files WHERE storage_path=$1 UNION ALL SELECT 1 FROM file_trash WHERE row->>\'storage_path\'=$1 LIMIT 1',[trash.storage_path]);if(!refs.rowCount&&trash.storage_path){await checkLease(db,lease);const {unlink}=await import('node:fs/promises');const path=await import('node:path');await unlink(path.join(UPLOAD_DIR,path.basename(trash.storage_path))).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
 await cleanCanvasOrphans(db,UPLOAD_DIR,()=>checkLease(db,lease));await db.query("UPDATE ask_canvas_file_saves SET state='removed',updated_at=now() WHERE state='trashed' AND NOT EXISTS(SELECT 1 FROM file_trash WHERE file_id=reserved_file_id)");await db.query('UPDATE ask_canvas_maintenance SET orphan_checkpoint=orphan_checkpoint+1 WHERE singleton');});
}

async function savedEvent(db:PoolClient,c:any,v:any,s:any,projectName:string){await db.query(`INSERT INTO ask_canvas_events(conversation_id,owner_user_id,canvas_id,version,actor_user_id,kind,saved_file_id,saved_project_name,saved_policy) VALUES($1,$2,$3,$4,$5,'saved',$6,$7,$8)`,[c.conversation_id,c.owner_user_id,c.id,v.version,s.saver_user_id,s.reserved_file_id,projectName,JSON.stringify(s.policy)]);}

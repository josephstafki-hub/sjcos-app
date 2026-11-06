import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {pool} from '@/lib/db';
import {canvasBody,canvasJson} from '@/lib/ask-canvases';
import {withPrivateRunner} from '@/lib/ask-private-bridge.mjs';
import {resolveCanvasFilePolicy,canvasFilePredicate,canvasFileLifecycle,canvasTrashList} from '@/lib/canvas-file-access';
import {digest} from '@/lib/project-file-writes.mjs';
import {readUpload} from '@/lib/uploads';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const schema=z.object({action:z.enum(['list','resolve','read','trash','restore']),input:z.object({file_id:z.string().min(1).max(100).optional(),project_slug:z.string().min(1).max(120).optional(),trash:z.boolean().optional()}).strict(),context:z.object({transport:z.literal('runner_stdio'),run_id:z.string().uuid(),principal_user_id:z.string().uuid(),run_profile:z.enum(['operator','business']),run_started_s:z.number().int().positive()}).strict()}).strict();
export async function POST(req:Request){return canvasJson(async()=>{
 const wanted=`Bearer ${process.env.CRON_SECRET}`,got=req.headers.get('authorization')??'';
 if(!process.env.CRON_SECRET||Buffer.byteLength(wanted)!==Buffer.byteLength(got)||!timingSafeEqual(Buffer.from(wanted),Buffer.from(got)))throw Error('AUTH_REQUIRED');
 const parsed=schema.safeParse(await canvasBody(req,8192));if(!parsed.success)throw Error('INVALID_INPUT');const {context:ctx,input,action}=parsed.data;
 const run=(await pool.query("SELECT conversation_id FROM dev_agent_runs WHERE id=$1 AND principal_user_id=$2 AND with_mcp AND agent='claude'",[ctx.run_id,ctx.principal_user_id])).rows[0];if(!run?.conversation_id)throw Error('RUN_CONTEXT_REQUIRED');
 return withPrivateRunner(pool,{...ctx,conversation_id:run.conversation_id},async()=>{
 const principal={id:ctx.principal_user_id};
 if(action==='list'){
 if(!input.project_slug)throw Error('INVALID_INPUT');if(input.trash)return {ok:true,deleted_files:await canvasTrashList(input.project_slug,principal)};const predicate=await canvasFilePredicate('f',principal);
 return {ok:true,files:(await pool.query(`SELECT id,name,type,tag,size_label,mime_type,sha256,created_at,canvas_policy,canvas_version FROM files f WHERE project_key=$1 AND security_profile='canvas_static_v1' AND ${predicate} ORDER BY created_at DESC LIMIT 100`,[input.project_slug])).rows};
 }
 if(!input.file_id)throw Error('INVALID_INPUT');
 if(input.project_slug){const saved=(await pool.query('SELECT p.slug FROM ask_canvas_file_saves s JOIN projects p ON p.id=s.project_id WHERE reserved_file_id=$1',[input.file_id])).rows[0];if(!saved||saved.slug!==input.project_slug)throw Error('CANVAS_UNAVAILABLE');}
 if(action==='restore')return await canvasFileLifecycle(principal,input.file_id,'restore')??{ok:false,code:'CANVAS_UNAVAILABLE'};
 const access=await resolveCanvasFilePolicy({principal,fileId:input.file_id,operation:action});if(!access||access.ordinary)throw Error('CANVAS_UNAVAILABLE');
 if(action==='trash')return canvasFileLifecycle(principal,input.file_id,'trash');
 const f=(await pool.query("SELECT id,name,project_key,size_label,mime_type,storage_path,canvas_version,sha256 FROM files WHERE id=$1 AND security_profile='canvas_static_v1'",[input.file_id])).rows[0];if(!f)throw Error('CANVAS_UNAVAILABLE');
 const {storage_path,...file}=f;
 if(action==='read'){const bytes=await readUpload(storage_path);if(digest(bytes)!==f.sha256)throw Error('CANVAS_UNAVAILABLE');if(bytes.length>1048576)throw Error('CONTENT_TOO_LARGE');return {ok:true,file,content:bytes.toString('utf8'),untrusted:true};}
 return {ok:true,file,effective_policy:access.policy};
 });
 });}

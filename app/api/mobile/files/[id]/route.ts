import {resolveCanvasFilePolicy,canvasSnapshotResponse} from '@/lib/canvas-file-access';
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { queryOne } from "@/lib/db";
import { serveFile } from "@/lib/file-serve";

// Same access check and file serving as /api/files/[id], with mandatory bearer auth.
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const user=await getUserFromRequest(req);
    if(!user) return new Response("Unauthorized",{status:401});
    const {id}=await params;
    if(!hasAccess(user,"subs")&&await queryOne(`SELECT 1 FROM sub_documents WHERE file_id=$1 AND restricted LIMIT 1`,[id])) return new Response("Forbidden",{status:403});
    const access=await resolveCanvasFilePolicy({principal:user,fileId:id,operation:'read'});if(!access)return new Response('Not found',{status:404});
    if(!access.ordinary)return canvasSnapshotResponse(req,id,user);
    const file=await queryOne<{storage_path:string|null;mime_type:string|null;name:string;lead_slug:string|null;project_key:string|null}>(`SELECT storage_path,mime_type,name,lead_slug,project_key FROM files WHERE id=$1`,[id]);
    if(!file?.storage_path) return new Response("Not found",{status:404});
    const inherited = file.lead_slug && hasAccess(user,"projects") && await queryOne(
      `SELECT 1 FROM projects p JOIN leads l ON l.id=p.lead_id WHERE l.slug=$1 LIMIT 1`, [file.lead_slug]);
    if (!(file.lead_slug ? hasAccess(user,"leads") || ((file.project_key || inherited) && hasAccess(user,"projects")) : hasAccess(user,"projects"))) return new Response("Forbidden",{status:403});
    const response=await serveFile(req,id,{...file,storage_path:file.storage_path});return response;
  } catch(e) { console.error("[mobile-file]",e); return new Response("Unable to open file",{status:500}); }
}

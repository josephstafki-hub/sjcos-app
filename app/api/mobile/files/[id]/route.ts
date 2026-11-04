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
    const file=await queryOne<{storage_path:string|null;mime_type:string|null;name:string;lead_slug:string|null;project_key:string|null}>(`SELECT storage_path,mime_type,name,lead_slug,project_key FROM files WHERE id=$1`,[id]);
    if(!file?.storage_path) return new Response("Not found",{status:404});
    if (!(file.lead_slug ? hasAccess(user,"leads") || (file.project_key && hasAccess(user,"projects")) : hasAccess(user,"projects"))) return new Response("Forbidden",{status:403});
    return serveFile(req,id,{...file,storage_path:file.storage_path});
  } catch(e) { console.error("[mobile-file]",e); return new Response("Unable to open file",{status:500}); }
}

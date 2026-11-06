import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getDoc } from "@/lib/unsorted-docs";
import { runDirect } from "@/lib/commands/db";
import { queryOne } from "@/lib/db";
import { serveFile } from "@/lib/file-serve";
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const u=await getUserFromRequest(req);
    if(!u) return Response.json({error:"Unauthorized"},{status:401});
    if(!hasAccess(u,"money")) return Response.json({error:"Forbidden"},{status:403});
    const {id}=await params;
    if(!/^\d+$/.test(id)) return Response.json({error:"Invalid document id"},{status:400});
    const doc=await getDoc(runDirect,Number(id));
    const fileId=new URL(req.url).searchParams.get("fileId") ?? doc?.attachment_file_ids[0] ?? doc?.email_file_id;
    if(!doc || !fileId || ![...doc.attachment_file_ids,doc.email_file_id].includes(fileId)) return Response.json({error:"File not found"},{status:404});
    const f=await queryOne<{storage_path:string|null;mime_type:string|null;name:string}>(`SELECT storage_path,mime_type,name FROM files WHERE security_profile IS NULL AND id=$1`,[fileId]);
    if(!f?.storage_path) return Response.json({error:"File not found"},{status:404});
    return serveFile(req,fileId,{...f,storage_path:f.storage_path});
  } catch(e) {console.error("[mobile-unsorted-file]",e);return Response.json({error:"Unable to load file"},{status:500});}
}

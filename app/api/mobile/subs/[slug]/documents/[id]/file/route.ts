import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { queryOne } from "@/lib/db";
import { serveFile } from "@/lib/file-serve";
export async function GET(req:Request,{params}:{params:Promise<{slug:string;id:string}>}) {
  try {
    const u=await getUserFromRequest(req);
    if(!u) return Response.json({error:"Unauthorized"},{status:401});
    if(!hasAccess(u,"subs")) return Response.json({error:"Forbidden"},{status:403});
    const {slug,id}=await params;
    if(!/^\d+$/.test(id)) return Response.json({error:"Invalid document id"},{status:400});
    const f=await queryOne<{id:string;storage_path:string|null;mime_type:string|null;name:string}>(`SELECT f.id,f.storage_path,f.mime_type,f.name FROM sub_documents d JOIN files f ON f.id=d.file_id WHERE d.sub_slug=$1 AND d.id=$2`,[slug,Number(id)]);
    if(!f?.storage_path) return Response.json({error:"File not found"},{status:404});
    return serveFile(req,f.id,{...f,storage_path:f.storage_path});
  } catch(e) {console.error("[mobile-sub-file]",e);return Response.json({error:"Unable to load file"},{status:500});}
}

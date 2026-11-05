import { commsRead, CommsReadError, uuid } from "@/lib/mobile-rpc/comms-reads";
import { hasAccess } from "@/lib/api-auth";
import { getCall } from "@/lib/voice";
import { queryOne } from "@/lib/db";
import { serveFile } from "@/lib/file-serve";
export async function GET(req:Request,ctx:{params:Promise<{id:string}>}){
  const {id}=await ctx.params;
  return commsRead(req,"comms",async user=>{
    // Preserve /api/files/[id]'s access check as well as the Calls area.
    if(!hasAccess(user,"projects"))throw new CommsReadError("Forbidden",403);
    const call=await getCall(uuid(id),user);if(!call?.recording_file_id)throw new CommsReadError("Recording not found.",404);
    const fileId=call.recording_file_id;
    if(!hasAccess(user,"subs")&&await queryOne(`SELECT 1 FROM sub_documents WHERE file_id=$1 AND restricted LIMIT 1`,[fileId]))throw new CommsReadError("Forbidden",403);
    const row=await queryOne<{storage_path:string|null;mime_type:string|null;name:string}>(`SELECT storage_path,mime_type,name FROM files WHERE id=$1`,[fileId]);
    if(!row?.storage_path)throw new CommsReadError("Recording not found.",404);
    return serveFile(req,fileId,{...row,storage_path:row.storage_path});
  });
}

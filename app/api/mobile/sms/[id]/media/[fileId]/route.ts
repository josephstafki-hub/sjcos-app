import { commsRead, positiveId, CommsReadError } from "@/lib/mobile-rpc/comms-reads";
import { getSmsThread } from "@/lib/sms";
import { queryOne } from "@/lib/db";
import { serveFile } from "@/lib/file-serve";
export async function GET(req:Request,{params}:{params:Promise<{id:string;fileId:string}>}) {
 return commsRead(req,"comms",async user=>{
  const {id,fileId}=await params;const thread=await getSmsThread(positiveId(id),user);
  if(!thread?.messages.some(m=>m.media.some(a=>a.file_id===fileId)))throw new CommsReadError("Attachment not found.",404);
  const file=await queryOne<{storage_path:string|null;mime_type:string|null;name:string}>("SELECT storage_path,mime_type,name FROM files WHERE id=$1",[fileId]);
  if(!file?.storage_path)throw new CommsReadError("Attachment not found.",404);
  return serveFile(req,fileId,{...file,storage_path:file.storage_path});
 });
}

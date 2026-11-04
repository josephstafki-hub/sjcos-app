import { getCurrentUser } from "@/lib/dal";
import { z } from "zod";
import { commsRead, CommsReadError } from "@/lib/mobile-rpc/comms-reads";
import { sendReplyAction } from "@/lib/actions/inbox";
const schema=z.object({threadId:z.string().min(1),toEmail:z.string().min(1),subject:z.string(),body:z.string().min(1),replyAll:z.boolean().optional()});
// Compatibility endpoint; writes use the same mailbox-scoped action as web/RPC.
export async function POST(req:Request){
 return commsRead(req,"inbox",async user=>{
  if((await getCurrentUser())?.id!==user.id)throw new CommsReadError("Unauthorized",401);
  let body:unknown;try{body=await req.json();}catch{throw new CommsReadError("Invalid request body.");}
  const parsed=schema.safeParse(body);if(!parsed.success)throw new CommsReadError(parsed.error.issues[0]?.message??"Invalid input.");
  const result=await sendReplyAction(parsed.data);if(!result.ok)throw new CommsReadError(result.error??"Could not complete this request.");
  return Response.json({ok:true});
 });
}

import { getCurrentUser } from "@/lib/dal";
import { z } from "zod";
import { commsRead, CommsReadError } from "@/lib/mobile-rpc/comms-reads";
import { draftReplyAction } from "@/lib/actions/inbox";
const schema=z.object({threadId:z.string().min(1),model:z.enum(["qwen","hermes"]).optional()});
// Compatibility endpoint; writes use the same mailbox-scoped action as web/RPC.
export async function POST(req:Request){
 return commsRead(req,"inbox",async user=>{
  if((await getCurrentUser())?.id!==user.id)throw new CommsReadError("Unauthorized",401);
  let body:unknown;try{body=await req.json();}catch{throw new CommsReadError("Invalid request body.");}
  const parsed=schema.safeParse(body);if(!parsed.success)throw new CommsReadError(parsed.error.issues[0]?.message??"Invalid input.");
  const result=await draftReplyAction(parsed.data.threadId,parsed.data.model??"qwen");if(!result.ok)throw new CommsReadError(result.error??"Could not complete this request.");
  const {ok,...draft}=result; return Response.json(draft);
 });
}

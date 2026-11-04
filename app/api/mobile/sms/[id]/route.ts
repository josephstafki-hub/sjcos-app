import { commsRead, CommsReadError, positiveId, linkedRecord } from "@/lib/mobile-rpc/comms-reads";
import { getSmsThread, getSmsLinkOptions } from "@/lib/sms";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
 const {id}=await ctx.params;
 return commsRead(req,"comms",async user=>{
  const data=await getSmsThread(positiveId(id));
  if(!data)throw new CommsReadError("Text conversation not found.",404);
  const options=await getSmsLinkOptions();
  return {thread:data.thread,name:data.thread.contactName??data.thread.phone,record:linkedRecord(data.thread.linkType,data.thread.linkSlug,options),messages:data.messages.map(m=>({...m,label:m.direction==="in"?"Received text":"Sent text",statusLabel:m.status.replaceAll("_"," ")})),allowedActions:user.role==="owner"&&!data.thread.optedOut&&!data.thread.blockedAt?["sms.send","sms.read"]:["sms.read"]};
 });
}

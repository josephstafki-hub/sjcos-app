import { commsRead, CommsReadError, uuid, linkedRecord } from "@/lib/mobile-rpc/comms-reads";
import { getSmsLinkOptions } from "@/lib/sms";
import { getCall, getCallEvents, callDisplayName } from "@/lib/voice";
import { hasAccess } from "@/lib/api-auth";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
 const {id}=await ctx.params;
 return commsRead(req,"comms",async user=>{
  const call=await getCall(uuid(id));if(!call)throw new CommsReadError("Call not found.",404);
  const options=await getSmsLinkOptions();
  return {call,events:await getCallEvents(id),name:callDisplayName(call),record:linkedRecord(call.link_type,call.link_slug,options),statusLabel:call.status.replaceAll("_"," "),label:call.direction==="inbound"?"Incoming call":"Outgoing call",recordingUrl:call.recording_file_id&&hasAccess(user,"projects")?`/api/mobile/calls/${id}/recording`:null,allowedActions:user.role==="owner"?["calls.place"]:[]};
 });
}

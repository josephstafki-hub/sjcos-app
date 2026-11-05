import { commsRead, linkedRecord } from "@/lib/mobile-rpc/comms-reads";
import { getSmsLinkOptions } from "@/lib/sms";
import { listCalls, callDisplayName, voiceConfigured } from "@/lib/voice";
import { hasAccess } from "@/lib/api-auth";
export async function GET(req: Request) {
  return commsRead(req,"comms",async user=>{const [calls,options]=await Promise.all([listCalls(150,user),getSmsLinkOptions()]);return {calls:calls.map(c=>({...c,label:c.direction==="inbound"?"Incoming call":"Outgoing call",statusLabel:c.status.replaceAll("_"," "),name:callDisplayName(c),record:linkedRecord(c.link_type,c.link_slug,options),recordingUrl:c.recording_file_id&&hasAccess(user,"projects")?`/api/mobile/calls/${c.id}/recording`:null,allowedActions:["open"]})),configured:voiceConfigured(),allowedActions:hasAccess(user,"comms")?["calls.place"]:[]};});
}

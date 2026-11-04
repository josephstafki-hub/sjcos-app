import { commsRead, linkedRecord } from "@/lib/mobile-rpc/comms-reads";
import { getSmsThreads, getSmsLinkOptions, smsConfigured } from "@/lib/sms";
import { query } from "@/lib/db";
export async function GET(req: Request) {
  return commsRead(req,"comms",async user=>{const [threads,options]=await Promise.all([getSmsThreads(),getSmsLinkOptions()]);const {rows}=await query<{thread_id:number;body:string}>(`SELECT DISTINCT ON (thread_id) thread_id,body FROM sms_messages ORDER BY thread_id,created_at DESC,id DESC`);const last=new Map(rows.map(r=>[r.thread_id,r.body]));return {threads:threads.map(t=>({...t,name:t.contactName??t.phone,lastMessage:last.get(t.id)??null,record:linkedRecord(t.linkType,t.linkSlug,options),allowedActions:user.role==="owner"&&!t.optedOut&&!t.blockedAt?["sms.send","sms.read"]:["sms.read"]})),configured:smsConfigured(),allowedActions:user.role==="owner"?["sms.new"]:[]};});
}

import { commsRead } from "@/lib/mobile-rpc/comms-reads";
import { getInboxData, SMART_VIEWS } from "@/lib/inbox";
import { SYSTEM_VIEWS } from "@/lib/types";
export async function GET(req: Request) {
  return commsRead(req,"inbox",async user=>{const data=await getInboxData(user); const email=data.threads.filter(t=>t.channel==="email");return {views:[{id:"inbox",label:"Inbox",unread:email.filter(t=>t.unread&&t.inInbox).length},...SMART_VIEWS.map(v=>({id:v.key,label:v.label,unread:email.filter(t=>t.unread&&t.view===v.key).length})),...SYSTEM_VIEWS.map(v=>({id:v.key,label:v.label,unread:email.filter(t=>t.unread&&(v.labelId?t.labelIds?.includes(v.labelId):false)).length})),...data.labels.map(l=>({id:`label:${l.id}`,label:l.name,unread:email.filter(t=>t.unread&&t.labelIds?.includes(l.id)).length}))],countsScope:"Loaded email page",mailbox:data.mailbox,allowedActions:["inbox.compose"]};});
}

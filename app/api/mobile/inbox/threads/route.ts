import { commsRead, emailPage, emailCard } from "@/lib/mobile-rpc/comms-reads";
import { SMART_VIEWS } from "@/lib/inbox";
export async function GET(req: Request) {
  return commsRead(req,"inbox",async user=>{const q=new URL(req.url).searchParams;const view=q.get("view")??"inbox";const page=await emailPage(user,view,q.get("cursor")??undefined);return {threads:page.threads.filter(t=>t.channel==="email"&&(!SMART_VIEWS.some(v=>v.key===view)||t.view===view)).map(t=>emailCard(t,user)),nextCursor:page.nextPageToken??null,emailPaused:page.emailPaused??false,lastSyncedAt:page.lastSyncedAt?new Date(page.lastSyncedAt).toISOString():null};});
}

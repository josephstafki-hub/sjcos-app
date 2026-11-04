import { commsRead } from "@/lib/mobile-rpc/comms-reads";
import { searchInboxDirectory } from "@/lib/inbox-directory";
export async function GET(req: Request) {
  return commsRead(req,"inbox",async()=>{const q=new URL(req.url).searchParams;return {records:await searchInboxDirectory((q.get("q")??"").slice(0,200),(q.get("sender")??"").slice(0,320))};});
}

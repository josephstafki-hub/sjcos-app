import { commsRead } from "@/lib/mobile-rpc/comms-reads";
import { getInboxData } from "@/lib/inbox";
// Preserve the shipped InboxData contract and cached per-account loader.
export async function GET(req: Request) { return commsRead(req,"inbox",user=>getInboxData(user)); }

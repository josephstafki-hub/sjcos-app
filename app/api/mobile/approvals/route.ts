import { mobileRead, mobileApprovals } from "@/lib/mobile-rpc/reads";
import { destination } from "@/lib/mobile-rpc/destinations";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return mobileRead(req, true, async ()=>{const data=await mobileApprovals();return {...data,approvals:data.approvals.map(a=>({...a,record:{...a.record,destination:a.record.href?destination(a.record.href):null}}))};});
}

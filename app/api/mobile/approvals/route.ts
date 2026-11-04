import { mobileRead, mobileApprovals } from "@/lib/mobile-rpc/reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return mobileRead(req, true, mobileApprovals);
}

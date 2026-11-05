import { mobileOperatorRead, operatorJobs } from "@/lib/mobile-rpc/operator-reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return mobileOperatorRead(req, true, async (user) => operatorJobs(req));
}

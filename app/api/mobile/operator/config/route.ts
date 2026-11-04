import { mobileOperatorRead, operatorConfig } from "@/lib/mobile-rpc/operator-reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return mobileOperatorRead(req, false, async (user) => operatorConfig(req, user));
}

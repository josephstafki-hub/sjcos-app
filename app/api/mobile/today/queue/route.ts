import { mobileRead, mobileQueue } from "@/lib/mobile-rpc/reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return mobileRead(req, false, mobileQueue);
}

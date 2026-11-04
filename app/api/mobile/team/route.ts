import { mobileRead } from "@/lib/mobile-rpc/reads";
import { listAssignees } from "@/lib/today";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return mobileRead(req, true, async () => ({ users: await listAssignees() }));
}

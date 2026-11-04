import { areaRead } from "@/lib/mobile-rpc/field-reads";
import { subsRead } from "@/lib/mobile-rpc/directory-reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return areaRead(req, "subs", async u => subsRead(u), false); }

import { areaRead } from "@/lib/mobile-rpc/field-reads";
import { vendorsRead } from "@/lib/mobile-rpc/directory-reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return areaRead(req, "vendors", async u => vendorsRead(), false); }

import { areaRead } from "@/lib/mobile-rpc/field-reads";
import { searchRead } from "@/lib/mobile-rpc/directory-reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return areaRead(req, "today", async u => searchRead(u, new URL(req.url).searchParams.get("q") ?? ""), false); }

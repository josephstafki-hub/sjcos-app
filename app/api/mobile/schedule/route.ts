import { areaRead, scheduleRead } from "@/lib/mobile-rpc/field-reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return areaRead(req, "projects", async () => scheduleRead(new URL(req.url).searchParams.get("week"))); }

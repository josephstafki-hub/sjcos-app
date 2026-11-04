import { areaRead, unsortedRead } from "@/lib/mobile-rpc/field-reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return areaRead(req, "money", async () => unsortedRead(new URL(req.url).searchParams.get("tab") ?? "needs")); }

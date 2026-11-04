import { areaRead, warrantyRead } from "@/lib/mobile-rpc/field-reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return areaRead(req, "warranty", async () => warrantyRead()); }

import { areaRead, moneyRead } from "@/lib/mobile-rpc/field-reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return areaRead(req, "money", async () => moneyRead()); }

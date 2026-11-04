import { areaRead } from "@/lib/mobile-rpc/field-reads";
import { subRead } from "@/lib/mobile-rpc/directory-reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request, {params}: {params: Promise<{slug:string}>}) { const {slug} = await params; return areaRead(req, "subs", u => subRead(u,slug)); }

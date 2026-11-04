import { areaRead } from "@/lib/mobile-rpc/field-reads";
import { vendorRead } from "@/lib/mobile-rpc/directory-reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request, {params}: {params: Promise<{slug:string}>}) { const {slug} = await params; return areaRead(req, "vendors", u => vendorRead(u,slug)); }

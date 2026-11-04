import { areaRead, ReadError } from "@/lib/mobile-rpc/field-reads";
import { portalPage } from "@/lib/mobile-rpc/portal-reads";
import { queryOne } from "@/lib/db";
import { portalChannel } from "@/lib/portal-messages";
export async function GET(req:Request,{params}:{params:Promise<{slug:string}>}) {
  return areaRead(req,"leads",async()=>{
    const {slug}=await params;
    if(!await queryOne("SELECT 1 FROM leads WHERE slug=$1",[slug]))throw new ReadError("Not found",404);
    return portalPage(portalChannel("client",`lead:${slug}`),new URL(req.url).searchParams.get("before"));
  });
}

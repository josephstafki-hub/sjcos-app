import { commsRead, emailDetail } from "@/lib/mobile-rpc/comms-reads";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const {id}=await ctx.params;return commsRead(req,"inbox",user=>{const q=new URL(req.url).searchParams;return emailDetail(user,id,q.get("view")??undefined,q.get("cursor")??undefined);});
}

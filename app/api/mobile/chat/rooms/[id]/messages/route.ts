import { commsRead, chatMessages } from "@/lib/mobile-rpc/comms-reads";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const {id}=await ctx.params;return commsRead(req,"chat",user=>{const q=new URL(req.url).searchParams;return chatMessages(user,id,{after:q.get("after"),before:q.get("before"),limit:q.get("limit")});});
}

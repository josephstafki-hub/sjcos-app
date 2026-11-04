import { mobileOperatorRead, operatorConversation } from "@/lib/mobile-rpc/operator-reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return mobileOperatorRead(req, false, async (user) => operatorConversation(id));
}

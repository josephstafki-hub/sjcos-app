import { mobileOperatorRead, operatorRun } from "@/lib/mobile-rpc/operator-reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return mobileOperatorRead(req, false, async (user) => operatorRun(id, new URL(req.url).searchParams.get("after") ?? undefined));
}

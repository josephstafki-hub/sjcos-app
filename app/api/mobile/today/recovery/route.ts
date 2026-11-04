import { mobileRead } from "@/lib/mobile-rpc/reads";
import { listRecoverableWork } from "@/lib/today-recovery.mjs";
import { runDirect } from "@/lib/commands/db";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const view = new URL(req.url).searchParams.get("view");
  if (view !== "done" && view !== "snoozed") {
    return Response.json({ error: "Choose Done or Snoozed." }, { status: 400 });
  }
  return mobileRead(req, false, async user => ({ items: await listRecoverableWork(runDirect, user, view) }));
}

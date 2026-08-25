// Internal agent surface for bidding (MCP -> app bridge). The MCP server is
// plain JS and can't import the TS ops, so award drives through this route —
// the exact function the owner's button calls (lib/bidding.ts) — guarded by a
// bearer token (CRON_SECRET), a trusted local caller, not a browser session.
//
// SCOPE NOTE: send is REFUSED here. Sending a bid package now emails the
// packet straight to each sub's inbox (sendBidPackageOp), and client-facing
// sends stay owner-approved — agents stage the package (files, invites,
// notes) and Joe presses Send on the Bidding tab. This moves the line back
// from the earlier arrangement where agents could "send" because nothing
// transmitted; now it does, so they can't.

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { awardBidOp, markBidWorkingOp } from "@/lib/bidding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false; // fail closed if unconfigured
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

/** Light audit so every agent mutation leaves a trace (mirrors purchase-orders). */
async function audit(action: string, summary: string) {
  try {
    await query(
      `INSERT INTO agent_runs (runtime_name, status, input_summary, output_summary, finished_at)
       VALUES ('mcp:bidding','succeeded',$1,$2, now())`,
      [action.slice(0, 200), summary.slice(0, 500)],
    );
  } catch {
    /* audit is best-effort */
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  try {
    let result: { ok: boolean; error?: string; [k: string]: unknown };

    switch (action) {
      case "send_package":
        // Owner-only: Send transmits real email to subs now. Refuse with an
        // explanation an agent can relay instead of a bare 400.
        result = {
          ok: false,
          error:
            "Sending a bid package emails the subs directly, so it needs Joe's express permission: " +
            "use send_bid_package with an owner_grant_id (ask via request_owner_permission), " +
            "or tell Joe the package is staged so he can press Send on the Bidding tab.",
        };
        break;
      case "award_bid":
        result = await awardBidOp(Number(body.invite_id));
        break;
      case "mark_working":
        // Internal record update (no email transmits): the sub said they're
        // pricing it, so the auto chase switches to the softer check-in.
        result = await markBidWorkingOp(Number(body.invite_id));
        break;
      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }

    if (result.ok) {
      revalidatePath("/projects/[slug]", "page");
      revalidatePath("/notifications");
      await audit(action, JSON.stringify(result).slice(0, 500));
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) },
      { status: 500 },
    );
  }
}

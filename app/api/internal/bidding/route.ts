// Internal agent surface for bidding (MCP -> app bridge). The MCP server is
// plain JS and can't import the TS ops, so send/award/message drive through
// this route — the exact functions the owner's buttons call (lib/bidding.ts),
// so portal publishing, parked invite emails, and notifications stay one
// implementation. Guarded by a bearer token (CRON_SECRET), a trusted local
// caller, not a browser session.
//
// SCOPE NOTE: unlike newsletter/PO, bidding's send IS exposed to agents — the
// owner explicitly moved that line for this family. What "send" does here is
// publish to sub portals and PARK invite emails on the Subs tab; no code path
// in the app transmits email, so the real send line (a message leaving for a
// sub's inbox) still ends at Joe's own mail client.

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { awardBidOp, postBidMessageOp, sendBidPackageOp } from "@/lib/bidding";

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
        result = await sendBidPackageOp(Number(body.package_id));
        break;
      case "award_bid":
        result = await awardBidOp(Number(body.invite_id));
        break;
      case "post_message":
        result = await postBidMessageOp(
          Number(body.invite_id),
          {
            kind: "ai",
            name: String(body.author_name ?? "SJC Office"),
            initials: String(body.author_initials ?? "AI").slice(0, 3),
          },
          String(body.body ?? ""),
        );
        break;
      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }

    if (result.ok) {
      revalidatePath("/projects/[slug]", "page");
      revalidatePath("/sub-portal");
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

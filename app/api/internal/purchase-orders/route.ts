// Internal agent surface for purchase orders (MCP -> app bridge). The MCP
// server is plain JS and can't import the TS recompute/status logic, so it
// drives writes THROUGH this route — one source of truth for the same totals/
// status logic the browser uses. Guarded by a bearer token (CRON_SECRET), a
// trusted local caller, not a browser session.
//
// SAFETY: this route exposes create/update a draft PO, add/update/delete its
// lines, and queue it (mark "ready for review"). It has NO 'send' action and
// no 'record_receipt'/'close'/'void' action — emailing a vendor, receiving,
// and closing out stay owner-gated in lib/actions/purchase-orders.ts and are
// unreachable from any agent. See the safety note at the top of
// lib/purchase-orders-agent.ts.

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import {
  agentCreatePurchaseOrder,
  agentUpdatePurchaseOrder,
  agentAddLine,
  agentUpdateLine,
  agentDeleteLine,
  agentQueuePurchaseOrder,
} from "@/lib/purchase-orders-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false; // fail closed if unconfigured
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

/** Light audit so every agent mutation leaves a trace (mirrors doc-drafts / newsletter). */
async function audit(action: string, summary: string) {
  try {
    await query(
      `INSERT INTO agent_runs (runtime_name, status, input_summary, output_summary, finished_at)
       VALUES ('mcp:purchase-orders','succeeded',$1,$2, now())`,
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
  const num = (v: unknown) => (v == null ? undefined : Number(v));
  const str = (v: unknown) => (v == null ? undefined : String(v));

  try {
    let result: { ok: boolean; error?: string; [k: string]: unknown };

    switch (action) {
      case "create":
        result = await agentCreatePurchaseOrder({
          projectSlug: String(body.project_slug ?? ""),
          title: String(body.title ?? ""),
          notes: str(body.notes),
          vendorKind: str(body.vendor_kind),
          vendorId: str(body.vendor_id),
          subSlug: str(body.sub_slug),
          vendorName: String(body.vendor_name ?? ""),
          vendorEmail: str(body.vendor_email),
          vendorPhone: str(body.vendor_phone),
        });
        break;
      case "update":
        result = await agentUpdatePurchaseOrder(Number(body.id), { title: str(body.title), notes: str(body.notes) });
        break;
      case "add_line":
        result = await agentAddLine(Number(body.po_id), {
          description: String(body.description ?? ""),
          unit: str(body.unit),
          qtyOrdered: Number(body.qty_ordered ?? 0),
          unitCost: (body.unit_cost as string | number) ?? "0",
        });
        break;
      case "update_line":
        result = await agentUpdateLine(Number(body.id), {
          description: str(body.description),
          unit: str(body.unit),
          qtyOrdered: num(body.qty_ordered),
          unitCost: body.unit_cost as string | number | undefined,
        });
        break;
      case "delete_line":
        result = await agentDeleteLine(Number(body.id));
        break;
      case "queue":
        result = await agentQueuePurchaseOrder(Number(body.id));
        break;

      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }

    if (result.ok) {
      revalidatePath("/projects/[slug]", "page");
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

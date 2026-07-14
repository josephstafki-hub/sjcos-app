// Internal agent surface for document drafts (doc-templates plan, Phase 4).
// The MCP server (plain JS, can't import the TS templates/renderer) drives the
// draft lifecycle THROUGH this route so there is one source of truth for the
// field manifest, validation, and rendering. Guarded by a bearer token
// (CRON_SECRET) since it's a trusted local caller, not a browser session.
//
// SAFETY: this route exposes create / get / list / update / render only. It has
// NO 'submit' action — sending for signature is owner-gated in
// lib/actions/doc-drafts.ts and is unreachable from any agent. All field edits
// here run with actor 'ai', so the manifest blocks writes to money/date/enum/
// statutory fields (narratives only).

import { NextResponse } from "next/server";
import {
  listDocTemplates,
  createDocDraft,
  getDocDraft,
  listDocDrafts,
  updateDocDraftFields,
  renderDocDraft,
} from "@/lib/doc-drafts";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

/** Light audit so every agent mutation leaves a trace (plan Phase 4). */
async function audit(action: string, summary: string) {
  try {
    await query(
      `INSERT INTO agent_runs (runtime_name, status, input_summary, output_summary, finished_at)
       VALUES ('mcp:doc-drafts','succeeded',$1,$2, now())`,
      [action, summary],
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

  try {
    switch (action) {
      case "list_templates":
        return NextResponse.json({ ok: true, templates: listDocTemplates() });

      case "create": {
        const templateKey = String(body.template_key ?? "");
        const scope = {
          slug: body.project_slug ? String(body.project_slug) : undefined,
          leadSlug: body.lead_slug ? String(body.lead_slug) : undefined,
          estimateId: num(body.estimate_id),
          invoiceId: num(body.invoice_id),
          changeOrderId: num(body.change_order_id),
        };
        const res = await createDocDraft(templateKey, scope, { createdVia: "mcp" });
        if (res.ok) await audit("create", `draft ${res.id} (${templateKey})`);
        return NextResponse.json(res);
      }

      case "get": {
        const d = await getDocDraft(Number(body.id));
        return d
          ? NextResponse.json({ ok: true, draft: d })
          : NextResponse.json({ ok: false, error: `Draft ${body.id} not found.` }, { status: 404 });
      }

      case "list": {
        const drafts = await listDocDrafts({
          slug: body.project_slug ? String(body.project_slug) : undefined,
          leadSlug: body.lead_slug ? String(body.lead_slug) : undefined,
        });
        return NextResponse.json({ ok: true, drafts });
      }

      case "update": {
        const edits = (body.edits ?? {}) as Record<string, unknown>;
        const res = await updateDocDraftFields(Number(body.id), edits, "ai");
        if (res.ok) await audit("update", `draft ${body.id}: ${Object.keys(edits).join(", ")}`);
        return NextResponse.json(res);
      }

      case "render": {
        const res = await renderDocDraft(Number(body.id));
        if (res.ok) await audit("render", `draft ${body.id} → pdf ${res.pdfFileId}`);
        return NextResponse.json(res);
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown action '${action}'.` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

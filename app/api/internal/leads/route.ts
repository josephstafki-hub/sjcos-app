// Internal bridge (MCP → app) for LEAD IMPORT. For now web leads land in
// Joe's email inbox; Hermes parses each one and imports it here. The MCP
// server runs in its own process, so its import_lead tool reports to this
// route instead of importing lib/intake directly — same shape as the
// notify-owner / runbooks bridges. Bearer-gated with CRON_SECRET (trusted
// local caller, not a browser session and NOT the website's intake token).
//
// Actions:
//   import — create an inbound lead through createInboundLead, the single
//            funnel every inbound source uses: flexible intake rows, AI
//            scoring, chat room, feed card, and (W6) the intake-runbook
//            auto-start. Guards against re-importing the same email thread:
//            an existing non-lost lead with the same email refuses unless
//            allow_duplicate is set.

import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { createInboundLead, type InboundLead } from "@/lib/intake";
import { runDirect } from "@/lib/commands/db";
import { matchIntake } from "@/lib/leads/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false; // fail closed if unconfigured
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
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
  const str = (k: string) => {
    const v = body[k];
    return v == null ? undefined : String(v).trim() || undefined;
  };
  try {
    switch (action) {
      case "import": {
        const name = str("name");
        if (!name) return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });

        const email = str("email");
        const phone = str("phone");
        // Same person already a lead? Email or phone (lib/leads/match.ts):
        // one match → work that lead; several that disagree → a review row,
        // never a guessed merge.
        if ((email || phone) && body.allow_duplicate !== true) {
          const m = await matchIntake(runDirect, { email, phone, name }, { payload: { name, email, phone, source: str("source") ?? null } });
          if (m.kind === "review") {
            return NextResponse.json({
              ok: false,
              error: `${m.reason} Leads: ${m.candidates.map((c) => c.slug).join(", ")}. Logged for review (#${m.reviewId}); ask Joe which one, or re-send with allow_duplicate: true if it's a new project.`,
              candidates: m.candidates.map((c) => c.slug),
            });
          }
          const existing = m.kind === "matched" ? await queryOne<{ slug: string; name: string }>(`SELECT slug, name FROM leads WHERE id = $1`, [m.leadId]) : null;
          if (existing) {
            return NextResponse.json({
              ok: false,
              error:
                `A non-lost lead with this email or phone already exists: "${existing.name}" (${existing.slug}). ` +
                `Probably the same inquiry — work that lead instead, or re-send with allow_duplicate: true ` +
                `if this is genuinely a new project from the same person.`,
              existing_slug: existing.slug,
            });
          }
        }

        const extra: Record<string, string> = {};
        if (body.extra && typeof body.extra === "object") {
          for (const [k, v] of Object.entries(body.extra as Record<string, unknown>)) {
            if (v != null) extra[String(k).slice(0, 120)] = String(v).slice(0, 2000);
          }
        }
        const lead: InboundLead = {
          name,
          email,
          phone: str("phone"),
          project: str("project"),
          budget: str("budget"),
          timeline: str("timeline"),
          address: str("address"),
          message: str("message"),
          source: str("source") ?? "Email import (Hermes)",
          extra,
        };
        const { slug, verdict } = await createInboundLead(lead);

        // Report the auto-started intake runbook so the importer sees the
        // stepper is live (best-effort — the lead itself already committed).
        const instance = await queryOne<{ id: string; status: string }>(
          `SELECT ri.id, ri.status FROM runbook_instances ri
             JOIN leads l ON l.id = ri.lead_id
            WHERE l.slug = $1 AND ri.runbook_slug = 'lead-intake-to-qualified-or-declined'
            ORDER BY ri.started_at DESC LIMIT 1`,
          [slug],
        );
        return NextResponse.json({
          ok: true,
          slug,
          verdict,
          runbook_instance_id: instance?.id ?? null,
          runbook_status: instance?.status ?? null,
        });
      }
      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Internal error" }, { status: 500 });
  }
}

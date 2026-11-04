// Houzz exit inventory (A21 / INTEGRATIONS.md "Houzz exit checklist", V30).
// Pure `run(sql, params)` module: the /engine/houzz-exit page and
// scripts/houzz-export-inventory.mjs share it. It INVENTORIES and scores the
// five retirement criteria from evidence already in SJC OS; it never cancels,
// deletes or migrates anything. Joe retires the service by hand when every
// criterion holds — a merge or deploy of this code is not that decision.

import type { Run } from "./commands/core";
import { squareEnvironment } from "./payments/square";

export interface HouzzCriterion {
  n: 1 | 2 | 3 | 4 | 5;
  title: string;
  status: "met" | "not_met" | "needs_owner_evidence";
  evidence: string[];
  gaps: string[];
}

export interface HouzzExitInventory {
  generated_at: string;
  criteria: HouzzCriterion[];
  ready_to_cancel: boolean;
  invoices: { total: number; by_status: Record<string, number>; outstanding: Array<{ id: number; number: string; project: string; slug: string; milestone: string; amount_cents: number; sent_at: string | null; delivery: string | null }> };
  imported_history: { houzz_expenses: number; houzz_expense_cents: number; houzz_lead_imports: number; retainers_recorded: number };
  active_senders: Array<{ owner: string; what: string; state: string }>;
  code_references: string[];
  designer: { designs: number; versions: number; pinned_versions: number; exports: number };
}

async function count(run: Run, sql: string, params: unknown[] = []): Promise<number> {
  try {
    const [r] = await run<{ n: string }>(`SELECT count(*)::text AS n FROM (${sql}) s`, params);
    return Number(r?.n ?? 0);
  } catch {
    return 0;
  }
}

async function capability(run: Run, key: string): Promise<{ implemented: boolean; deployed: boolean; enabled: boolean; proven: boolean } | null> {
  try {
    const [r] = await run<{ implemented: boolean; deployed: boolean; enabled: boolean; proven: boolean }>(`SELECT implemented, deployed, enabled, proven FROM capability_status WHERE key = $1`, [key]);
    return r ?? null;
  } catch {
    return null;
  }
}

async function laneState(run: Run, lane: string): Promise<string> {
  try {
    const [r] = await run<{ n: string }>(`SELECT count(*)::text AS n FROM lane_pauses WHERE lane IN ($1, 'all')`, [lane]);
    return Number(r?.n ?? 0) > 0 ? "paused" : "open";
  } catch {
    return "unknown";
  }
}

export async function houzzExitInventory(run: Run): Promise<HouzzExitInventory> {
  const byStatusRows = await run<{ status: string; n: string }>(`SELECT status, count(*)::text AS n FROM invoices GROUP BY status`).catch(() => []);
  const by_status: Record<string, number> = {};
  for (const r of byStatusRows) by_status[r.status] = Number(r.n);
  const outstanding = await run<{ id: number; number: string; project: string; slug: string; milestone: string; amount_cents: number; sent_at: string | null; delivery: string | null }>(
    `SELECT i.id::int AS id, i.number, p.name AS project, p.slug, i.milestone, i.amount::int AS amount_cents, i.sent_at::text AS sent_at, i.delivery_state AS delivery
       FROM invoices i JOIN projects p ON p.id = i.project_id
      WHERE i.status = 'sent' ORDER BY i.sent_at NULLS LAST, i.id`,
  );
  const [hx] = await run<{ n: string; cents: string }>(`SELECT count(*)::text AS n, COALESCE(sum(amount_cents),0)::text AS cents FROM expenses WHERE source_ref LIKE 'houzz:%'`).catch(() => [{ n: "0", cents: "0" }]);
  const imported_history = {
    houzz_expenses: Number(hx?.n ?? 0),
    houzz_expense_cents: Number(hx?.cents ?? 0),
    houzz_lead_imports: await count(run, `SELECT 1 FROM sjc_temp_lead_imports WHERE lower(raw::text) LIKE '%houzz%'`),
    retainers_recorded: await count(run, `SELECT 1 FROM retainers WHERE collected > 0`),
  };
  const designer = {
    designs: await count(run, `SELECT 1 FROM plan_designs`),
    versions: await count(run, `SELECT 1 FROM plan_design_versions`),
    pinned_versions: await count(run, `SELECT 1 FROM document_revisions WHERE doc_kind = 'plan_design_version'`),
    exports: await count(run, `SELECT 1 FROM plan_design_files`),
  };
  const [square, qbo, a21, a20] = await Promise.all([capability(run, "feature.square"), capability(run, "feature.qbo"), capability(run, "A21"), capability(run, "A20")]);
  // Square is configured by env (SQUARE_ENV + SQUARE_ACCESS_TOKEN, lib/payments/square), not app settings.
  const squareMode = squareEnvironment();
  const active_senders = [
    { owner: "SJC OS delivery", what: "invoice emails, reminders, bid packages, POs, weekly summaries", state: `Delivery ${await laneState(run, "sends")}` },
    { owner: "SJC OS Square adapter", what: "card / ACH customer payments (checkout on the client portal)", state: squareMode === "fake" ? "not configured" : `configured (${squareMode})` },
    { owner: "SJC OS payments lane", what: "vendor payments (manual confirmation only — no rail)", state: `Payments ${await laneState(run, "payments")}` },
    { owner: "Houzz Pro (external)", what: "invoice payment links, reminders, design files — retired by hand", state: "owner-reported: still in use for online payment links" },
  ];
  const code_references = [
    "Imported Houzz estimates preserve the original client prices. Keep these records.",
    "Imported Houzz payment history is retained as evidence.",
  ];

  const crit: HouzzCriterion[] = [];
  // 1. Card + bank payment paths live with reconciliation.
  {
    const ev: string[] = [];
    const gaps: string[] = [];
    if (square?.proven) ev.push("Square payments verified on real work"); else gaps.push("Square payments have not been verified on a real job. Finish setup in Settings › Payments, then verify payments and reconciliation.");
    if (squareMode === "production") ev.push("Square production credentials configured");
    else gaps.push(squareMode === "sandbox" ? "Square is on sandbox credentials, not production" : "Square is not connected. Add your Square keys using the setup checklist in Settings › Payments.");
    if (qbo?.enabled) ev.push("QuickBooks sync enabled"); else gaps.push("QuickBooks reconciliation not enabled");
    if (a20?.proven) ev.push("Refunds and existing invoice payments verified"); else gaps.push("Refunds, returns and existing invoice payments still need verification");
    crit.push({ n: 1, title: "SJC/Square card and bank payments live and reconciled (refunds, returns, existing invoices)", status: gaps.length ? "not_met" : "met", evidence: ev, gaps });
  }
  // 2. Full designer meets real workflows.
  {
    const ev: string[] = [`${designer.designs} designs · ${designer.versions} versions · ${designer.pinned_versions} pinned · ${designer.exports} exported files`];
    const gaps: string[] = [];
    if (a21?.proven) ev.push("Designer verified on real projects"); else gaps.push("Needs your confirmation that saved and exported designs cover the work you do in Houzz");
    crit.push({ n: 2, title: "Full designer meets the agreed real project workflows with saved/exported data", status: gaps.length ? "not_met" : "met", evidence: ev, gaps });
  }
  // 3. Houzz records exported and linked.
  {
    const ev: string[] = [`${imported_history.houzz_expenses} Houzz payment records imported ($${(imported_history.houzz_expense_cents / 100).toFixed(2)})`, `${imported_history.houzz_lead_imports} Houzz lead imports staged`, `${imported_history.retainers_recorded} projects with a recorded retainer`];
    crit.push({ n: 3, title: "Houzz designs, invoices, payment history and client artifacts exported/preserved and linked to jobs", status: "needs_owner_evidence", evidence: ev, gaps: ["Design files and unsupported records must be exported from Houzz by hand and filed on the job (Files tab); list what could not be imported here before cancelling"] });
  }
  // 4. Outstanding payment links have a finish/migrate path.
  {
    const ev: string[] = [`${outstanding.length} invoice(s) sent and unpaid`];
    const gaps = outstanding.length ? [`Each of the ${outstanding.length} open invoice(s) needs a documented path: collect via the existing link, or re-issue the SAME amount through SJC OS once (never both)`] : [];
    crit.push({ n: 4, title: "Existing customer payment links and outstanding invoices have a documented finish/migrate path (no duplicate collection, no changed amount)", status: outstanding.length ? "needs_owner_evidence" : "met", evidence: ev, gaps });
  }
  // 5. One system owns each outbound action.
  {
    const ev = active_senders.map((s) => `${s.owner}: ${s.what} — ${s.state}`);
    const gaps = ["Confirm Houzz reminders/automations are switched off before SJC OS invoice reminders run for the same client", ...code_references.slice(0, 1)];
    crit.push({ n: 5, title: "Old reminders, integrations and payment senders inventoried; one system owns each active outbound action", status: "needs_owner_evidence", evidence: ev, gaps });
  }
  return {
    generated_at: new Date().toISOString(),
    criteria: crit,
    ready_to_cancel: crit.every((c) => c.status === "met"),
    invoices: { total: Object.values(by_status).reduce((a, b) => a + b, 0), by_status, outstanding },
    imported_history,
    active_senders,
    code_references,
    designer,
  };
}

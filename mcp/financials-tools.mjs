// SJC OS MCP — project financials (job costing). Wired from sjcos-mcp.mjs:
//
//   import { registerFinancialsTools } from "./financials-tools.mjs";
//   registerFinancialsTools(server, { rows, json, pool, strippedDollarError });
//
// docs/project-financials-plan.md §8. Read tools (what a job is priced at, has
// cost, should make, and what those numbers rest on) and the write tools an
// agent needs to fill a job in from documents: budget lines, settings, payers,
// expenses, sub invoices, filing a cost under a trade, linking a bill to its PO.
//
// These are INTERNAL records — no owner grant, nothing is sent. Two hard lines:
//   • No tool here creates a change order or moves one out of draft. The client
//     portal lists every non-draft change order (plan §14 #19).
//   • No tool flips a job's billing source. `propose_billing_reconciliation`
//     shows the numbers; the switch is the owner's reviewed step in the app.
// Every import-shaped write is idempotent on a stable key (a line's `key`, a
// cost's `source_ref`), so a retried import changes nothing.
//
// Runtime note: like floor-tools.mjs this is plain Node ESM importing the pure
// TypeScript libs directly (Node 22 strips types unflagged; every lib/budget-*.ts
// imports its siblings with a `.ts` extension for exactly this). The app and
// this server therefore run the SAME queries and the SAME math — only
// lib/budget.ts and lib/actions/budget.ts ("server-only" / "use server") are
// off limits here.
//
// MONEY IS INTEGER CENTS in every field of every result. (projects.contract_value
// and collected_to_date are whole dollars in the DB; they are converted before
// anything leaves this module.)

import { z } from "zod";
import { assembleBudgetView } from "../lib/budget-assemble.ts";
import { buildCompanyMoney } from "../lib/budget-company.ts";
import { findProjects, loadRawProjectMoney, todayCentral } from "../lib/budget-queries.ts";
import { computeTotals, describeFinancials, proposeBillingReconciliation } from "../lib/budget-types.ts";
import * as writes from "../lib/budget-writes.ts";

const pct = (r) => (r == null ? null : Math.round(r * 1000) / 10);

function projectPayload(view) {
  const t = computeTotals(view);
  const needsReconcile = view.billing.source === "manual" && view.billing.invoiceCount > 0;
  return {
    project: view.project,
    as_of: view.asOfLabel,
    units: "every *_cents field is integer cents; *_pct is a percentage",
    summary: describeFinancials(view, t),
    completeness: {
      profit: view.completeness.profit,
      budget_covers_whole_job: view.completeness.budget,
      costs_through: view.completeness.costsThrough,
      billing: view.completeness.billing,
      based_on: view.completeness.basedOn,
      missing: view.completeness.missing,
    },
    price: {
      price_cents: t.priceCents,
      base_price_cents: t.basePriceCents,
      change_orders_net_cents: t.coNetCents,
      pending_change_orders_cents: t.coPendingCents,
    },
    cost: {
      spent_cents: t.paidCents,
      owed_cents: t.owedCents,
      on_order_cents: t.orderedCents,
      still_to_spend_cents: t.estToFinishCents,
      projected_cost_cents: t.projectedCostCents,
      cost_so_far_cents: t.costSoFarCents,
      budget_cost_cents: t.budgetCostCents + t.coBudgetCostCents,
      cost_headroom_cents: t.costHeadroomCents,
      on_unsigned_change_orders_cents: t.unsignedCoCostCents,
      unassigned_cents: view.unassigned.paidCents + view.unassigned.owedCents + view.unassigned.orderedCents,
    },
    profit: {
      status: view.completeness.profit,
      projected_profit_cents: t.projectedProfitCents,
      planned_profit_cents: t.plannedProfitCents,
      margin_pct: pct(t.marginPct),
      planned_margin_pct: pct(t.plannedMarginPct),
    },
    progress: { work_done_by_cost_pct: pct(t.workDonePct), earned_cents: t.earnedCents },
    billing: {
      source: view.billing.source,
      collected_cents: t.collectedCents,
      left_to_collect_cents: t.leftToCollectCents,
      unpaid_invoices_cents: t.unpaidInvoicesCents,
      billed_cents: t.billedCents,
      left_to_bill_cents: t.leftToBillCents,
      billed_ahead_of_work_cents: t.overUnderBilledCents,
      opening_collected_cents: view.billing.openingCollectedCents,
      hand_kept_collected_cents: view.billing.handKeptCollectedCents,
      paid_invoices_cents: view.billing.paidInvoicesCents,
      mismatch_cents: view.billing.mismatchCents,
      mismatch_flagged: view.billing.mismatchFlagged,
      reconciliation_proposal: needsReconcile ? proposeBillingReconciliation(view.billing) : null,
    },
    who_pays: t.paidBy.map((p) => ({ party: p.label, amount_cents: p.amountCents, is_owner: p.isOwner })),
    lines: view.lines.map((l, i) => ({
      key: l.id, trade: l.trade, kind: l.kind, status: l.status ?? null,
      budget_cents: l.budgetCents, price_cents: l.priceCents ?? null,
      spent_cents: l.paidCents, owed_cents: l.owedCents, on_order_cents: l.orderedCents,
      still_to_spend_cents: t.lines[i].estCents, still_to_spend_derived: t.lines[i].estDerived,
      projected_cents: t.lines[i].projectedCents, variance_cents: t.lines[i].varianceCents,
      margin_cents: t.lines[i].marginCents, percent_complete: l.percentComplete ?? null,
      credited_to: l.creditedTo ?? null, credit_in_effect: t.lines[i].credited, flags: l.flags ?? [],
    })),
    change_orders: view.changeOrders.map((c, i) => ({
      number: c.id, title: c.title, status: c.status, counted: t.changeOrders[i].counted,
      total_cents: c.totalCents, credit_cents: t.changeOrders[i].creditCents, net_to_client_cents: t.changeOrders[i].netPriceCents,
      billed_cents: c.billedCents, budget_cost_cents: c.budgetCostCents ?? null,
      spent_cents: c.paidCents, owed_cents: c.owedCents, on_order_cents: c.orderedCents,
      still_to_spend_cents: t.changeOrders[i].estCents, cost_not_planned: t.changeOrders[i].notPlanned,
      margin_cents: t.changeOrders[i].marginCents, age_days: c.ageDays ?? null,
    })),
    costs: view.costs.map((r) => ({
      source: r.source, id: r.sourceId, vendor: r.vendor, date: r.dateLabel, status: r.status, note: r.note ?? null,
      amount_cents: r.amountCents, counts_as: { spent_cents: r.paidCents, owed_cents: r.owedCents, on_order_cents: r.orderedCents },
      assigned_to: r.key ?? null, bills_against_po: r.poNumber ?? r.purchaseOrderId ?? null,
      source_ref: r.sourceRef ?? null, flags: r.flags ?? [],
    })),
    client_invoices: view.clientInvoices.map((i) => ({
      number: i.number, label: i.label, amount_cents: i.amountCents, status: i.status, status_label: i.statusLabel,
      days_outstanding: i.daysOutstanding ?? null,
    })),
    funding_events: view.fundingEvents,
    notes: view.notes ?? [],
  };
}

const jobRow = (r) => ({
  slug: r.slug, name: r.name, stage: r.stage, profit_status: r.profitStatus, billing: r.billing,
  price_cents: r.priceCents, cost_cents: r.costCents, cost_is_so_far: r.costIsSoFar,
  profit_cents: r.profitCents, margin_pct: pct(r.marginPct), work_done_by_cost_pct: pct(r.workDonePct),
  collected_cents: r.collectedCents, unpaid_invoices_cents: r.unpaidInvoicesCents, left_to_collect_cents: r.leftToCollectCents,
  headline: r.headline,
});
const totalsRow = (c) => ({
  jobs: c.jobCount, contracted_cents: c.contractedCents, collected_cents: c.collectedCents,
  left_to_collect_cents: c.leftToCollectCents, unpaid_invoices_cents: c.unpaidInvoicesCents,
  billing_tracked_on_jobs: c.billingTrackedJobs,
  profit_cents: c.profitCents, profit_known_on_jobs: c.profitJobs, of_which_projected: c.projectedJobs,
  of_which_planned: c.plannedJobs, profit_covers_price_cents: c.profitPriceCoverageCents,
  blended_margin_pct: pct(c.blendedMarginPct), unbilled_work_cents: c.unbilledCents, unbilled_known_on_jobs: c.unbilledJobs,
});

/** The open-jobs block of business_snapshot: the same totals `company_financials` reports. */
export async function openJobsSnapshot(rows) {
  const projects = await findProjects(rows, "all");
  const raw = await loadRawProjectMoney(rows, projects.map((p) => p.id));
  const asOf = todayCentral();
  return totalsRow(buildCompanyMoney(projects.map((p) => assembleBudgetView(raw.get(p.id), { asOf }))).totals);
}

export function registerFinancialsTools(server, { rows, json, pool, strippedDollarError }) {
  /** One write = one transaction against one job. Commits only on `ok`, then
   *  logs the change so open browser tabs refresh (as rows() does for plain writes). */
  async function write(projectSlug, texts, fn) {
    const mangled = strippedDollarError(...texts.filter((t) => typeof t === "string"));
    if (mangled) return mangled;
    const client = await pool.connect();
    try {
      const run = async (sql, params) => (await client.query(sql, params)).rows;
      const [project] = await run(`SELECT id FROM projects WHERE slug = $1`, [projectSlug]);
      if (!project) return json({ ok: false, error: `No project with slug "${projectSlug}"` });
      await client.query("BEGIN");
      const result = await fn(run, project.id);
      await client.query(result.ok ? "COMMIT" : "ROLLBACK");
      if (result.ok) await pool.query(`INSERT INTO app_change_log (scope, source) VALUES ('budget_lines', 'mcp')`).catch(() => {});
      return json(result);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      return json({ ok: false, error: String(err?.message ?? err) });
    } finally {
      client.release();
    }
  }
  /** `line_key` / `co_number` → the row a cost is filed under. Both absent →
   *  undefined: on a new cost that means unassigned; on a re-import it means
   *  "keep the filing someone already did". assign_cost turns it into null. */
  async function targetOf(run, projectId, a) {
    if (a.line_key) {
      const [l] = await run(`SELECT id FROM budget_lines WHERE project_id = $1 AND key = $2`, [projectId, a.line_key]);
      if (!l) throw new Error(`No budget line with key "${a.line_key}" on this job. Call get_project_financials to see the keys.`);
      return { kind: "line", id: Number(l.id) };
    }
    if (a.co_number) {
      const [c] = await run(`SELECT id FROM change_orders WHERE project_id = $1 AND (number = $2 OR 'CO-' || id = $2)`, [projectId, a.co_number]);
      if (!c) throw new Error(`No change order "${a.co_number}" on this job.`);
      return { kind: "co", id: Number(c.id) };
    }
    return undefined;
  }
  const cents = z.number().int().describe("integer cents");

  server.registerTool(
    "get_project_financials",
    {
      title: "Get a project's financials",
      description:
        "What one job is priced at, what it has cost, what it should make, how far along it is, and what those " +
        "numbers rest on. Returns plain-English summary sentences, price / cost / profit / progress / billing totals, " +
        "every budget line with its spent · owed · on order · still to spend, change orders, the cost ledger " +
        "(sub invoices, POs, expenses — each counted once), client invoices and notes. ALL MONEY IS INTEGER CENTS. " +
        "`completeness.profit` is 'unknown' until the budget covers the whole job: then no profit or margin is " +
        "given, only cost so far — do not compute one yourself. `billing.source` 'manual' means collected is the " +
        "hand-kept total and billed is unknown. Read-only.",
      inputSchema: { project_slug: z.string() },
    },
    async ({ project_slug }) => {
      const [project] = await findProjects(rows, { slug: project_slug });
      if (!project) return json({ error: `No project with slug "${project_slug}"` });
      const money = (await loadRawProjectMoney(rows, [project.id])).get(project.id);
      return json(projectPayload(assembleBudgetView(money, { asOf: todayCentral() })));
    },
  );

  server.registerTool(
    "company_financials",
    {
      title: "Company financials across all jobs",
      description:
        "Every job side by side: price, cost, profit, margin, work done, collected, unpaid invoices and left to " +
        "collect — open jobs and closed (warranty) jobs separately — plus company totals and a needs-attention " +
        "list, most money first. Totals sum ONLY what is known and say their coverage: profit and blended margin " +
        "cover just the jobs whose profit is known (`profit_known_on_jobs`, `profit_covers_price_cents`), never " +
        "the price of jobs with no budget. `left_to_collect` is price minus collected and includes unbilled work — " +
        "it is not receivables; `unpaid_invoices` is. ALL MONEY IS INTEGER CENTS. Read-only.",
      inputSchema: {},
    },
    async () => {
      const projects = await findProjects(rows, "all");
      const raw = await loadRawProjectMoney(rows, projects.map((p) => p.id));
      const asOf = todayCentral();
      const company = buildCompanyMoney(projects.map((p) => assembleBudgetView(raw.get(p.id), { asOf })));
      return json({
        as_of: asOf,
        units: "every *_cents field is integer cents; *_pct is a percentage",
        open_totals: totalsRow(company.totals),
        closed_totals: totalsRow(company.closedTotals),
        needs_attention: company.attention.map((a) => ({ slug: a.slug, job: a.name, kind: a.kind, what: a.text, amount_cents: a.amountCents })),
        open_jobs: company.open.map(jobRow),
        closed_jobs: company.closed.map(jobRow),
      });
    },
  );

  // ─── Write tools ───────────────────────────────────────────────────────────

  server.registerTool(
    "adopt_estimate_as_budget",
    {
      title: "Use a job's approved estimate as its budget",
      description:
        "One budget line per estimate section: budget = what the section costs (qty × unit cost), price = what the " +
        "client pays for it. Uses the job's approved estimate unless `estimate_id` names another of its estimates. " +
        "Refuses if the job already has lines unless `replace` — a re-sync upserts by key and never deletes a line. " +
        "IMPORTANT: an estimate with NO markup (the Houzz imports carry client prices as costs) yields lines and " +
        "prices but leaves the budget unconfirmed, so no profit is claimed; the result's `warning` says so. Set real " +
        "costs with set_budget_lines, then set_budget_settings { budget_complete: true }.",
      inputSchema: { project_slug: z.string(), estimate_id: z.number().int().optional(), replace: z.boolean().optional() },
    },
    (a) => write(a.project_slug, [], (run, projectId) => writes.adoptEstimateAsBudget(run, { projectId, estimateId: a.estimate_id, replace: a.replace })),
  );

  server.registerTool(
    "set_budget_lines",
    {
      title: "Set a job's budget lines",
      description:
        "Upsert budget lines by `key` (a stable slug; derived from `trade` when omitted). One line per trade as the " +
        "payer sees it — an estimate's sections, an insurer's categories — not per invoice. `budget_cents` is what " +
        "the trade should COST SJC; `price_cents` is what the client pays for it (omit if not priced by trade). " +
        "`est_to_finish_cents`: omit to derive (budget less what's spent, owed and on order); 0 = nothing left. " +
        "`percent_complete` only when cost misleads (material paid for, not installed); 100 marks it complete. Work " +
        "that must happen but was never budgeted still gets a line, at budget 0. On an existing line, fields you " +
        "leave out keep their values. mode 'replace' also removes lines not listed — and REFUSES if any of those " +
        "has costs filed under it. Spent / owed / on order are never set here: they come from the costs. ALL MONEY " +
        "IS INTEGER CENTS.",
      inputSchema: {
        project_slug: z.string(),
        mode: z.enum(["merge", "replace"]).optional(),
        lines: z.array(z.object({
          key: z.string().optional(), trade: z.string(),
          kind: z.enum(["trade", "allowance", "overhead", "tax", "contingency", "other"]).optional(),
          budget_cents: cents, price_cents: cents.nullable().optional(), est_to_finish_cents: cents.nullable().optional(),
          percent_complete: z.number().int().min(0).max(100).nullable().optional(),
          status: z.string().optional(), status_kind: z.enum(["ghost", "accent", "money", "flag", "info"]).optional(),
          detail: z.string().optional(), source: z.string().optional(), flags: z.array(z.string()).optional(),
        })).min(1),
      },
    },
    (a) => write(a.project_slug, a.lines.flatMap((l) => [l.trade, l.status, l.detail, l.source, ...(l.flags ?? [])]), (run, projectId) =>
      writes.setBudgetLines(run, projectId, a.lines.map((l) => {
        const spec = { key: l.key, trade: l.trade, kind: l.kind, budgetCents: l.budget_cents, status: l.status, statusKind: l.status_kind, detail: l.detail, source: l.source, flags: l.flags };
        // Only carry a field the caller actually sent: "left out" keeps the old value, null clears it.
        if ("price_cents" in l) spec.priceCents = l.price_cents;
        if ("est_to_finish_cents" in l) spec.estToFinishCents = l.est_to_finish_cents;
        if ("percent_complete" in l) spec.percentComplete = l.percent_complete;
        return spec;
      }), a.mode ?? "merge")),
  );

  server.registerTool(
    "set_budget_settings",
    {
      title: "Set a job's budget settings",
      description:
        "Change only what you pass. `budget_complete: true` is the claim that the lines cover the WHOLE job with " +
        "real costs — it is what allows a profit to be shown, so set it only when that is true. `costs_through` " +
        "(YYYY-MM-DD) is the date the sub invoices and receipts you entered run to. `price_cents` is the base price " +
        "EXCLUDING change orders; set it when the hand-kept contract total already includes them; null = use the " +
        "approved estimate / contract. `notes` REPLACES the list: assumptions, open questions, next moves — one per " +
        "item. Does not touch billing.",
      inputSchema: {
        project_slug: z.string(),
        basis: z.enum(["fixed_price", "insurance", "cost_plus", "time_materials"]).optional(),
        budget_label: z.string().optional(), budget_caption: z.string().optional(),
        price_cents: cents.nullable().optional(), retainage_cents: cents.optional(),
        budget_complete: z.boolean().optional(), costs_through: z.string().nullable().optional(),
        notes: z.array(z.string()).optional(),
      },
    },
    (a) => write(a.project_slug, [a.budget_label, a.budget_caption, ...(a.notes ?? [])], (run, projectId) => {
      const patch = {};
      if ("basis" in a) patch.basis = a.basis;
      if ("budget_label" in a) patch.budgetLabel = a.budget_label;
      if ("budget_caption" in a) patch.budgetCaption = a.budget_caption;
      if ("price_cents" in a) patch.priceCents = a.price_cents;
      if ("retainage_cents" in a) patch.retainageCents = a.retainage_cents;
      if ("budget_complete" in a) patch.budgetComplete = a.budget_complete;
      if ("costs_through" in a) patch.costsThrough = a.costs_through;
      if ("notes" in a) patch.notes = a.notes;
      return writes.patchBudgetSettings(run, projectId, patch);
    }),
  );

  server.registerTool(
    "set_budget_parties",
    {
      title: "Set who pays for a job's base price",
      description:
        "REPLACES the list of payers. A plain fixed-price job needs none (the client pays everything). Insurance: " +
        "the insurer at the net claim plus the client at the deductible. Lender: the lender at the loan plus the " +
        "client at the down payment. Shares should add up to the base price; a shortfall shows as unfunded and " +
        "lands on the client. At most one payer has is_owner (the client).",
      inputSchema: {
        project_slug: z.string(),
        parties: z.array(z.object({ key: z.string(), label: z.string(), base_share_cents: cents, is_owner: z.boolean().optional() })),
      },
    },
    (a) => write(a.project_slug, a.parties.map((p) => p.label), (run, projectId) =>
      writes.saveParties(run, projectId, a.parties.map((p) => ({ key: p.key, label: p.label, baseShareCents: p.base_share_cents, isOwner: p.is_owner })))),
  );

  server.registerTool(
    "set_funding_events",
    {
      title: "Set a job's expected payments",
      description:
        "REPLACES the list of expected inflows and what triggers each: insurance payments, lender draws, deposits. " +
        "`party_key` matches a payer's key. Empty on a plain fixed-price job.",
      inputSchema: {
        project_slug: z.string(),
        events: z.array(z.object({ party_key: z.string(), source: z.string(), amount_cents: cents, trigger: z.string().optional(), status: z.enum(["expected", "requested", "received"]) })),
      },
    },
    (a) => write(a.project_slug, a.events.flatMap((e) => [e.source, e.trigger]), (run, projectId) =>
      writes.saveFundingEvents(run, projectId, a.events.map((e) => ({ partyKey: e.party_key, source: e.source, amountCents: e.amount_cents, trigger: e.trigger, status: e.status })))),
  );

  server.registerTool(
    "add_expense",
    {
      title: "Log an expense on a job",
      description:
        "A direct cost SJC paid: a receipt, a card charge, a check, Joe's own labor (kind 'labor'). Counts as SPENT. " +
        "File it under a trade (`line_key`) or a change order (`co_number`); with neither it is unassigned — still " +
        "counted, and flagged. If it is a payment on a purchase order pass `po_id`, or the order and the payment " +
        "count twice. ALWAYS pass a `source_ref` when importing from a document (e.g. 'receipt:menards-0912'): " +
        "logging the same ref again UPDATES that expense instead of adding another — the document's fields " +
        "(date, vendor, amount, memo) are replaced, while a trade or PO filing someone did since is KEPT unless " +
        "you pass it. Negative amount = a return. " +
        "Not for a bill from a sub — use record_sub_invoice, which can be owed or part-paid.",
      inputSchema: {
        project_slug: z.string(), date: z.string().describe("YYYY-MM-DD"), vendor: z.string(),
        kind: z.enum(["labor", "material", "sub", "equipment", "permit", "other"]), amount_cents: cents,
        memo: z.string().optional(), paid_from: z.enum(["checking", "card", "cash"]).optional(),
        line_key: z.string().optional(), co_number: z.string().optional(), po_id: z.number().int().optional(), source_ref: z.string().optional(),
      },
    },
    (a) => write(a.project_slug, [a.vendor, a.memo], async (run, projectId) =>
      writes.saveExpense(run, projectId, {
        date: a.date, vendorLabel: a.vendor, kind: a.kind, amountCents: a.amount_cents, memo: a.memo, paidFrom: a.paid_from ?? "card",
        target: await targetOf(run, projectId, a), purchaseOrderId: a.po_id, sourceRef: a.source_ref,
      })),
  );

  server.registerTool(
    "record_sub_invoice",
    {
      title: "Record a bill from a sub or vendor",
      description:
        "A paper or emailed invoice the sub portal never saw. Name a roster sub with `sub_slug` (see list_subs) or, " +
        "for someone outside the roster, `vendor_label`. status 'approved' (default) = owed; 'paid' = spent; a " +
        "deposit or part payment = `paid_cents` with status approved (the rest shows as owed). File it under a " +
        "trade (`line_key`) or change order (`co_number`). Every dollar a sub invoiced goes on exactly ONE line or " +
        "CO: split a bill that covers two into two records with their own source_refs. If it bills a purchase " +
        "order pass `po_id` so they count once. ALWAYS pass `source_ref` (e.g. 'cpk:1745'): the same ref again " +
        "UPDATES the record — the document's fields (vendor, amount, date, note) are replaced, while its payment " +
        "state and filing (status, paid_cents, trade, PO) are KEPT unless you pass them, so re-importing an " +
        "invoice never undoes a payment recorded since. Note: a roster sub with invoices and no W-9 on file " +
        "gets a W-9 work item.",
      inputSchema: {
        project_slug: z.string(), sub_slug: z.string().optional(), vendor_label: z.string().optional(), amount_cents: cents,
        date: z.string().optional().describe("YYYY-MM-DD"), note: z.string().optional(),
        status: z.enum(["submitted", "approved", "paid"]).optional(), paid_cents: cents.optional(),
        line_key: z.string().optional(), co_number: z.string().optional(), po_id: z.number().int().optional(), source_ref: z.string().optional(),
      },
    },
    (a) => write(a.project_slug, [a.vendor_label, a.note], async (run, projectId) =>
      writes.recordSubInvoice(run, projectId, {
        subSlug: a.sub_slug, vendorLabel: a.vendor_label, amountCents: a.amount_cents, date: a.date ?? null, note: a.note,
        status: a.status, paidCents: a.paid_cents, target: await targetOf(run, projectId, a), purchaseOrderId: a.po_id, sourceRef: a.source_ref,
      })),
  );

  server.registerTool(
    "set_sub_invoice_status",
    {
      title: "Approve, part-pay or mark a sub invoice paid",
      description: "`id` from get_project_financials costs[] where source = 'sub_invoice'. 'paid' counts the whole invoice as spent; `paid_cents` with 'approved' records a part payment.",
      inputSchema: { project_slug: z.string(), id: z.number().int(), status: z.enum(["submitted", "approved", "paid"]), paid_cents: cents.optional() },
    },
    (a) => write(a.project_slug, [], (run, projectId) => writes.setSubInvoicePayment(run, projectId, { id: a.id, status: a.status, paidCents: a.paid_cents })),
  );

  server.registerTool(
    "assign_cost",
    {
      title: "File a cost under a trade or change order",
      description: "`source` and `id` from get_project_financials costs[]. Pass `line_key` or `co_number`; pass neither to un-assign (it still counts, as unassigned).",
      inputSchema: { project_slug: z.string(), source: z.enum(["sub_invoice", "po", "expense"]), id: z.number().int(), line_key: z.string().optional(), co_number: z.string().optional() },
    },
    (a) => write(a.project_slug, [], async (run, projectId) => writes.assignCost(run, projectId, { source: a.source, id: a.id, target: (await targetOf(run, projectId, a)) ?? null })),
  );

  server.registerTool(
    "link_cost_to_po",
    {
      title: "Say which purchase order a bill or payment is against",
      description: "So an order and its bill count once. `po_id` from list_purchase_orders; omit it to unlink. Look for the 'possible duplicate' flag in get_project_financials costs[].",
      inputSchema: { project_slug: z.string(), source: z.enum(["sub_invoice", "expense"]), id: z.number().int(), po_id: z.number().int().optional() },
    },
    (a) => write(a.project_slug, [], (run, projectId) => writes.linkCostToPurchaseOrder(run, projectId, { source: a.source, id: a.id, purchaseOrderId: a.po_id ?? null })),
  );

  server.registerTool(
    "set_change_order_costs",
    {
      title: "Set the budget side of an existing change order",
      description:
        "Planned cost, remaining cost, who pays, and the base-scope trades it replaces. NEVER the change order's " +
        "price or status — creating one and sending it for signature stay in the app, because the client portal " +
        "shows every change order that is not a draft. `budget_cost_cents` null = not planned, so it is assumed to " +
        "cost its full price (no profit). `credits` REPLACES the list: each names a trade by `line_key` and the " +
        "price credited back to the client; the trade drops out of the cost only once the CO is signed. A trade " +
        "can be credited on ONE change order — this refuses if another already credits it. Cost " +
        "already incurred on a CO is never typed here — file it with assign_cost / add_expense / record_sub_invoice.",
      inputSchema: {
        project_slug: z.string(), co_number: z.string(),
        budget_cost_cents: cents.nullable().optional(), est_to_finish_cents: cents.nullable().optional(),
        paid_by: z.enum(["owner", "funder", "split"]).optional(), funder_share_cents: cents.optional(),
        credits: z.array(z.object({ line_key: z.string(), amount_cents: cents })).optional(),
      },
    },
    (a) => write(a.project_slug, [], async (run, projectId) => {
      const co = await targetOf(run, projectId, { co_number: a.co_number });
      const [cur] = await run(`SELECT paid_by, funder_share_cents, budget_cost_cents, est_to_finish_cents FROM change_orders WHERE id = $1`, [co.id]);
      const curCredits = await run(`SELECT budget_line_id, amount_cents FROM change_order_credits WHERE change_order_id = $1`, [co.id]);
      const credits = [];
      for (const c of a.credits ?? []) credits.push({ lineId: (await targetOf(run, projectId, { line_key: c.line_key })).id, amountCents: c.amount_cents });
      return writes.saveChangeOrderCosts(run, projectId, {
        id: co.id,
        paidBy: a.paid_by ?? cur.paid_by, funderShareCents: a.funder_share_cents ?? Number(cur.funder_share_cents),
        budgetCostCents: "budget_cost_cents" in a ? a.budget_cost_cents : cur.budget_cost_cents,
        estToFinishCents: "est_to_finish_cents" in a ? a.est_to_finish_cents : cur.est_to_finish_cents,
        credits: "credits" in a ? credits : curCredits.map((c) => ({ lineId: Number(c.budget_line_id), amountCents: Number(c.amount_cents) })),
      });
    }),
  );

  server.registerTool(
    "propose_billing_reconciliation",
    {
      title: "Show what reconciling a job's billing would do",
      description:
        "READ ONLY. A job's Collected figure is either the hand-kept projects.collected_to_date ('manual', the " +
        "default) or an opening balance plus the paid invoices in SJC OS. Nothing keeps those two in step, so they " +
        "can disagree. This returns both side by side and the opening balance that would make the switch change " +
        "nothing. It does NOT switch: that is Joe's reviewed step (project › Money › Overview › Reconcile billing). " +
        "If the documents show collections the invoices lack, tell Joe with ask_owner or create_work_item.",
      inputSchema: { project_slug: z.string() },
    },
    async ({ project_slug }) => {
      const [project] = await findProjects(rows, { slug: project_slug });
      if (!project) return json({ error: `No project with slug "${project_slug}"` });
      const view = assembleBudgetView((await loadRawProjectMoney(rows, [project.id])).get(project.id), { asOf: todayCentral() });
      const p = proposeBillingReconciliation(view.billing);
      return json({
        project: view.project, billing_source: view.billing.source, invoices_on_file: view.billing.invoiceCount,
        hand_kept_collected_cents: p.handKeptCents, paid_invoices_cents: p.paidInvoicesCents, difference_cents: p.differenceCents,
        proposed_opening_collected_cents: p.proposedOpeningCollectedCents, proposed_opening_billed_cents: p.proposedOpeningBilledCents,
        hand_kept_looks_stale: p.handKeptLooksStale,
        how_to_apply: "Joe reviews and applies it in the app: project › Money › Overview › Reconcile billing. No tool can.",
      });
    },
  );
}

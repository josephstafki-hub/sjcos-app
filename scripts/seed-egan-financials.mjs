#!/usr/bin/env node
// SJC OS — seed the Molly Egan job's financials from Joe's packet
// (lib/budget-fixtures.ts EGAN_RAW) into the project-financials tables, and
// PROVE the result before anything is kept.
//
//   node scripts/seed-egan-financials.mjs                  # DRY RUN: write, verify, ROLL BACK
//   node scripts/seed-egan-financials.mjs --approve        # write, verify, COMMIT
//   node scripts/seed-egan-financials.mjs --undo           # show what an undo would delete
//   node scripts/seed-egan-financials.mjs --undo --confirm # delete exactly what this script wrote
//
// Every run writes inside one transaction and then reads the job back through
// the SAME queries the app and the MCP tools use (lib/budget-queries.ts →
// lib/budget-assemble.ts → computeTotals). If any cost / price / profit total
// differs from the fixture's, it rolls back and exits non-zero — approved or not.
//
// What it writes: budget settings on the project, 16 budget lines, 3 change
// orders + their credits, 2 paying parties, 4 funding events, 7 sub invoices,
// 1 expense.
//
// What it deliberately does NOT write:
//   • Billing. The job stays on `billing_source = 'manual'`, so Collected is the
//     hand-kept projects.collected_to_date — a live number (it moved from
//     $31,667 to $34,929 the day this was written). Switching a job to invoices
//     is the owner's reviewed reconcile step, never a script's.
//   • Client invoices. IN-10047…53 live in Houzz. Rows in `invoices` show in
//     the CLIENT portal; history belongs in the opening balance instead.
//   • The M&M proposal as a purchase order. A quote is not a promise; it is
//     recorded as CO-1's planned cost.
//
// ⚠ CLIENT-FACING: the client portal's Documents page lists every change order
// that is not a draft. This seed therefore writes CO-1 as `draft` (the packet
// calls it "sent", but nothing was sent through SJC OS e-sign, and the portal
// would tell the client to "sign it in the list above" with nothing there).
// Draft and sent are both "pending, not counted", so every total is identical.
// CO-3 is written as `approved`, as in the packet — it WILL appear in the
// client's portal as an approved $2,765 change order. That is the owner's call,
// which is why --approve is a separate, deliberate step.
//
// ⚠ Sub invoices tied to a roster sub make the w9-missing detector open a work
// item for any of those subs without a W-9 on file.

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { assembleBudgetView } from "../lib/budget-assemble.ts";
import { EGAN_AS_OF, EGAN_RAW } from "../lib/budget-fixtures.ts";
import { findProjects, loadRawProjectMoney, todayCentral } from "../lib/budget-queries.ts";
import { computeTotals, describeFinancials, fmtK } from "../lib/budget-types.ts";

const SLUG = "molly-egan";
const args = new Set(process.argv.slice(2));
const approve = args.has("--approve");
const undo = args.has("--undo");
const confirm = args.has("--confirm");

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const url =
  process.env.DATABASE_URL ??
  readFileSync(envFile, "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found (env or ${envFile})`);

// A roster sub is linked only where the match is unambiguous; everyone else is
// named by vendor_label (a mover and a one-off plumber are not in the roster).
const ROSTER = [[/kunkel/i, "tim-kunkel-electric"], [/^cpk\b/i, "cpk-demolition-services"]];
// Totals that must equal the fixture's. Billing is excluded on purpose: it stays live.
const MUST_MATCH = [
  "paidCents", "owedCents", "orderedCents", "estToFinishCents", "projectedCostCents", "budgetCostCents",
  "coBudgetCostCents", "costHeadroomCents", "unsignedCoCostCents", "basePriceCents", "coNetCents",
  "coPendingCents", "priceCents", "projectedProfitCents", "plannedProfitCents", "workDonePct",
];

const client = new pg.Client({ connectionString: url });
await client.connect();
const run = async (sql, params) => (await client.query(sql, params)).rows;
const refs = [...EGAN_RAW.subInvoices, ...EGAN_RAW.expenses].map((r) => r.sourceRef);

try {
  const [project] = await findProjects(run, { slug: SLUG });
  if (!project) throw new Error(`No project with slug "${SLUG}"`);

  if (undo) {
    await client.query("BEGIN");
    const del = async (label, sql, params) => console.log(`  ${label}: ${(await client.query(sql, params)).rowCount}`);
    console.log(confirm ? "UNDO — deleting what the seed wrote:" : "UNDO PREVIEW — would delete:");
    await del("sub invoices", `DELETE FROM sub_invoices WHERE project_id = $1 AND source_ref = ANY($2)`, [project.id, refs]);
    await del("expenses", `DELETE FROM expenses WHERE project_id = $1 AND source_ref = ANY($2)`, [project.id, refs]);
    await del("funding events", `DELETE FROM funding_events WHERE project_id = $1 AND source = ANY($2)`, [project.id, EGAN_RAW.fundingEvents.map((f) => f.source)]);
    await del("parties", `DELETE FROM budget_parties WHERE project_id = $1 AND key = ANY($2)`, [project.id, EGAN_RAW.parties.map((p) => p.key)]);
    await del("budget lines (+ credits)", `DELETE FROM budget_lines WHERE project_id = $1 AND key = ANY($2)`, [project.id, EGAN_RAW.lines.map((l) => l.key)]);
    await del("change orders", `DELETE FROM change_orders WHERE project_id = $1 AND (number, title) IN (SELECT * FROM unnest($2::text[], $3::text[]))`,
      [project.id, EGAN_RAW.changeOrders.map((c) => c.number), EGAN_RAW.changeOrders.map((c) => c.title)]);
    await del("project settings reset", `UPDATE projects SET budget_basis = 'fixed_price', budget_label = '', budget_caption = '', price_cents = NULL,
        budget_notes = '[]', budget_complete = false, costs_through = NULL WHERE id = $1`, [project.id]);
    await client.query(confirm ? "COMMIT" : "ROLLBACK");
    console.log(confirm ? "UNDONE." : "Nothing deleted. Add --confirm to undo for real.");
  } else {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");

    const [{ n }] = await run(`SELECT count(*)::int AS n FROM budget_lines WHERE project_id = $1`, [project.id]);
    if (n > 0) throw new Error(`${SLUG} already has ${n} budget lines — refusing to seed over them (use --undo first)`);
    const [before] = await run(`SELECT contract_value, collected_to_date, billing_source FROM projects WHERE id = $1`, [project.id]);

    const p = EGAN_RAW.project;
    await run(
      `UPDATE projects SET budget_basis = $2, budget_label = $3, budget_caption = $4, price_cents = $5,
              budget_notes = $6::jsonb, budget_complete = $7, costs_through = $8, updated_at = now() WHERE id = $1`,
      [project.id, p.basis, p.budgetLabel ?? "", p.budgetCaption ?? "", p.priceCentsOverride, JSON.stringify(p.notes ?? []), p.budgetComplete, p.costsThrough],
    );

    const coId = new Map();
    for (const c of EGAN_RAW.changeOrders) {
      const status = c.status === "sent" ? "draft" : c.status; // see the client-facing note above
      const [row] = await run(
        `INSERT INTO change_orders (project_id, number, title, description, vendor_label, price_cents, status, budget_cost_cents, est_to_finish_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [project.id, c.number, c.title, c.description ?? "", c.vendorLabel ?? "", c.priceCents, status, c.budgetCostCents, c.estToFinishCents],
      );
      coId.set(c.id, Number(row.id));
    }

    const lineId = new Map();
    for (const [i, l] of EGAN_RAW.lines.entries()) {
      const [row] = await run(
        `INSERT INTO budget_lines (project_id, key, trade, detail, source, kind, budget_cents, price_cents, est_to_finish_cents,
                                   percent_complete, status, status_kind, credited_co_id, flags, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15) RETURNING id`,
        [project.id, l.key, l.trade, l.detail ?? "", l.source ?? "", l.kind, l.budgetCents, l.priceCents, l.estToFinishCents,
         l.percentComplete, l.status ?? "", l.statusKind ?? "ghost", l.creditedCoId == null ? null : coId.get(l.creditedCoId),
         JSON.stringify(l.flags ?? []), i],
      );
      lineId.set(l.id, Number(row.id));
    }
    for (const c of EGAN_RAW.changeOrders)
      for (const credit of c.credits)
        await run(`INSERT INTO change_order_credits (change_order_id, budget_line_id, amount_cents) VALUES ($1, $2, $3)`,
          [coId.get(c.id), lineId.get(credit.budgetLineId), credit.amountCents]);

    for (const [i, party] of EGAN_RAW.parties.entries())
      await run(`INSERT INTO budget_parties (project_id, key, label, base_share_cents, is_owner, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
        [project.id, party.key, party.label, party.baseShareCents, !!party.isOwner, i]);
    for (const [i, f] of EGAN_RAW.fundingEvents.entries())
      await run(`INSERT INTO funding_events (project_id, party_key, source, amount_cents, trigger_text, status, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [project.id, f.partyKey, f.source, f.amountCents, f.trigger ?? "", f.status, i]);

    const roster = new Set((await run(`SELECT slug FROM subs WHERE slug = ANY($1)`, [ROSTER.map(([, slug]) => slug)])).map((r) => r.slug));
    const linked = [];
    for (const s of EGAN_RAW.subInvoices) {
      const slug = ROSTER.find(([re, sl]) => re.test(s.vendor) && roster.has(sl))?.[1] ?? null;
      if (slug) linked.push(slug);
      await run(
        `INSERT INTO sub_invoices (sub_slug, vendor_label, project_id, amount, note, status, paid_cents, invoice_date,
                                   budget_line_id, change_order_id, source_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [slug, s.vendor, project.id, s.amountCents, slug ? [s.vendor, s.note].filter(Boolean).join(" — ") : (s.note ?? ""), s.status,
         s.paidCents ?? 0, s.on, s.budgetLineId == null ? null : lineId.get(s.budgetLineId),
         s.changeOrderId == null ? null : coId.get(s.changeOrderId), s.sourceRef],
      );
    }
    for (const e of EGAN_RAW.expenses)
      await run(
        `INSERT INTO expenses (project_id, expense_date, vendor_label, kind, amount_cents, memo, paid_from, budget_line_id, change_order_id, source_ref)
         VALUES ($1, $2, $3, $4, $5, $6, 'checking', $7, $8, $9)`,
        [project.id, e.on, e.vendorLabel, e.kind, e.amountCents, e.memo ?? "", e.budgetLineId == null ? null : lineId.get(e.budgetLineId),
         e.changeOrderId == null ? null : coId.get(e.changeOrderId), e.sourceRef],
      );

    // ---- read it back through the real path, inside the same transaction
    const money = (await loadRawProjectMoney(run, [project.id], { sequential: true })).get(project.id);
    const view = assembleBudgetView(money, { asOf: todayCentral() });
    const got = computeTotals(view);
    const want = computeTotals(assembleBudgetView(EGAN_RAW, { asOf: EGAN_AS_OF }));

    const problems = MUST_MATCH.filter((k) => (typeof want[k] === "number" && typeof got[k] === "number" ? Math.abs(want[k] - got[k]) > 1e-9 : want[k] !== got[k]));
    const handKept = Number(before.collected_to_date) * 100;
    if (got.collectedCents !== handKept) problems.push(`collected ${got.collectedCents} ≠ hand-kept ${handKept}`);
    if (got.billedCents !== null) problems.push("billed should be unknown on a manual job");

    console.log(`\n${project.name} — as the app will show it (${view.asOfLabel})\n`);
    for (const s of describeFinancials(view, got)) console.log(`  • ${s}`);
    console.log(`\n  price ${fmtK(got.priceCents)} · projected cost ${fmtK(got.projectedCostCents)} · projected profit ${fmtK(got.projectedProfitCents)} · planned ${fmtK(got.plannedProfitCents)}`);
    console.log(`  spent ${fmtK(got.paidCents)} · owed ${fmtK(got.owedCents)} · on order ${fmtK(got.orderedCents)} · still to spend ${fmtK(got.estToFinishCents)}`);
    console.log(`  collected ${fmtK(got.collectedCents)} (hand-kept, live) · left to collect ${fmtK(got.leftToCollectCents)} · billing: ${view.completeness.billing}`);
    console.log(`  who pays: ${got.paidBy.map((x) => `${x.label} ${fmtK(x.amountCents)}`).join(" · ")}`);
    console.log(`  roster subs linked: ${[...new Set(linked)].join(", ") || "none"}; others named by vendor_label`);
    console.log(`  missing / soft: ${view.completeness.missing.join(" | ") || "nothing"}`);
    console.log(`\n  verification: ${MUST_MATCH.length} totals vs the fixture — ${problems.length ? "MISMATCH: " + problems.join(", ") : "all match"}`);

    if (problems.length) throw new Error("seeded data does not reproduce the fixture's totals");
    if (approve) {
      await client.query("COMMIT");
      console.log("\nSEEDED. CO-3 now shows in the client portal as an approved change order.");
    } else {
      await client.query("ROLLBACK");
      console.log("\nDRY RUN — rolled back, nothing written. Re-run with --approve to keep it.");
    }
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("FAILED, rolled back:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { adoptEstimateAsBudget, budgetKey, guessLineKind, planBudgetFromEstimate, NO_MARKUP_NOTE } from "../lib/budget-writes.ts";

// Adopting an estimate as a job's budget (docs/project-financials-plan.md §4.7).
// The rule that matters: an estimate with no markup tells us prices, not costs,
// and must never be allowed to "plan" a profit of $0 — both approved estimates
// on the live system are Houzz imports of exactly that kind.

const l = (section, qty, unitCostCents, extendedCents) => ({ section, qty, unitCostCents, extendedCents });

test("one budget line per estimate section, in order: cost is qty × unit cost, price is the extended amount", () => {
  const plan = planBudgetFromEstimate([
    l("Cabinets", 1, 700000, 875000), l("Electrical", 2, 50000, 120000), l("Cabinets", 12.5, 1000, 15000), l("", 1, 5000, 6000),
  ]);
  assert.deepEqual(plan.lines.map((x) => [x.key, x.trade, x.budgetCents, x.priceCents, x.sortOrder]), [
    ["cabinets", "Cabinets", 712500, 890000, 0], ["electrical", "Electrical", 100000, 120000, 1], ["general", "General", 5000, 6000, 2],
  ]);
  assert.deepEqual([plan.costCents, plan.priceCents, plan.hasMarkup], [817500, 1016000, true]);
});

test("an estimate that carries client prices as costs has no markup", () => {
  const plan = planBudgetFromEstimate([l("Demolition", 1, 125000, 125000), l("Countertops", 1, 1101525, 1101525)]);
  assert.equal(plan.hasMarkup, false);
  assert.equal(plan.costCents, plan.priceCents);
});

test("keys are stable slugs and never collide; only a section NAMED for what it is leaves 'trade'", () => {
  assert.equal(budgetKey("SJ Carpentry labor & general conditions"), "sj-carpentry-labor-and-general-conditions");
  assert.equal(budgetKey("  —  "), "general");
  assert.deepEqual(planBudgetFromEstimate([l("Option A", 1, 1, 1), l("Option-A", 1, 1, 1)]).lines.map((x) => x.key), ["option-a", "option-a-2"]);
  assert.deepEqual(
    ["Contingency", "Allowances", "Materials & allowances", "Overhead & profit", "SJ Carpentry labor & general conditions", "Sales tax", "Permits", "Credits", "Plumbing"].map(guessLineKind),
    ["contingency", "allowance", "trade", "overhead", "trade", "tax", "tax", "other", "trade"],
  );
});

/** A fake `run` that answers the adopt flow and records what it was asked to write. */
function fakeDb({ estimate = { id: "10", total: 2829564 }, existingLines = 0, lines }) {
  const writes = [];
  const run = async (sql, params) => {
    if (/FROM estimates/.test(sql)) return estimate ? [estimate] : [];
    if (/count\(\*\).*FROM budget_lines/.test(sql)) return [{ n: existingLines }];
    if (/FROM estimate_lines/.test(sql)) return lines;
    if (/INSERT INTO budget_lines/.test(sql)) { writes.push({ table: "budget_lines", params }); return []; }
    if (/UPDATE projects/.test(sql)) { writes.push({ table: "projects", sql, params }); return [{ budget_complete: params[2] }]; }
    throw new Error(`unexpected query: ${sql}`);
  };
  return { run, writes };
}
const row = (section, qty, unit_cost, extended) => ({ section, qty: String(qty), unit_cost, extended });

test("adopting a no-markup estimate writes lines and prices but does NOT mark the budget complete", async () => {
  const db = fakeDb({ lines: [row("Demolition", "1.00", 125000, 125000), row("Cabinets", "1.00", 887125, 887125)] });
  const r = await adoptEstimateAsBudget(db.run, { projectId: "p" });
  assert.deepEqual([r.ok, r.linesWritten, r.hasMarkup, r.budgetComplete, r.warning], [true, 2, false, false, NO_MARKUP_NOTE]);
  const project = db.writes.find((w) => w.table === "projects");
  assert.deepEqual(project.params, ["p", 2829564, false, NO_MARKUP_NOTE], "price pinned to the estimate total; complete = false; the note explains why");
  assert.match(project.sql, /COALESCE\(price_cents, \$2\)/, "never overwrites a price the owner set");
});

test("re-syncing a no-markup estimate over a confirmed budget WITHDRAWS the confirmation", async () => {
  // The lines now carry client prices as costs — unverified — so a profit must not keep showing.
  const db = fakeDb({ existingLines: 3, lines: [row("Cabinets", 1, 887125, 887125)] });
  const r = await adoptEstimateAsBudget(db.run, { projectId: "p", replace: true });
  assert.deepEqual([r.ok, r.hasMarkup, r.budgetComplete], [true, false, false]);
  const project = db.writes.find((w) => w.table === "projects");
  assert.match(project.sql, /budget_complete = \$3/, "set, not OR-ed: a re-sync without markup un-confirms");
  assert.equal(project.params[2], false);
});

test("adopting an estimate with real markup marks the budget complete", async () => {
  const db = fakeDb({ lines: [row("Cabinets", 1, 700000, 875000)] });
  const r = await adoptEstimateAsBudget(db.run, { projectId: "p" });
  assert.deepEqual([r.ok, r.hasMarkup, r.budgetComplete, r.warning], [true, true, true, undefined]);
  assert.deepEqual(db.writes[0].params, ["p", "cabinets", "Cabinets", "trade", 700000, 875000, "Estimate #10 · Cabinets", 0]);
});

test("it refuses rather than guesses: no approved estimate, an empty one, or lines already there", async () => {
  assert.deepEqual(await adoptEstimateAsBudget(fakeDb({ estimate: null, lines: [] }).run, { projectId: "p" }), { ok: false, error: "This job has no approved estimate." });
  assert.deepEqual(await adoptEstimateAsBudget(fakeDb({ estimate: null, lines: [] }).run, { projectId: "p", estimateId: 99 }), { ok: false, error: "That estimate isn't on this job." });
  assert.deepEqual(await adoptEstimateAsBudget(fakeDb({ lines: [] }).run, { projectId: "p" }), { ok: false, error: "That estimate has no lines." });

  const busy = fakeDb({ existingLines: 4, lines: [row("Cabinets", 1, 700000, 875000)] });
  assert.equal((await adoptEstimateAsBudget(busy.run, { projectId: "p" })).ok, false);
  assert.equal(busy.writes.length, 0, "nothing written");
  assert.equal((await adoptEstimateAsBudget(busy.run, { projectId: "p", replace: true })).ok, true, "re-sync upserts; it never deletes a line costs may point at");
});

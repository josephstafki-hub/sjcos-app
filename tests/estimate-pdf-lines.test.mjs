import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// lib/*.ts import each other extensionless — resolve those to .ts.
registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
    }
    return next(specifier, context);
  },
});
const { ESTIMATE_LINE_FIELDS, estimateLinesChanged } = await import("../lib/doc-templates/fill-validate.ts");

// A Formal Estimate PDF copy is flagged "lines changed" when its lines, subtotal
// or total no longer match the estimate (lib/doc-drafts.ts linesChanged). The
// stored copy comes back from Postgres jsonb, which reorders object keys — the
// check must not mistake that for a change. docs/estimates-and-change-orders.md

const current = {
  line_items_table: {
    columns: ["Description", "Category", "Qty", "Amount"],
    rows: [
      ["Framing labor", "Framing", "1 lump sum", "$5,790.00"],
      ["Pre-Construction Deposit Credit", "General", "1 each", "-$2,200.00"],
    ],
  },
  subtotal: 359000,
  total: 359000,
};
// Same values as jsonb hands them back: "rows" before "columns", other fields around them.
const stored = {
  total: 359000,
  subtotal: 359000,
  client_name: "Chuck Spaeth",
  scope_summary: "Garage addition.",
  line_items_table: { rows: current.line_items_table.rows.map((r) => [...r]), columns: [...current.line_items_table.columns] },
};

test("the line fields are the table and the two totals", () => {
  assert.deepEqual([...ESTIMATE_LINE_FIELDS], ["line_items_table", "subtotal", "total"]);
});

test("a copy that matches is not flagged, whatever the key order", () => {
  assert.equal(estimateLinesChanged(stored, current), false);
});

test("other fields on the document never count as a line change", () => {
  assert.equal(estimateLinesChanged({ ...stored, scope_summary: "Rewritten.", contingency: 50000 }, current), false);
});

test("a changed, added or removed line is flagged", () => {
  const repriced = structuredClone(stored);
  repriced.line_items_table.rows[0][3] = "$6,000.00";
  assert.equal(estimateLinesChanged(repriced, current), true, "repriced line");

  const fewer = structuredClone(stored);
  fewer.line_items_table.rows.pop();
  assert.equal(estimateLinesChanged(fewer, current), true, "line removed");

  const reordered = structuredClone(stored);
  reordered.line_items_table.rows.reverse();
  assert.equal(estimateLinesChanged(reordered, current), true, "lines in a different order print differently");
});

test("a changed total is flagged", () => {
  assert.equal(estimateLinesChanged({ ...stored, total: 360000 }, current), true);
  assert.equal(estimateLinesChanged({ ...stored, subtotal: 1 }, current), true);
});

test("a copy with no lines at all is flagged against an estimate that has them", () => {
  const bare = { ...stored };
  delete bare.line_items_table;
  assert.equal(estimateLinesChanged(bare, current), true);
  assert.equal(estimateLinesChanged({ ...stored, line_items_table: "not a table" }, current), true);
});

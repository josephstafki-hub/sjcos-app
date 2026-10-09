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
const { applyFieldEdits } = await import("../lib/doc-templates/fill-validate.ts");

// An agent may fill the client's contact details on a document (Joe,
// 2026-10-09) — and still nothing else that isn't a narrative.
const template = {
  fields: [
    { key: "client_name", label: "", kind: "text", source: "auto", required: true },
    { key: "client_email", label: "", kind: "text", source: "auto", required: false },
    { key: "client_phone", label: "", kind: "text", source: "owner", required: false },
    { key: "client_address", label: "", kind: "text", source: "owner", required: false },
    { key: "client_city_state_zip", label: "", kind: "text", source: "owner", required: false },
    { key: "company_name", label: "", kind: "text", source: "auto", required: true },
    { key: "contract_number", label: "", kind: "text", source: "auto", required: true },
    { key: "contract_total", label: "", kind: "money_cents", source: "auto", required: true },
    { key: "contract_date", label: "", kind: "date", source: "auto", required: true },
    { key: "sow_narrative", label: "", kind: "narrative", source: "ai", required: false },
  ],
};

test("AI may write the client's contact details and narratives", () => {
  const edits = {
    client_name: "Tim and Libby Mahowald",
    client_email: "tim@example.test",
    client_phone: "651-555-0100",
    client_address: "1 Main St",
    client_city_state_zip: "Saint Paul, MN 55105",
    sow_narrative: "Scope.",
  };
  const r = applyFieldEdits(template, {}, {}, edits, "ai");
  assert.deepEqual(r.rejected, {});
  assert.equal(r.values.client_name, "Tim and Libby Mahowald");
  assert.equal(r.fillReport.client_phone, "ai");
});

test("AI still may not write money, dates, contract numbers or company info", () => {
  const r = applyFieldEdits(
    template,
    {},
    {},
    { company_name: "X", contract_number: "Y", contract_total: 100, contract_date: "today" },
    "ai",
  );
  assert.deepEqual(Object.keys(r.rejected).sort(), ["company_name", "contract_date", "contract_number", "contract_total"]);
  assert.deepEqual(r.values, {});
});

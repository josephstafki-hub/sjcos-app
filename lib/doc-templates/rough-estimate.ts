// Rough Estimate template (key `rough_estimate`).
//
// The client-facing, house-style version of a lead's Phase 1 rough estimate —
// the polished PDF emailed to the lead in place of a plain-text ballpark. Unlike
// the formal `estimate_doc` (cents-based line items from the cost book), the
// rough estimate is qualitative: RANGE values ("$225,000–$285,000") and option
// notes, kept as display strings. Informational only — NOT signable (carries a
// "this is not a contract" note). Auto fields come from `lead_estimates` + the
// lead; `scope_summary` is the AI/owner narrative. Lead-scoped.

import type { DocTemplate, FieldValues, TemplateSection } from "./types";
import {
  bulletList,
  heading,
  infoGrid,
  infoStrip,
  moneyTable,
  para,
  str,
  table,
  tableSection,
} from "./blocks";

export const roughEstimateTemplate: DocTemplate = {
  key: "rough_estimate",
  version: "2026-07-10.1",
  title: "Rough Estimate",
  subtitle: "Preliminary Phase 1 estimate — ballpark ranges before final scope & selections.",
  docClass: "transactional",
  scope: "lead",
  fields: [
    { key: "company_name", label: "Company name", kind: "text", source: "auto", required: true },
    { key: "company_address", label: "Company address", kind: "text", source: "auto", required: true },
    { key: "company_phone", label: "Company phone", kind: "text", source: "auto", required: true },
    { key: "company_email", label: "Company email", kind: "text", source: "auto", required: true },
    { key: "company_license", label: "Company license", kind: "text", source: "auto", required: false },
    { key: "estimate_number", label: "Estimate #", kind: "text", source: "auto", required: true },
    { key: "date_prepared", label: "Date prepared", kind: "date", source: "auto", required: true },
    { key: "valid_until", label: "Valid until", kind: "date", source: "auto", required: true },
    { key: "client_name", label: "Prepared for", kind: "text", source: "auto", required: true },
    { key: "property_address", label: "Property address", kind: "text", source: "auto", required: false },
    { key: "client_phone_email", label: "Phone / email", kind: "text", source: "auto", required: false },
    {
      key: "scope_summary",
      label: "Scope summary",
      kind: "narrative",
      source: "ai",
      required: false,
      help: "1–3 sentences describing what the ranges cover; never states firm prices as final.",
    },
    { key: "line_items_table", label: "Estimated ranges", kind: "table", source: "auto", required: true },
    { key: "rough_total", label: "Rough total", kind: "text", source: "auto", required: true },
  ],
  build,
};

function build(v: FieldValues): TemplateSection[] {
  const co = str(v, "company_name", "SJ Carpentry LLC");
  const out: TemplateSection[] = [];

  out.push(
    infoStrip([
      { label: "Estimate #", value: str(v, "estimate_number") },
      { label: "Date Prepared", value: str(v, "date_prepared") },
      { label: "Valid Until", value: str(v, "valid_until") },
    ]),
    infoGrid([
      { label: "Prepared For", value: str(v, "client_name") },
      { label: "Property Address", value: str(v, "property_address", "—") },
      { label: "Phone / Email", value: str(v, "client_phone_email", "—") },
    ]),
  );

  out.push(heading("Preliminary Scope"));
  const summary = str(v, "scope_summary");
  out.push(
    para(
      summary ||
        "These figures are ballpark ranges based on the discovery conversation and available information — " +
          "provided to confirm we're in the right neighborhood before scope and selections are finalized.",
    ),
  );

  out.push(heading("Estimated Ranges"));
  const lines = table(v, "line_items_table");
  if (lines) out.push(tableSection(lines));
  out.push(moneyTable([{ label: "Rough total", value: str(v, "rough_total"), bold: true }]));

  out.push(
    heading("Notes & Terms"),
    bulletList([
      "These are preliminary ranges, not fixed prices. Final pricing follows a completed scope of work, material selections, and site verification.",
      "**This rough estimate is not a contract.** A signed pre-construction agreement or contract is required before work is scheduled.",
      "Ranges are valid for 30 days from the date prepared above; material and labor costs may change after that period.",
      `Once you're comfortable with the range, the next step is a pre-construction agreement and detailed scope with ${co}.`,
    ]),
  );

  return out;
}

// Formal Estimate template (key `estimate_doc`).
//
// VISUAL SOURCE: docs/reference/doc-templates/source/SJC_Estimate_Template.docx.
// Auto fields from the estimate + its lines (grouped by section/category);
// `scope_summary` is the AI-drafted field. Works project- or lead-scoped. Money
// is CENTS. Transactional — carries its own "not a contract" terms, no legal
// disclaimer.

import type { DocTemplate, FieldValues, TemplateSection } from "./types";
import {
  bulletList,
  heading,
  infoGrid,
  infoStrip,
  money,
  para,
  signatureBlock,
  str,
  table,
  tableSection,
} from "./blocks";

export const estimateDocTemplate: DocTemplate = {
  key: "estimate_doc",
  version: "2026-07-10.1",
  title: "Formal Estimate",
  subtitle: "Prepared following site visit, material takeoff, and confirmed selections.",
  docClass: "transactional",
  scope: "both",
  fields: [
    { key: "company_name", label: "Company name", kind: "text", source: "auto", required: true },
    { key: "company_address", label: "Company address", kind: "text", source: "auto", required: true },
    { key: "company_phone", label: "Company phone", kind: "text", source: "auto", required: true },
    { key: "company_email", label: "Company email", kind: "text", source: "auto", required: true },
    { key: "company_license", label: "Company license", kind: "text", source: "auto", required: false },
    { key: "estimate_number", label: "Estimate #", kind: "text", source: "auto", required: true },
    { key: "date_prepared", label: "Date prepared", kind: "date", source: "auto", required: true },
    { key: "valid_until", label: "Valid until", kind: "date", source: "auto", required: true },
    { key: "project_name", label: "Project / job", kind: "text", source: "auto", required: true },
    { key: "client_name", label: "Client name", kind: "text", source: "auto", required: true },
    { key: "property_address", label: "Property address", kind: "text", source: "auto", required: false },
    { key: "client_phone_email", label: "Phone / email", kind: "text", source: "auto", required: false },
    {
      key: "scope_summary",
      label: "Project scope summary",
      kind: "narrative",
      source: "ai",
      required: false,
      help: "Brief description of the scope; full scope is in the attached SOW. Never invents pricing.",
    },
    { key: "line_items_table", label: "Estimated line items", kind: "table", source: "auto", required: true },
    { key: "subtotal", label: "Estimated subtotal", kind: "money_cents", source: "auto", required: true },
    { key: "contingency", label: "Contingency / allowance buffer", kind: "money_cents", source: "owner", required: false },
    { key: "total", label: "Total estimated investment", kind: "money_cents", source: "auto", required: true },
  ],
  build,
};

function build(v: FieldValues): TemplateSection[] {
  const out: TemplateSection[] = [];

  out.push(
    infoStrip([
      { label: "Estimate #", value: str(v, "estimate_number") },
      { label: "Date Prepared", value: str(v, "date_prepared") },
      { label: "Valid Until", value: str(v, "valid_until") },
    ]),
    infoGrid([
      { label: "Project / Job", value: str(v, "project_name") },
      { label: "Client Name", value: str(v, "client_name") },
      { label: "Property Address", value: str(v, "property_address", "—") },
      { label: "Phone / Email", value: str(v, "client_phone_email", "—") },
    ]),
  );

  out.push(heading("Project Scope Summary"));
  const summary = str(v, "scope_summary");
  out.push(
    para(
      summary ||
        "Brief description of the project scope. Full scope of work is detailed in the attached Scope of Work (SOW) document.",
    ),
  );

  out.push(heading("Estimated Line Items"));
  const lines = table(v, "line_items_table");
  if (lines) out.push(tableSection(lines));
  out.push(
    infoGrid([
      { label: "Estimated Subtotal", value: money(v, "subtotal") },
      { label: "Contingency / Allowance Buffer", value: money(v, "contingency", "$0.00") },
      { label: "Total Estimated Investment", value: money(v, "total") },
    ]),
  );

  out.push(
    heading("Allowances & Selections"),
    bulletList([
      "Line items marked as allowances reflect a budgeted amount for materials or finishes not yet finalized by the client.",
      "Allowances are estimates only and are subject to change once selections are confirmed in writing.",
      "Any difference between an allowance and the confirmed selection price will be reflected in the final contract price or a change order.",
    ]),
  );

  out.push(
    heading("Notes & Terms"),
    bulletList([
      "This is a formal estimate based on a completed site visit, material takeoff, and available client selections.",
      "This estimate is not a contract. A signed contract and retainer deposit are required before work is scheduled.",
      "Pricing is valid for 30 days from the date prepared above; material and labor costs may change after that period.",
      "Any change to scope after acceptance will be handled through SJ Carpentry's written change order process.",
    ]),
  );

  out.push(
    heading("Client Acceptance"),
    para(
      "By signing below, the client acknowledges this estimate and authorizes " +
        `${str(v, "company_name", "SJ Carpentry LLC")} to proceed with preparing a formal contract for the scope described above.`,
    ),
    signatureBlock([
      { role: "Client", name: str(v, "client_name") },
      { role: str(v, "company_name", "SJ Carpentry LLC") },
    ]),
  );

  return out;
}

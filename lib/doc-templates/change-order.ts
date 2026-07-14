// Change Order template (key `change_order`).
//
// VISUAL SOURCE: docs/reference/doc-templates/source/SJC_Change_Order_Template.docx
// (house style — header, info grid, reason checkboxes, pricing-impact table,
// deposit policy, terms, paired signatures). Auto fields from the change_orders
// row; `co_scope_description` is the AI-drafted field. Money is CENTS.

import type { DocTemplate, FieldValues, TemplateSection } from "./types";
import {
  bulletList,
  checkboxGroup,
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

const REASONS = [
  { key: "reason_addition", label: "Client-requested addition to scope" },
  { key: "reason_deletion", label: "Client-requested deletion from scope" },
  { key: "reason_substitution", label: "Material or finish substitution after selections were confirmed" },
  { key: "reason_site", label: "Unforeseen site condition (hidden damage, code requirement, etc.)" },
  { key: "reason_design", label: "Design revision requested after contract signing" },
];

export const changeOrderTemplate: DocTemplate = {
  key: "change_order",
  version: "2026-07-10.1",
  title: "Change Order",
  subtitle: "No scope change is performed without a signed change order and required deposit.",
  docClass: "transactional",
  scope: "project",
  fields: [
    { key: "company_name", label: "Company name", kind: "text", source: "auto", required: true },
    { key: "company_address", label: "Company address", kind: "text", source: "auto", required: true },
    { key: "company_phone", label: "Company phone", kind: "text", source: "auto", required: true },
    { key: "company_email", label: "Company email", kind: "text", source: "auto", required: true },
    { key: "company_license", label: "Company license", kind: "text", source: "auto", required: false },
    { key: "co_number", label: "Change order #", kind: "text", source: "auto", required: true },
    { key: "co_date", label: "Date", kind: "date", source: "auto", required: true },
    { key: "contract_number", label: "Original contract ref. #", kind: "text", source: "auto", required: false },
    { key: "project_name", label: "Project / job", kind: "text", source: "auto", required: true },
    { key: "client_name", label: "Client", kind: "text", source: "auto", required: true },
    { key: "job_site_address", label: "Job site address", kind: "text", source: "auto", required: false },
    ...REASONS.map((r) => ({ key: r.key, label: r.label, kind: "enum" as const, source: "owner" as const, required: false, enumValues: ["yes", "no"] })),
    {
      key: "co_scope_description",
      label: "Description of scope change",
      kind: "narrative",
      source: "ai",
      required: false,
      help: "Drafted from the change order's title/description; describes exactly what changes.",
    },
    { key: "pricing_impact_table", label: "Pricing impact", kind: "table", source: "auto", required: false },
    { key: "added_scope_total", label: "Added scope total", kind: "money_cents", source: "auto", required: false },
    { key: "credit_deleted", label: "Credit for deleted scope", kind: "money_cents", source: "owner", required: false },
    { key: "net_change", label: "Net change to contract price", kind: "money_cents", source: "auto", required: true },
    { key: "timeline_impact", label: "Timeline impact", kind: "text", source: "owner", required: false },
    { key: "co_deposit_required", label: "CO deposit required", kind: "money_cents", source: "owner", required: false },
    { key: "co_balance_due", label: "CO balance due", kind: "money_cents", source: "owner", required: false },
  ],
  build,
};

function build(v: FieldValues): TemplateSection[] {
  const out: TemplateSection[] = [];

  out.push(
    infoStrip([
      { label: "Change Order #", value: str(v, "co_number") },
      { label: "Date", value: str(v, "co_date") },
      { label: "Original Contract Ref. #", value: str(v, "contract_number", "—") },
    ]),
    infoGrid([
      { label: "Project / Job", value: str(v, "project_name") },
      { label: "Client", value: str(v, "client_name") },
      { label: "Job Site Address", value: str(v, "job_site_address", "—") },
    ]),
  );

  out.push(
    heading("Reason for Change"),
    para("Check the box(es) that apply and describe below."),
    checkboxGroup(REASONS.map((r) => ({ label: r.label, checked: str(v, r.key) === "yes" }))),
  );

  out.push(heading("Description of Scope Change"));
  const scope = str(v, "co_scope_description");
  if (scope) out.push(para(scope));

  out.push(heading("Pricing Impact"));
  const pricing = table(v, "pricing_impact_table");
  if (pricing) out.push(tableSection(pricing));
  out.push(
    infoGrid([
      { label: "Added Scope Total", value: money(v, "added_scope_total") },
      { label: "Credit for Deleted Scope", value: money(v, "credit_deleted", "$0.00") },
      { label: "Net Change to Contract Price", value: money(v, "net_change") },
    ]),
  );

  out.push(
    heading("Schedule & Deposit"),
    infoGrid([
      { label: "Timeline Impact", value: str(v, "timeline_impact", "—") },
      { label: "CO Deposit Required", value: money(v, "co_deposit_required") },
      { label: "CO Deposit Due", value: "Before additional work begins" },
      { label: "CO Balance Due", value: str(v, "co_balance_due") ? money(v, "co_balance_due") : "With final invoice, unless noted otherwise" },
    ]),
    para(
      "**CO Deposit Policy:** material-only changes under $500 require 100% deposit; changes between $500–$2,500 " +
        "require 50% deposit; scope additions over $2,500 require 40% deposit with the balance due at milestone; " +
        "unforeseen/emergency conditions are authorized in writing with the deposit added to the next invoice.",
    ),
  );

  out.push(
    heading("Terms"),
    bulletList([
      "This Change Order authorizes only the specific scope described above. Additional changes require a separate, signed Change Order.",
      "No work on this change begins until this Change Order is signed and the deposit shown above has cleared.",
      "This Change Order amends the original contract referenced above; all other contract terms remain in effect.",
      "Verbal authorization is not sufficient under any circumstance.",
    ]),
  );

  out.push(
    heading("Signatures"),
    para("By signing below, both parties agree to the scope, pricing, and terms described in this Change Order."),
    signatureBlock([
      { role: "Client", name: str(v, "client_name") },
      { role: str(v, "company_name", "SJ Carpentry LLC") },
    ]),
  );

  return out;
}

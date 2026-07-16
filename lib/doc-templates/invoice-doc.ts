// Invoice template (key `invoice_doc`).
//
// VISUAL SOURCE: docs/reference/doc-templates/source/SJC_Invoice_Template.docx.
// Auto fields from the invoices row. No AI fields; no signature block (an
// invoice is not signed). Money is CENTS. Transactional — carries its own Net-7
// payment terms.
// P1-B7: the retainer ledger is gone, so "previous payments applied" is now an
// owner-entered credit (same pattern as co_balance), not a retainer read.

import type { DocTemplate, FieldValues, TemplateSection } from "./types";
import {
  bulletList,
  heading,
  infoGrid,
  infoStrip,
  money,
  para,
  str,
  table,
  tableSection,
} from "./blocks";

export const invoiceDocTemplate: DocTemplate = {
  key: "invoice_doc",
  version: "2026-07-16.1",
  title: "Invoice",
  subtitle: "",
  docClass: "transactional",
  scope: "project",
  fields: [
    { key: "company_name", label: "Company name", kind: "text", source: "auto", required: true },
    { key: "company_address", label: "Company address", kind: "text", source: "auto", required: true },
    { key: "company_phone", label: "Company phone", kind: "text", source: "auto", required: true },
    { key: "company_email", label: "Company email", kind: "text", source: "auto", required: true },
    { key: "company_license", label: "Company license", kind: "text", source: "auto", required: false },
    { key: "invoice_number", label: "Invoice #", kind: "text", source: "auto", required: true },
    { key: "invoice_date", label: "Invoice date", kind: "date", source: "auto", required: true },
    { key: "due_date", label: "Due date", kind: "date", source: "auto", required: true },
    { key: "project_name", label: "Project / job", kind: "text", source: "auto", required: true },
    { key: "client_name", label: "Client name", kind: "text", source: "auto", required: true },
    { key: "billing_address", label: "Billing address", kind: "text", source: "owner", required: false },
    { key: "client_phone_email", label: "Phone / email", kind: "text", source: "auto", required: false },
    { key: "job_site_address", label: "Job site address", kind: "text", source: "auto", required: false },
    { key: "line_items_table", label: "Itemized charges", kind: "table", source: "auto", required: true },
    { key: "subtotal", label: "Subtotal", kind: "money_cents", source: "auto", required: true },
    {
      key: "previous_payments_applied",
      label: "Previous payments applied",
      kind: "money_cents",
      source: "owner",
      required: false,
      help: "Deposit or prior payment to credit against this invoice. Subtracted from Total Due.",
    },
    { key: "co_balance", label: "Change order balance", kind: "money_cents", source: "owner", required: false },
    { key: "total_due", label: "Total due", kind: "money_cents", source: "auto", required: true },
  ],
  build,
};

/** Read a money_cents field as a number; 0 when unset/unparseable. */
function cents(v: FieldValues, key: string): number {
  const n = Number(v[key]);
  return Number.isFinite(n) ? n : 0;
}

function build(v: FieldValues): TemplateSection[] {
  const out: TemplateSection[] = [];

  out.push(
    infoStrip([
      { label: "Invoice #", value: str(v, "invoice_number") },
      { label: "Invoice Date", value: str(v, "invoice_date") },
      { label: "Due Date", value: str(v, "due_date") },
    ]),
    infoGrid([
      { label: "Project / Job", value: str(v, "project_name") },
      { label: "Client Name", value: str(v, "client_name") },
      { label: "Billing Address", value: str(v, "billing_address", "—") },
      { label: "Phone / Email", value: str(v, "client_phone_email", "—") },
      { label: "Job Site Address", value: str(v, "job_site_address", "—") },
    ]),
  );

  out.push(heading("Itemized Charges"));
  const lines = table(v, "line_items_table");
  if (lines) out.push(tableSection(lines));
  // Total Due nets out any owner-entered credit so the rendered invoice can
  // never show a payment applied above an un-reduced total. With no credit
  // entered this is exactly `total_due` (= the invoice amount); with `total_due`
  // itself unset it stays "—" rather than a misleading $0.00.
  const totalDue =
    v["total_due"] == null || v["total_due"] === ""
      ? money(v, "total_due")
      : money({ net: cents(v, "total_due") - cents(v, "previous_payments_applied") }, "net");
  out.push(
    infoGrid([
      { label: "Subtotal", value: money(v, "subtotal") },
      { label: "Previous Payments Applied", value: money(v, "previous_payments_applied", "$0.00") },
      { label: "Change Order Balance (if any)", value: money(v, "co_balance", "$0.00") },
      { label: "Total Due", value: totalDue },
    ]),
  );

  out.push(
    heading("Payment Terms"),
    bulletList([
      "Payment is due Net 7 — within 7 days of the invoice date shown above.",
      "Accepted payment methods: check, ACH/bank transfer, or online payment via Houzz Pro invoice link.",
      `Make checks payable to ${str(v, "company_name", "SJ Carpentry LLC")}.`,
      `Questions about this invoice? Contact us at ${str(v, "company_email")} or ${str(v, "company_phone")}.`,
    ]),
    para(`Thank you for choosing ${str(v, "company_name", "SJ Carpentry LLC")}.`),
  );

  return out;
}

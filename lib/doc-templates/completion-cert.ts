// Certificate of Substantial Completion template (key `completion_cert`).
//
// CANONICAL LEGAL TEXT: docs/reference/doc-templates/certificate-of-completion.md
// (source of truth — BUMP `version` on any change). Punch data from
// project_punch; account summary from project/invoices; `work_summary` is the
// AI-writable field. Supersedes renderCompletionCertificatePdf after cutover.

import type { DocTemplate, FieldValues, TemplateSection } from "./types";
import {
  heading,
  infoGrid,
  infoStrip,
  money,
  numberList,
  para,
  signatureBlock,
  str,
  table,
  tableSection,
} from "./blocks";

export const completionCertTemplate: DocTemplate = {
  key: "completion_cert",
  version: "2026-07-10.1",
  title: "Certificate of Substantial Completion",
  subtitle: "Formal record that the project below has reached Substantial Completion.",
  docClass: "legal",
  scope: "project",
  fields: [
    { key: "company_name", label: "Company name", kind: "text", source: "auto", required: true },
    { key: "company_address", label: "Company address", kind: "text", source: "auto", required: true },
    { key: "company_phone", label: "Company phone", kind: "text", source: "auto", required: true },
    { key: "company_email", label: "Company email", kind: "text", source: "auto", required: true },
    { key: "company_license", label: "Company license", kind: "text", source: "auto", required: false },
    { key: "certificate_number", label: "Certificate #", kind: "text", source: "auto", required: true },
    { key: "document_date", label: "Date issued", kind: "date", source: "auto", required: true },
    { key: "contract_number", label: "Original contract ref. #", kind: "text", source: "auto", required: false },
    { key: "project_name", label: "Project / job", kind: "text", source: "auto", required: true },
    { key: "project_address", label: "Project address", kind: "text", source: "auto", required: true },
    { key: "client_name", label: "Client / owner", kind: "text", source: "auto", required: true },
    {
      key: "substantial_completion_date",
      label: "Substantial completion date",
      kind: "date",
      source: "owner",
      required: true,
      help: "The date the project reached Substantial Completion — starts the § 327A warranty clocks.",
    },
    {
      key: "work_summary",
      label: "Summary of work",
      kind: "narrative",
      source: "ai",
      required: false,
      help: "2–4 sentences summarizing the completed scope; grounded on the project, never invents dates or figures.",
    },
    { key: "punch_done", label: "Punch items complete", kind: "text", source: "auto", required: false },
    { key: "punch_open", label: "Punch items open", kind: "text", source: "auto", required: false },
    { key: "punch_list_items", label: "Open punch list", kind: "table", source: "auto", required: false },
    { key: "contract_total", label: "Total contract price", kind: "money_cents", source: "auto", required: true },
    { key: "paid_to_date", label: "Paid to date", kind: "money_cents", source: "auto", required: true },
    { key: "balance_due", label: "Final balance due", kind: "money_cents", source: "auto", required: true },
  ],
  build,
};

function build(v: FieldValues): TemplateSection[] {
  const co = str(v, "company_name", "the Contractor");
  const client = str(v, "client_name", "the Client");
  const scDate = str(v, "substantial_completion_date", "the date stated above");
  const out: TemplateSection[] = [];

  out.push(
    infoStrip([
      { label: "Certificate #", value: str(v, "certificate_number") },
      { label: "Date Issued", value: str(v, "document_date") },
      { label: "Original Contract Ref. #", value: str(v, "contract_number", "—") },
    ]),
    infoGrid([
      { label: "Project / Job", value: str(v, "project_name") },
      { label: "Project Address", value: str(v, "project_address") },
      { label: "Client / Owner", value: str(v, "client_name") },
      { label: "Contractor", value: co },
    ]),
  );

  out.push(
    heading("Certification"),
    para(
      `${co} ("Contractor") hereby certifies that the work performed for ${client} ("Client") at ` +
        `${str(v, "project_address")} under the Agreement referenced above reached **Substantial Completion on ${scDate}**. ` +
        "As defined in the Agreement, Substantial Completion means the work is sufficiently complete in accordance with the " +
        "Agreement so that Client can occupy or utilize the project for its intended purpose, notwithstanding minor items " +
        "or corrective work remaining on the punch list.",
    ),
  );

  const summary = str(v, "work_summary");
  out.push(heading("Summary of Work"));
  if (summary) out.push(para(summary));

  out.push(
    heading("Effect of Substantial Completion"),
    para("As of the Substantial Completion date stated above:"),
    numberList([
      "**Statutory warranties commence.** The warranty periods under Minn. Stat. § 327A begin to run: one (1) year for defects in workmanship and materials; two (2) years for defects in electrical, plumbing, heating, cooling, and ventilation systems; and ten (10) years for major construction defects, each as defined by statute and the Agreement.",
      "**Retainage release.** Any retainage withheld under the Agreement shall be released no later than sixty (60) days after Substantial Completion, consistent with Minn. Stat. § 337.10.",
      "**Punch list period begins.** Client has fourteen (14) calendar days from receipt of this Certificate to inspect the project and deliver a written punch list. Contractor will complete punch list items within fourteen (14) calendar days of receipt, or within a mutually agreed extended timeline for items requiring additional lead time. If no punch list is delivered within the fourteen-day period, the work is deemed accepted as substantially complete per the Agreement.",
      "**Final payment.** The final payment balance under the Agreement is due upon Substantial Completion as set forth in the payment schedule.",
    ]),
  );

  out.push(
    heading("Punch List Status"),
    infoGrid([
      { label: "Punch list items complete", value: str(v, "punch_done", "0") },
      { label: "Punch list items open", value: str(v, "punch_open", "0") },
    ]),
  );
  const punch = table(v, "punch_list_items");
  if (punch && punch.rows.length) out.push(tableSection(punch));

  out.push(
    heading("Account Summary"),
    infoGrid([
      { label: "Total contract price (incl. executed Change Orders)", value: money(v, "contract_total") },
      { label: "Paid to date", value: money(v, "paid_to_date") },
      { label: "Final balance due", value: money(v, "balance_due") },
    ]),
  );

  out.push(
    heading("Warranty Contact"),
    para(
      `Warranty claims should be submitted in writing to ${co} at ${str(v, "company_email")} or ${str(v, "company_address")}, ` +
        "per the Notice and Right to Cure provisions of the Agreement.",
    ),
  );

  out.push(
    heading("Acknowledgment"),
    para(
      "This Certificate documents the Substantial Completion date for the purposes described above. It does not waive " +
        "Client's punch-list rights, statutory warranty rights, or Contractor's right to final payment under the Agreement.",
    ),
    para("By signing below, the Parties acknowledge the Substantial Completion date stated above."),
    signatureBlock([
      { role: co },
      { role: "Client", name: str(v, "client_name") },
    ]),
  );

  return out;
}

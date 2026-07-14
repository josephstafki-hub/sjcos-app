// Waiver and Release of Mechanic's Lien template (key `lien_release`).
//
// CANONICAL LEGAL TEXT: docs/reference/doc-templates/lien-release.md (source of
// truth — BUMP `version` on any change). One template, four variants selected by
// the `waiver_type` enum; build() emits ONLY the selected variant's body
// paragraph. Amounts auto from projects/invoices/retainers. Supersedes the
// simpler renderLienWaiverPdf in lib/documents.ts after cutover.

import type { DocTemplate, FieldValues, TemplateSection } from "./types";
import {
  heading,
  infoGrid,
  infoStrip,
  money,
  notaryBlock,
  para,
  signatureBlock,
  str,
} from "./blocks";

export const WAIVER_TYPES = [
  "partial_conditional",
  "partial_unconditional",
  "final_conditional",
  "final_unconditional",
] as const;
export type WaiverType = (typeof WAIVER_TYPES)[number];

const WAIVER_TITLES: Record<WaiverType, string> = {
  partial_conditional: "Partial Conditional Waiver and Release of Lien",
  partial_unconditional: "Partial Unconditional Waiver and Release of Lien",
  final_conditional: "Final Conditional Waiver and Release of Lien",
  final_unconditional: "Final Unconditional Waiver and Release of Lien",
};

export function waiverTitle(t: string): string {
  return WAIVER_TITLES[t as WaiverType] ?? "Waiver and Release of Lien";
}

export const lienReleaseTemplate: DocTemplate = {
  key: "lien_release",
  version: "2026-07-10.1",
  title: "Waiver and Release of Lien",
  subtitle: "Mechanic's lien waiver under Minnesota Statutes chapter 514.",
  docClass: "legal",
  scope: "project",
  fields: [
    { key: "company_name", label: "Company name", kind: "text", source: "auto", required: true },
    { key: "company_address", label: "Company address", kind: "text", source: "auto", required: true },
    { key: "company_phone", label: "Company phone", kind: "text", source: "auto", required: true },
    { key: "company_email", label: "Company email", kind: "text", source: "auto", required: true },
    { key: "company_license", label: "Company license", kind: "text", source: "auto", required: false },
    {
      key: "waiver_type",
      label: "Waiver type",
      kind: "enum",
      source: "owner",
      required: true,
      enumValues: WAIVER_TYPES,
      help: "Partial vs. final × conditional (payment promised) vs. unconditional (payment cleared).",
    },
    { key: "project_name", label: "Project / job", kind: "text", source: "auto", required: true },
    { key: "document_date", label: "Date", kind: "date", source: "auto", required: true },
    { key: "owner_name", label: "Property owner", kind: "text", source: "auto", required: true },
    { key: "property_address", label: "Property address", kind: "text", source: "auto", required: true },
    { key: "legal_description", label: "Legal description", kind: "text", source: "owner", required: false },
    { key: "contract_number", label: "Original contract ref. #", kind: "text", source: "auto", required: false },
    {
      key: "payment_amount",
      label: "Payment amount",
      kind: "money_cents",
      source: "owner",
      required: true,
      help: "Amount covered by THIS waiver (the draw/payment being waived against).",
    },
    { key: "through_date", label: "Furnished through", kind: "date", source: "owner", required: true },
    { key: "invoice_reference", label: "Invoice / draw reference", kind: "text", source: "owner", required: false },
    { key: "contract_total", label: "Total contract price", kind: "money_cents", source: "auto", required: true },
    { key: "paid_to_date", label: "Total paid to date", kind: "money_cents", source: "auto", required: true },
    { key: "balance_remaining", label: "Balance remaining", kind: "money_cents", source: "auto", required: true },
    { key: "include_notary", label: "Include notary block", kind: "enum", source: "owner", required: false, enumValues: ["yes", "no"] },
  ],
  build,
  titleFor: (v) => waiverTitle(str(v, "waiver_type")),
};

function build(v: FieldValues): TemplateSection[] {
  const co = str(v, "company_name", "the Contractor");
  const amount = money(v, "payment_amount");
  const through = str(v, "through_date", "the date stated above");
  const type = str(v, "waiver_type") as WaiverType;
  const out: TemplateSection[] = [];

  out.push(
    infoStrip([
      { label: "Project / Job", value: str(v, "project_name") },
      { label: "Date", value: str(v, "document_date") },
    ]),
    infoGrid([
      { label: "Claimant (Contractor)", value: `${co}, ${str(v, "company_address")}` },
      { label: "Property Owner", value: str(v, "owner_name") },
      { label: "Property Address", value: str(v, "property_address") },
      { label: "Legal Description (if known)", value: str(v, "legal_description", "—") },
      { label: "Original Contract Ref. #", value: str(v, "contract_number", "—") },
    ]),
  );

  // PAYMENT
  out.push(
    heading("Payment"),
    infoGrid([
      { label: "Payment amount covered by this waiver", value: amount },
      { label: "For labor/materials furnished through", value: through },
      { label: "Invoice / draw reference", value: str(v, "invoice_reference", "—") },
    ]),
  );

  // WAIVER AND RELEASE — only the selected variant.
  out.push(heading("Waiver and Release"));
  out.push(para(waiverBody(type, co, amount, through)));

  // SUBCONTRACTORS AND SUPPLIERS (all variants)
  out.push(
    heading("Subcontractors and Suppliers"),
    para(
      "Claimant warrants that all subcontractors, laborers, and material suppliers engaged by Claimant for the work " +
        `covered by this waiver have been paid in full, or will be paid in full from the payment identified above, for ` +
        `labor and materials furnished through ${through}. Lien waivers from subcontractors and suppliers who provided ` +
        "pre-lien notice are available to the Owner upon written request, consistent with the notice provisions of the " +
        "Agreement and Minn. Stat. § 514.011.",
    ),
  );

  // AMOUNTS (auto summary)
  out.push(
    heading("Amounts"),
    infoGrid([
      { label: "Total contract price (incl. executed Change Orders)", value: money(v, "contract_total") },
      { label: "Total paid to date (incl. this payment if unconditional)", value: money(v, "paid_to_date") },
      { label: "Balance remaining after this payment", value: money(v, "balance_remaining") },
    ]),
  );

  // SIGNATURE
  out.push(
    heading("Signature"),
    para("The person signing below is authorized to execute this waiver on behalf of Claimant."),
    signatureBlock([{ role: `${co} — signature / printed name & title` }]),
  );

  // NOTARIZATION (optional)
  if (str(v, "include_notary") === "yes") {
    out.push(heading("Notarization"), notaryBlock());
  }

  return out;
}

function waiverBody(type: WaiverType, co: string, amount: string, through: string): string {
  switch (type) {
    case "partial_conditional":
      return (
        `Upon receipt and clearance of payment in the amount of ${amount}, the undersigned Claimant waives and releases ` +
        "any and all mechanic's lien, claim, or right to lien under Minnesota Statutes chapter 514 upon the real property " +
        "and improvements identified above, on account of labor, services, materials, or equipment furnished by Claimant " +
        `for the project through ${through} only. **This waiver is conditioned on actual receipt and clearance of the ` +
        "payment identified above and is of no force or effect until that condition is satisfied.** This waiver does not " +
        `cover: (a) labor, services, materials, or equipment furnished after ${through}; (b) retainage; (c) amounts owing ` +
        "under executed but unbilled Change Orders; or (d) claims for disputed work identified in writing before the date of this waiver."
      );
    case "partial_unconditional":
      return (
        `The undersigned Claimant acknowledges receipt of payment in the amount of ${amount}, and in consideration of that ` +
        "payment waives and releases any and all mechanic's lien, claim, or right to lien under Minnesota Statutes chapter " +
        "514 upon the real property and improvements identified above, on account of labor, services, materials, or " +
        `equipment furnished by Claimant for the project through ${through} only. This waiver does not cover: (a) labor, ` +
        `services, materials, or equipment furnished after ${through}; (b) retainage; (c) amounts owing under executed but ` +
        "unbilled Change Orders; or (d) claims for disputed work identified in writing before the date of this waiver."
      );
    case "final_conditional":
      return (
        `Upon receipt and clearance of final payment in the amount of ${amount}, the undersigned Claimant waives, releases, ` +
        "and relinquishes any and all mechanic's lien, claim, or right to lien under Minnesota Statutes chapter 514 upon " +
        "the real property and improvements identified above, on account of any and all labor, services, materials, or " +
        "equipment furnished by Claimant for the project. **This waiver is conditioned on actual receipt and clearance of " +
        "the payment identified above and is of no force or effect until that condition is satisfied.**"
      );
    case "final_unconditional":
    default:
      return (
        `For and in consideration of final payment in the amount of ${amount}, the receipt and sufficiency of which is ` +
        "hereby acknowledged, the undersigned Claimant does hereby unconditionally waive, release, and relinquish any and " +
        "all mechanic's lien, claim, or right to lien it has under Minnesota Statutes chapter 514 upon the real property " +
        "and improvements identified above, on account of any and all labor, services, materials, or equipment furnished " +
        `by Claimant for the project. This waiver and release is unconditional and covers all work performed through ${through}.`
      );
  }
}

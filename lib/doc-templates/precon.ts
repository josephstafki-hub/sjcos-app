// Pre-Construction Agreement template (key `precon`).
//
// CANONICAL LEGAL TEXT: docs/reference/doc-templates/preconstruction-agreement.md
// (source of truth for language — BUMP `version` on any change). Works
// lead-scoped OR project-scoped (precon is signed before a project row may
// exist). Billing-rates table + markup pcts come from app_settings `rates.*`.

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

export const preconTemplate: DocTemplate = {
  key: "precon",
  version: "2026-07-10.2",
  title: "Pre-Construction Agreement",
  subtitle: "Professional pre-construction services for the project identified below.",
  docClass: "legal",
  scope: "both",
  fields: [
    { key: "company_name", label: "Company name", kind: "text", source: "auto", required: true },
    { key: "company_address", label: "Company address", kind: "text", source: "auto", required: true },
    { key: "company_phone", label: "Company phone", kind: "text", source: "auto", required: true },
    { key: "company_email", label: "Company email", kind: "text", source: "auto", required: true },
    { key: "company_license", label: "Company license", kind: "text", source: "auto", required: false },
    { key: "agreement_number", label: "Agreement #", kind: "text", source: "auto", required: true },
    { key: "agreement_date", label: "Agreement date", kind: "date", source: "auto", required: true },
    {
      key: "precon_fee",
      label: "Pre-construction fee",
      kind: "money_cents",
      source: "owner",
      required: true,
      help: "Flat non-refundable pre-construction retainer.",
    },
    { key: "client_name", label: "Client name", kind: "text", source: "auto", required: true },
    { key: "client_address", label: "Client address", kind: "text", source: "owner", required: false },
    { key: "client_city_state_zip", label: "Client city, state, ZIP", kind: "text", source: "owner", required: false },
    { key: "client_phone", label: "Client phone", kind: "text", source: "auto", required: false },
    { key: "client_email", label: "Client email", kind: "text", source: "auto", required: false },
    { key: "project_address", label: "Project address", kind: "text", source: "auto", required: false },
    { key: "markup_pct", label: "Third-party markup %", kind: "text", source: "auto", required: true },
    { key: "billing_rates_table", label: "Billing rates", kind: "table", source: "auto", required: true },
  ],
  build,
};

function build(v: FieldValues): TemplateSection[] {
  const co = str(v, "company_name", "the Contractor");
  const fee = money(v, "precon_fee");
  const out: TemplateSection[] = [];

  out.push(
    infoStrip([
      { label: "Agreement #", value: str(v, "agreement_number") },
      { label: "Date", value: str(v, "agreement_date") },
      { label: "Pre-construction fee", value: fee },
    ]),
    infoGrid([
      { label: "Client Name", value: str(v, "client_name") },
      { label: "Client Address", value: str(v, "client_address", "—") },
      { label: "City, State, ZIP", value: str(v, "client_city_state_zip", "—") },
      { label: "Client Phone", value: str(v, "client_phone", "—") },
      { label: "Client Email", value: str(v, "client_email", "—") },
      { label: "Project Address", value: str(v, "project_address", "—") },
    ]),
  );

  out.push(
    heading("Purpose of This Agreement"),
    para(
      `This Pre-Construction Agreement establishes the scope, compensation, and terms under which ${co} will provide ` +
        "pre-construction services for the project identified above. The goal of the pre-construction phase is to fully " +
        "develop the project before construction begins — producing a complete Scope of Work, final material selections, " +
        "and a construction-ready budget that aligns with the Client's financial goals.",
    ),
    para(
      `Pre-construction is a dedicated professional engagement. The fee outlined in this agreement compensates ${co} for ` +
        "the design coordination, estimating, selection guidance, and planning work required to bring a project from " +
        "concept to a signed construction contract.",
    ),
  );

  out.push(
    heading("Scope of Pre-Construction Services"),
    para(`${co} will provide the following services during the pre-construction phase:`),
    para("**Design Coordination & Scope Development**"),
    bulletList([
      "Meet with the Client to establish project goals, priorities, and budget parameters.",
      `Coordinate with architects, designers, and other consultants engaged by the Client or ${co} to develop construction drawings and specifications.`,
      "Review design documents for constructibility and flag issues before they reach the field.",
      "Produce a final, written Scope of Work that defines exactly what will be built, how it will be built, and what materials will be used.",
    ]),
    para("**Estimating & Budget Management**"),
    bulletList([
      "Develop a preliminary budget based on the project concept, adjusted as design progresses.",
      "Refine the budget through each design phase, incorporating subcontractor input, material pricing, and real-time market conditions.",
      "Provide value engineering analysis when design intent and budget are in conflict — offering alternatives that preserve the project's goals at a lower cost.",
      "Deliver a final construction budget aligned with the Client's stated financial parameters prior to entering the construction phase.",
    ]),
    para("**Material Selections**"),
    bulletList([
      "Guide the Client through all material and finish selections required to complete the project — flooring, tile, cabinetry, fixtures, hardware, and any other specified items.",
      "Confirm product availability, lead times, and accurate pricing for all selections.",
      "Document all confirmed selections in a project specifications sheet that feeds directly into the final construction budget and Scope of Work.",
    ]),
    para("**Subcontractor & Vendor Coordination**"),
    bulletList([
      "Solicit bids and input from key subcontractors and specialty vendors relevant to the project scope.",
      `Conduct site visits as needed with ${co}'s trade partners to review existing conditions and develop accurate scopes.`,
    ]),
    para("**Scheduling & Permitting**"),
    bulletList([
      "Prepare a preliminary project schedule integrating design milestones, permit timelines, material procurement, and construction sequencing.",
      "Identify required permits, inspections, and approvals; coordinate their submission or preparation as part of the pre-construction process.",
    ]),
    para(
      `**Additional Pre-Construction Work.** If the Client requests work beyond the services listed above — such as ` +
        `exploratory demolition, invasive investigation, or minor temporary repairs — ${co} will provide a written cost ` +
        "estimate for the Client's written approval before proceeding. Approved additional work will be billed at cost " +
        "plus the applicable markup and is not drawn against the pre-construction retainer.",
    ),
    para(
      `**Limitations.** Pre-construction services are provided by ${co} in its capacity as a contractor. They are not a ` +
        "substitute for licensed architectural, engineering, or design services. The Client is responsible for retaining " +
        "any licensed professionals required by the project.",
    ),
  );

  out.push(
    heading("Compensation"),
    para(
      `**Pre-Construction Retainer.** The pre-construction fee of **${fee}** is due in full upon execution of this ` +
        `agreement. This fee is a flat, non-refundable retainer that covers all ${co} labor associated with the services ` +
        "described above — design coordination, estimating, selection guidance, scope development, and project planning.",
    ),
    para(
      `No hourly invoices will be issued against the retainer. The retainer is the total cost for ${co}'s pre-construction ` +
        "labor, regardless of how many hours are required to complete the work.",
    ),
    para(
      `**Credit Toward Construction.** If the Client proceeds to a signed construction contract with ${co}, the full ` +
        "pre-construction retainer will be credited toward the total construction price. The retainer is not an additional " +
        "cost — it is an advance against the build.",
    ),
    para(
      `If the Client chooses not to proceed to construction, the retainer is non-refundable. ${co} retains the fee as ` +
        "compensation for the professional services rendered.",
    ),
    para(
      `**Third-Party Costs — Billed Separately.** The pre-construction retainer covers ${co}'s own labor only. The ` +
        "following costs are billed separately and are not included in the retainer:",
    ),
    bulletList([
      "**Subcontractor fees** — Any trade partner engaged during pre-construction (structural engineer, architect, surveyor, geotechnical firm, etc.) is billed at the subcontractor's invoice cost plus the markup set out below.",
      "**Permits, tests, and studies** — Permit application fees, soil tests, environmental studies, utility surveys, and any other third-party fees required by the project are billed at cost plus the applicable markup.",
      `**Materials** — Any materials purchased by ${co} during pre-construction are billed at cost plus the applicable markup.`,
    ]),
    para(
      "Third-party invoices will be transmitted to the Client as they are incurred and are due upon receipt. These costs " +
        "are in addition to the pre-construction retainer and are separate from the construction contract.",
    ),
    para("**Markup on Third-Party Costs.** All subcontractor, material, and permit costs are marked up as follows:"),
    bulletList([
      `${str(v, "markup_pct", "20%")} for profit and overhead`,
      "Applicable state and local tax",
    ]),
  );

  out.push(
    heading("Schedule of Billing Rates"),
    para(
      "The following rates apply to any time-and-material work performed outside the pre-construction retainer scope, " +
        "if authorized in writing by the Client.",
    ),
  );
  const rates = table(v, "billing_rates_table");
  if (rates) out.push(tableSection(rates));
  out.push(
    para(
      "*Rates are valid through December 2026 and subject to a 3% annual increase on January 1st of each calendar year " +
        "to account for inflation, wage increases, and overhead adjustments.*",
    ),
  );

  out.push(
    heading("Payment Terms"),
    para(
      "The pre-construction retainer is due in full upon execution of this agreement. Third-party invoices are due upon receipt.",
    ),
    para(
      `If the Client has a question or dispute regarding any invoice, the Client agrees to contact ${co} in writing within ` +
        "ten (10) days of receipt. Invoices not disputed within that period are deemed accepted and payable in full. If a " +
        "portion of an invoice is disputed, the Client agrees to pay the undisputed portion within ten (10) days and provide " +
        "a written explanation of the grounds for withholding the remainder.",
    ),
    para(
      "A late fee of 1.5% per month (or the maximum rate permitted by law, whichever is lower) will be applied to any " +
        "outstanding balance more than thirty (30) days past due.",
    ),
  );

  out.push(
    heading("Insurance & Liability"),
    para(
      `${co} will maintain general liability insurance with limits of $1,000,000 per occurrence and $2,000,000 aggregate ` +
        "for the duration of this agreement.",
    ),
    para(
      `The Client is responsible for maintaining their own property and liability insurance. The Client's policy should ` +
        `name ${co} and its subcontractors and vendors as additional insureds.`,
    ),
    para(
      `The Client and ${co} mutually waive all rights of recovery against one another and their respective subcontractors, ` +
        "agents, employees, and vendors for any loss or damage covered by the Client's property insurance.",
    ),
    para(
      `To the fullest extent permitted by law, ${co}'s total liability to the Client for any and all claims arising from or ` +
        "related to this agreement — including its subcontractors, vendors, and agents — shall not exceed the pre-construction " +
        "fee paid under this agreement.",
    ),
  );

  out.push(
    heading("Cancellation"),
    para(
      "Either party may terminate this agreement with written notice. In the event of termination, the pre-construction " +
        "retainer is non-refundable. Any approved third-party costs incurred prior to termination remain the Client's " +
        "responsibility and are payable upon receipt of final invoice.",
    ),
    para(
      `**Notice of Right to Cancel.** If this agreement was signed at a location other than ${co}'s principal place of ` +
        "business, the Client has the right to cancel within three (3) business days of signing by delivering written notice " +
        `to ${co} by mail, email, or hand delivery no later than midnight of the third business day.`,
    ),
  );

  out.push(
    heading("Agreement & Signatures"),
    para(
      "By signing below, both parties acknowledge they have read, understood, and agreed to the terms of this " +
        "Pre-Construction Agreement.",
    ),
    signatureBlock([
      { role: "Client", name: str(v, "client_name") },
      { role: co },
    ]),
  );

  return out;
}

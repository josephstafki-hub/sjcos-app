// Construction Contract template (key `contract`).
//
// CANONICAL LEGAL TEXT: docs/reference/doc-templates/construction-contract.md —
// that .md is the source of truth for the language; transcribe changes from
// there and BUMP `version` on any language change. Visual house style from
// SJC_Contract_Template.docx. Auto fields come from project + estimate (+ draw
// schedule); `sow_narrative` is the only AI-writable field. Money is CENTS.

import type { DocTemplate, FieldValues, TemplateSection } from "./types";
import {
  bulletList,
  heading,
  infoGrid,
  infoStrip,
  money,
  numberList,
  para,
  signatureBlock,
  statutoryNotice,
  str,
  table,
  tableSection,
} from "./blocks";

export const contractTemplate: DocTemplate = {
  key: "contract",
  version: "2026-07-10.2",
  title: "Construction Contract",
  subtitle: "A binding agreement between the parties named below.",
  docClass: "legal",
  attorneyReviewed: true,
  scope: "project",
  fields: [
    // Company block (auto from app_settings)
    { key: "company_name", label: "Company name", kind: "text", source: "auto", required: true },
    { key: "company_address", label: "Company address", kind: "text", source: "auto", required: true },
    { key: "company_phone", label: "Company phone", kind: "text", source: "auto", required: true },
    { key: "company_email", label: "Company email", kind: "text", source: "auto", required: true },
    { key: "company_license", label: "Company license", kind: "text", source: "auto", required: false },
    // Doc header
    { key: "contract_number", label: "Contract #", kind: "text", source: "auto", required: true },
    { key: "contract_date", label: "Contract date", kind: "date", source: "auto", required: true },
    { key: "contract_total", label: "Total contract price", kind: "money_cents", source: "auto", required: true },
    // Client / project
    { key: "client_name", label: "Client name", kind: "text", source: "auto", required: true },
    { key: "client_address", label: "Client address", kind: "text", source: "owner", required: false },
    { key: "client_city_state_zip", label: "Client city, state, ZIP", kind: "text", source: "owner", required: false },
    { key: "client_phone", label: "Client phone", kind: "text", source: "owner", required: false },
    { key: "client_email", label: "Client email", kind: "text", source: "auto", required: false },
    { key: "project_address", label: "Project address", kind: "text", source: "auto", required: true },
    // Tables (auto from estimate)
    { key: "payment_schedule_table", label: "Payment schedule", kind: "table", source: "auto", required: true },
    { key: "sow_line_items_table", label: "SOW line items", kind: "table", source: "auto", required: true },
    // AI narrative
    {
      key: "sow_narrative",
      label: "Scope-of-work narrative",
      kind: "narrative",
      source: "ai",
      required: false,
      help: "2–5 sentences describing the agreed scope; grounded on the estimate, never invents pricing.",
    },
  ],
  build,
};

function build(v: FieldValues): TemplateSection[] {
  const co = str(v, "company_name", "the Contractor");
  const total = money(v, "contract_total");
  const out: TemplateSection[] = [];

  // Page-one info strip + parties grid.
  out.push(
    infoStrip([
      { label: "Contract #", value: str(v, "contract_number") },
      { label: "Date", value: str(v, "contract_date") },
      { label: "Total contract price", value: total },
    ]),
    infoGrid([
      { label: "Client Name", value: str(v, "client_name") },
      { label: "Client Address", value: str(v, "client_address", "—") },
      { label: "City, State, ZIP", value: str(v, "client_city_state_zip", "—") },
      { label: "Client Phone", value: str(v, "client_phone", "—") },
      { label: "Client Email", value: str(v, "client_email", "—") },
      { label: "Project Address", value: str(v, "project_address") },
    ]),
    heading("General Contractor Contract Agreement", 1),
  );

  // AGREEMENT
  out.push(
    heading("Agreement"),
    para(
      `This General Contractor Contract Agreement ("Agreement") is entered into by and between ` +
        `${co}, located at ${str(v, "company_address")} ("General Contractor"), and the undersigned client named above.`,
    ),
    para(
      `${co} and Client are referenced together as **"Parties"** or individually as **"Party."** ` +
        `This Agreement shall commence on the date of the last Party to sign below (the **"Effective Date"**). ` +
        `In consideration of their respective rights and obligations set forth herein, the Parties agree as follows:`,
    ),
  );

  // MECHANICS LIEN NOTICE (statutory, ≥10-pt bold)
  out.push(
    heading("Notice Required by Minnesota Law — Mechanics Lien Rights"),
    statutoryNotice(
      "Any person or company supplying labor or materials for this improvement to your real property " +
        "may file a lien against your property if that person or company is not paid for their contributions. " +
        "Under Minnesota law, you have the right to pay persons who supplied labor or materials for this project " +
        "directly and deduct this amount from our contract price, or withhold the amounts due them from us until " +
        "120 days after completion of the improvement unless we give you a lien waiver signed by persons who " +
        "supplied any labor or material for the improvement and who gave you timely notice.",
    ),
    para(
      "You have the right to receive from us, upon written request, the following information within 15 days of your request:",
    ),
    numberList([
      "A list of all persons or companies supplying labor or materials for the project; and",
      "The amount due or to become due to each of them.",
    ]),
  );

  // CONTRACTOR RECOVERY FUND
  out.push(
    heading("Notice — Minnesota Contractor Recovery Fund (Minn. Stat. § 326B.89)"),
    para(
      "If you are a residential homeowner and you have a financial loss caused by the work of a licensed " +
        "residential contractor or residential remodeler, you may be able to recover your losses from the " +
        "Contractor Recovery Fund. To make a claim to the fund, you must first obtain a court judgment against " +
        "the contractor and provide evidence that the judgment cannot be collected. For more information about " +
        "the Contractor Recovery Fund, contact the Minnesota Department of Labor and Industry, 443 Lafayette " +
        "Road North, Saint Paul, MN 55155, (651) 284-5065.",
    ),
  );

  // SERVICES
  out.push(
    heading("Services"),
    para(
      `${co} agrees to perform the services ("Services") as described in the Statement of Work ("SOW") attached ` +
        `to this Agreement as Exhibit A, which is incorporated herein by reference. Client should review the SOW ` +
        `carefully to confirm that it accurately describes the agreed scope and pricing before signing.`,
    ),
  );

  // TERM
  out.push(
    heading("Term"),
    para(
      "This Agreement shall begin on the Effective Date and continue until the conclusion of all Services " +
        "described in any outstanding SOW, unless terminated earlier as set forth below.",
    ),
  );

  // CONTRACT PRICE AND PAYMENT
  out.push(
    heading("Contract Price and Payment"),
    para(
      `The total contract price is **${total}**, payable according to the following schedule, as set forth in the SOW:`,
    ),
  );
  const pay = table(v, "payment_schedule_table");
  if (pay) out.push(tableSection(pay));
  out.push(
    para(
      "Invoices are due **Net 7** — within seven (7) days of the invoice date. Final Payment is the remaining " +
        "balance, calculated as the total contract price minus all prior payments, due upon Substantial Completion.",
    ),
    para(
      "If retainage is withheld, it shall not exceed five percent (5%) of any progress payment, consistent with " +
        "Minn. Stat. § 337.10, subd. 4. All retained amounts shall be released no later than 60 days after Substantial Completion.",
    ),
    para(
      "Undisputed amounts not paid when due shall accrue interest at a rate of one and one-half percent (1.5%) " +
        "per month, with a minimum monthly charge of $10.00 on balances of $100.00 or more, as provided by Minn. " +
        `Stat. § 337.10. ${co} reserves the right to suspend work immediately if any undisputed payment is not ` +
        "received within ten (10) days of its due date.",
    ),
  );

  // TERMINATION
  out.push(
    heading("Termination"),
    para(
      "**Termination by Client.** Client may terminate this Agreement upon no fewer than five (5) business days' " +
        `written notice to ${co}, provided ${co} is not in material default. Upon such termination, Client shall ` +
        "pay: (a) all amounts due for Services completed through the termination date; (b) the cost of all materials " +
        "ordered or committed to the project that cannot be reasonably returned or canceled; and (c) a demobilization " +
        "fee equal to five percent (5%) of the unbilled balance of the contract price. All in-process material orders " +
        "shall be delivered to Client subject to payment of any outstanding balance.",
    ),
    para(
      `**Termination by General Contractor.** ${co} may terminate this Agreement immediately upon written notice if ` +
        "Client fails to make any undisputed payment within ten (10) days of its due date, or upon five (5) business " +
        `days' written notice for any other material breach by Client that remains uncured after such notice period. ` +
        `${co} may also terminate for any non-default reason upon five (5) business days' written notice, in which ` +
        "case it shall be entitled only to payment for Services completed and materials committed prior to the termination date.",
    ),
  );

  // NOTICE OF RIGHT TO CANCEL (MN home-solicitation 3-business-day notice)
  out.push(
    heading("Notice of Right to Cancel"),
    para(
      `If this Agreement was signed at a location other than ${co}'s principal place of business, Client has the ` +
        "right to cancel this Agreement within three (3) business days of signing by delivering written notice to " +
        `${co} by mail, email, or hand delivery no later than midnight of the third business day. Upon timely ` +
        "cancellation, any payments made by Client shall be refunded, less the cost of any materials ordered or work " +
        "performed at Client's request before cancellation.",
    ),
  );

  // EXPENSES
  out.push(
    heading("Expenses"),
    para(
      `Expenses are amounts ${co} reasonably incurs in connection with the Services, including but not limited to: ` +
        "obtaining material samples, parking, postage and handling, freight, transportation, printing, and storage. " +
        `Client agrees to reimburse ${co} for all reasonable, documented Expenses. ${co} will provide reasonable ` +
        "advance notice of material expenses where possible, and Client may request supporting documentation prior to " +
        "payment of any Expense invoice.",
    ),
  );

  // INSURANCE
  out.push(
    heading("Insurance"),
    para(
      `**General Contractor Insurance.** ${co} maintains commercial general liability insurance with limits of no ` +
        "less than **$1,000,000 per occurrence / $2,000,000 aggregate** and workers' compensation insurance as " +
        "required by Minnesota law. Certificates of insurance are available upon request.",
    ),
    para(
      "**Client Insurance.** Client shall procure and maintain property insurance against loss or damage to the " +
        "project site and any materials stored on site throughout the duration of the project. Client is solely " +
        `responsible for insuring Client's personal property. ${co} strongly recommends the installation of security ` +
        "cameras and other monitoring measures to secure the premises during construction.",
    ),
  );

  // PERMITS
  out.push(
    heading("Permits"),
    para(
      `${co} is responsible for obtaining all building permits, licenses, and governmental approvals required for ` +
        "the Services, unless otherwise specified in the SOW. The cost of required permits shall be included in the " +
        "project price or billed to Client at cost with no markup, as specified in the SOW.",
    ),
  );

  // SUBSTANTIAL COMPLETION
  out.push(
    heading("Substantial Completion"),
    para(
      `**"Substantial Completion"** means the stage of the project at which the work is sufficiently complete in ` +
        "accordance with this Agreement so that Client can occupy or utilize the project for its intended purpose, " +
        "notwithstanding minor items or corrective work remaining on the punch list. Substantial Completion triggers " +
        "the commencement of applicable statutory warranty periods under Minn. Stat. § 327A and the obligation to " +
        "release retainage as provided in Minn. Stat. § 337.10.",
    ),
  );

  // NOTICE AND RIGHT TO CURE
  out.push(
    heading("Notice and Right to Cure"),
    para(
      `Before pursuing any legal remedy for an alleged defect in the Services, Client shall provide ${co} with ` +
        `written notice describing the alleged defect in reasonable detail. ${co} shall have thirty (30) days after ` +
        "receipt of such notice, or such additional time as is reasonably necessary, to inspect the alleged defect and " +
        `submit a written offer to repair, replace, or otherwise remedy the condition. Client shall provide ${co} and ` +
        "its representatives reasonable access to the project site for inspection and remediation. This right to cure " +
        "does not waive any statute of limitations or repose applicable to Client's claims.",
    ),
  );

  // WARRANTIES
  out.push(
    heading("Warranties"),
    para(
      `${co} warrants that the Services will be performed in a workmanlike manner and in conformance with all ` +
        "applicable building codes and this Agreement. The following statutory warranties apply to this project under " +
        "Minn. Stat. § 327A:",
    ),
    bulletList([
      "One (1) year from the date of Substantial Completion for defects in workmanship and materials;",
      "Two (2) years from the date of Substantial Completion for defects in electrical, plumbing, heating, cooling, and ventilation systems; and",
      "Ten (10) years from the date of Substantial Completion for major construction defects affecting the structural integrity of the improvement.",
    ]),
    para(
      "These statutory warranties supplement, and are not replaced by, any other warranty provided in this Agreement. " +
        `${co} does not warrant that the Services will be free from all defects, but commits to promptly address warranty ` +
        "claims in accordance with the Notice and Right to Cure section above. Manufacturer warranties on materials, " +
        `fixtures, and appliances are passed through to Client and are the responsibility of the respective manufacturer. ` +
        `${co} warrants that it holds a current Minnesota residential contractor or remodeler license and that all work ` +
        "will be performed in compliance with Minn. Stat. § 326B.",
    ),
  );

  // INDEMNIFICATION AND LIMITATION OF LIABILITY
  out.push(
    heading("Indemnification and Limitation of Liability"),
    para(
      "Neither Party shall be liable to the other for any consequential, special, punitive, exemplary, or indirect " +
        "damages, including but not limited to lost profits, loss of revenue, economic loss, loss of use, or " +
        "interruption of business, arising out of this Agreement under any theory of liability. In no event shall the " +
        `total liability of either Party exceed the total amounts paid to ${co} as compensation under this Agreement. ` +
        "The foregoing limitation does not apply to claims arising from gross negligence or willful misconduct.",
    ),
    para(
      `Client agrees to indemnify, defend, and hold ${co} harmless from and against any third-party claims, losses, ` +
        "liabilities, damages, costs, and expenses (including reasonable attorneys' fees) arising from the negligence " +
        "or intentional misconduct of Client or any architect, designer, vendor, or agent retained directly by Client.",
    ),
    para(
      `${co} agrees to indemnify, defend, and hold Client harmless from and against any third-party claims, losses, ` +
        "liabilities, damages, costs, and expenses (including reasonable attorneys' fees) arising from the negligent, " +
        `reckless, or intentional acts or omissions of ${co} or its employees, subject to the limitation of liability set forth above.`,
    ),
  );

  // FORCE MAJEURE
  out.push(
    heading("Force Majeure"),
    para(
      "If either Party's performance is rendered impossible, unlawful, or commercially unreasonable due to events " +
        "beyond its reasonable control — including but not limited to natural disasters, supply chain disruptions, " +
        "governmental orders, labor strikes, or acts of war — that Party shall be temporarily excused from performance " +
        "for the duration of the event. The affected Party shall provide prompt written notice and shall resume " +
        "performance with due diligence once the event has ended. Project schedules and completion dates shall be adjusted accordingly.",
    ),
  );

  // DISPUTE RESOLUTION
  out.push(
    heading("Dispute Resolution"),
    para(
      "The Parties agree to attempt to resolve any dispute arising out of or relating to this Agreement first through " +
        "good-faith negotiation. If the dispute is not resolved within fifteen (15) days of written notice, the Parties " +
        "agree to submit the dispute to non-binding mediation before a mutually agreed-upon mediator prior to commencing " +
        "any litigation. The costs of mediation shall be shared equally. If mediation fails to resolve the dispute, " +
        "either Party may pursue its legal remedies as set forth below.",
    ),
  );

  // MISCELLANEOUS
  out.push(
    heading("Miscellaneous"),
    para(
      "**A. Non-Disparagement.** Each Party agrees not to make, publish, or cause to be made or published any false, " +
        "defamatory, or malicious statement about the other Party, including through print, electronic communications, " +
        "or any public or social media platform. Nothing in this section prohibits: (a) truthful statements made in " +
        "good faith to enforce this Agreement or protect legal rights; (b) information provided as required by law, " +
        "subpoena, or governmental inquiry; or (c) opinions or statements that are substantially true and based on personal experience.",
    ),
    para(
      "**B. Attorneys' Fees.** In any litigation or arbitration arising out of this Agreement, the prevailing Party " +
        "shall be entitled to recover its reasonable attorneys' fees and costs from the non-prevailing Party, as " +
        "determined by the court or arbitrator.",
    ),
    para(
      `**C. Relationship of the Parties.** ${co} is an independent contractor and not an employee, partner, joint ` +
        `venturer, or agent of Client. ${co} retains sole control over the means and methods of performing the Services ` +
        "and shall not bind Client to any contract or obligation.",
    ),
    para(
      "**D. Entire Agreement.** This Agreement, together with all attached exhibits and any executed Change Orders, " +
        "constitutes the entire agreement between the Parties and supersedes all prior agreements, representations, and " +
        "understandings, whether written or oral. This Agreement may not be amended except by a written instrument signed by both Parties.",
    ),
    para(
      "**E. Governing Law and Venue.** This Agreement shall be governed by and construed in accordance with the laws " +
        "of the State of Minnesota, without regard to conflict of law principles. Any litigation arising out of this " +
        "Agreement shall be brought exclusively in the state or federal courts located in Anoka County, Minnesota, and " +
        "each Party irrevocably submits to the personal jurisdiction of such courts. Pursuant to Minn. Stat. § 337.10, " +
        "any provision purporting to require litigation outside Minnesota is void and unenforceable.",
    ),
    para(
      "**F. Signatures; Counterparts.** An electronic signature shall be deemed an original signature for all purposes. " +
        "This Agreement may be executed in one or more counterparts, each of which shall be deemed an original, and all " +
        "of which together shall constitute one and the same instrument.",
    ),
    para(
      "**G. Severability.** If any provision of this Agreement is held to be invalid, illegal, or unenforceable, the " +
        "remaining provisions shall continue in full force and effect.",
    ),
    para(
      "**H. Notices.** All notices under this Agreement shall be in writing and delivered by email (with confirmation " +
        `of receipt), hand delivery, or certified mail to the addresses set forth in this Agreement. Notices to ${co} ` +
        "shall also be sent to:",
    ),
    para(
      `${co} | ${str(v, "company_address")} | ${str(v, "company_phone")} | ${str(v, "company_email")}`,
    ),
  );

  // SIGNATURES
  out.push(
    heading("Signatures"),
    para("By signing below, the Parties agree to be bound by all terms and conditions of this Agreement."),
    signatureBlock([
      { role: "Client", name: str(v, "client_name") },
      { role: co },
    ]),
  );

  // ── EXHIBIT A — STATEMENT OF WORK ──
  out.push(
    heading("Exhibit A — Statement of Work (SOW)", 1),
    para(
      `This Statement of Work is incorporated into and governed by the General Contractor Contract Agreement between ` +
        `${co} and Client. All capitalized terms not defined herein have the meanings set forth in the Agreement.`,
    ),
    heading("Scope of Work"),
  );
  const narrative = str(v, "sow_narrative");
  if (narrative) out.push(para(narrative));
  const sow = table(v, "sow_line_items_table");
  if (sow) out.push(tableSection(sow));
  out.push(
    para(
      "**Basis of Proposal:** This proposal is based on the project description, site conditions, and any drawings or " +
        "specifications provided to General Contractor as of the Effective Date. Any conditions discovered during " +
        "construction that differ materially from those assumed — including but not limited to concealed structural " +
        "defects, hazardous materials, or deviations from existing plans — shall be addressed by written Change Order.",
    ),
    heading("Payment Schedule"),
  );
  if (pay) out.push(tableSection(pay));
  out.push(
    heading("Change Orders"),
    para(
      `Either Party may request a modification to the Services ("Change Order") by: (a) providing the other Party ` +
        `written notice describing the requested change; (b) ${co} providing Client a written cost estimate for the ` +
        "change; and (c) both Parties executing a written Change Order confirming the agreed change, revised pricing, " +
        `and any adjusted completion date. ${co} is not obligated to commence work on any change until a Change Order ` +
        `is fully executed by both Parties. A Change Order deposit is required per ${co}'s standard Change Order deposit ` +
        "policy. Verbal authorization is not sufficient under any circumstance. All executed Change Orders become part of this SOW.",
    ),
    heading("Completion Inspection and Punch List"),
    para(
      `Upon reaching Substantial Completion, ${co} shall notify Client in writing. Within fourteen (14) calendar days ` +
        `of such notice, Client shall inspect the project and provide ${co} a written punch list of items to be completed ` +
        `or corrected. ${co} shall complete all punch list items within fourteen (14) calendar days of receiving the list, ` +
        "or within a mutually agreed extended timeline for items requiring additional lead time. Failure of Client to " +
        "provide a punch list within the fourteen-day period shall be deemed acceptance of the work as substantially complete.",
    ),
    heading("SOW Approval"),
    para(
      "By signing below, both Parties confirm that they have reviewed and agree to the scope, schedule, and payment " +
        "terms set forth in this Statement of Work.",
    ),
    signatureBlock([
      { role: "Client", name: str(v, "client_name") },
      { role: co },
    ]),
  );

  return out;
}

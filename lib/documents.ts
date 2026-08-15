import "server-only";

// Phase-4 document generation (closeout / collections / permits / incident) +
// shared PDF chrome (companyHeader/docTitle/palette) reused by
// lib/doc-render.ts's template engine. Deterministic rendering from real
// project/estimate data — narrative fields are AI-authored (passed in), never
// the binding figures. NOT a "use server" file — plain helpers called by
// lib/actions/*.ts. pdfkit is kept external in next.config so its runtime
// font-metric lookups work under `next start`.

import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { query, queryOne } from "./db";
import { fmtUsd } from "./cost-book-units";
import {
  type DrawLine,
  defaultDrawSchedule,
  parseDrawSchedule,
} from "./draw-schedule";

export interface DocLine {
  description: string;
  qty: number;
  unit: string;
  unitCost: number; // cents
  markup: number; // %
  extended: number; // cents
}
export interface DocLineGroup {
  section: string;
  lines: DocLine[];
  subtotal: number; // cents
}
export interface DocData {
  estimateId: number;
  title: string;
  projectName: string;
  projectSlug: string;
  clientName: string;
  clientEmail: string;
  company: { name: string; license: string; address: string; phone: string; email: string };
  terms: string;
  drawSchedule: DrawLine[];
  groups: DocLineGroup[];
  subtotal: number; // cents
  markupTotal: number; // cents
  total: number; // cents
  dateLabel: string;
}

function today(): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date());
}

/** Amount (cents) for a draw line given the contract total. */
export function drawAmount(total: number, percent: number): number {
  return Math.round((total * percent) / 100);
}

/** Gather everything needed to render a contract or SOW for an estimate. Returns
 *  null if the estimate (scoped to the project slug) doesn't exist. */
export async function gatherDocData(estimateId: number, slug: string): Promise<DocData | null> {
  const est = await queryOne<{
    id: string;
    title: string;
    subtotal: number;
    markup_total: number;
    total: number;
    draw_schedule: unknown;
    project_name: string;
    client_name: string | null;
  }>(
    `SELECT e.id, e.title, e.subtotal, e.markup_total, e.total, e.draw_schedule,
            p.name AS project_name, p.client_name
       FROM estimates e JOIN projects p ON p.id = e.project_id
      WHERE e.id = $1 AND p.slug = $2`,
    [estimateId, slug],
  );
  if (!est) return null;

  const { rows: lines } = await query<{
    description: string;
    section: string;
    unit: string;
    qty: string;
    unit_cost: number;
    markup: string;
    extended: number;
  }>(
    `SELECT description, section, unit, qty, unit_cost, markup, extended
       FROM estimate_lines WHERE estimate_id = $1 ORDER BY section, sort_order, id`,
    [estimateId],
  );

  // Group lines by section, preserving order.
  const groups: DocLineGroup[] = [];
  const byName = new Map<string, DocLineGroup>();
  for (const l of lines) {
    let g = byName.get(l.section);
    if (!g) {
      g = { section: l.section, lines: [], subtotal: 0 };
      byName.set(l.section, g);
      groups.push(g);
    }
    g.lines.push({
      description: l.description,
      qty: Number(l.qty),
      unit: l.unit,
      unitCost: l.unit_cost,
      markup: Number(l.markup),
      extended: l.extended,
    });
    g.subtotal += l.extended;
  }

  // Company boilerplate + the linked client's email.
  const { rows: settingRows } = await query<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings
      WHERE key IN ('profile.company','profile.phone','profile.email',
                    'company.license','company.address','contract.terms','contract.deposit_pct')`,
  );
  const s = new Map(settingRows.map((r) => [r.key, r.value]));
  const clientUser = await queryOne<{ email: string }>(
    `SELECT u.email FROM users u JOIN projects p ON p.slug = u.link_slug
      WHERE u.role = 'client' AND p.slug = $1 LIMIT 1`,
    [slug],
  );

  const depositPct = Number(s.get("contract.deposit_pct")) || 10;
  const drawSchedule =
    parseDrawSchedule(est.draw_schedule) ?? defaultDrawSchedule(depositPct);

  return {
    estimateId: Number(est.id),
    title: est.title || "Estimate",
    projectName: est.project_name,
    projectSlug: slug,
    clientName: est.client_name ?? "",
    clientEmail: clientUser?.email ?? "",
    company: {
      name: s.get("profile.company") || "SJ Carpentry LLC",
      license: s.get("company.license") || "",
      address: s.get("company.address") || "",
      phone: s.get("profile.phone") || "",
      email: s.get("profile.email") || "",
    },
    terms: s.get("contract.terms") || "",
    drawSchedule,
    groups,
    subtotal: est.subtotal,
    markupTotal: est.markup_total,
    total: est.total,
    dateLabel: today(),
  };
}

// ─── PDF rendering (pdfkit) ──────────────────────────────────────────────────

// Shared page geometry + palette (also consumed by lib/doc-render.ts). ACCENT /
// ACCENT_2 match the app's own --accent / --accent-2 CSS tokens (globals.css)
// so generated PDFs read as the same brand as the uploaded house templates
// (docs/reference/doc-templates/source/*.docx) instead of a generic mono doc.
export const PAGE = { size: "LETTER" as const, margin: 56 };
export const INK = "#283021";
export const GRAY = "#6b6b63";
export const ACCENT = "#4c5a40";
export const ACCENT_2 = "#38442d";

let logoCache: Buffer | null | undefined;
/** SJ Carpentry wordmark, embedded in every generated PDF's header. Returns
 *  null (header falls back to text-only) if the asset is ever moved. */
function logoBuffer(): Buffer | null {
  if (logoCache !== undefined) return logoCache;
  try {
    logoCache = fs.readFileSync(path.join(process.cwd(), "public/brand/sjc-logo.png"));
  } catch {
    logoCache = null;
  }
  return logoCache;
}

function pdfToBuffer(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...PAGE, info: { Title: "SJC OS Document", Author: "SJ Carpentry LLC" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    build(doc);
    doc.end();
  });
}

export function companyHeader(doc: PDFKit.PDFDocument, c: DocData["company"]) {
  const w = doc.page.width - 2 * PAGE.margin;
  const logo = logoBuffer();
  if (logo) {
    const size = 44;
    doc.image(logo, PAGE.margin + w / 2 - size / 2, doc.y, { width: size, height: size });
    doc.y += size + 8;
  }
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text(c.name.toUpperCase(), PAGE.margin, doc.y, {
    width: w,
    align: "center",
    characterSpacing: 0.5,
  });
  const meta = [
    c.license ? `License ${c.license}` : null,
    c.address || null,
    [c.phone, c.email].filter(Boolean).join("  ·  ") || null,
  ].filter(Boolean) as string[];
  if (meta.length) {
    doc.moveDown(0.15);
    doc.font("Helvetica").fontSize(8.5).fillColor(GRAY).text(meta.join("   ·   "), PAGE.margin, doc.y, {
      width: w,
      align: "center",
    });
  }
  doc.fillColor(INK);
  doc.moveDown(0.5);
  doc.strokeColor(ACCENT).lineWidth(1.5).moveTo(PAGE.margin, doc.y).lineTo(PAGE.margin + w, doc.y).stroke();
  doc.moveDown(0.6);
}

export function docTitle(doc: PDFKit.PDFDocument, title: string, sub: string) {
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(15).text(title.toUpperCase());
  doc.font("Helvetica").fontSize(9.5).fillColor(GRAY).text(sub);
  doc.fillColor(INK).moveDown(0.6);
}

/** Left label (may wrap) + optional small sub-line, with a right-aligned value. */
function row(doc: PDFKit.PDFDocument, left: string, sub: string | null, right: string, bold = false) {
  const leftX = PAGE.margin;
  const rightW = 110;
  const rightX = doc.page.width - PAGE.margin - rightW;
  const leftW = rightX - leftX - 12;
  const y0 = doc.y;
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(INK).text(right, rightX, y0, { width: rightW, align: "right" });
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(INK).text(left, leftX, y0, { width: leftW });
  if (sub) doc.font("Helvetica").fontSize(8).fillColor(GRAY).text(sub, leftX, doc.y, { width: leftW });
  doc.fillColor(INK).moveDown(0.25);
}

function sectionLabel(doc: PDFKit.PDFDocument, text: string) {
  doc.moveDown(0.3).font("Helvetica-Bold").fontSize(9).fillColor(GRAY).text(text.toUpperCase());
  doc.fillColor(INK).moveDown(0.15);
}

function signatureLine(doc: PDFKit.PDFDocument, who: string) {
  const x = PAGE.margin;
  const w = 300;
  doc.moveDown(1.0);
  doc.strokeColor("#999").lineWidth(0.8).moveTo(x, doc.y).lineTo(x + w, doc.y).stroke();
  doc.font("Helvetica").fontSize(8.5).fillColor(GRAY).text(who, x, doc.y + 3);
  doc.font("Helvetica").fontSize(8.5).fillColor(GRAY).text("Date: ____________________", x + w + 24, doc.y - 11);
  doc.fillColor(INK);
}

// ─── Phase-4 documents (closeout / collections / incident) ───────────────────
// These are not estimate-based; they gather project/company data directly. The
// pdfkit primitives above (companyHeader/docTitle/row/sectionLabel/signatureLine)
// are reused. Legal/collections docs carry a disclaimer footer.

/** Standard "not legal advice" disclaimer stamped on generated legal/collections
 *  documents. The app assists; the owner/attorney is responsible for filing. */
export const LEGAL_DISCLAIMER =
  "This document was generated by SJC OS to assist SJ Carpentry LLC. It is not legal advice. " +
  "Review it with your attorney and confirm all figures, dates, and statutory requirements before " +
  "sending, serving, or filing.";

function usdDollars(n: number): string {
  return `$${Math.round(n || 0).toLocaleString("en-US")}`;
}

/** Small print paragraph. */
function para(doc: PDFKit.PDFDocument, text: string, gap = 0.6) {
  doc.font("Helvetica").fontSize(10).fillColor(INK).text(text, { align: "left", lineGap: 1.5 });
  doc.moveDown(gap);
}

/** A boxed disclaimer footer at the bottom of legal/collections docs. */
function disclaimerFooter(doc: PDFKit.PDFDocument) {
  doc.moveDown(1.2);
  doc.strokeColor("#d9d4c7").lineWidth(1).moveTo(PAGE.margin, doc.y).lineTo(doc.page.width - PAGE.margin, doc.y).stroke();
  doc.moveDown(0.4);
  doc.font("Helvetica-Oblique").fontSize(8).fillColor(GRAY).text(LEGAL_DISCLAIMER, { align: "left", lineGap: 1.2 });
  doc.fillColor(INK);
}

export interface CompanyDocInfo {
  company: DocData["company"];
  googleReviewUrl: string;
  warrantyTerms: string;
}

/** Shared company boilerplate for the Phase-4 docs + outreach (reads app_settings). */
export async function getCompanyDocInfo(): Promise<CompanyDocInfo> {
  const { rows } = await query<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings
      WHERE key IN ('profile.company','profile.phone','profile.email',
                    'company.license','company.address','company.google_review_url',
                    'company.warranty_terms')`,
  );
  const s = new Map(rows.map((r) => [r.key, r.value]));
  return {
    company: {
      name: s.get("profile.company") || "SJ Carpentry LLC",
      license: s.get("company.license") || "",
      address: s.get("company.address") || "",
      phone: s.get("profile.phone") || "",
      email: s.get("profile.email") || "",
    },
    googleReviewUrl: s.get("company.google_review_url") || "",
    warrantyTerms:
      s.get("company.warranty_terms") ||
      "SJ Carpentry LLC warrants its workmanship for one (1) year from the date of substantial " +
        "completion. Manufacturer warranties on materials and fixtures pass through per their terms.",
  };
}

/** Render an inline signature-request body (estimate/change-order/contract
 *  text) onto company letterhead as a real PDF, so the client portal can
 *  display, download, and print every signable document — even ones composed
 *  as plain text. Used by the send paths as the attached review copy. */
export async function renderInlineDocPdf(opts: {
  title: string;
  subtitle: string;
  body: string;
}): Promise<Buffer> {
  const { company } = await getCompanyDocInfo();
  return pdfToBuffer((doc) => {
    companyHeader(doc, company);
    docTitle(doc, opts.title, opts.subtitle);
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(opts.body, { lineGap: 3 });
    doc.moveDown(1.2);
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(GRAY)
      .text(
        "This document is signed electronically through the SJ Carpentry client portal. " +
          "The signature record — typed name, timestamp, and consent — is retained alongside this document.",
      );
  });
}

export interface CloseoutData {
  projectId: string;
  projectName: string;
  projectSlug: string;
  clientName: string;
  clientEmail: string;
  address: string;
  company: DocData["company"];
  warrantyTerms: string;
  contractValue: number; // dollars
  paid: number; // dollars
  closedLabel: string;
  punchOpen: number;
  punchDone: number;
  dateLabel: string;
}

/** Gather project + client + company data for closeout documents. Null if the
 *  project doesn't exist. */
export async function gatherCloseoutData(slug: string): Promise<CloseoutData | null> {
  const proj = await queryOne<{
    id: string;
    name: string;
    client_name: string | null;
    address: string | null;
    contract_value: number;
    collected_to_date: number;
    closed_label: string;
  }>(
    `SELECT id, name, client_name, address, contract_value, collected_to_date,
            to_char(updated_at, 'FMMonth FMDD, YYYY') AS closed_label
       FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!proj) return null;

  const clientUser = await queryOne<{ email: string }>(
    `SELECT u.email FROM users u WHERE u.role = 'client' AND u.link_slug = $1 LIMIT 1`,
    [slug],
  );
  const punch = await queryOne<{ open: number; done: number }>(
    `SELECT count(*) FILTER (WHERE NOT done)::int AS open,
            count(*) FILTER (WHERE done)::int      AS done
       FROM project_punch WHERE project_id = $1`,
    [proj.id],
  );
  const info = await getCompanyDocInfo();

  return {
    projectId: proj.id,
    projectName: proj.name,
    projectSlug: slug,
    clientName: proj.client_name ?? "",
    clientEmail: clientUser?.email ?? "",
    address: proj.address ?? "",
    company: info.company,
    warrantyTerms: info.warrantyTerms,
    contractValue: proj.contract_value ?? 0,
    paid: proj.collected_to_date ?? 0,
    closedLabel: proj.closed_label,
    punchOpen: punch?.open ?? 0,
    punchDone: punch?.done ?? 0,
    dateLabel: today(),
  };
}

/** Certificate of Substantial Completion — record doc (narrative is AI, figures
 *  are code-generated). */
export async function renderCompletionCertificatePdf(d: CloseoutData, narrative: string): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    companyHeader(doc, d.company);
    docTitle(doc, "Certificate of Substantial Completion", `${d.projectName} — ${d.dateLabel}`);

    para(
      doc,
      `This certifies that the work performed by ${d.company.name} for ${d.clientName || "the Client"} ` +
        `at ${d.address || "the project address"} ("${d.projectName}") has reached substantial completion ` +
        `as of ${d.closedLabel}, meaning the project is sufficiently complete for its intended use.`,
    );

    if (narrative.trim()) {
      sectionLabel(doc, "Summary of Work");
      para(doc, narrative.trim());
    }

    sectionLabel(doc, "Project");
    row(doc, d.projectName, d.address || null, "");
    row(doc, "Contract value", null, usdDollars(d.contractValue));
    row(doc, "Amount paid to date", null, usdDollars(d.paid));
    row(
      doc,
      "Punch list",
      d.punchOpen === 0 ? "all items complete" : `${d.punchOpen} open · ${d.punchDone} complete`,
      `${d.punchDone}/${d.punchOpen + d.punchDone}`,
    );

    sectionLabel(doc, "Warranty");
    para(doc, d.warrantyTerms, 0.4);

    doc.moveDown(1.0);
    sectionLabel(doc, "Acknowledgment");
    signatureLine(doc, "Contractor — " + d.company.name);
    doc.moveDown(0.8);
    signatureLine(doc, "Client — " + (d.clientName || ""));
  });
}

/** Final (unconditional) waiver and release of lien, upon final payment. */
export async function renderLienWaiverPdf(d: CloseoutData): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    companyHeader(doc, d.company);
    docTitle(doc, "Final Waiver and Release of Lien", `${d.projectName} — ${d.dateLabel}`);

    para(
      doc,
      `For and in consideration of the final payment of ${usdDollars(d.paid)}, the receipt and sufficiency ` +
        `of which is hereby acknowledged, ${d.company.name} ("Contractor") does hereby waive, release, and ` +
        `relinquish any and all mechanic's lien, claim, or right to lien it has upon the real property and ` +
        `improvements located at ${d.address || "[property address]"}, owned by ${d.clientName || "[owner]"}, ` +
        `on account of labor, services, materials, or equipment furnished for the project known as ` +
        `"${d.projectName}."`,
    );
    para(
      doc,
      `This waiver and release is unconditional and covers all work through ${d.closedLabel}. The Contractor ` +
        `warrants that all subcontractors and suppliers engaged by it for this project have been, or will be, ` +
        `paid in full for their work.`,
    );

    sectionLabel(doc, "Amounts");
    row(doc, "Contract value", null, usdDollars(d.contractValue), true);
    row(doc, "Total paid", null, usdDollars(d.paid), true);

    doc.moveDown(1.2);
    sectionLabel(doc, "Signature");
    signatureLine(doc, "Contractor — " + d.company.name);
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(8.5).fillColor(GRAY).text(
      "State of Minnesota, County of ______________.  Subscribed and sworn before me this ____ day of " +
        "____________, 20____.   Notary Public: ____________________________",
      { width: doc.page.width - 2 * PAGE.margin },
    );
    doc.fillColor(INK);

    disclaimerFooter(doc);
  });
}

// ─── Building permit application packet ─────────────────────────────────────

export interface PermitData {
  projectId: string;
  projectName: string;
  projectSlug: string;
  address: string;
  ownerName: string;
  company: DocData["company"];
  /** Estimated construction valuation in whole dollars (drives permit fees). */
  valuation: number;
  dateLabel: string;
}

/** Gather project + owner + company data + a valuation for a permit packet.
 *  Valuation prefers the signed contract value; falls back to the highest
 *  estimate total on the project. Null if the project doesn't exist. */
export async function gatherPermitData(slug: string): Promise<PermitData | null> {
  const proj = await queryOne<{
    id: string;
    name: string;
    client_name: string | null;
    address: string | null;
    contract_value: number;
  }>(
    `SELECT id, name, client_name, address, contract_value FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!proj) return null;

  let valuation = proj.contract_value ?? 0;
  if (!valuation) {
    // Fall back to the largest estimate total (stored in cents → dollars).
    const est = await queryOne<{ total: number }>(
      `SELECT total FROM estimates WHERE project_id = $1 ORDER BY total DESC LIMIT 1`,
      [proj.id],
    );
    valuation = est?.total ? Math.round(est.total / 100) : 0;
  }

  const info = await getCompanyDocInfo();
  return {
    projectId: proj.id,
    projectName: proj.name,
    projectSlug: slug,
    address: proj.address ?? "",
    ownerName: proj.client_name ?? "",
    company: info.company,
    valuation,
    dateLabel: today(),
  };
}

/** Building-permit application packet — a cover packet to accompany the local
 *  jurisdiction's official form. Facts/valuation are code-generated; the scope
 *  narrative is AI-authored (passed in). */
export async function renderPermitPacketPdf(d: PermitData, narrative: string): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    companyHeader(doc, d.company);
    docTitle(doc, "Building Permit Application Packet", `${d.projectName} — ${d.dateLabel}`);

    para(
      doc,
      `This packet summarizes the project for a residential building permit application. Attach it to the ` +
        `permit application form required by the local building department having jurisdiction over the ` +
        `project address below.`,
    );

    sectionLabel(doc, "Project");
    row(doc, d.projectName, d.address || null, "");
    row(doc, "Property owner", d.ownerName || "—", "");
    row(doc, "Estimated construction valuation", "used to compute permit fees", usdDollars(d.valuation), true);

    sectionLabel(doc, "Contractor / Applicant");
    row(doc, d.company.name, d.company.address || null, "");
    row(doc, "Contractor license", null, d.company.license || "—");
    const contact = [d.company.phone, d.company.email].filter(Boolean).join("  ·  ");
    if (contact) row(doc, "Contact", null, "");
    if (contact) doc.font("Helvetica").fontSize(9).fillColor(GRAY).text(contact, PAGE.margin, doc.y).fillColor(INK);

    sectionLabel(doc, "Scope of Work");
    para(doc, narrative.trim() || "See attached plans and specifications.");

    doc.moveDown(0.8);
    sectionLabel(doc, "Applicant Signature");
    signatureLine(doc, "Applicant — " + d.company.name);

    doc.moveDown(1.0);
    doc.font("Helvetica-Oblique").fontSize(8).fillColor(GRAY).text(
      "This packet is a preparation aid, not the official permit application. Permit requirements, forms, " +
        "plan-review submittals, and fees vary by jurisdiction — confirm with the local building department.",
      { width: doc.page.width - 2 * PAGE.margin, lineGap: 1.2 },
    );
    doc.fillColor(INK);
  });
}

export interface CollectionData {
  invoiceNumber: string;
  milestone: string;
  amount: number; // cents (Phase 5.0)
  sentLabel: string;
  daysOverdue: number;
  projectName: string;
  projectSlug: string;
  clientName: string;
  clientEmail: string;
  address: string;
  company: DocData["company"];
  dateLabel: string;
}

/** Gather invoice + project + company data for a demand letter / lien package.
 *  Null if the invoice doesn't exist. */
export async function gatherCollectionData(invoiceId: number): Promise<CollectionData | null> {
  const r = await queryOne<{
    number: string;
    milestone: string;
    amount: number;
    sent_label: string | null;
    days_overdue: number | null;
    project_name: string;
    slug: string;
    client_name: string | null;
    address: string | null;
  }>(
    `SELECT i.number, i.milestone, i.amount,
            to_char(i.sent_at, 'FMMonth FMDD, YYYY') AS sent_label,
            (CURRENT_DATE - i.sent_at::date)         AS days_overdue,
            p.name AS project_name, p.slug, p.client_name, p.address
       FROM invoices i JOIN projects p ON p.id = i.project_id
      WHERE i.id = $1`,
    [invoiceId],
  );
  if (!r) return null;
  const clientUser = await queryOne<{ email: string }>(
    `SELECT email FROM users WHERE role = 'client' AND link_slug = $1 LIMIT 1`,
    [r.slug],
  );
  const info = await getCompanyDocInfo();
  return {
    invoiceNumber: r.number,
    milestone: r.milestone,
    amount: r.amount,
    sentLabel: r.sent_label ?? "—",
    daysOverdue: r.days_overdue ?? 0,
    projectName: r.project_name,
    projectSlug: r.slug,
    clientName: r.client_name ?? "",
    clientEmail: clientUser?.email ?? "",
    address: r.address ?? "",
    company: info.company,
    dateLabel: today(),
  };
}

/** Day-15 past-due demand letter. */
export async function renderDemandLetterPdf(d: CollectionData): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    companyHeader(doc, d.company);
    docTitle(doc, "Notice of Past-Due Payment", `${d.projectName} — ${d.dateLabel}`);

    para(doc, `${d.clientName || "Property Owner"}${d.address ? `\n${d.address}` : ""}`, 0.8);
    para(
      doc,
      `Our records show that invoice ${d.invoiceNumber} for "${d.milestone}" on your ${d.projectName} ` +
        `project, in the amount of ${fmtUsd(d.amount)}, was sent on ${d.sentLabel} and remains unpaid ` +
        `(${d.daysOverdue} days past the invoice date).`,
    );
    para(
      doc,
      `Please remit payment of ${fmtUsd(d.amount)} within ten (10) days of this notice. If you have ` +
        `already sent payment, thank you — please disregard this letter. If there's an issue with the work ` +
        `or the invoice, contact us right away so we can resolve it.`,
    );
    para(
      doc,
      `Continued non-payment may result in suspension of work and the pursuit of remedies available under ` +
        `Minnesota law, including mechanic's lien rights. We'd much rather resolve this directly.`,
    );
    para(doc, `Sincerely,\n\n${d.company.name}\n${[d.company.phone, d.company.email].filter(Boolean).join("  ·  ")}`, 0.4);

    disclaimerFooter(doc);
  });
}

/** Day-30 MN mechanic's-lien statement-of-claim draft. */
export async function renderLienPackagePdf(d: CollectionData): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    companyHeader(doc, d.company);
    docTitle(doc, "Mechanic's Lien Statement — DRAFT", `${d.projectName} — ${d.dateLabel}`);

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#a4402f").text(
      "DRAFT — NOT FILED. Minnesota mechanic's liens (Minn. Stat. ch. 514) have strict content, timing, " +
        "and pre-lien notice requirements. Verify every field and deadline with your attorney before filing.",
      { width: doc.page.width - 2 * PAGE.margin },
    );
    doc.fillColor(INK).moveDown(0.6);

    sectionLabel(doc, "Claimant");
    row(doc, d.company.name, d.company.license ? `License ${d.company.license}` : null, "");
    if (d.company.address) row(doc, d.company.address, null, "");

    sectionLabel(doc, "Property Owner");
    row(doc, d.clientName || "[owner name]", null, "");

    sectionLabel(doc, "Property");
    row(doc, d.address || "[property address]", "Legal description: ________________________________", "");

    sectionLabel(doc, "Claim");
    row(doc, "Amount due and owing", `Invoice ${d.invoiceNumber} · ${d.milestone}`, fmtUsd(d.amount), true);
    row(doc, "Description of work", "Labor, services & materials furnished for the improvement", "");
    row(doc, "First / last date of work", "________________  /  ________________", "");

    doc.moveDown(0.6);
    para(
      doc,
      `The claimant furnished labor, services, and/or materials for the improvement of the above-described ` +
        `real property, the last of which was furnished within the statutory period, and ${fmtUsd(d.amount)} ` +
        `remains due and owing after demand.`,
    );

    doc.moveDown(0.8);
    sectionLabel(doc, "Verification");
    doc.font("Helvetica").fontSize(8.5).fillColor(GRAY).text(
      "Signed under penalty of perjury.  Signature: ____________________________   Date: ____________\n" +
        "State of Minnesota, County of ______________.  Subscribed and sworn before me this ____ day of " +
        "____________, 20____.   Notary Public: ____________________________",
      { width: doc.page.width - 2 * PAGE.margin },
    );
    doc.fillColor(INK);

    disclaimerFooter(doc);
  });
}

export interface IncidentDocData {
  company: DocData["company"];
  projectName: string;
  occurredLabel: string;
  reporter: string;
  severityLabel: string;
  narrative: string;
  dateLabel: string;
}

/** Internal incident report — factual narrative (AI-drafted from the owner's
 *  notes), with a disclaimer footer. Not an OSHA form. */
export async function renderIncidentReportPdf(d: IncidentDocData): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    companyHeader(doc, d.company);
    docTitle(doc, "Incident Report", `${d.projectName} — ${d.dateLabel}`);

    sectionLabel(doc, "Details");
    row(doc, "Project", null, d.projectName);
    row(doc, "Date of incident", null, d.occurredLabel || "—");
    row(doc, "Reported by", null, d.reporter || "—");
    row(doc, "Severity", null, d.severityLabel);

    sectionLabel(doc, "Narrative");
    para(doc, d.narrative || "(No narrative provided.)");

    doc.moveDown(0.8);
    sectionLabel(doc, "Prepared by");
    signatureLine(doc, "Signature");

    disclaimerFooter(doc);
  });
}


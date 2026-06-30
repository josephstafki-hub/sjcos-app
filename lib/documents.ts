import "server-only";

// Phase-2 B5 — Contract / SOW document generation. Deterministic rendering from
// real estimate data (numbers, terms, totals, layout all code-generated); the
// only AI-authored part is the SOW scope narrative, passed in by the action
// (Qwen) — never the binding figures. Produces a signable PDF (pdfkit) and an
// editable .docx (docx) per document. NOT a "use server" file — plain helpers
// called by lib/actions/documents.ts. pdfkit is kept external in next.config so
// its runtime font-metric lookups work under `next start`.

import PDFDocument from "pdfkit";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  HeadingLevel,
} from "docx";
import { query, queryOne } from "./db";
import { fmtUsd, unitLabel } from "./cost-book-units";
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

const PAGE = { size: "LETTER" as const, margin: 56 };
const INK = "#283021";
const GRAY = "#6b6b63";

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

function companyHeader(doc: PDFKit.PDFDocument, c: DocData["company"]) {
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(17).text(c.name);
  const meta = [
    c.license ? `License ${c.license}` : null,
    c.address || null,
    [c.phone, c.email].filter(Boolean).join("  ·  ") || null,
  ].filter(Boolean) as string[];
  if (meta.length) doc.font("Helvetica").fontSize(9).fillColor(GRAY).text(meta.join("\n"));
  doc.fillColor(INK);
  doc.moveDown(0.4);
  doc.strokeColor("#d9d4c7").lineWidth(1).moveTo(doc.x, doc.y).lineTo(doc.page.width - PAGE.margin, doc.y).stroke();
  doc.moveDown(0.6);
}

function docTitle(doc: PDFKit.PDFDocument, title: string, sub: string) {
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

export async function renderContractPdf(d: DocData): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    companyHeader(doc, d.company);
    docTitle(doc, "Construction Contract", `${d.projectName} — ${d.dateLabel}`);

    doc.font("Helvetica").fontSize(10).text(
      `This Construction Contract is made on ${d.dateLabel} between ${d.company.name} ("Contractor") ` +
        `and ${d.clientName || "the Client"} ("Client") for the project described below.`,
    );
    doc.moveDown(0.6);

    sectionLabel(doc, "Project");
    row(doc, d.projectName, d.title, "");

    sectionLabel(doc, "Total Price");
    row(doc, "Total contract price (materials, labor & overhead)", null, fmtUsd(d.total), true);

    sectionLabel(doc, "Payment Schedule");
    for (const dl of d.drawSchedule) {
      row(doc, dl.label, `${dl.percent}% of total`, fmtUsd(drawAmount(d.total, dl.percent)));
    }

    if (d.terms) {
      sectionLabel(doc, "Terms & Conditions");
      doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(d.terms, { align: "left", lineGap: 1.5 });
    }

    // Signature block.
    doc.moveDown(1.4);
    sectionLabel(doc, "Signatures");
    signatureLine(doc, "Contractor — " + d.company.name);
    doc.moveDown(0.8);
    signatureLine(doc, "Client — " + (d.clientName || ""));
  });
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

export async function renderSowPdf(d: DocData, narrative: string): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    companyHeader(doc, d.company);
    docTitle(doc, "Scope of Work", `${d.projectName} — ${d.dateLabel}`);

    if (narrative.trim()) {
      sectionLabel(doc, "Scope Narrative");
      doc.font("Helvetica").fontSize(10).fillColor(INK).text(narrative.trim(), { align: "left", lineGap: 1.5 });
      doc.moveDown(0.4);
    }

    sectionLabel(doc, "Detailed Scope & Pricing");
    for (const g of d.groups) {
      doc.moveDown(0.2).font("Helvetica-Bold").fontSize(10).fillColor(INK).text(g.section);
      for (const l of g.lines) {
        row(doc, l.description, `${l.qty} ${unitLabel(l.unit)}`, fmtUsd(l.extended));
      }
      row(doc, `${g.section} subtotal`, null, fmtUsd(g.subtotal), true);
      doc.moveDown(0.2);
    }
    doc.moveDown(0.3);
    doc.strokeColor("#d9d4c7").lineWidth(1).moveTo(PAGE.margin, doc.y).lineTo(doc.page.width - PAGE.margin, doc.y).stroke();
    doc.moveDown(0.4);
    row(doc, "TOTAL", null, fmtUsd(d.total), true);

    doc.moveDown(1.0).font("Helvetica-Oblique").fontSize(8.5).fillColor(GRAY).text(
      "This Scope of Work accompanies and is incorporated into the Construction Contract for this project. " +
        "Work not expressly listed above is excluded unless added by signed Change Order.",
    );
  });
}

// ─── DOCX rendering (docx) — editable owner record ───────────────────────────

const FONT = "Calibri";
function p(text: string, opts: { bold?: boolean; size?: number; color?: string; spacingBefore?: number; spacingAfter?: number } = {}) {
  return new Paragraph({
    spacing: { before: opts.spacingBefore ?? 0, after: opts.spacingAfter ?? 120 },
    children: [new TextRun({ text, bold: opts.bold, size: (opts.size ?? 11) * 2, color: opts.color, font: FONT })],
  });
}
function heading(text: string) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text, font: FONT })] });
}
function twoColTable(rows: { label: string; sub?: string; value: string; bold?: boolean }[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders(),
    rows: rows.map(
      (r) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 72, type: WidthType.PERCENTAGE },
              borders: noBorders(),
              children: [
                new Paragraph({ children: [new TextRun({ text: r.label, bold: r.bold, font: FONT, size: 22 })] }),
                ...(r.sub ? [new Paragraph({ children: [new TextRun({ text: r.sub, color: "888888", font: FONT, size: 18 })] })] : []),
              ],
            }),
            new TableCell({
              width: { size: 28, type: WidthType.PERCENTAGE },
              borders: noBorders(),
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: r.value, bold: r.bold, font: FONT, size: 22 })] })],
            }),
          ],
        }),
    ),
  });
}
function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
}
function companyHeaderDocx(c: DocData["company"]): Paragraph[] {
  const out = [p(c.name, { bold: true, size: 16 })];
  const meta = [c.license ? `License ${c.license}` : null, c.address || null, [c.phone, c.email].filter(Boolean).join("  ·  ") || null].filter(Boolean) as string[];
  for (const m of meta) out.push(p(m, { size: 9, color: "6B6B63", spacingAfter: 20 }));
  return out;
}

export async function renderContractDocx(d: DocData): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    ...companyHeaderDocx(d.company),
    p("CONSTRUCTION CONTRACT", { bold: true, size: 15, spacingBefore: 160 }),
    p(`${d.projectName} — ${d.dateLabel}`, { color: "6B6B63", size: 10 }),
    p(
      `This Construction Contract is made on ${d.dateLabel} between ${d.company.name} ("Contractor") and ${d.clientName || "the Client"} ("Client") for the project described below.`,
    ),
    heading("Total Price"),
    twoColTable([{ label: "Total contract price (materials, labor & overhead)", value: fmtUsd(d.total), bold: true }]),
    heading("Payment Schedule"),
    twoColTable(d.drawSchedule.map((dl) => ({ label: dl.label, sub: `${dl.percent}% of total`, value: fmtUsd(drawAmount(d.total, dl.percent)) }))),
  ];
  if (d.terms) {
    children.push(heading("Terms & Conditions"), p(d.terms, { size: 10 }));
  }
  children.push(
    heading("Signatures"),
    p("Contractor — " + d.company.name + "    ____________________________    Date: ____________", { spacingBefore: 120 }),
    p("Client — " + (d.clientName || "") + "    ____________________________    Date: ____________", { spacingBefore: 120 }),
  );
  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function renderSowDocx(d: DocData, narrative: string): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    ...companyHeaderDocx(d.company),
    p("SCOPE OF WORK", { bold: true, size: 15, spacingBefore: 160 }),
    p(`${d.projectName} — ${d.dateLabel}`, { color: "6B6B63", size: 10 }),
  ];
  if (narrative.trim()) {
    children.push(heading("Scope Narrative"), p(narrative.trim(), { size: 10 }));
  }
  children.push(heading("Detailed Scope & Pricing"));
  for (const g of d.groups) {
    children.push(p(g.section, { bold: true, spacingBefore: 100, spacingAfter: 40 }));
    children.push(
      twoColTable([
        ...g.lines.map((l) => ({ label: l.description, sub: `${l.qty} ${unitLabel(l.unit)}`, value: fmtUsd(l.extended) })),
        { label: `${g.section} subtotal`, value: fmtUsd(g.subtotal), bold: true },
      ]),
    );
  }
  children.push(twoColTable([{ label: "TOTAL", value: fmtUsd(d.total), bold: true }]));
  children.push(
    p(
      "This Scope of Work accompanies and is incorporated into the Construction Contract for this project. Work not expressly listed above is excluded unless added by signed Change Order.",
      { size: 9, color: "6B6B63", spacingBefore: 160 },
    ),
  );
  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

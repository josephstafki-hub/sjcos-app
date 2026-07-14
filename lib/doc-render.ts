import "server-only";

// Deterministic PDF + DOCX rendering for document-template drafts (doc-templates
// plan, Phase 3). Walks the ordered TemplateSection blocks produced by a
// template's build(values) and emits each block kind. Reuses the SJC house
// header chrome (companyHeader/docTitle) + palette from lib/documents.ts so the
// new docs match the existing generated PDFs. Every page carries a
// `<key> v<version> · Generated <date>` footer; legal docs also get the
// LEGAL_DISCLAIMER block. PDF is the signable artifact; DOCX is the owner's
// editable escape hatch.

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
  Footer,
} from "docx";
import { PAGE, INK, GRAY, ACCENT, ACCENT_2, companyHeader, docTitle, LEGAL_DISCLAIMER } from "./documents";
import type { DocTemplate, FieldValues, Run, TemplateSection } from "./doc-templates/types";

function today(): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date());
}

function companyOf(v: FieldValues) {
  const s = (k: string) => (v[k] == null ? "" : String(v[k]));
  return {
    name: s("company_name") || "SJ Carpentry LLC",
    license: s("company_license"),
    address: s("company_address"),
    phone: s("company_phone"),
    email: s("company_email"),
  };
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

export function renderTemplatePdf(template: DocTemplate, values: FieldValues): Promise<Buffer> {
  const sections = template.build(values);
  const title = template.titleFor ? template.titleFor(values) : template.title;
  const footerLine = `${template.key} v${template.version} · Generated ${today()}`;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      ...PAGE,
      bufferPages: true,
      info: { Title: title, Author: "SJ Carpentry LLC" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width - 2 * PAGE.margin;
    const bottom = () => doc.page.height - PAGE.margin - 16; // leave room for footer

    const ensure = (needed: number) => {
      if (doc.y + needed > bottom()) doc.addPage();
    };

    companyHeader(doc, companyOf(values));
    docTitle(doc, title, template.subtitle);

    for (const s of sections) renderPdfSection(doc, s, W, ensure);

    if (template.docClass === "legal" && !template.attorneyReviewed) disclaimerBlock(doc, W);

    // Stamp the footer on every buffered page. Writing into the bottom margin
    // would otherwise make pdfkit auto-add a page per write — zero the bottom
    // margin around each stamp so the text stays on its page.
    const range = doc.bufferedPageRange();
    const footY = doc.page.height - PAGE.margin + 2;
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const saved = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(7.5).fillColor(GRAY);
      doc.text(footerLine, PAGE.margin, footY, { width: W, align: "left", lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, PAGE.margin, footY, { width: W, align: "right", lineBreak: false });
      doc.page.margins.bottom = saved;
    }

    doc.end();
  });
}

type Ensure = (needed: number) => void;

function setRunFont(doc: PDFKit.PDFDocument, run: Run) {
  const font = run.bold ? "Helvetica-Bold" : run.italic ? "Helvetica-Oblique" : "Helvetica";
  doc.font(font);
}

/**
 * Flow a run-array as ONE wrapped paragraph with inline bold/italic. Uses the
 * idiomatic pdfkit `continued` pattern: position is set via doc.x/doc.y up front
 * and every segment call passes ONLY options (passing positional x/y on
 * continuation forces a spurious line break at each run boundary).
 */
function flowRuns(
  doc: PDFKit.PDFDocument,
  runs: Run[],
  opts: { x?: number; y?: number; size?: number; width?: number; lineGap?: number; color?: string },
) {
  const width = opts.width ?? doc.page.width - 2 * PAGE.margin;
  doc.x = opts.x ?? PAGE.margin;
  if (opts.y != null) doc.y = opts.y;
  doc.fontSize(opts.size ?? 10).fillColor(opts.color ?? INK);
  runs.forEach((run, i) => {
    setRunFont(doc, run);
    doc.text(run.text, { width, continued: i < runs.length - 1, lineGap: opts.lineGap ?? 1.5 });
  });
  doc.font("Helvetica").fillColor(INK);
}

function paragraph(doc: PDFKit.PDFDocument, runs: Run[], opts: { size?: number; x?: number; width?: number; color?: string } = {}) {
  flowRuns(doc, runs, opts);
}

function renderPdfSection(doc: PDFKit.PDFDocument, s: TemplateSection, W: number, ensure: Ensure) {
  switch (s.kind) {
    case "heading": {
      ensure(30);
      doc.moveDown(s.level === 1 ? 0.7 : 0.5);
      const size = s.level === 1 ? 14 : s.level === 2 ? 10.5 : 10;
      doc.font("Helvetica-Bold").fontSize(size).fillColor(s.level === 1 ? INK : GRAY)
        .text(s.level === 1 ? s.text : s.text.toUpperCase(), PAGE.margin, doc.y, { width: W });
      if (s.level === 1) {
        doc.moveDown(0.15);
        doc.strokeColor("#d9d4c7").lineWidth(1).moveTo(PAGE.margin, doc.y).lineTo(PAGE.margin + W, doc.y).stroke();
      }
      doc.fillColor(INK).moveDown(0.2);
      break;
    }
    case "paragraph":
      ensure(24);
      paragraph(doc, s.runs);
      doc.moveDown(0.5);
      break;
    case "statutory_notice": {
      // ≥10-pt bold, boxed (Minn. Stat. § 514.011).
      ensure(40);
      const startY = doc.y;
      doc.moveDown(0.2);
      const innerX = PAGE.margin + 8;
      const innerW = W - 16;
      const runs = s.runs.map((r) => ({ ...r, bold: true }));
      flowRuns(doc, runs, { x: innerX, width: innerW, size: 10.5, lineGap: 2 });
      const endY = doc.y;
      doc.strokeColor("#b6b09c").lineWidth(1).rect(PAGE.margin, startY - 2, W, endY - startY + 8).stroke();
      doc.font("Helvetica").fillColor(INK).moveDown(0.6);
      break;
    }
    case "list": {
      doc.fontSize(10).fillColor(INK);
      s.items.forEach((item, idx) => {
        ensure(18);
        const marker = s.ordered ? `${idx + 1}.` : "•";
        const mx = PAGE.margin + 6;
        const tx = mx + 18;
        const tw = W - (tx - PAGE.margin);
        const y0 = doc.y;
        doc.font("Helvetica").fontSize(10).text(marker, mx, y0, { width: 16 });
        flowRuns(doc, item, { x: tx, y: y0, width: tw, size: 10, lineGap: 1.5 });
        doc.moveDown(0.2);
      });
      doc.font("Helvetica").moveDown(0.4);
      break;
    }
    case "info_strip": {
      const n = s.cells.length || 1;
      const cellW = W / n;
      const innerW = cellW - 16;
      // Box height fits the tallest cell value — a long estimate #/name that
      // wraps to 2+ lines used to overflow a fixed-height box and bleed into
      // the content below it.
      doc.font("Helvetica-Bold").fontSize(11);
      const valueH = Math.max(...s.cells.map((c) => doc.heightOfString(c.value || "—", { width: innerW })));
      const h = Math.max(40, 26 + valueH);
      ensure(h + 8);
      const y0 = doc.y + 2;
      doc.strokeColor("#d9d4c7").lineWidth(1).rect(PAGE.margin, y0, W, h).stroke();
      s.cells.forEach((c, i) => {
        const cx = PAGE.margin + i * cellW;
        if (i > 0) doc.strokeColor("#e7e2d5").moveTo(cx, y0).lineTo(cx, y0 + h).stroke();
        doc.font("Helvetica-Bold").fontSize(7).fillColor(GRAY).text(c.label.toUpperCase(), cx + 8, y0 + 7, { width: innerW });
        doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(c.value || "—", cx + 8, y0 + 18, { width: innerW });
      });
      doc.y = y0 + h + 8;
      doc.fillColor(INK);
      break;
    }
    case "info_grid": {
      doc.fontSize(10);
      for (const rrow of s.rows) {
        ensure(16);
        const y0 = doc.y;
        const labelW = W * 0.42;
        doc.font("Helvetica").fillColor(GRAY).text(rrow.label, PAGE.margin, y0, { width: labelW - 8 });
        const yAfterLabel = doc.y;
        doc.font("Helvetica-Bold").fillColor(INK).text(rrow.value || "—", PAGE.margin + labelW, y0, { width: W - labelW });
        doc.y = Math.max(yAfterLabel, doc.y);
        doc.moveDown(0.15);
      }
      doc.font("Helvetica").fillColor(INK).moveDown(0.3);
      break;
    }
    case "money_table": {
      for (const rrow of s.rows) {
        const rightW = 160;
        const rightX = PAGE.margin + W - rightW;
        const leftW = rightX - PAGE.margin - 12;
        const size = rrow.bold ? 11 : 10;
        doc.font(rrow.bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
        // A row's value can wrap (e.g. a multi-option rough-estimate total) —
        // size the row to the taller of label/value so the next section never
        // starts drawing over it.
        const rowH = Math.max(doc.heightOfString(rrow.label, { width: leftW }), doc.heightOfString(rrow.value, { width: rightW }));
        ensure(rowH + 6);
        const y0 = doc.y;
        doc.fillColor(rrow.bold ? ACCENT_2 : INK)
          .text(rrow.value, rightX, y0, { width: rightW, align: "right" });
        doc.fillColor(INK)
          .text(rrow.label, PAGE.margin, y0, { width: leftW });
        let by = y0 + rowH;
        if (rrow.sub) {
          doc.font("Helvetica").fontSize(8).fillColor(GRAY).text(rrow.sub, PAGE.margin, by, { width: leftW });
          by = doc.y;
        }
        doc.y = by;
        doc.fillColor(INK).fontSize(10).moveDown(0.25);
      }
      doc.moveDown(0.2);
      break;
    }
    case "columns_table":
      renderColumnsTable(doc, s, W, ensure);
      break;
    case "checkbox_group": {
      if (s.title) {
        ensure(18);
        doc.font("Helvetica-Bold").fontSize(9).fillColor(GRAY).text(s.title.toUpperCase(), PAGE.margin, doc.y, { width: W });
        doc.fillColor(INK).moveDown(0.15);
      }
      doc.fontSize(10);
      for (const item of s.items) {
        ensure(16);
        const y0 = doc.y;
        // Draw the checkbox as a stroked square (Helvetica lacks ☐/☒ glyphs);
        // an ✗ inside when checked.
        const bx = PAGE.margin + 4;
        const sz = 9;
        const by = y0 + 1.5;
        doc.strokeColor("#6b6b63").lineWidth(0.9).rect(bx, by, sz, sz).stroke();
        if (item.checked) {
          doc.strokeColor(INK).lineWidth(1.1)
            .moveTo(bx + 1.5, by + 1.5).lineTo(bx + sz - 1.5, by + sz - 1.5).stroke()
            .moveTo(bx + sz - 1.5, by + 1.5).lineTo(bx + 1.5, by + sz - 1.5).stroke();
        }
        doc.font("Helvetica").fillColor(INK).text(item.label, bx + sz + 8, y0, { width: W - sz - 16 });
        doc.moveDown(0.1);
      }
      doc.moveDown(0.3);
      break;
    }
    case "signature_block": {
      doc.moveDown(0.4);
      for (const party of s.parties) {
        ensure(60);
        const who = party.name ? `${party.role} — ${party.name}` : party.role;
        doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(who, PAGE.margin, doc.y, { width: W });
        doc.moveDown(1.1);
        const lineY = doc.y;
        const sigW = 260;
        const dateX = PAGE.margin + sigW + 30;
        const dateW = 150;
        doc.strokeColor("#999").lineWidth(0.8).moveTo(PAGE.margin, lineY).lineTo(PAGE.margin + sigW, lineY).stroke();
        doc.moveTo(dateX, lineY).lineTo(dateX + dateW, lineY).stroke();
        doc.font("Helvetica").fontSize(8).fillColor(GRAY)
          .text("Signature / Printed name", PAGE.margin, lineY + 3, { width: sigW });
        doc.text("Date", dateX, lineY + 3, { width: dateW });
        doc.fillColor(INK).moveDown(1.0);
      }
      break;
    }
    case "notary_block": {
      ensure(50);
      doc.font("Helvetica").fontSize(9).fillColor(GRAY).text(
        "State of Minnesota, County of ______________.  Subscribed and sworn before me this ____ day of " +
          "____________, 20____.\n\nNotary Public: ____________________________",
        PAGE.margin,
        doc.y,
        { width: W, lineGap: 3 },
      );
      doc.fillColor(INK).moveDown(0.5);
      break;
    }
    case "spacer":
      doc.moveDown(s.size);
      break;
  }
}

function renderColumnsTable(doc: PDFKit.PDFDocument, s: Extract<TemplateSection, { kind: "columns_table" }>, W: number, ensure: Ensure) {
  const cols = s.headers.length;
  const GUTTER = 10;
  // Column widths: a 2-col table (Item | Estimate/Value) splits ~56/44 so long
  // values have room; 3+ cols keep the money/qty columns narrow + right-aligned
  // with a wide first (description) column.
  let widths: number[];
  if (cols <= 1) widths = [W];
  else if (cols === 2) widths = [W * 0.56, W * 0.44];
  else {
    const amt = 96;
    widths = [W - amt * (cols - 1), ...Array(cols - 1).fill(amt)];
  }
  const colX = (i: number) => PAGE.margin + widths.slice(0, i).reduce((a, b) => a + b, 0);
  // Inner text width leaves a gutter so adjacent columns never touch.
  const textW = (i: number) => Math.max(10, widths[i] - (i < cols - 1 ? GUTTER : 0));
  const align = (i: number) => (i === 0 ? "left" : "right") as "left" | "right";

  ensure(30);
  // Header row — solid accent band with white caps text, matching the house
  // estimate/invoice templates instead of a bare gray label.
  const hy = doc.y;
  const headerH = 20;
  doc.rect(PAGE.margin, hy, W, headerH).fill(ACCENT);
  doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#ffffff");
  s.headers.forEach((h, i) => {
    const pad = i === 0 ? 8 : 8;
    doc.text(h.toUpperCase(), colX(i) + (i === 0 ? pad : 0), hy + 6, { width: textW(i) - pad, align: align(i) });
  });
  doc.y = hy + headerH + 6;
  doc.fillColor(INK);

  doc.fontSize(9.5).fillColor(INK);
  s.rows.forEach((row, ri) => {
    const last = s.emphasizeLast && ri === s.rows.length - 1;
    // A "section header" row (only first cell populated, in CAPS) reads as a group label.
    const isGroup = row.length > 1 && row.slice(1).every((c) => c === "") && row[0] === row[0].toUpperCase() && row[0] !== "";
    doc.font(last || isGroup ? "Helvetica-Bold" : "Helvetica");
    // Row height = the tallest wrapped cell, so multi-line cells never overlap
    // the next row.
    const rowH = Math.max(
      ...row.map((cell, i) => doc.heightOfString(cell || " ", { width: textW(i), align: align(i) })),
    );
    ensure(rowH + 4);
    const y0 = doc.y;
    row.forEach((cell, i) => {
      doc.font(last || isGroup ? "Helvetica-Bold" : "Helvetica").fillColor(isGroup ? GRAY : INK)
        .text(cell, colX(i), y0, { width: textW(i), align: align(i) });
    });
    doc.y = y0 + rowH + 3;
    if (last) {
      doc.strokeColor("#d9d4c7").lineWidth(1).moveTo(PAGE.margin, y0 - 2).lineTo(PAGE.margin + W, y0 - 2).stroke();
    }
  });
  doc.font("Helvetica").fillColor(INK).moveDown(0.5);
}

function disclaimerBlock(doc: PDFKit.PDFDocument, W: number) {
  if (doc.y + 60 > doc.page.height - PAGE.margin - 16) doc.addPage();
  doc.moveDown(1.0);
  doc.strokeColor("#d9d4c7").lineWidth(1).moveTo(PAGE.margin, doc.y).lineTo(PAGE.margin + W, doc.y).stroke();
  doc.moveDown(0.4);
  doc.font("Helvetica-Oblique").fontSize(8).fillColor(GRAY).text(LEGAL_DISCLAIMER, PAGE.margin, doc.y, { width: W, lineGap: 1.2 });
  doc.fillColor(INK);
}

// ─── DOCX ────────────────────────────────────────────────────────────────────

const FONT = "Calibri";
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
function noBorders() {
  return { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
}
function runsToDocx(runs: Run[], baseSize = 22): TextRun[] {
  return runs.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic, font: FONT, size: baseSize }));
}

export async function renderTemplateDocx(template: DocTemplate, values: FieldValues): Promise<Buffer> {
  const sections = template.build(values);
  const title = template.titleFor ? template.titleFor(values) : template.title;
  const c = companyOf(values);
  const children: (Paragraph | Table)[] = [];

  // Header chrome.
  children.push(new Paragraph({ children: [new TextRun({ text: c.name, bold: true, size: 32, font: FONT })] }));
  const meta = [c.license ? `License ${c.license}` : null, c.address || null, [c.phone, c.email].filter(Boolean).join("  ·  ") || null].filter(Boolean) as string[];
  for (const m of meta) children.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: m, size: 18, color: "6B6B63", font: FONT })] }));
  children.push(new Paragraph({ spacing: { before: 160, after: 40 }, children: [new TextRun({ text: title.toUpperCase(), bold: true, size: 30, font: FONT })] }));
  children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: template.subtitle, size: 20, color: "6B6B63", font: FONT })] }));

  for (const s of sections) pushDocxSection(children, s);

  if (template.docClass === "legal" && !template.attorneyReviewed) {
    children.push(new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: LEGAL_DISCLAIMER, italics: true, size: 16, color: "6B6B63", font: FONT })] }));
  }

  const footerLine = `${template.key} v${template.version} · Generated ${today()}`;
  const doc = new Document({
    sections: [
      {
        children,
        footers: {
          default: new Footer({
            children: [new Paragraph({ children: [new TextRun({ text: footerLine, size: 15, color: "888888", font: FONT })] })],
          }),
        },
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

function pushDocxSection(out: (Paragraph | Table)[], s: TemplateSection) {
  switch (s.kind) {
    case "heading":
      out.push(new Paragraph({
        heading: s.level === 1 ? HeadingLevel.HEADING_1 : s.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 80 },
        children: [new TextRun({ text: s.text, font: FONT })],
      }));
      break;
    case "paragraph":
      out.push(new Paragraph({ spacing: { after: 120 }, children: runsToDocx(s.runs) }));
      break;
    case "statutory_notice":
      out.push(new Paragraph({
        spacing: { before: 80, after: 120 },
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: "B6B09C" }, bottom: { style: BorderStyle.SINGLE, size: 6, color: "B6B09C" }, left: { style: BorderStyle.SINGLE, size: 6, color: "B6B09C" }, right: { style: BorderStyle.SINGLE, size: 6, color: "B6B09C" } },
        children: s.runs.map((r) => new TextRun({ text: r.text, bold: true, font: FONT, size: 21 })),
      }));
      break;
    case "list":
      s.items.forEach((item, idx) => {
        out.push(new Paragraph({
          spacing: { after: 40 },
          indent: { left: 360 },
          children: [new TextRun({ text: s.ordered ? `${idx + 1}.  ` : "•  ", font: FONT, size: 22 }), ...runsToDocx(item)],
        }));
      });
      break;
    case "info_strip":
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({
          children: s.cells.map((cell) => new TableCell({
            width: { size: Math.floor(100 / s.cells.length), type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ children: [new TextRun({ text: cell.label.toUpperCase(), bold: true, size: 14, color: "6B6B63", font: FONT })] }),
              new Paragraph({ children: [new TextRun({ text: cell.value || "—", bold: true, size: 22, font: FONT })] }),
            ],
          })),
        })],
      }));
      out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      break;
    case "info_grid":
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorders(),
        rows: s.rows.map((r) => new TableRow({
          children: [
            new TableCell({ width: { size: 42, type: WidthType.PERCENTAGE }, borders: noBorders(), children: [new Paragraph({ children: [new TextRun({ text: r.label, color: "6B6B63", font: FONT, size: 20 })] })] }),
            new TableCell({ width: { size: 58, type: WidthType.PERCENTAGE }, borders: noBorders(), children: [new Paragraph({ children: [new TextRun({ text: r.value || "—", bold: true, font: FONT, size: 20 })] })] }),
          ],
        })),
      }));
      out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      break;
    case "money_table":
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorders(),
        rows: s.rows.map((r) => new TableRow({
          children: [
            new TableCell({ width: { size: 72, type: WidthType.PERCENTAGE }, borders: noBorders(), children: [
              new Paragraph({ children: [new TextRun({ text: r.label, bold: r.bold, font: FONT, size: 22 })] }),
              ...(r.sub ? [new Paragraph({ children: [new TextRun({ text: r.sub, color: "888888", font: FONT, size: 18 })] })] : []),
            ] }),
            new TableCell({ width: { size: 28, type: WidthType.PERCENTAGE }, borders: noBorders(), children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: r.value, bold: r.bold, font: FONT, size: 22 })] })] }),
          ],
        })),
      }));
      out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      break;
    case "columns_table": {
      const thin = { style: BorderStyle.SINGLE, size: 2, color: "D9D4C7" };
      const borders = { top: thin, bottom: thin, left: NONE, right: NONE, insideHorizontal: thin, insideVertical: NONE };
      const headerRow = new TableRow({
        tableHeader: true,
        children: s.headers.map((h, i) => new TableCell({ borders, children: [new Paragraph({ alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text: h.toUpperCase(), bold: true, size: 16, color: "6B6B63", font: FONT })] })] })),
      });
      const bodyRows = s.rows.map((row, ri) => {
        const last = s.emphasizeLast && ri === s.rows.length - 1;
        return new TableRow({
          children: row.map((cell, i) => new TableCell({ borders, children: [new Paragraph({ alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text: cell, bold: last, size: 20, font: FONT })] })] })),
        });
      });
      out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders, rows: [headerRow, ...bodyRows] }));
      out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      break;
    }
    case "checkbox_group":
      if (s.title) out.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: s.title.toUpperCase(), bold: true, size: 18, color: "6B6B63", font: FONT })] }));
      for (const item of s.items) out.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `${item.checked ? "☒" : "☐"}  ${item.label}`, font: FONT, size: 22 })] }));
      break;
    case "signature_block":
      for (const party of s.parties) {
        const who = party.name ? `${party.role} — ${party.name}` : party.role;
        out.push(new Paragraph({ spacing: { before: 200, after: 40 }, children: [new TextRun({ text: who, bold: true, font: FONT, size: 20 })] }));
        out.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: "Signature / Printed name: ____________________________        Date: ____________", font: FONT, size: 20 })] }));
      }
      break;
    case "notary_block":
      out.push(new Paragraph({ spacing: { before: 120, after: 80 }, children: [new TextRun({ text: "State of Minnesota, County of ______________.  Subscribed and sworn before me this ____ day of ____________, 20____.   Notary Public: ____________________________", font: FONT, size: 18, color: "6B6B63" })] }));
      break;
    case "spacer":
      out.push(new Paragraph({ children: [] }));
      break;
  }
}

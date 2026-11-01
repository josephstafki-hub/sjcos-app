// get_project_file's PDF reader (mcp/pdf-read.mjs): text layer via pdftotext,
// scanned PDFs detected and rendered to page images via pdftoppm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import PDFDocument from "pdfkit";
import { isPdf, looksScanned, pageRange, pdfPagePngs, pdfText, PDF_MAX_IMAGE_PAGES } from "../mcp/pdf-read.mjs";

const havePoppler = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

function writePdf(file, draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const out = createWriteStream(file);
    out.on("finish", resolve);
    out.on("error", reject);
    doc.pipe(out);
    draw(doc);
    doc.end();
  });
}

test("isPdf by mime or extension", () => {
  assert.equal(isPdf({ mime_type: "application/pdf", name: "x" }), true);
  assert.equal(isPdf({ mime_type: "", name: "ES-10151.PDF" }), true);
  assert.equal(isPdf({ mime_type: "image/png", name: "x.png" }), false);
});

test("pageRange clamps to the document and the span", () => {
  assert.deepEqual(pageRange(5, undefined, undefined), { from: 1, to: 5 });
  assert.deepEqual(pageRange(5, 4, 99), { from: 4, to: 5 });
  assert.deepEqual(pageRange(5, 9, undefined), { from: 5, to: 5 });
  assert.deepEqual(pageRange(20, 3, undefined, PDF_MAX_IMAGE_PAGES), { from: 3, to: 7 });
  assert.deepEqual(pageRange(null, 2, undefined), { from: 2, to: 2 });
});

test("looksScanned: thin text per page is a scan", () => {
  assert.equal(looksScanned("", 3), true);
  assert.equal(looksScanned("Page 1\n\nPage 2", 2), true);
  assert.equal(looksScanned("Framing labor 120 hrs at $65 ".repeat(5), 1), false);
});

test("text PDF: pdfText returns the words, pages and range", { skip: !havePoppler && "poppler not installed" }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pdfread-test-"));
  try {
    const file = path.join(dir, "estimate.pdf");
    await writePdf(file, (doc) => {
      doc.fontSize(12).text("Estimate ES-10151 Garage - Flanagan. Framing labor 120 hours. Concrete slab 24x24 with thickened edge.");
      doc.addPage().text("Page two: Roofing, 30 squares architectural shingles. Total $48,250.00");
    });
    const all = await pdfText(file);
    assert.equal(all.pages, 2);
    assert.equal(all.scanned, false);
    assert.match(all.text, /ES-10151/);
    assert.match(all.text, /\$48,250\.00/);
    const p2 = await pdfText(file, { from: 2 });
    assert.equal(p2.from, 2);
    assert.doesNotMatch(p2.text, /ES-10151/);
    assert.match(p2.text, /Roofing/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scanned PDF: flagged, and pages render to PNGs", { skip: !havePoppler && "poppler not installed" }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pdfread-test-"));
  try {
    const file = path.join(dir, "scan.pdf");
    // Shapes only, no text layer — what a phone scan looks like to pdftotext.
    await writePdf(file, (doc) => {
      doc.rect(60, 60, 300, 120).fill("#333");
      doc.addPage().circle(200, 200, 80).fill("#666");
    });
    const t = await pdfText(file);
    assert.equal(t.scanned, true);
    const r = await pdfPagePngs(file, { from: 1, to: 9 });
    assert.equal(r.images.length, 2);
    for (const png of r.images) assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

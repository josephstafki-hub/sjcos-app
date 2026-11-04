// Read a stored PDF for an agent: its text layer (pdftotext) or, for a scanned
// PDF with no text, its pages as PNGs (pdftoppm). Both tools ship with poppler
// and are already on the box (lib/attachments.ts and lib/plan-underlay.ts use
// them). Used by get_project_file so the unattended worker, which has no Read
// tool, can read estimates, contracts and invoices that only exist as PDFs.
//
//   pdfPageCount(file)                         → number | null
//   pdfText(file, { from, to })                → { text, pages, truncated }
//   pdfPagePngs(file, { from, to, dpi })       → Buffer[] (one per page)
//
// Never runs a shell; arguments go to execFile as an array. Each call is time-
// and output-capped so one bad PDF can't hang or flood a run.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 30_000;

export const PDF_TEXT_MAX = 200_000;
/** Most pages rendered as images in one call (each is a full image block). */
export const PDF_MAX_IMAGE_PAGES = 5;
/** Below this many non-space characters per page the PDF is treated as scanned. */
const MIN_CHARS_PER_PAGE = 40;

export function isPdf(f) {
  return /^application\/pdf\b/i.test(String(f?.mime_type || "")) || /\.pdf$/i.test(String(f?.name || ""));
}

/** Clamp a requested 1-based page range to the document. */
export function pageRange(pages, from, to, maxSpan = Infinity) {
  const total = Number.isFinite(pages) && pages > 0 ? pages : null;
  let a = Math.max(1, Math.round(Number(from) || 1));
  if (total) a = Math.min(a, total);
  let b = Math.round(Number(to) || 0) || (total ?? a);
  if (total) b = Math.min(b, total);
  b = Math.max(a, Math.min(b, a + maxSpan - 1));
  return { from: a, to: b };
}

export async function pdfPageCount(file) {
  try {
    const { stdout } = await execFileAsync("pdfinfo", [file], { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    const m = /^Pages:\s+(\d+)/m.exec(stdout);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** True when the extracted text is too thin to be a real text layer. */
export function looksScanned(text, pageCount) {
  const chars = String(text || "").replace(/\s+/g, "").length;
  return chars < MIN_CHARS_PER_PAGE * Math.max(1, pageCount || 1);
}

export async function pdfText(file, { from, to } = {}) {
  const pages = await pdfPageCount(file);
  const r = pageRange(pages, from, to);
  const { stdout } = await execFileAsync(
    "pdftotext",
    ["-layout", "-enc", "UTF-8", "-f", String(r.from), "-l", String(r.to), file, "-"],
    { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
  );
  // -layout pads columns with long space runs; squeeze them so the cap holds
  // content, not whitespace (same as lib/attachments.ts).
  const body = stdout.replace(/[ \t]{3,}/g, "   ").replace(/\n{3,}/g, "\n\n").trim();
  return {
    text: body.slice(0, PDF_TEXT_MAX),
    truncated: body.length > PDF_TEXT_MAX,
    pages,
    from: r.from,
    to: r.to,
    scanned: looksScanned(body, r.to - r.from + 1),
  };
}

export async function pdfPagePngs(file, { from, to, dpi = 110 } = {}) {
  const pages = await pdfPageCount(file);
  const r = pageRange(pages, from, to, PDF_MAX_IMAGE_PAGES);
  const dir = await mkdtemp(path.join(os.tmpdir(), "sjcos-pdfpages-"));
  try {
    await execFileAsync(
      "pdftoppm",
      ["-png", "-r", String(Math.min(200, Math.max(50, Math.round(dpi)))), "-f", String(r.from), "-l", String(r.to), file, path.join(dir, "p")],
      { timeout: TIMEOUT_MS * 2, maxBuffer: 1024 * 1024 },
    );
    const names = (await readdir(dir)).filter((n) => n.endsWith(".png")).sort();
    const out = [];
    for (const n of names) out.push(await readFile(path.join(dir, n)));
    return { images: out, pages, from: r.from, to: r.to };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

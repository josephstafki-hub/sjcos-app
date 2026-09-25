import "server-only";

// Turns an uploaded plan (image or PDF) into the image the designer traces
// over. PDFs are rendered with poppler (pdftoppm) at a known DPI, so a sheet
// drawn at 1/4" = 1'-0" can be scaled exactly without calibrating; photos are
// EXIF-rotated. Either way the result is capped at MAX_PX on its long side so
// an iPad can hold it in memory.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { sheetScaleFromText } from "./plan-geometry";

const execFileAsync = promisify(execFile);

const MAX_PX = 4096;
const MAX_DPI = 200;
const TIMEOUT_MS = 60_000;

export interface UnderlayImage {
  png: Buffer;
  widthPx: number;
  heightPx: number;
  /** Render DPI for PDFs (null for photos / images). */
  dpi: number | null;
  /** PDF page count (1 for images). */
  pages: number;
  page: number;
  /** Drawing scale printed on the sheet (paper inches per foot, 1/4" = 1'-0"
   *  → 0.25) when the page's text names one clearly; null otherwise. */
  sheetInPerFt: number | null;
}

export function isPdf(mime: string | null | undefined, name = ""): boolean {
  return (mime ?? "").includes("pdf") || name.toLowerCase().endsWith(".pdf");
}

async function pdfPageInfo(file: string, page: number): Promise<{ pages: number; wPt: number; hPt: number }> {
  const { stdout } = await execFileAsync("pdfinfo", ["-f", String(page), "-l", String(page), file], { timeout: TIMEOUT_MS });
  const pages = Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? 1);
  // "Page    1 size: 2592 x 1728 pts" (per-page) or "Page size: 612 x 792 pts".
  const m = stdout.match(/size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/);
  const rot = Number(stdout.match(/rot:\s+(\d+)/)?.[1] ?? 0);
  let wPt = m ? Number(m[1]) : 612;
  let hPt = m ? Number(m[2]) : 792;
  if (rot === 90 || rot === 270) [wPt, hPt] = [hPt, wPt];
  return { pages, wPt, hPt };
}

/** Render one page of a PDF (1-based) to PNG at the highest DPI ≤ 200 that
 *  keeps the long side within MAX_PX. */
async function renderPdf(bytes: Buffer, page: number): Promise<UnderlayImage> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sjcos-underlay-"));
  try {
    const src = path.join(dir, "in.pdf");
    await writeFile(src, bytes);
    const info = await pdfPageInfo(src, 1);
    const p = Math.max(1, Math.min(info.pages, Math.floor(page) || 1));
    const pg = p === 1 ? info : await pdfPageInfo(src, p);
    const longIn = Math.max(pg.wPt, pg.hPt) / 72;
    const dpi = Math.max(36, Math.min(MAX_DPI, Math.floor(MAX_PX / Math.max(1, longIn))));
    await execFileAsync("pdftoppm", ["-png", "-r", String(dpi), "-f", String(p), "-l", String(p), "-singlefile", src, path.join(dir, "out")], {
      timeout: TIMEOUT_MS,
    });
    const png = await readFile(path.join(dir, "out.png"));
    const meta = await sharp(png).metadata();
    let sheetInPerFt: number | null = null;
    try {
      const { stdout } = await execFileAsync("pdftotext", ["-f", String(p), "-l", String(p), src, "-"], { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
      sheetInPerFt = sheetScaleFromText(stdout);
    } catch {
      /* scanned sheet / no text layer — measure instead */
    }
    return { png, widthPx: meta.width ?? 1, heightPx: meta.height ?? 1, dpi, pages: info.pages, page: p, sheetInPerFt };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function normaliseImage(bytes: Buffer): Promise<UnderlayImage> {
  const img = sharp(bytes, { failOn: "none" }).rotate(); // EXIF orientation
  const meta = await img.metadata();
  const w = meta.autoOrient?.width ?? meta.width ?? 1;
  const h = meta.autoOrient?.height ?? meta.height ?? 1;
  const resized = Math.max(w, h) > MAX_PX ? img.resize({ width: w >= h ? MAX_PX : undefined, height: h > w ? MAX_PX : undefined }) : img;
  const { data, info } = await resized.png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true });
  return { png: data, widthPx: info.width, heightPx: info.height, dpi: null, pages: 1, page: 1, sheetInPerFt: null };
}

/** The traceable image for an uploaded plan file. Throws with a readable
 *  message when the file can't be read. */
export async function underlayImage(bytes: Buffer, mime: string | null, name: string, page = 1): Promise<UnderlayImage> {
  if (isPdf(mime, name)) {
    try {
      return await renderPdf(bytes, page);
    } catch {
      throw new Error("Couldn't read that PDF — try exporting the sheet as an image.");
    }
  }
  try {
    return await normaliseImage(bytes);
  } catch {
    throw new Error("Couldn't read that image — use a PNG, JPG or PDF.");
  }
}

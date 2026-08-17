import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { ChatAttachment } from "@/lib/dev-agents-meta";

const execFileAsync = promisify(execFile);

// Files uploaded from the Ask composer (lib/actions/ai-chat.ts) and how each
// model gets to read them.
//
//   claude → reads the file itself (its Read tool handles text, PDFs, images) —
//            we hand it the absolute path.
//   hermes → its gateway takes text + images (data:image/… parts) — and its
//            terminal tool runs on this box, so it also gets the path.
//   qwen   → text only (qwen2.5:7b-instruct has no vision) unless OLLAMA_MODEL
//            is a vision model, in which case images ride along too.
//
// So every attachment is reduced here to (text, images): text is extracted
// with the tools already on the box (pdftotext, LibreOffice headless, unzip)
// and cached in a sidecar file next to the upload; a scanned PDF with no
// text layer is rendered to page images so a vision model can still read it.

export const UPLOAD_DIR = path.join(process.cwd(), "uploads", "ai-chat");

export type { ChatAttachment };

export type AttachmentKind = "text" | "image" | "pdf" | "document" | "sheet" | "archive" | "binary";

export interface AttachmentImage {
  mime: string;
  /** Raw base64 (no data: prefix). */
  base64: string;
}

export interface AttachmentContent {
  name: string;
  path: string;
  kind: AttachmentKind;
  /** Extracted text, clipped to the caller's limit. Empty when there is none. */
  text: string;
  /** The image itself, or the rendered pages of a text-less PDF. */
  images: AttachmentImage[];
  /** Why `text` is empty / what the images are (shown to the model). */
  note?: string;
}

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "yaml", "yml", "html", "htm", "log",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "css", "scss", "sql", "py", "sh", "toml", "ini", "env", "eml", "ics", "vcf", "svg",
]);
const IMAGE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};
const DOC_EXT = new Set(["doc", "docx", "odt", "rtf", "pptx", "ppt", "odp", "pages"]);
const SHEET_EXT = new Set(["xls", "xlsx", "ods", "numbers"]);
const ARCHIVE_EXT = new Set(["zip"]);

/** Max longest side / bytes for an image sent to a vision model. */
const IMAGE_MAX_SIDE = 1600;
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
/** Text-less PDF → render this many pages as images. */
const PDF_RENDER_PAGES = 4;
const TOOL_TIMEOUT_MS = 60_000;

const ext = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

export function attachmentKind(name: string): AttachmentKind {
  const e = ext(name);
  if (IMAGE_MIME[e]) return "image";
  if (e === "pdf") return "pdf";
  if (TEXT_EXT.has(e)) return "text";
  if (DOC_EXT.has(e)) return "document";
  if (SHEET_EXT.has(e)) return "sheet";
  if (ARCHIVE_EXT.has(e)) return "archive";
  return "binary";
}

/** Keep only attachments that live in our upload dir (guards path traversal
 *  from a tampered client payload — the row we persist is trusted after this). */
export function sanitizeAttachments(atts?: ChatAttachment[] | null): ChatAttachment[] {
  return (atts ?? []).filter(
    (a): a is ChatAttachment =>
      !!a && typeof a.path === "string" && typeof a.name === "string" && a.path.startsWith(UPLOAD_DIR + path.sep),
  );
}

// ─── text extraction (cached in a sidecar) ───────────────────────────────────

const sidecar = (p: string) => `${p}.extracted.txt`;

async function readCached(p: string): Promise<string | null> {
  try {
    return await readFile(sidecar(p), "utf8");
  } catch {
    return null;
  }
}

async function run(bin: string, args: string[], timeoutMs = TOOL_TIMEOUT_MS): Promise<string> {
  const { stdout } = await execFileAsync(bin, args, {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  return stdout;
}

/** LibreOffice headless conversion into a temp dir; returns the converted
 *  file's text. An isolated profile dir keeps it from fighting a desktop
 *  LibreOffice over the user profile lock. */
async function sofficeConvert(file: string, filter: string): Promise<string> {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "sjcos-attach-"));
  try {
    await run("soffice", [
      "-env:UserInstallation=file:///tmp/sjcos-soffice-profile",
      "--headless",
      "--convert-to",
      filter,
      "--outdir",
      outDir,
      file,
    ]);
    const files = await readdir(outDir);
    if (!files.length) return "";
    return (await readFile(path.join(outDir, files[0]))).toString("utf8").replace(/^\uFEFF/, "");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

async function extractRaw(a: ChatAttachment, kind: AttachmentKind): Promise<string> {
  switch (kind) {
    case "text": {
      const buf = await readFile(a.path);
      const text = buf.toString("utf8");
      return text.includes("\u0000") ? "" : text;
    }
    case "pdf":
      // -layout keeps table columns aligned; squeeze the padding runs it
      // emits so a 40k-char cap holds content, not spaces.
      return (await run("pdftotext", ["-layout", "-enc", "UTF-8", a.path, "-"]))
        .replace(/[ \t]{3,}/g, "   ")
        .replace(/\n{3,}/g, "\n\n");
    case "document":
      return sofficeConvert(a.path, "txt:Text");
    case "sheet":
      // All sheets, comma-separated (the trailing -1 = every sheet, one CSV
      // each; LibreOffice ≥7.2 — readdir picks them all up below).
      return sofficeConvertAll(a.path);
    case "archive":
      return run("unzip", ["-l", a.path]);
    default:
      return "";
  }
}

async function sofficeConvertAll(file: string): Promise<string> {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "sjcos-attach-"));
  try {
    await run("soffice", [
      "-env:UserInstallation=file:///tmp/sjcos-soffice-profile",
      "--headless",
      "--convert-to",
      "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1",
      "--outdir",
      outDir,
      file,
    ]);
    const files = (await readdir(outDir)).sort();
    const parts: string[] = [];
    for (const f of files) {
      const body = (await readFile(path.join(outDir, f))).toString("utf8").replace(/^\uFEFF/, "");
      parts.push(files.length > 1 ? `--- ${f} ---\n${body}` : body);
    }
    return parts.join("\n\n");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

/** Extracted text for an attachment (cached after the first call). Never
 *  throws — a failed extraction caches as empty and the caller notes it. */
export async function extractText(a: ChatAttachment): Promise<string> {
  const kind = attachmentKind(a.name);
  if (kind === "image" || kind === "binary") return "";
  const cached = await readCached(a.path);
  if (cached !== null) return cached;
  let text = "";
  try {
    text = (await extractRaw(a, kind)).trim();
  } catch {
    text = "";
  }
  await writeFile(sidecar(a.path), text).catch(() => {});
  return text;
}

// ─── images ──────────────────────────────────────────────────────────────────

/** Read an image, downscaling anything a vision API would balk at. */
async function loadImage(file: string, mime: string): Promise<AttachmentImage> {
  const buf = await readFile(file);
  let img = sharp(buf, { animated: false });
  const meta = await img.metadata().catch(() => null);
  const big = buf.length > IMAGE_MAX_BYTES || (meta?.width ?? 0) > IMAGE_MAX_SIDE || (meta?.height ?? 0) > IMAGE_MAX_SIDE;
  if (!big) return { mime, base64: buf.toString("base64") };
  img = img.rotate().resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: "inside", withoutEnlargement: true });
  const out = await img.jpeg({ quality: 82 }).toBuffer();
  return { mime: "image/jpeg", base64: out.toString("base64") };
}

/** Render the first pages of a PDF to images (scanned estimates etc.). */
async function renderPdfPages(file: string): Promise<AttachmentImage[]> {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "sjcos-pdf-"));
  try {
    await run("pdftoppm", ["-png", "-r", "80", "-f", "1", "-l", String(PDF_RENDER_PAGES), file, path.join(outDir, "p")]);
    const files = (await readdir(outDir)).filter((f) => f.endsWith(".png")).sort();
    const out: AttachmentImage[] = [];
    for (const f of files) out.push(await loadImage(path.join(outDir, f), "image/png"));
    return out;
  } catch {
    return [];
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

// ─── the one entry point ─────────────────────────────────────────────────────

export interface ReadOptions {
  /** Clip extracted text to this many chars (per file). */
  maxChars: number;
  /** Load image payloads (only worth the bytes for a vision-capable reader). */
  withImages: boolean;
}

/** Everything a model can get out of one attachment. Never throws. */
export async function readAttachment(a: ChatAttachment, opts: ReadOptions): Promise<AttachmentContent> {
  const kind = attachmentKind(a.name);
  const out: AttachmentContent = { name: a.name, path: a.path, kind, text: "", images: [] };
  try {
    await stat(a.path);
  } catch {
    out.note = "file is no longer on disk";
    return out;
  }
  if (kind === "image") {
    if (opts.withImages) {
      try {
        out.images = [await loadImage(a.path, IMAGE_MIME[ext(a.name)])];
      } catch {
        out.note = "image could not be read";
      }
    } else {
      out.note = "image — attached for a vision-capable model; not readable as text";
    }
    return out;
  }
  const text = await extractText(a);
  if (text) {
    out.text = text.length > opts.maxChars ? `${text.slice(0, opts.maxChars)}\n…(truncated — ${text.length.toLocaleString()} chars total)` : text;
    return out;
  }
  if (kind === "pdf") {
    if (opts.withImages) {
      out.images = await renderPdfPages(a.path);
      out.note = out.images.length
        ? `PDF has no text layer (scanned) — first ${out.images.length} page(s) attached as images`
        : "PDF has no extractable text and could not be rendered";
    } else {
      out.note = "PDF has no text layer (scanned) — a vision-capable model can view it";
    }
    return out;
  }
  out.note =
    kind === "binary"
      ? "binary file — no text to show"
      : kind === "archive"
        ? "archive — could not list contents"
        : "no text could be extracted";
  return out;
}

/** Plain-text rendering of attachments for a prompt: text inline, images and
 *  unreadable files described, plus the on-disk path when the reader has a
 *  shell/file tool (Claude, Hermes) to open the original itself. */
export async function renderAttachmentsForPrompt(
  atts: ChatAttachment[],
  opts: ReadOptions & { withPaths: boolean; heading?: string },
): Promise<{ text: string; images: AttachmentImage[] }> {
  if (!atts.length) return { text: "", images: [] };
  const parts: string[] = [];
  const images: AttachmentImage[] = [];
  for (const a of atts) {
    const c = await readAttachment(a, opts);
    const head = `### ${a.name}${opts.withPaths ? `\n(path on this machine: ${a.path})` : ""}`;
    if (c.text) parts.push(`${head}\n${c.text}`);
    else if (c.images.length && c.kind === "image") parts.push(`${head}\n(image attached${opts.withPaths ? "" : " below"})`);
    else parts.push(`${head}\n(${c.note ?? "not shown"})`);
    images.push(...c.images);
  }
  return { text: `\n\n[${opts.heading ?? "Attached files"}]\n${parts.join("\n\n")}`, images };
}

/** data:image/…;base64 URL for OpenAI-style image parts. */
export const imageDataUrl = (img: AttachmentImage) => `data:${img.mime};base64,${img.base64}`;

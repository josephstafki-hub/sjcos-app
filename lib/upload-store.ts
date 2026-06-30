import "server-only";

// Shared upload helper (Review-round-3 S5). Stores an uploaded File as a blob
// under uploads/ and indexes it in the files table, returning the new files row
// id. Reused by catalog images, selections, mood boards, and floor plans.
// NOT a "use server" file (those may only export async actions) — it's a plain
// server-only module called by the action files that own each upload.

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { query } from "./db";
import { UPLOAD_DIR } from "./uploads";

const MAX_BYTES = 25 * 1024 * 1024; // matches next.config serverActions bodySizeLimit

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeName(name: string): string {
  return path.basename(name).replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
}

export interface StoreOpts {
  /** files.id prefix, e.g. "cat" / "sel" / "mood" / "fp". */
  idPrefix?: string;
  projectKey?: string;
  tag?: string;
  subtitle?: string;
  /** Reject non-image uploads. */
  imagesOnly?: boolean;
}

export type StoreResult =
  | { ok: true; id: string; type: "img" | "doc" }
  | { ok: false; error: string };

/** Validate, write to disk, and insert a files row. Returns the row id. */
export async function storeUpload(file: unknown, opts: StoreOpts = {}): Promise<StoreResult> {
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `File is too large (max ${sizeLabel(MAX_BYTES)}).` };
  }
  const isImage = (file.type || "").startsWith("image/");
  if (opts.imagesOnly && !isImage) {
    return { ok: false, error: "Only image files are allowed here." };
  }

  return persistBlob(Buffer.from(await file.arrayBuffer()), {
    original: safeName(file.name),
    mime: file.type || "application/octet-stream",
    isImage,
    idPrefix: opts.idPrefix,
    projectKey: opts.projectKey,
    tag: opts.tag,
    subtitle: opts.subtitle,
  });
}

export interface StoreBufferOpts {
  /** Stored + displayed file name, e.g. "Henderson — Contract.pdf". */
  filename: string;
  /** MIME type, e.g. "application/pdf". */
  mime: string;
  idPrefix?: string;
  projectKey?: string;
  tag?: string;
  subtitle?: string;
}

/** Store an already-built Buffer (e.g. a generated PDF/DOCX) as a files row.
 *  Mirrors storeUpload but takes raw bytes instead of an uploaded File — used by
 *  the document generator (lib/documents.ts) where there's no client upload. */
export async function storeBuffer(buf: Buffer, opts: StoreBufferOpts): Promise<StoreResult> {
  if (!buf || buf.length === 0) return { ok: false, error: "Empty document." };
  if (buf.length > MAX_BYTES) return { ok: false, error: `Document is too large (max ${sizeLabel(MAX_BYTES)}).` };
  return persistBlob(buf, {
    original: safeName(opts.filename),
    mime: opts.mime,
    isImage: opts.mime.startsWith("image/"),
    idPrefix: opts.idPrefix,
    projectKey: opts.projectKey,
    tag: opts.tag,
    subtitle: opts.subtitle,
  });
}

/** Shared: write bytes to disk + insert the files row. */
async function persistBlob(
  bytes: Buffer,
  o: {
    original: string;
    mime: string;
    isImage: boolean;
    idPrefix?: string;
    projectKey?: string;
    tag?: string;
    subtitle?: string;
  },
): Promise<StoreResult> {
  const id = `${o.idPrefix ?? "up"}-${randomUUID()}`;
  const storedName = `${id}__${o.original}`;

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, storedName), bytes);

  const type: "img" | "doc" = o.isImage ? "img" : "doc";
  const ext = path.extname(o.original).replace(".", "").toUpperCase();

  await query(
    `INSERT INTO files
       (id, project_key, type, name, tag, ai_origin, modified_label, size_label,
        subtitle, ai_tags, sort, storage_path, mime_type)
     VALUES ($1, $2, $3, $4, $5, false, 'just now', $6, $7, '{}', -1, $8, $9)`,
    [
      id,
      o.projectKey ?? "",
      type,
      o.original,
      o.tag ?? (ext ? `UPLOAD · ${ext}` : "UPLOAD"),
      sizeLabel(bytes.length),
      o.subtitle ?? "Uploaded",
      storedName,
      o.mime,
    ],
  );

  return { ok: true, id, type };
}

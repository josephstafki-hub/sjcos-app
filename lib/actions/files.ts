"use server";

// File actions. The preview pane's "Summarize" button routes through lib/ai.ts
// (provider-agnostic). uploadFile stores a real blob on the server and inserts a
// files row, so /files is now a real upload browser (Drive mirror still deferred).

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { ai } from "@/lib/ai";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { UPLOAD_DIR } from "@/lib/uploads";
import { storeUpload } from "@/lib/upload-store";

const MAX_BYTES = 25 * 1024 * 1024; // keep in step with next.config bodySizeLimit

/** Humanize a byte count for the size column, e.g. "2.4 MB". */
function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Strip a filename to a safe on-disk basename (no paths, no odd chars). */
function safeName(name: string): string {
  return path.basename(name).replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
}

export type UploadResult = { ok: true } | { ok: false; error: string };

/** Store an uploaded file on the server and index it in the files table.
 *  Owner-gated. `project_key` (the viewed folder) scopes it in the tree rail. */
export async function uploadFile(formData: FormData): Promise<UploadResult> {
  await requireRole("owner");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `File is too large (max ${sizeLabel(MAX_BYTES)}).` };
  }

  const projectKey = String(formData.get("project_key") ?? "").trim();
  const original = safeName(file.name);
  const id = `up-${randomUUID()}`;
  const storedName = `${id}__${original}`;

  await mkdir(UPLOAD_DIR, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, storedName), bytes);

  const isImage = (file.type || "").startsWith("image/");
  const type = isImage ? "img" : "doc";
  const ext = path.extname(original).replace(".", "").toUpperCase();

  await query(
    `INSERT INTO files
       (id, project_key, type, name, tag, ai_origin, modified_label, size_label,
        subtitle, ai_tags, sort, storage_path, mime_type)
     VALUES ($1, $2, $3, $4, $5, false, 'just now', $6, $7, '{}', -1, $8, $9)`,
    [
      id,
      projectKey,
      type,
      original,
      ext ? `UPLOAD · ${ext}` : "UPLOAD",
      sizeLabel(file.size),
      projectKey ? `Uploaded · ${projectKey}` : "Uploaded",
      storedName,
      file.type || "application/octet-stream",
    ],
  );

  revalidatePath("/files");
  return { ok: true };
}

/** Upload a real photo attached to a lead (shown in the lead's Photos grid).
 *  Owner-gated, images only. Stored like any other upload but tagged lead_slug. */
export async function uploadLeadPhoto(
  slug: string,
  formData: FormData,
): Promise<UploadResult> {
  await requireRole("owner");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }
  if (!(file.type || "").startsWith("image/")) {
    return { ok: false, error: "Only image files can be added as photos." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `Image is too large (max ${sizeLabel(MAX_BYTES)}).` };
  }

  const original = safeName(file.name);
  const id = `lp-${randomUUID()}`;
  const storedName = `${id}__${original}`;

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, storedName), Buffer.from(await file.arrayBuffer()));

  await query(
    `INSERT INTO files
       (id, project_key, lead_slug, type, name, tag, ai_origin, modified_label,
        size_label, subtitle, ai_tags, sort, storage_path, mime_type)
     VALUES ($1, '', $2, 'img', $3, 'PHOTO', false, 'just now', $4, $5, '{}', -1, $6, $7)`,
    [
      id,
      slug,
      original,
      sizeLabel(file.size),
      `Lead photo · ${slug}`,
      storedName,
      file.type,
    ],
  );

  revalidatePath(`/leads/${slug}`);
  return { ok: true };
}

/** Upload a real file scoped to a project (project_key = slug), shown on the
 *  project's Files tab and downloadable via /api/files/[id]. Owner-gated. */
export async function uploadProjectFile(
  slug: string,
  formData: FormData,
): Promise<UploadResult> {
  await requireRole("owner");
  const res = await storeUpload(formData.get("file"), {
    idPrefix: "proj",
    projectKey: slug,
    subtitle: `Project file · ${slug}`,
  });
  if (!res.ok) return res;
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

interface FileSummaryRow {
  name: string;
  tag: string;
  subtitle: string | null;
  ai_tags: string[];
}

/** Summarize a file from its metadata via the AI service. Returns a one-line
 *  blurb (or a fallback when the file is gone). */
export async function summarizeFile(id: string): Promise<string> {
  const row = await queryOne<FileSummaryRow>(
    `SELECT name, tag, subtitle, ai_tags FROM files WHERE id = $1`,
    [id],
  );
  if (!row) return "That file is no longer available.";

  const text =
    `${row.name} — ${row.tag}. ${row.subtitle ?? ""} ` +
    `Tags: ${row.ai_tags.join(", ") || "none"}.`;

  const { summary } = await ai.summarize({ text, focus: "file" });
  return summary;
}

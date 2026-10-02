// Stored files → email attachments, shared by the bid-packet send
// (lib/bidding.ts) and the agent send_email tool (lib/agent-sends.ts). No db or
// fs import: callers pass `run` and `read` (lib/uploads.ts → readUpload), so
// unit tests can stub both.

import type { MailAttachment } from "./gmail.ts";
import type { Run } from "./budget-queries.ts";

/** Gmail's hard cap is ~25 MB per message; leave headroom for MIME overhead. */
export const MAX_ATTACHMENT_BYTES = 22 * 1024 * 1024;
/** Most files an agent may attach to one send_email (mcp/grants-tools.mjs). */
export const MAX_EMAIL_ATTACHMENTS = 10;

export interface AttachmentFile {
  name: string;
  mime_type: string | null;
  storage_path: string | null;
}

export type ReadBlob = (storagePath: string) => Promise<Buffer>;

/** Read every file's blob, in order. A missing blob stops the lot — half a
 *  packet is worse than no send — and names the file that's gone. */
export async function readAttachments(
  files: AttachmentFile[],
  read: ReadBlob,
): Promise<{ ok: true; attachments: MailAttachment[]; totalBytes: number } | { ok: false; missing: string }> {
  const attachments: MailAttachment[] = [];
  for (const f of files) {
    try {
      const content = await read(f.storage_path ?? "");
      attachments.push({ filename: f.name, mimeType: f.mime_type || "application/octet-stream", content });
    } catch {
      return { ok: false, missing: f.name };
    }
  }
  return { ok: true, attachments, totalBytes: attachments.reduce((s, a) => s + a.content.length, 0) };
}

/** Resolve the file ids an agent asked to attach. Refuses — before anything is
 *  sent or any grant spent — when an id has no stored file, a blob is missing
 *  from disk, or the total is over Gmail's limit. No ids → no query, no read. */
export async function loadFileAttachments(
  run: Run,
  read: ReadBlob,
  fileIds: readonly string[],
): Promise<{ ok: true; attachments: MailAttachment[] } | { ok: false; error: string }> {
  const ids = [...new Set(fileIds.map((id) => String(id).trim()))];
  if (ids.length === 0) return { ok: true, attachments: [] };
  if (ids.length > MAX_EMAIL_ATTACHMENTS) {
    return { ok: false, error: `Too many attachments (${ids.length}) — ${MAX_EMAIL_ATTACHMENTS} files per email at most. Nothing was sent.` };
  }

  const rows = await run<AttachmentFile & { id: string }>(
    `SELECT id, name, mime_type, storage_path FROM files WHERE id = ANY($1::text[]) AND storage_path IS NOT NULL`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `No stored file with id ${unknown.map((id) => JSON.stringify(id)).join(", ")} — take ids from list_project_files. Nothing was sent.`,
    };
  }

  const loaded = await readAttachments(ids.map((id) => byId.get(id)!), read);
  if (!loaded.ok) {
    return { ok: false, error: `Attachment "${loaded.missing}" is missing from storage — re-upload it. Nothing was sent.` };
  }
  if (loaded.totalBytes > MAX_ATTACHMENT_BYTES) {
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `Attachments total ${mb(loaded.totalBytes)} MB, over Gmail's ~25 MB limit (${mb(MAX_ATTACHMENT_BYTES)} MB max) — attach fewer or smaller files. Nothing was sent.`,
    };
  }
  return { ok: true, attachments: loaded.attachments };
}

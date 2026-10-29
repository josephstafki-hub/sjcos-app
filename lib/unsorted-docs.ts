import "server-only";

// Unsorted documents — the app side: Gmail + blob storage around the pure DB
// module (lib/unsorted-docs-core.ts). Used by the /unsorted page's actions and
// by the internal route the MCP tools call (app/api/internal/filing), so an
// agent and Joe go through the same code.
//
// The agent never ships file bytes: it names a Gmail message id and the app
// pulls the email body and every attachment from the company mailbox itself
// (lib/gmail.ts fetchMessageForFiling). For a document that didn't come from
// Gmail an agent may pass the body text and base64 attachments instead, or
// the server path of a file it was handed — a file dropped into the Ask
// window (uploads/ai-chat/…), or under a root listed in
// SJCOS_FILING_PATH_ROOTS (colon-separated). Nothing outside those is read.
//
// Sorting wakes the filing agent at once (lib/agent-kick.ts).

import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { kickFilingAgent } from "@/lib/agent-kick";
import { withTransaction, type Run } from "@/lib/commands/db";
import { query } from "@/lib/db";
import { fetchMessageForFiling, gmailConfigured, type FilingMessage } from "@/lib/gmail";
import { storeBuffer } from "@/lib/upload-store";
import { UPLOAD_DIR } from "@/lib/uploads";
import { todayCentral } from "@/lib/budget-queries";
import { clearThumbnails } from "@/lib/file-trash";
import {
  attachDocFiles,
  fileDoc,
  noteForAgent,
  replyOnDoc,
  stageDoc,
  undoDoc,
  type FileResult,
  type FileTarget,
  type Result,
  type StageInput,
  type StageResult,
} from "@/lib/unsorted-docs-core";

export * from "@/lib/unsorted-docs-core";

/** Run a write that answers {ok:false} by rolling back instead of committing half of it. */
class Refused extends Error {
  constructor(readonly result: { ok: false; error: string }) {
    super(result.error);
  }
}
async function atomically<T extends Result<object>>(fn: (run: Run) => Promise<T>): Promise<T> {
  try {
    return await withTransaction(async (run) => {
      const out = await fn(run);
      if (!out.ok) throw new Refused(out);
      return out;
    });
  } catch (e) {
    if (e instanceof Refused) return e.result as T;
    throw e;
  }
}

export interface UploadedAttachment {
  filename: string;
  mime_type: string;
  /** base64 of the file bytes. */
  base64: string;
}

export interface StageFromEmailInput extends Omit<StageInput, "sourceRef" | "emailFileId" | "attachmentFileIds"> {
  /** Committed create_unsorted_upload ids to attach. */
  uploadIds?: string[];
  /** Gmail message id — the source of the body + attachments. */
  gmailMessageId?: string | null;
  /** Agent's own stable key when there's no Gmail id (e.g. 'hermes:ocr-0912'). */
  sourceRef?: string;
  /** Fallbacks when the message can't be read from Gmail. */
  bodyText?: string;
  attachments?: UploadedAttachment[];
  /** Server paths of files the agent was handed (Ask-window uploads). */
  filePaths?: string[];
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  heic: "image/heic", txt: "text/plain", csv: "text/csv",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function pathRoots(): string[] {
  return [path.join(process.cwd(), "uploads", "ai-chat"), ...(process.env.SJCOS_FILING_PATH_ROOTS ?? "").split(":")]
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => path.resolve(r));
}

/** Read files an agent named by path — only from the allowed roots. */
async function readHandedFiles(paths: string[]): Promise<{ ok: true; files: { filename: string; mimeType: string; bytes: Buffer }[] } | { ok: false; error: string }> {
  const roots = await Promise.all(pathRoots().map((r) => realpath(r).catch(() => r)));
  const files: { filename: string; mimeType: string; bytes: Buffer }[] = [];
  for (const raw of paths.slice(0, 10)) {
    let real: string;
    try {
      real = await realpath(String(raw));
    } catch {
      return { ok: false, error: `File not found: ${raw}` };
    }
    if (!roots.some((r) => real.startsWith(r + path.sep))) {
      return { ok: false, error: `${raw} is outside the folders filing may read (Ask-window uploads, or SJCOS_FILING_PATH_ROOTS).` };
    }
    const info = await stat(real);
    if (!info.isFile() || info.size > MAX_UPLOAD_BYTES) return { ok: false, error: `${raw} isn't a file under 20 MB.` };
    const ext = path.extname(real).slice(1).toLowerCase();
    // Ask-window uploads are saved as "<uuid>-<original name>".
    const filename = path.basename(real).replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
    files.push({ filename, mimeType: MIME_BY_EXT[ext] ?? "application/octet-stream", bytes: await readFile(real) });
  }
  return { ok: true, files };
}

const ATTACH_MIME = /^(application\/pdf|image\/|application\/(msword|vnd\.openxmlformats|vnd\.ms-excel)|text\/(plain|csv))/i;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The email as a self-contained page: a header block, then the sanitized body. */
function emailPage(m: { from: string; subject: string; receivedAt: string | null; html: string; text: string }): string {
  const when = m.receivedAt
    ? new Date(m.receivedAt).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })
    : "";
  const body = m.html || `<pre style="white-space:pre-wrap;font:14px/1.5 system-ui,sans-serif">${escapeHtml(m.text)}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(m.subject || "Email")}</title></head>
<body style="margin:0;font:14px/1.5 system-ui,sans-serif;color:#222;background:#fff">
<div style="padding:12px 16px;border-bottom:1px solid #ddd;background:#f6f4ee;font-size:12px;color:#555">
<div><b>From:</b> ${escapeHtml(m.from)}</div><div><b>Subject:</b> ${escapeHtml(m.subject)}</div>${when ? `<div><b>Date:</b> ${escapeHtml(when)}</div>` : ""}
</div><div style="padding:16px">${body}</div></body></html>`;
}

function fileStem(subject: string): string {
  return (subject || "Email").replace(/[^\w.\- ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Email";
}

/** Store the email page + attachments as files rows (project_key ''). An
 *  attachment whose name matches one in `replace` (name → file id) overwrites
 *  that file in place instead, keeping its id; so does the email page when
 *  `replaceEmailId` is given. */
async function storeDocFiles(
  m: { from: string; subject: string; receivedAt: string | null; html: string; text: string },
  attachments: { filename: string; mimeType: string; bytes: Buffer }[],
  replace: { byName?: Map<string, string>; emailId?: string | null } = {},
): Promise<{ emailFileId: string | null; attachmentFileIds: string[]; replaced: string[]; emailReplaced: boolean; skipped: string[] }> {
  const skipped: string[] = [];
  const attachmentFileIds: string[] = [];
  const replaced: string[] = [];
  for (const a of attachments) {
    if (!ATTACH_MIME.test(a.mimeType) || !a.bytes.length || a.bytes.length > MAX_UPLOAD_BYTES) {
      skipped.push(a.filename);
      continue;
    }
    const same = replace.byName?.get(storedName(a.filename));
    if (same && (await overwriteFile(same, a.bytes, a.mimeType))) {
      if (!replaced.includes(same)) replaced.push(same);
      continue;
    }
    const r = await storeBuffer(a.bytes, { filename: a.filename, mime: a.mimeType, idPrefix: "mail", projectKey: "", subtitle: `Email attachment · ${m.subject}`.slice(0, 200) });
    if (r.ok) attachmentFileIds.push(r.id);
    else skipped.push(a.filename);
  }
  let emailFileId: string | null = null;
  let emailReplaced = false;
  if (m.html || m.text) {
    const page = Buffer.from(emailPage(m), "utf8");
    if (replace.emailId && (await overwriteFile(replace.emailId, page, "text/html; charset=utf-8"))) emailReplaced = true;
    else {
      const r = await storeBuffer(page, {
        filename: `Email — ${fileStem(m.subject)}.html`,
        mime: "text/html; charset=utf-8",
        idPrefix: "mail",
        projectKey: "",
        subtitle: `From ${m.from}`.slice(0, 200),
      });
      if (r.ok) emailFileId = r.id;
    }
  }
  return { emailFileId, attachmentFileIds, replaced, emailReplaced, skipped };
}

/** The name storeBuffer gives a file (lib/upload-store.ts safeName). */
const storedName = (name: string) => path.basename(name).replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";

/** New bytes for a stored file, same id and name. False when it has no blob. */
async function overwriteFile(id: string, bytes: Buffer, mime: string): Promise<boolean> {
  const [f] = (await query<{ storage_path: string | null }>(`SELECT storage_path FROM files WHERE id = $1`, [id])).rows;
  if (!f?.storage_path) return false;
  const target = path.join(UPLOAD_DIR, path.basename(f.storage_path));
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, target);
  await clearThumbnails(UPLOAD_DIR, id);
  await query(
    `UPDATE files SET type = $2, mime_type = $3, size_label = $4, sha256 = $5, modified_label = 'just now', updated_at = now() WHERE id = $1`,
    [id, mime.startsWith("image/") ? "img" : "doc", mime, sizeLabel(bytes.length), createHash("sha256").update(bytes).digest("hex")]);
  return true;
}

const sizeLabel = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

/** Remove files rows + blobs stored for a stage that then failed. */
async function dropFiles(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { rows } = await query<{ storage_path: string | null }>(`DELETE FROM files WHERE id = ANY($1::text[]) RETURNING storage_path`, [ids]);
  await Promise.all(rows.map((r) => (r.storage_path ? unlink(path.join(UPLOAD_DIR, path.basename(r.storage_path))).catch(() => {}) : null)));
}

/** Committed create_unsorted_upload files for this doc: the ones named in
 *  upload_ids (refused unless committed, and not someone else's), plus any
 *  held for its source_ref. */
async function uploadedFiles(sourceRef: string, docId: number | null, uploadIds: string[]): Promise<{ ok: true; uploadIds: string[]; fileIds: string[] } | { ok: false; error: string }> {
  const wanted = [...new Set(uploadIds.map((u) => String(u).trim()).filter(Boolean))].slice(0, 50);
  const { rows } = await query<{ id: string; target: string; status: string; file_id: string | null; unsorted_doc_id: string | null; source_ref: string | null }>(
    `SELECT id, target, status, file_id, unsorted_doc_id::text AS unsorted_doc_id, source_ref FROM project_uploads
      WHERE id = ANY($1::text[]) OR (target = 'unsorted' AND status = 'committed' AND unsorted_doc_id IS NULL AND source_ref = $2)
      ORDER BY committed_at NULLS LAST, created_at`,
    [wanted, sourceRef]);
  for (const id of wanted) {
    const u = rows.find((r) => r.id === id);
    if (!u) return { ok: false, error: `Unknown upload_id ${id}. Start one with create_unsorted_upload.` };
    if (u.target !== "unsorted") return { ok: false, error: `Upload ${id} went to a project's Files (create_project_upload), not the Unsorted tray.` };
    if (u.status !== "committed" || !u.file_id) return { ok: false, error: `Upload ${id} isn't committed yet. Call commit_unsorted_upload first.` };
    if (u.unsorted_doc_id && Number(u.unsorted_doc_id) !== docId) return { ok: false, error: `Upload ${id} is already attached to Unsorted document ${u.unsorted_doc_id}.` };
  }
  const usable = rows.filter((r) => r.status === "committed" && r.file_id);
  return { ok: true, uploadIds: usable.map((r) => r.id), fileIds: [...new Set(usable.map((r) => r.file_id as string))] };
}

export type StageFromEmailResult =
  | StageResult
  | (Extract<StageResult, { ok: true }> & {
      /** Files on the document now (attachments + the email copy). */
      files: number;
      files_added: number;
      files_replaced: number;
      body_updated: boolean;
      skipped_attachments: string[];
    });

/** Put an emailed document in the tray, or refresh one already there: the
 *  agent's read, plus any attachments, upload_ids and body_text it brings —
 *  a file with the same name as one on the doc replaces it in place, and
 *  body_text rewrites the email copy (a Gmail document keeps the mailbox's). */
export async function stageFromEmail(input: StageFromEmailInput): Promise<StageFromEmailResult> {
  const gmailId = String(input.gmailMessageId ?? "").trim();
  const handed = input.filePaths?.length ? await readHandedFiles(input.filePaths) : { ok: true as const, files: [] };
  if (!handed.ok) return handed;
  // A handed file with no other key is keyed on its content, so the same
  // receipt dropped in twice is one document.
  const contentRef = handed.files.length ? `upload:${createHash("sha256").update(handed.files[0].bytes).digest("hex").slice(0, 24)}` : "";
  const sourceRef = gmailId ? `gmail:${gmailId}` : String(input.sourceRef ?? "").trim() || contentRef;
  if (!sourceRef) return { ok: false, error: "Pass gmail_message_id, file_paths, or a source_ref for a document that didn't come from Gmail." };

  const [existing] = (
    await query<{ id: number; email_file_id: string | null; attachment_file_ids: string[]; gmail_message_id: string | null; from_label: string; subject: string; received_at: string | null }>(
      `SELECT id::int AS id, email_file_id, attachment_file_ids, gmail_message_id, from_label, subject, received_at::text AS received_at
         FROM unsorted_docs WHERE source_ref = $1`,
      [sourceRef],
    )
  ).rows;
  const uploaded = await uploadedFiles(sourceRef, existing?.id ?? null, input.uploadIds ?? []);
  if (!uploaded.ok) return uploaded;

  // Gmail is read for a new doc, or one that never got its files.
  const hadFiles = !!existing && (!!existing.email_file_id || existing.attachment_file_ids.length > 0);
  let msg: FilingMessage | null = null;
  if (gmailId && !hadFiles) {
    if (!gmailConfigured()) return { ok: false, error: "The app's Gmail connection isn't set up, so it can't read that message. Pass body_text and attachments instead." };
    try {
      msg = await fetchMessageForFiling(gmailId);
    } catch (e) {
      return { ok: false, error: `Couldn't read Gmail message ${gmailId} from the company mailbox (${e instanceof Error ? e.message : String(e)}). Check the id, or pass body_text and attachments instead.` };
    }
  }

  // Same name as a file already on the doc → replaced in place.
  const byName = new Map<string, string>();
  if (existing?.attachment_file_ids.length) {
    const { rows } = await query<{ id: string; name: string }>(`SELECT id, name FROM files WHERE id = ANY($1::text[]) AND storage_path IS NOT NULL`, [existing.attachment_file_ids]);
    for (const r of rows) if (!byName.has(r.name)) byName.set(r.name, r.id);
  }
  // The email copy: from Gmail, or body_text. On a doc that has one, body_text
  // rewrites it — unless it came from Gmail, whose copy is the record.
  const bodyText = String(input.bodyText ?? "");
  const rewriteBody = !!existing?.email_file_id && !existing.gmail_message_id && !!bodyText.trim();
  const page = {
    from: msg?.from ?? (input.fromLabel || existing?.from_label || ""),
    subject: msg?.subject ?? (input.subject || existing?.subject || ""),
    receivedAt: msg?.receivedAt ?? (input.receivedAt || existing?.received_at || null),
    html: msg?.html ?? "",
    text: msg?.text ?? (existing?.email_file_id && !rewriteBody ? "" : bodyText),
  };
  const uploads = (input.attachments ?? []).map((a) => ({ filename: String(a.filename || "attachment"), mimeType: String(a.mime_type || "application/octet-stream"), bytes: Buffer.from(String(a.base64 || ""), "base64") }));
  const stored = await storeDocFiles(page, [...(msg?.attachments ?? []), ...uploads, ...handed.files], {
    byName,
    emailId: rewriteBody ? existing!.email_file_id : null,
  });
  const fresh = [...stored.attachmentFileIds, ...(stored.emailFileId ? [stored.emailFileId] : [])];
  try {
    const res = await atomically(async (run) => {
      const staged = await stageDoc(run, {
        ...input,
        sourceRef,
        gmailMessageId: gmailId || null,
        gmailThreadId: msg?.threadId || input.gmailThreadId || null,
        fromLabel: input.fromLabel || msg?.from || undefined,
        subject: input.subject || msg?.subject || undefined,
        receivedAt: input.receivedAt || msg?.receivedAt || null,
        // A new row takes its files here; one already there gets them below.
        emailFileId: existing ? null : stored.emailFileId,
        attachmentFileIds: existing ? [] : stored.attachmentFileIds,
      });
      if (!staged.ok) return staged;
      const attached = await attachDocFiles(run, staged.id, {
        attachmentFileIds: [...(existing ? stored.attachmentFileIds : []), ...uploaded.fileIds],
        emailFileId: existing ? stored.emailFileId : null,
      });
      if (!attached.ok) return attached;
      if (uploaded.uploadIds.length) await run(`UPDATE project_uploads SET unsorted_doc_id = $2, updated_at = now() WHERE id = ANY($1::text[])`, [uploaded.uploadIds, staged.id]);
      const [{ n }] = await run<{ n: number }>(
        `SELECT (cardinality(attachment_file_ids) + (email_file_id IS NOT NULL)::int)::int AS n FROM unsorted_docs WHERE id = $1`, [staged.id]);
      return { ...staged, files: n, files_added: existing ? attached.added.length : fresh.length + attached.added.length, files_replaced: stored.replaced.length, body_updated: stored.emailReplaced };
    });
    if (!res.ok) {
      await dropFiles(fresh);
      return res;
    }
    return { ...res, skipped_attachments: stored.skipped };
  } catch (e) {
    await dropFiles(fresh);
    throw e;
  }
}

export async function fileDocument(id: number, target: FileTarget, opts: { by: string; logCost?: boolean; kind?: string; amountCents?: number | null; vendorLabel?: string; note?: string }): Promise<FileResult> {
  const r = await atomically((run) => fileDoc(run, id, target, { ...opts, today: todayCentral() }));
  if (r.ok && r.agent_queued) kickFilingAgent();
  return r;
}

export async function sendToAgent(id: number, note: string) {
  const r = await atomically((run) => noteForAgent(run, id, note));
  if (r.ok && r.agent_queued) kickFilingAgent();
  return r;
}

export function replyOnDocument(id: number, message: string, giveBack: boolean) {
  return atomically((run) => replyOnDoc(run, id, message, giveBack));
}

export function undoDocument(id: number) {
  return atomically((run) => undoDoc(run, id));
}

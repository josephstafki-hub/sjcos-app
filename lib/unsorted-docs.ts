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

import { createHash } from "node:crypto";
import { readFile, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { kickFilingAgent } from "@/lib/agent-kick";
import { withTransaction, type Run } from "@/lib/commands/db";
import { query } from "@/lib/db";
import { fetchMessageForFiling, gmailConfigured, type FilingMessage } from "@/lib/gmail";
import { storeBuffer } from "@/lib/upload-store";
import { UPLOAD_DIR } from "@/lib/uploads";
import { todayCentral } from "@/lib/budget-queries";
import {
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

/** Store the email page + attachments as files rows (project_key ''). */
async function storeDocFiles(
  m: { from: string; subject: string; receivedAt: string | null; html: string; text: string },
  attachments: { filename: string; mimeType: string; bytes: Buffer }[],
): Promise<{ emailFileId: string | null; attachmentFileIds: string[]; skipped: string[] }> {
  const skipped: string[] = [];
  const attachmentFileIds: string[] = [];
  for (const a of attachments) {
    if (!ATTACH_MIME.test(a.mimeType) || a.bytes.length > MAX_UPLOAD_BYTES) {
      skipped.push(a.filename);
      continue;
    }
    const r = await storeBuffer(a.bytes, { filename: a.filename, mime: a.mimeType, idPrefix: "mail", projectKey: "", subtitle: `Email attachment · ${m.subject}`.slice(0, 200) });
    if (r.ok) attachmentFileIds.push(r.id);
    else skipped.push(a.filename);
  }
  let emailFileId: string | null = null;
  if (m.html || m.text) {
    const r = await storeBuffer(Buffer.from(emailPage(m), "utf8"), {
      filename: `Email — ${fileStem(m.subject)}.html`,
      mime: "text/html; charset=utf-8",
      idPrefix: "mail",
      projectKey: "",
      subtitle: `From ${m.from}`.slice(0, 200),
    });
    if (r.ok) emailFileId = r.id;
  }
  return { emailFileId, attachmentFileIds, skipped };
}

/** Remove files rows + blobs stored for a stage that then failed. */
async function dropFiles(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { rows } = await query<{ storage_path: string | null }>(`DELETE FROM files WHERE id = ANY($1::text[]) RETURNING storage_path`, [ids]);
  await Promise.all(rows.map((r) => (r.storage_path ? unlink(path.join(UPLOAD_DIR, path.basename(r.storage_path))).catch(() => {}) : null)));
}

export type StageFromEmailResult = StageResult | (Extract<StageResult, { ok: true }> & { files: number; skipped_attachments: string[] });

/** Put an emailed document in the tray (or refresh the agent's read of one already there). */
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
    await query<{ status: string; has_files: boolean }>(
      `SELECT status, (email_file_id IS NOT NULL OR cardinality(attachment_file_ids) > 0) AS has_files FROM unsorted_docs WHERE source_ref = $1`,
      [sourceRef],
    )
  ).rows;

  let msg: FilingMessage | null = null;
  let stored: { emailFileId: string | null; attachmentFileIds: string[]; skipped: string[] } = { emailFileId: null, attachmentFileIds: [], skipped: [] };
  const needFiles = !existing || (!existing.has_files && existing.status !== "filed" && existing.status !== "dismissed");
  if (gmailId && (needFiles || !existing)) {
    if (!gmailConfigured()) return { ok: false, error: "The app's Gmail connection isn't set up, so it can't read that message. Pass body_text and attachments instead." };
    try {
      msg = await fetchMessageForFiling(gmailId);
    } catch (e) {
      return { ok: false, error: `Couldn't read Gmail message ${gmailId} from the company mailbox (${e instanceof Error ? e.message : String(e)}). Check the id, or pass body_text and attachments instead.` };
    }
  }
  if (needFiles) {
    const uploads = (input.attachments ?? []).map((a) => ({ filename: String(a.filename || "attachment"), mimeType: String(a.mime_type || "application/octet-stream"), bytes: Buffer.from(String(a.base64 || ""), "base64") }));
    stored = await storeDocFiles(
      {
        from: msg?.from ?? input.fromLabel ?? "",
        subject: msg?.subject ?? input.subject ?? "",
        receivedAt: msg?.receivedAt ?? input.receivedAt ?? null,
        html: msg?.html ?? "",
        text: msg?.text ?? input.bodyText ?? "",
      },
      [...(msg?.attachments ?? []), ...uploads, ...handed.files],
    );
  }
  const fresh = [...stored.attachmentFileIds, ...(stored.emailFileId ? [stored.emailFileId] : [])];
  try {
    const res = await atomically((run) =>
      stageDoc(run, {
        ...input,
        sourceRef,
        gmailMessageId: gmailId || null,
        gmailThreadId: msg?.threadId || input.gmailThreadId || null,
        fromLabel: input.fromLabel || msg?.from || "",
        subject: input.subject || msg?.subject || "",
        receivedAt: input.receivedAt || msg?.receivedAt || null,
        emailFileId: stored.emailFileId,
        attachmentFileIds: stored.attachmentFileIds,
      }),
    );
    if (!res.ok) {
      await dropFiles(fresh);
      return res;
    }
    return { ...res, files: fresh.length, skipped_attachments: stored.skipped };
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

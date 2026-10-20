import "server-only";

// Receipt scanning — the app side around lib/receipt-scan-core.ts.
//
//   • Phone: /scan (or the mobile app) posts photos to /api/receipts/scan →
//     scanUploads() stores them and puts each receipt in the Unsorted tray
//     marked "reading"; the route then reads them after answering.
//   • Text: a photo texted to the business number (lib/sms.ts) →
//     scanTextedPhotos() reads it first and only keeps it if it IS a receipt,
//     so a client's kitchen photo never lands in the tray.
//
// readReceipt() asks Claude (the logged-in CLI, no tools, images over
// stream-json stdin) for one JSON object, saves it on the doc, and files it to
// the job when the sender picked one or Claude is sure (applyRead). A read
// that fails leaves the doc in the tray with "Read again".

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import sharp from "sharp";
import { kickFilingAgent } from "@/lib/agent-kick";
import { todayCentral } from "@/lib/budget-queries";
import { runDirect, withTransaction } from "@/lib/commands/db";
import { storeBuffer } from "@/lib/upload-store";
import { readUpload } from "@/lib/uploads";
import { applyRead, parseReceiptReply, receiptPrompt, type JobChoice, type ReceiptExtract } from "@/lib/receipt-scan-core";
import { stageDoc } from "@/lib/unsorted-docs-core";

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? `${process.env.HOME}/.local/bin/claude`;
/** Sonnet by default: faded thermal paper and handwriting are worth it. */
const MODEL = process.env.RECEIPT_SCAN_MODEL ?? "sonnet";
const TIMEOUT_MS = 150_000;
const MAX_PICTURES = 8;
const VISION_MIME = /^image\/(jpeg|png|gif|webp)$/;

export interface Picture {
  mime: string;
  bytes: Buffer;
}

/** One `claude -p` turn with pictures attached. Returns the reply text. */
export async function claudeReadPictures(prompt: string, pictures: Picture[], opts?: { model?: string; timeoutMs?: number }): Promise<string> {
  const content = [
    ...pictures.map((p) =>
      p.mime === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.bytes.toString("base64") } }
        : { type: "image", source: { type: "base64", media_type: p.mime, data: p.bytes.toString("base64") } },
    ),
    { type: "text", text: prompt },
  ];
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--model", opts?.model ?? MODEL,
    "--disallowedTools", "Read Glob Grep Write Edit Bash WebFetch WebSearch",
    "--strict-mcp-config",
  ];
  return new Promise((resolve, reject) => {
    // A neutral cwd: no repo CLAUDE.md loaded into a receipt read.
    const child = spawn(CLAUDE_BIN, args, { cwd: os.tmpdir(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), opts?.timeoutMs ?? TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Claude CLI didn't start: ${e.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const line = out.split("\n").reverse().find((l) => l.includes('"type":"result"'));
      if (!line) {
        return reject(new Error(signal === "SIGKILL" ? "Claude timed out." : `Claude CLI exited ${code}: ${(err || out).trim().slice(-300)}`));
      }
      try {
        const env = JSON.parse(line) as { is_error?: boolean; subtype?: string; result?: string };
        if (env.is_error || (env.subtype && env.subtype !== "success")) {
          return reject(new Error(`Claude error: ${(env.result || env.subtype || "unknown").slice(0, 300)}`));
        }
        resolve((env.result ?? "").trim());
      } catch (e) {
        reject(new Error(`Claude reply wasn't readable: ${(e as Error).message}`));
      }
    });
    child.stdin.end(JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n");
  });
}

/** Turn a phone photo the right way up and down to a size Claude reads well.
 *  PDFs pass through. Null = a picture we can't open (e.g. HEIC). */
export async function preparePicture(bytes: Buffer, mime: string): Promise<Picture | null> {
  if (/^application\/pdf/i.test(mime)) return { mime: "application/pdf", bytes };
  if (!/^image\//i.test(mime)) return null;
  try {
    const out = await sharp(bytes, { failOn: "none" })
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { mime: "image/jpeg", bytes: out };
  } catch {
    return VISION_MIME.test(mime) ? { mime, bytes } : null;
  }
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 24);

async function jobs(): Promise<JobChoice[]> {
  return runDirect<JobChoice>(
    `SELECT slug, name, client_name, COALESCE(address, '') AS address FROM projects ORDER BY (status = 'warranty'), updated_at DESC`);
}

// ─── Phone uploads ───────────────────────────────────────────────────────────

export interface ScanUploadInput {
  files: { name: string; mime: string; bytes: Buffer }[];
  /** All the photos are one long receipt. Default: one receipt per photo. */
  oneReceipt?: boolean;
  projectSlug?: string | null;
  note?: string;
  senderName: string;
}

export type ScanUploadResult =
  | { ok: true; receipts: { id: number; existed: boolean }[]; skipped: string[] }
  | { ok: false; error: string };

/** Store the photos and put each receipt in the tray, marked "reading".
 *  The caller reads them (readReceipts) once it has answered the phone. */
export async function scanUploads(input: ScanUploadInput): Promise<ScanUploadResult> {
  const files = input.files.filter((f) => f.bytes.length > 0).slice(0, 20);
  if (!files.length) return { ok: false, error: "No photo came through." };
  let senderProjectId: string | null = null;
  if (input.projectSlug) {
    const [p] = await runDirect<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [input.projectSlug]);
    if (!p) return { ok: false, error: "That job wasn't found." };
    senderProjectId = p.id;
  }
  const groups = input.oneReceipt ? [files.slice(0, MAX_PICTURES)] : files.map((f) => [f]);
  const receipts: { id: number; existed: boolean }[] = [];
  const skipped: string[] = [];
  const from = `Scanned by ${input.senderName || "the team"}`.slice(0, 200);
  for (const group of groups) {
    const sourceRef = `scan:${sha(group[0].bytes)}`;
    const [seen] = await runDirect<{ id: number }>(`SELECT id::int AS id FROM unsorted_docs WHERE source_ref = $1`, [sourceRef]);
    if (seen) {
      receipts.push({ id: seen.id, existed: true });
      continue;
    }
    const ids: string[] = [];
    for (const f of group) {
      const pic = await preparePicture(f.bytes, f.mime);
      if (!pic) {
        skipped.push(f.name);
        continue;
      }
      const ext = pic.mime === "application/pdf" ? "pdf" : "jpg";
      const stem = f.name.replace(/\.[^.]+$/, "").replace(/[^\w.\- ]+/g, " ").trim().slice(0, 60) || "receipt";
      const r = await storeBuffer(pic.bytes, { filename: `${stem}.${ext}`, mime: pic.mime, idPrefix: "scan", projectKey: "", subtitle: from });
      if (r.ok) ids.push(r.id);
      else skipped.push(f.name);
    }
    if (!ids.length) continue;
    const id = await withTransaction(async (run) => {
      const staged = await stageDoc(run, {
        sourceRef,
        kind: "receipt",
        fromLabel: from,
        subject: group.length > 1 ? `Receipt photos (${group.length})` : "Receipt photo",
        receivedAt: new Date().toISOString(),
        attachmentFileIds: ids,
        stagedBy: "scan",
      });
      if (!staged.ok) throw new Error(staged.error);
      await run(
        `UPDATE unsorted_docs SET extract_state = 'reading', extract_started_at = now(), sender_note = $2, sender_project_id = $3,
                why_unsure = 'Claude is reading it…' WHERE id = $1`,
        [staged.id, String(input.note ?? "").trim().slice(0, 600), senderProjectId]);
      return staged.id;
    });
    receipts.push({ id, existed: false });
  }
  if (!receipts.length) return { ok: false, error: `Couldn't open ${skipped.join(", ") || "those photos"}. Try a JPEG or PNG.` };
  return { ok: true, receipts, skipped };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

interface DocForRead {
  id: number;
  source_ref: string;
  status: string;
  from_label: string;
  sender_note: string;
  sender_project_slug: string | null;
  attachment_file_ids: string[];
}

async function threadLinkFor(sourceRef: string): Promise<string> {
  const m = /^sms:(\d+):/.exec(sourceRef);
  if (!m) return "";
  const [t] = await runDirect<{ link_type: string | null; link_slug: string | null; name: string | null }>(
    `SELECT t.link_type, t.link_slug, COALESCE(p.name, l.name) AS name
       FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id
       LEFT JOIN projects p ON t.link_type = 'project' AND p.slug = t.link_slug
       LEFT JOIN leads l ON t.link_type = 'lead' AND l.slug = t.link_slug
      WHERE m.id = $1`, [Number(m[1])]).catch(() => []);
  return t?.link_type && t.link_slug ? `${t.link_type} "${t.name || t.link_slug}" (${t.link_slug})` : "";
}

async function picturesOf(fileIds: string[]): Promise<Picture[]> {
  if (!fileIds.length) return [];
  const rows = await runDirect<{ id: string; storage_path: string | null; mime_type: string | null }>(
    `SELECT id, storage_path, mime_type FROM files WHERE id = ANY($1::text[])`, [fileIds]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Picture[] = [];
  for (const id of fileIds.slice(0, MAX_PICTURES)) {
    const r = byId.get(id);
    if (!r?.storage_path) continue;
    const pic = await preparePicture(await readUpload(r.storage_path), r.mime_type ?? "");
    if (pic) out.push(pic);
  }
  return out;
}

/** Ask Claude about the doc's pictures. Throws with a plain reason. */
async function askClaude(doc: DocForRead, pictures: Picture[]): Promise<ReceiptExtract> {
  if (!pictures.length) throw new Error("No picture to read.");
  const all = await jobs();
  const prompt = receiptPrompt({
    fromLabel: doc.from_label,
    senderProject: doc.sender_project_slug ? all.find((j) => j.slug === doc.sender_project_slug) ?? null : null,
    senderNote: doc.sender_note,
    threadLink: await threadLinkFor(doc.source_ref),
    today: todayCentral(),
    jobs: all,
  });
  const reply = await claudeReadPictures(prompt, pictures);
  const x = parseReceiptReply(reply, new Set(all.map((j) => j.slug)), { model: MODEL, readAt: new Date().toISOString() });
  if (!x) throw new Error("Claude's answer wasn't in the expected shape.");
  return x;
}

async function loadDoc(id: number): Promise<DocForRead | null> {
  const [d] = await runDirect<DocForRead>(
    `SELECT d.id::int AS id, d.source_ref, d.status, d.from_label, d.sender_note, sp.slug AS sender_project_slug, d.attachment_file_ids
       FROM unsorted_docs d LEFT JOIN projects sp ON sp.id = d.sender_project_id WHERE d.id = $1`, [id]);
  return d ?? null;
}

async function save(id: number, x: ReceiptExtract, senderProjectSlug: string | null) {
  const r = await withTransaction((run) => applyRead(run, id, x, { senderProjectSlug, today: todayCentral(), by: "Claude" }));
  if (r.agent_queued) kickFilingAgent();
  return r;
}

/** Read one receipt in the tray and file it if it can go on its own. Never throws. */
export async function readReceipt(id: number): Promise<{ ok: boolean; status?: "filed" | "pending"; project_slug?: string; error?: string }> {
  const doc = await loadDoc(id);
  if (!doc) return { ok: false, error: "No such document." };
  if (doc.status === "filed" || doc.status === "dismissed") return { ok: false, error: "Already put away." };
  await runDirect(`UPDATE unsorted_docs SET extract_state = 'reading', extract_started_at = now(), extract_error = '' WHERE id = $1`, [id]);
  try {
    const x = await askClaude(doc, await picturesOf(doc.attachment_file_ids));
    const r = await save(id, x, doc.sender_project_slug);
    return { ok: true, ...r };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    console.error(`[receipt-scan] doc ${id}: ${msg}`);
    await runDirect(
      `UPDATE unsorted_docs SET extract_state = 'failed', extract_error = $2,
              why_unsure = 'Claude couldn''t read it — tap Read again, or sort it by hand.', updated_at = now() WHERE id = $1`,
      [id, msg]).catch(() => {});
    return { ok: false, error: msg };
  }
}

/** Read several, one at a time (each is its own claude process). */
export async function readReceipts(ids: number[]): Promise<void> {
  for (const id of ids) await readReceipt(id);
}

// ─── Texted photos ───────────────────────────────────────────────────────────

export interface TextedPhoto {
  file_id: string;
  mime: string;
}

/** A text with pictures came in: keep the ones that are receipts. Claude reads
 *  each picture once; a receipt is staged with that read and filed when it
 *  names the job. Never throws — texts must always be recorded. */
export async function scanTextedPhotos(input: { messageId: number; from: string; contactName: string; text: string; media: TextedPhoto[] }): Promise<{ receipts: number[] }> {
  const receipts: number[] = [];
  const from = `Text from ${input.contactName && input.contactName !== input.from ? `${input.contactName} (${input.from})` : input.from}`.slice(0, 200);
  for (const [i, m] of input.media.entries()) {
    if (!/^image\/|^application\/pdf/i.test(m.mime)) continue;
    const sourceRef = `sms:${input.messageId}:${i}`;
    try {
      const [seen] = await runDirect(`SELECT 1 FROM unsorted_docs WHERE source_ref = $1`, [sourceRef]);
      if (seen) continue;
      const pictures = await picturesOf([m.file_id]);
      if (!pictures.length) continue;
      const doc: DocForRead = { id: 0, source_ref: sourceRef, status: "pending", from_label: from, sender_note: input.text, sender_project_slug: null, attachment_file_ids: [] };
      const x = await askClaude(doc, pictures);
      if (!x.is_receipt || x.kind === "other") continue;
      // Its own copy, so filing it never moves the picture out of the text thread.
      const stored = await storeBuffer(pictures[0].bytes, {
        filename: `texted-receipt-${input.messageId}-${i + 1}.${pictures[0].mime === "application/pdf" ? "pdf" : "jpg"}`,
        mime: pictures[0].mime,
        idPrefix: "scan",
        projectKey: "",
        subtitle: from,
      });
      if (!stored.ok) throw new Error(stored.error);
      const id = await withTransaction(async (run) => {
        const staged = await stageDoc(run, {
          sourceRef,
          kind: x.kind,
          fromLabel: from,
          subject: input.text.trim() ? `Texted: “${input.text.trim().slice(0, 120)}”` : "Texted receipt photo",
          receivedAt: new Date().toISOString(),
          attachmentFileIds: [stored.id],
          stagedBy: "text",
        });
        if (!staged.ok) throw new Error(staged.error);
        await run(`UPDATE unsorted_docs SET sender_note = $2, extract_started_at = now() WHERE id = $1`, [staged.id, input.text.trim().slice(0, 600)]);
        return staged.id;
      });
      await save(id, x, null);
      receipts.push(id);
    } catch (e) {
      console.error(`[receipt-scan] texted photo ${sourceRef}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { receipts };
}

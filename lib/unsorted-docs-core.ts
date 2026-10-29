// Unsorted documents — the DB side, with NO db import (same shape as
// lib/budget-writes.ts): every function takes a `run(sql, params)` and the
// CALLER owns the transaction. The app (lib/unsorted-docs.ts, server-only:
// Gmail + blob storage) and the tests both drive this module.
//
// What lives here: an invoice / receipt / rebate an agent pulled from email,
// its files (the email body + attachments, `files` rows with project_key ''
// until filed), the agent's guesses, and where it finally went. Filing to a
// project moves the files onto the project and — for an invoice or receipt
// with an amount — logs the cost through the same writers Money › Overview
// uses, keyed on the doc's source_ref so it can never count twice. Undo puts
// everything back, removing a cost row only if filing created it.
//
// Sorting starts a small agent run at once (agent trigger kind 'filing', run on
// a cheap model — scripts/run-business-agent.mjs): a typed note is carried out,
// a cost Joe filed is placed under the right trade / PO. The agent answers on
// the doc (agent_note); a question hands the doc back to Joe.

import type { Run } from "./budget-queries.ts";
import { recordSubInvoice, saveExpense } from "./budget-writes.ts";
import { enqueueAgentTrigger } from "./agent-runtime/triggers.ts";
import type { ReceiptExtract } from "./receipt-scan-core.ts";

export const DOC_KINDS = ["invoice", "receipt", "rebate", "statement", "other"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export type DocStatus = "pending" | "needs_agent" | "filed" | "dismissed";

export interface Suggestion {
  project_slug: string;
  reason: string;
}

export interface UnsortedDocRow {
  id: number;
  source_ref: string;
  doc_kind: DocKind;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  from_label: string;
  subject: string;
  received_at: string | null;
  vendor_label: string;
  amount_cents: number | null;
  doc_date: string | null;
  doc_number: string;
  summary: string;
  why_unsure: string;
  suggestions: Suggestion[];
  overhead_likely: boolean;
  email_file_id: string | null;
  attachment_file_ids: string[];
  status: DocStatus;
  owner_note: string;
  /** The agent's answer: where it put the cost, or a question for Joe. */
  agent_note: string;
  agent_note_at: string | null;
  filed_to: "project" | "overhead" | null;
  filed_project_slug: string | null;
  filed_project_name: string | null;
  cost_source: "expense" | "sub_invoice" | null;
  cost_id: number | null;
  cost_created: boolean;
  staged_by: string;
  resolved_by: string;
  resolved_at: string | null;
  created_at: string;
  /** Claude's read of a scanned / texted receipt (lib/receipt-scan-core.ts). */
  extracted: ReceiptExtract | null;
  extract_state: "reading" | "done" | "failed" | null;
  extract_error: string;
  extract_started_at: string | null;
  /** What the sender said: the job picked on /scan, a note, the text with the photo. */
  sender_note: string;
  sender_project_slug: string | null;
}

type Fail = { ok: false; error: string };
export type Result<T = object> = ({ ok: true } & T) | Fail;
const fail = (error: string): Fail => ({ ok: false, error });
const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const MAX_CENTS = 2_000_000_000;

/** Files tag for a filed document, by kind. Unfiled ones read UNSORTED. */
export const FILED_TAG: Record<DocKind, string> = {
  invoice: "INVOICE · Email",
  receipt: "RECEIPT · Email",
  rebate: "REBATE · Email",
  statement: "STATEMENT · Email",
  other: "DOC · Email",
};
export const UNSORTED_TAG = "UNSORTED · Email";
export const NOT_FILED_TAG = "NOT FILED · Email";
export const overheadTag = (year: number) => `OVERHEAD · ${year}`;

const COLS = `d.id::int AS id, d.source_ref, d.doc_kind, d.gmail_message_id, d.gmail_thread_id, d.from_label, d.subject,
  d.received_at::text AS received_at, d.vendor_label, d.amount_cents, d.doc_date::text AS doc_date, d.doc_number,
  d.summary, d.why_unsure, d.suggestions, d.overhead_likely, d.email_file_id, d.attachment_file_ids, d.status,
  d.owner_note, d.agent_note, d.agent_note_at::text AS agent_note_at, d.filed_to, p.slug AS filed_project_slug, p.name AS filed_project_name, d.cost_source,
  d.cost_id::int AS cost_id, d.cost_created, d.staged_by, d.resolved_by, d.resolved_at::text AS resolved_at,
  d.created_at::text AS created_at, d.extracted, d.extract_state, d.extract_error,
  d.extract_started_at::text AS extract_started_at, d.sender_note, sp.slug AS sender_project_slug`;
const FROM = `FROM unsorted_docs d LEFT JOIN projects p ON p.id = d.filed_project_id LEFT JOIN projects sp ON sp.id = d.sender_project_id`;

export async function getDoc(run: Run, id: number): Promise<UnsortedDocRow | null> {
  const [row] = await run<UnsortedDocRow>(`SELECT ${COLS} ${FROM} WHERE d.id = $1`, [id]);
  return row ?? null;
}

/** Open docs (pending + needs_agent), oldest email first so the backlog drains in order. */
export async function listOpenDocs(run: Run, limit = 200): Promise<UnsortedDocRow[]> {
  return run<UnsortedDocRow>(
    `SELECT ${COLS} ${FROM} WHERE d.status IN ('pending','needs_agent')
      ORDER BY (d.status = 'needs_agent'), COALESCE(d.received_at, d.created_at) ASC LIMIT $1`, [limit]);
}

/** Filed / dismissed docs, newest first — the audit trail with Undo. */
export async function listResolvedDocs(run: Run, limit = 50): Promise<UnsortedDocRow[]> {
  return run<UnsortedDocRow>(
    `SELECT ${COLS} ${FROM} WHERE d.status IN ('filed','dismissed') ORDER BY d.resolved_at DESC NULLS LAST LIMIT $1`, [limit]);
}

export async function listDocsByStatus(run: Run, statuses: DocStatus[], limit = 100): Promise<UnsortedDocRow[]> {
  return run<UnsortedDocRow>(
    `SELECT ${COLS} ${FROM} WHERE d.status = ANY($1::text[])
      ORDER BY COALESCE(d.resolved_at, d.received_at, d.created_at) DESC LIMIT $2`, [statuses, limit]);
}

/** Waiting on Joe — the sidebar badge. needs_agent rows are the agent's turn. */
export async function countPending(run: Run): Promise<number> {
  const [r] = await run<{ n: string }>(`SELECT count(*) AS n FROM unsorted_docs WHERE status = 'pending'`);
  return Number(r?.n ?? 0);
}

export interface ProjectChoice {
  slug: string;
  name: string;
  client_name: string;
  address: string;
  status: string;
}

/** Every project, live ones first — what the search box matches against. */
export async function projectChoices(run: Run): Promise<ProjectChoice[]> {
  return run<ProjectChoice>(
    `SELECT slug, name, client_name, COALESCE(address, '') AS address, status FROM projects
      ORDER BY (status = 'warranty'), updated_at DESC`);
}

// ─── Stage ───────────────────────────────────────────────────────────────────

export interface StageInput {
  sourceRef: string;
  kind: string;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  fromLabel?: string;
  subject?: string;
  receivedAt?: string | null;
  vendorLabel?: string;
  amountCents?: number | null;
  docDate?: string | null;
  docNumber?: string;
  summary?: string;
  whyUnsure?: string;
  suggestions?: Suggestion[];
  overheadLikely?: boolean;
  /** Files already stored for this doc. Only used when the row is new or has none yet. */
  emailFileId?: string | null;
  attachmentFileIds?: string[];
  stagedBy?: string;
}

export type StageResult = Result<{
  id: number;
  status: DocStatus;
  /** True when the row already existed (re-staging the same email). */
  existed: boolean;
  /** Guesses dropped because no project has that slug. */
  unknown_slugs: string[];
}>;

/** Add a doc to the tray, or refresh the agent's read of one already there.
 *  Idempotent on source_ref. A doc already filed or dismissed is left alone —
 *  Joe's decision is never re-opened by an agent re-reading the inbox. */
export async function stageDoc(run: Run, input: StageInput): Promise<StageResult> {
  const sourceRef = clip(input.sourceRef, 200);
  if (!sourceRef) return fail("source_ref is required (e.g. 'gmail:<message id>').");
  if (!(DOC_KINDS as readonly string[]).includes(input.kind)) return fail(`kind must be one of ${DOC_KINDS.join(", ")}.`);
  if (input.amountCents != null && (!Number.isInteger(input.amountCents) || Math.abs(input.amountCents) > MAX_CENTS)) return fail("amount_cents must be whole cents.");
  if (input.docDate != null && input.docDate !== "" && !isDay(input.docDate)) return fail("doc_date must be YYYY-MM-DD.");

  const wanted = (input.suggestions ?? []).slice(0, 5).map((s) => ({ project_slug: clip(s.project_slug, 120), reason: clip(s.reason, 240) })).filter((s) => s.project_slug);
  const known = wanted.length
    ? new Set((await run<{ slug: string }>(`SELECT slug FROM projects WHERE slug = ANY($1::text[])`, [wanted.map((s) => s.project_slug)])).map((r) => r.slug))
    : new Set<string>();
  const suggestions = wanted.filter((s, i) => known.has(s.project_slug) && wanted.findIndex((o) => o.project_slug === s.project_slug) === i);
  const unknown_slugs = wanted.filter((s) => !known.has(s.project_slug)).map((s) => s.project_slug);

  const [seen] = await run<{ id: number; status: DocStatus }>(`SELECT id::int AS id, status FROM unsorted_docs WHERE source_ref = $1 FOR UPDATE`, [sourceRef]);
  if (seen && (seen.status === "filed" || seen.status === "dismissed")) {
    return { ok: true, id: seen.id, status: seen.status, existed: true, unknown_slugs };
  }
  const fields = [
    input.kind, clip(input.gmailMessageId, 120) || null, clip(input.gmailThreadId, 120) || null,
    clip(input.fromLabel, 200), clip(input.subject, 300), input.receivedAt || null,
    clip(input.vendorLabel, 120), input.amountCents ?? null, input.docDate || null, clip(input.docNumber, 80),
    clip(input.summary, 600), clip(input.whyUnsure, 400), JSON.stringify(suggestions), Boolean(input.overheadLikely),
    input.emailFileId ?? null, input.attachmentFileIds ?? [], clip(input.stagedBy, 80),
  ];
  // Fresh files (the caller only stores them for a row without any) read UNSORTED in Files.
  await run(`UPDATE files SET tag = $2 WHERE id = ANY($1::text[])`, [docFileIds({ email_file_id: input.emailFileId ?? null, attachment_file_ids: input.attachmentFileIds ?? [] }), UNSORTED_TAG]);
  if (seen) {
    // Refresh the agent's read; keep Joe's note/status and any files already stored.
    await run(
      `UPDATE unsorted_docs SET doc_kind = $2, gmail_message_id = COALESCE($3, gmail_message_id), gmail_thread_id = COALESCE($4, gmail_thread_id),
              from_label = $5, subject = $6, received_at = COALESCE($7::timestamptz, received_at), vendor_label = $8,
              amount_cents = $9, doc_date = $10::date, doc_number = $11, summary = $12, why_unsure = $13,
              suggestions = $14::jsonb, overhead_likely = $15,
              email_file_id = COALESCE(email_file_id, $16),
              attachment_file_ids = CASE WHEN cardinality(attachment_file_ids) = 0 THEN $17::text[] ELSE attachment_file_ids END,
              updated_at = now()
        WHERE id = $1`,
      [seen.id, ...fields.slice(0, 16)]);
    return { ok: true, id: seen.id, status: seen.status, existed: true, unknown_slugs };
  }
  const [row] = await run<{ id: number }>(
    `INSERT INTO unsorted_docs (source_ref, doc_kind, gmail_message_id, gmail_thread_id, from_label, subject, received_at,
                                vendor_label, amount_cents, doc_date, doc_number, summary, why_unsure, suggestions,
                                overhead_likely, email_file_id, attachment_file_ids, staged_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10::date, $11, $12, $13, $14::jsonb, $15, $16, $17::text[], $18)
     RETURNING id::int AS id`,
    [sourceRef, ...fields]);
  return { ok: true, id: row.id, status: "pending", existed: false, unknown_slugs };
}

const docFileIds = (d: { email_file_id: string | null; attachment_file_ids: string[] }) =>
  [...(d.attachment_file_ids ?? []), ...(d.email_file_id ? [d.email_file_id] : [])];

// ─── File ────────────────────────────────────────────────────────────────────

export type FileTarget =
  | { to: "project"; projectSlug: string }
  | { to: "overhead" }
  | { to: "dismiss" };

export interface FileOptions {
  /** Log the cost on the project. Default: yes for an invoice or receipt with an amount. */
  logCost?: boolean;
  /** Corrections made while filing. */
  kind?: string;
  amountCents?: number | null;
  vendorLabel?: string;
  /** Who did it: 'owner' or the agent's key. */
  by: string;
  /** Joe's free-text note, kept with the record. */
  note?: string;
  /** Today in Central (YYYY-MM-DD), the fallback date for a cost with none. */
  today: string;
  /** Wake the filing agent to put a logged cost under the right trade / PO.
   *  Default: only when Joe filed it (an agent filing places its own cost). */
  placeCost?: boolean;
}

export type FileResult = Result<{
  id: number;
  status: DocStatus;
  project_slug?: string;
  cost?: { source: "expense" | "sub_invoice"; id: number; created: boolean } | null;
  /** A filing agent run was queued (the caller starts it). */
  agent_queued?: boolean;
}>;

/** Wake the filing agent for one doc. Idempotent per doc: a newer request
 *  re-opens / updates the same trigger instead of stacking runs. */
async function queueFilingAgent(run: Run, id: number, projectId: string | null, payload: Record<string, unknown>): Promise<void> {
  await enqueueAgentTrigger(run, { kind: "filing", ref: `unsorted:${id}`, projectId, payload: { doc_id: id, ...payload }, enqueuedBy: "unsorted:owner", maxAttempts: 2 });
}

/** Put a doc where it belongs. Refuses a doc already filed — Undo it first. */
export async function fileDoc(run: Run, id: number, target: FileTarget, opts: FileOptions): Promise<FileResult> {
  const [doc] = await run<UnsortedDocRow & { received_day: string | null }>(
    `SELECT id::int AS id, source_ref, doc_kind, vendor_label, from_label, subject, amount_cents, doc_date::text AS doc_date,
            doc_number, summary, email_file_id, attachment_file_ids, status,
            (received_at AT TIME ZONE 'America/Chicago')::date::text AS received_day
       FROM unsorted_docs WHERE id = $1 FOR UPDATE`, [id]);
  if (!doc) return fail("No such document.");
  if (doc.status === "filed" || doc.status === "dismissed") return fail("Already put away. Undo it first to file it somewhere else.");

  const kind = (opts.kind ?? doc.doc_kind) as DocKind;
  if (!(DOC_KINDS as readonly string[]).includes(kind)) return fail("Unknown kind of document.");
  const amount = opts.amountCents !== undefined ? opts.amountCents : doc.amount_cents;
  if (amount != null && (!Number.isInteger(amount) || Math.abs(amount) > MAX_CENTS)) return fail("Amount must be whole cents.");
  const vendor = clip(opts.vendorLabel ?? doc.vendor_label, 120) || vendorFromSender(doc.from_label);
  const files = docFileIds(doc);
  const by = clip(opts.by, 80) || "owner";
  // Joe's words are owner_note; an agent's are agent_note.
  const note = by === "owner" ? clip(opts.note, 600) : "";
  const agentNote = by === "owner" ? "" : clip(opts.note, 600);

  if (target.to === "dismiss" || target.to === "overhead") {
    const tag = target.to === "overhead" ? overheadTag(Number((doc.doc_date ?? doc.received_day ?? opts.today).slice(0, 4))) : NOT_FILED_TAG;
    await run(`UPDATE files SET tag = $2, project_key = '' WHERE id = ANY($1::text[])`, [files, tag]);
    const status: DocStatus = target.to === "overhead" ? "filed" : "dismissed";
    await run(
      `UPDATE unsorted_docs SET status = $2, filed_to = $3, filed_project_id = NULL, doc_kind = $4, amount_cents = $5, vendor_label = $6,
              owner_note = CASE WHEN $7 = '' THEN owner_note ELSE $7 END,
              agent_note = $9, agent_note_at = CASE WHEN $9 = '' THEN NULL ELSE now() END,
              cost_source = NULL, cost_id = NULL, cost_created = false, resolved_by = $8, resolved_at = now(), updated_at = now()
        WHERE id = $1`,
      [id, status, target.to === "overhead" ? "overhead" : null, kind, amount, vendor, note, by, agentNote]);
    return { ok: true, id, status, cost: null };
  }

  const [project] = await run<{ id: string; slug: string }>(`SELECT id, slug FROM projects WHERE slug = $1`, [clip(target.projectSlug, 120)]);
  if (!project) return fail(`No project with slug "${target.projectSlug}".`);

  await run(`UPDATE files SET project_key = $2, tag = $3 WHERE id = ANY($1::text[])`, [files, project.slug, FILED_TAG[kind]]);

  const logCost = opts.logCost ?? ((kind === "invoice" || kind === "receipt") && amount != null && amount !== 0);
  let cost: { source: "expense" | "sub_invoice"; id: number; created: boolean } | null = null;
  if (logCost) {
    if (kind !== "invoice" && kind !== "receipt") return fail("Only an invoice or a receipt is logged as a cost. File it without the cost.");
    if (amount == null || amount === 0) return fail("Enter the amount to log the cost, or file it without the cost.");
    const date = doc.doc_date ?? doc.received_day ?? opts.today;
    const memo = [doc.doc_number && `#${doc.doc_number}`, doc.summary || doc.subject].filter(Boolean).join(" · ");
    // A credit memo (negative invoice) is money back on materials: log it as a
    // negative expense, since a bill can't be owed below zero.
    if (kind === "invoice" && amount > 0) {
      const r = await recordSubInvoice(run, project.id, { vendorLabel: vendor, amountCents: amount, date, note: memo, sourceRef: doc.source_ref });
      if (!r.ok) return r;
      cost = { source: "sub_invoice", id: r.id, created: !r.updated };
    } else {
      const [had] = await run(`SELECT 1 FROM expenses WHERE project_id = $1 AND source_ref = $2`, [project.id, doc.source_ref]);
      const r = await saveExpense(run, project.id, { date, vendorLabel: vendor, kind: "material", amountCents: amount, memo, paidFrom: "card", sourceRef: doc.source_ref });
      if (!r.ok) return r;
      await run(`UPDATE expenses SET receipt_file_id = $2 WHERE id = $1`, [r.id, doc.attachment_file_ids[0] ?? doc.email_file_id]);
      cost = { source: "expense", id: r.id, created: !had };
    }
  }

  await run(
    `UPDATE unsorted_docs SET status = 'filed', filed_to = 'project', filed_project_id = $2, doc_kind = $3, amount_cents = $4, vendor_label = $5,
            owner_note = CASE WHEN $6 = '' THEN owner_note ELSE $6 END,
            agent_note = $11, agent_note_at = CASE WHEN $11 = '' THEN NULL ELSE now() END,
            cost_source = $7, cost_id = $8, cost_created = $9, resolved_by = $10, resolved_at = now(), updated_at = now()
      WHERE id = $1`,
    [id, project.id, kind, amount, vendor, note, cost?.source ?? null, cost?.id ?? null, cost?.created ?? false, by, agentNote]);
  // Joe filed a cost: the agent puts it under the right trade / PO right away.
  const agentQueued = (opts.placeCost ?? by === "owner") && cost !== null;
  if (cost && agentQueued) {
    await queueFilingAgent(run, id, project.id, { mode: "place_cost", project_slug: project.slug, cost_source: cost.source, cost_id: cost.id, owner_note: "" });
  }
  return { ok: true, id, status: "filed", project_slug: project.slug, cost, agent_queued: agentQueued };
}

/** Joe typed something that isn't a project: hand it to the agent with his
 *  note, and wake the filing agent to carry it out now. */
export async function noteForAgent(run: Run, id: number, note: string): Promise<Result<{ id: number; agent_queued: boolean }>> {
  const text = clip(note, 600);
  if (!text) return fail("Type where it goes.");
  const rows = await run(
    `UPDATE unsorted_docs SET status = 'needs_agent', owner_note = $2, agent_note = '', agent_note_at = NULL, updated_at = now()
      WHERE id = $1 AND status IN ('pending','needs_agent') RETURNING id`, [id, text]);
  if (!rows.length) return fail("That document was already put away.");
  await queueFilingAgent(run, id, null, { mode: "owner_note", owner_note: text, project_slug: null, cost_source: null, cost_id: null });
  return { ok: true, id, agent_queued: true };
}

/** The agent answers on a doc: where it put the cost, or a question. With
 *  giveBack a doc waiting on the agent goes back to Joe's tray. */
export async function replyOnDoc(run: Run, id: number, message: string, giveBack: boolean): Promise<Result<{ id: number; status: DocStatus }>> {
  const text = clip(message, 600);
  if (!text) return fail("message is required.");
  const [row] = await run<{ status: DocStatus }>(
    `UPDATE unsorted_docs SET agent_note = $2, agent_note_at = now(),
            status = CASE WHEN $3 AND status = 'needs_agent' THEN 'pending' ELSE status END, updated_at = now()
      WHERE id = $1 RETURNING status`, [id, text, giveBack]);
  return row ? { ok: true, id, status: row.status } : fail("No such document.");
}

/** Take a doc back out: files back to unsorted, a cost row filing created is
 *  removed (refused if it has been paid on since), status back to pending. */
export async function undoDoc(run: Run, id: number): Promise<Result<{ id: number }>> {
  const [doc] = await run<{ status: DocStatus; filed_project_id: string | null; cost_source: string | null; cost_id: number | null; cost_created: boolean; email_file_id: string | null; attachment_file_ids: string[] }>(
    `SELECT status, filed_project_id, cost_source, cost_id::int AS cost_id, cost_created, email_file_id, attachment_file_ids
       FROM unsorted_docs WHERE id = $1 FOR UPDATE`, [id]);
  if (!doc) return fail("No such document.");
  if (doc.status !== "filed" && doc.status !== "dismissed") return fail("It isn't filed.");
  if (doc.cost_created && doc.cost_id != null && doc.filed_project_id) {
    if (doc.cost_source === "sub_invoice") {
      const gone = await run(
        `DELETE FROM sub_invoices WHERE id = $1 AND project_id = $2 AND paid_cents = 0 AND status <> 'paid' RETURNING id`,
        [doc.cost_id, doc.filed_project_id]);
      if (!gone.length) {
        const [still] = await run(`SELECT 1 FROM sub_invoices WHERE id = $1`, [doc.cost_id]);
        if (still) return fail("The invoice it logged has been paid on since, so Undo would lose that payment. Fix it on the project's Money tab instead.");
      }
    } else if (doc.cost_source === "expense") {
      await run(`DELETE FROM expenses WHERE id = $1 AND project_id = $2`, [doc.cost_id, doc.filed_project_id]);
    }
  }
  await run(`UPDATE files SET project_key = '', tag = $2 WHERE id = ANY($1::text[])`, [docFileIds(doc), UNSORTED_TAG]);
  // A follow-up run not started yet has nothing left to do.
  await run(`UPDATE agent_triggers SET state = 'done', done_at = now(), last_error = 'document un-filed' WHERE kind = 'filing' AND ref = $1 AND state = 'pending'`, [`unsorted:${id}`]);
  await run(
    `UPDATE unsorted_docs SET status = 'pending', filed_to = NULL, filed_project_id = NULL, cost_source = NULL, cost_id = NULL,
            cost_created = false, resolved_by = '', resolved_at = NULL, agent_note = '', agent_note_at = NULL, updated_at = now()
      WHERE id = $1`, [id]);
  return { ok: true, id };
}

/** "Acme Supply <billing@acme.com>" → "Acme Supply"; a bare address → its domain's first label. */
export function vendorFromSender(from: string): string {
  const s = String(from ?? "").trim();
  const name = s.replace(/<[^>]*>/, "").trim().replace(/^"|"$/g, "").trim();
  if (name && !name.includes("@")) return name.slice(0, 120);
  const email = (s.match(/[\w.+-]+@([\w-]+)\./)?.[1] ?? "").replace(/^(mail|billing|noreply|no-reply|info)$/i, "");
  return email ? email.charAt(0).toUpperCase() + email.slice(1) : "Unknown vendor";
}

// Receipt scanning — the pure side, with NO db import (same shape as
// lib/unsorted-docs-core.ts): every write takes a `run(sql, params)` and the
// CALLER owns the transaction. The app (lib/receipt-scan.ts: the Claude call,
// image prep, the phone upload and texted photos) and the tests drive it.
//
// A receipt photographed on a phone or texted in is an unsorted_docs row like
// an emailed one. Claude reads the picture and answers with one JSON object:
// the store, where, when, every line (qty · description · amount), the totals,
// anything written on it that names a job, and which job it thinks it is for.
// That read is kept whole on the row (`extracted`) so /unsorted can show the
// key points first.
//
// Where it goes: filed to the job at once when the sender picked the job, or
// when Claude is SURE — the receipt, the sender's note or the text names it.
// A store, a date or the kind of material is never enough. Anything else, an
// unreadable total, or a likely duplicate waits on /unsorted with Claude's
// guesses. Filing goes through fileDoc, so Undo on /unsorted takes it back.

import type { Run } from "./budget-queries.ts";
import { fileDoc, stageDoc, type DocKind, type Suggestion } from "./unsorted-docs-core.ts";

export interface ReceiptItem {
  qty: number | null;
  description: string;
  sku: string;
  amount_cents: number | null;
}

export type MatchConfidence = "sure" | "likely" | "none";

export interface ReceiptExtract {
  /** False when the picture isn't a receipt / invoice / bill at all. */
  is_receipt: boolean;
  kind: "receipt" | "invoice" | "other";
  vendor: string;
  /** Store number / street / city as printed. */
  location: string;
  date: string | null;
  time: string;
  number: string;
  payment: string;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  /** Anything on it naming a job: job name, PO, customer, address, handwriting. */
  job_hint: string;
  items: ReceiptItem[];
  summary: string;
  notes: string;
  match: { project_slug: string | null; confidence: MatchConfidence; reason: string };
  guesses: Suggestion[];
  overhead_likely: boolean;
  model: string;
  read_at: string;
}

export interface JobChoice {
  slug: string;
  name: string;
  client_name: string;
  address: string;
}

export interface ReadContext {
  /** "Scanned by Joe" / "Text from Mike (612…)". */
  fromLabel: string;
  /** Job the sender picked on /scan. */
  senderProject: JobChoice | null;
  /** The sender's note, or the text that came with the photo. */
  senderNote: string;
  /** The text thread's link, when the photo was texted in. */
  threadLink: string;
  today: string;
  jobs: JobChoice[];
}

const clip = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** What Claude is asked. One JSON object back, dollars as numbers. */
export function receiptPrompt(ctx: ReadContext): string {
  const jobs = ctx.jobs.map((j) => `${j.slug} | ${j.name} | ${j.client_name} | ${j.address}`).join("\n");
  const hints = [
    `Sent by: ${ctx.fromLabel || "unknown"}.`,
    ctx.senderProject && `The sender picked the job: ${ctx.senderProject.name} (${ctx.senderProject.slug}).`,
    ctx.senderNote && `The sender wrote: "${clip(ctx.senderNote, 600)}"`,
    ctx.threadLink && `The text thread it came on is linked to ${ctx.threadLink} — a hint only; people text receipts for several jobs on one thread.`,
  ].filter(Boolean).join("\n");
  return (
    `You are reading a purchase receipt for SJ Carpentry LLC, a remodeling contractor in Minnesota. ` +
    `The picture was taken on a phone or texted in; it may be small, faded, crumpled or at an angle. ` +
    `Today is ${ctx.today}.\n\n${hints}\n\n` +
    `Open jobs (slug | name | client | address):\n${jobs || "(none)"}\n\n` +
    `Reply with ONE JSON object and nothing else:\n` +
    `{"is_receipt": true or false (false when it is not a receipt, invoice or bill — a jobsite photo, a drawing, a screenshot),\n` +
    ` "kind": "receipt" | "invoice" | "other",\n` +
    ` "vendor": "store or company as printed, e.g. Menards",\n` +
    ` "location": "store number, street and city as printed, or \\"\\"",\n` +
    ` "date": "YYYY-MM-DD" or null, "time": "e.g. 2:41 PM" or "",\n` +
    ` "number": "receipt / transaction / invoice number" or "",\n` +
    ` "payment": "how it was paid as printed, e.g. VISA ****4412" or "",\n` +
    ` "subtotal": dollars or null, "tax": dollars or null, "total": dollars or null,\n` +
    ` "job_hint": "words printed or written ON THE RECEIPT that name a job — job name, PO, customer name, address, handwriting — exactly as written, e.g. Egan deck. Not the sender's note" or "",\n` +
    ` "items": [{"qty": number or null, "description": "the item as printed, abbreviations spelled out when obvious (2X4X8 STUD KD → 2x4x8 stud, kiln dried)", "sku": "" , "amount": line total in dollars or null}],\n` +
    ` "summary": "one short line on what was bought, e.g. Framing lumber and deck screws",\n` +
    ` "notes": "anything unusual: a return, partly unreadable, two receipts in one picture" or "",\n` +
    ` "project_slug": slug of the job it is for, or null,\n` +
    ` "confidence": "sure" | "likely" | "none",\n` +
    ` "reason": "what points to that job — quote it",\n` +
    ` "guesses": [{"project_slug": "…", "reason": "…"}] (up to 3 other possible jobs),\n` +
    ` "overhead_likely": true when it looks like company overhead, not a job cost (fuel, office supplies, phone, tools the company keeps)}\n\n` +
    `Rules:\n` +
    `- "sure" ONLY when the receipt, the sender's note or the text names one job above: its name, the client's name, its address, or a PO / job name that matches exactly one job — or the sender picked the job. ` +
    `A store, a date, a city or the kind of material alone is never sure; use "likely" or "none".\n` +
    `- Copy every amount exactly as printed. Never guess a number you can't read — use null.\n` +
    `- A return or refund has a negative total.\n` +
    `- Use only slugs from the list above.`
  );
}

/** Pull the first balanced JSON object out of a possibly-chatty reply. */
export function firstJsonObject(reply: string): Record<string, unknown> | null {
  const text = String(reply ?? "").replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        const v = JSON.parse(text.slice(start, i + 1));
        return v && typeof v === "object" && !Array.isArray(v) ? v : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

const MAX_CENTS = 2_000_000_000;

/** 46.3 / "$1,046.30" / "(12.00)" → cents. Anything unreadable → null. */
export function toCents(v: unknown): number | null {
  if (v == null || v === "") return null;
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()$,\s-]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  if (!Number.isFinite(cents) || cents > MAX_CENTS) return null;
  return neg ? -cents : cents;
}

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Claude's reply → a checked ReceiptExtract. Slugs not in `knownSlugs` are dropped. */
export function parseReceiptReply(reply: string, knownSlugs: Set<string>, meta: { model: string; readAt: string }): ReceiptExtract | null {
  const o = firstJsonObject(reply);
  if (!o) return null;
  const kind = o.kind === "invoice" || o.kind === "other" ? o.kind : "receipt";
  const items: ReceiptItem[] = (Array.isArray(o.items) ? o.items : [])
    .slice(0, 80)
    .map((it) => {
      const r = (it ?? {}) as Record<string, unknown>;
      const qty = r.qty == null || r.qty === "" ? null : Number(r.qty);
      return {
        qty: qty != null && Number.isFinite(qty) ? qty : null,
        description: clip(r.description, 200),
        sku: clip(r.sku, 40),
        amount_cents: toCents(r.amount),
      };
    })
    .filter((it) => it.description || it.amount_cents != null);
  let slug = typeof o.project_slug === "string" && knownSlugs.has(o.project_slug) ? o.project_slug : null;
  let confidence: MatchConfidence = o.confidence === "sure" || o.confidence === "likely" ? o.confidence : "none";
  if (!slug) confidence = "none";
  if (confidence === "none") slug = null;
  const guesses = (Array.isArray(o.guesses) ? o.guesses : [])
    .map((g) => ({ project_slug: clip((g as Record<string, unknown>)?.project_slug, 120), reason: clip((g as Record<string, unknown>)?.reason, 240) }))
    .filter((g, i, all) => knownSlugs.has(g.project_slug) && g.project_slug !== slug && all.findIndex((x) => x.project_slug === g.project_slug) === i)
    .slice(0, 3);
  return {
    is_receipt: o.is_receipt !== false,
    kind,
    vendor: clip(o.vendor, 120),
    location: clip(o.location, 200),
    date: isDay(o.date) ? o.date : null,
    time: clip(o.time, 20),
    number: clip(o.number, 80),
    payment: clip(o.payment, 80),
    subtotal_cents: toCents(o.subtotal),
    tax_cents: toCents(o.tax),
    total_cents: toCents(o.total),
    job_hint: clip(o.job_hint, 200),
    items,
    summary: clip(o.summary, 300),
    notes: clip(o.notes, 400),
    match: { project_slug: slug, confidence, reason: clip(o.reason, 300) },
    guesses,
    overhead_likely: o.overhead_likely === true,
    model: meta.model,
    read_at: meta.readAt,
  };
}

/** Where a read receipt goes on its own, or null = Joe sorts it. */
export function autoFileTarget(
  x: ReceiptExtract,
  senderProjectSlug: string | null,
  duplicateOf: number | null,
): { projectSlug: string; why: string } | null {
  if (!x.is_receipt || x.kind === "other" || x.total_cents == null || x.total_cents === 0 || duplicateOf != null) return null;
  if (senderProjectSlug) return { projectSlug: senderProjectSlug, why: "the sender picked the job" };
  if (x.match.confidence === "sure" && x.match.project_slug) return { projectSlug: x.match.project_slug, why: x.match.reason || "it names the job" };
  return null;
}

/** Why it's waiting on Joe — one line for the tray. */
export function whyUnsure(x: ReceiptExtract, duplicateOf: number | null): string {
  if (!x.is_receipt) return "This doesn't look like a receipt.";
  if (duplicateOf === 0) return "An expense with the same total and date is already logged on a job — check it isn't the same receipt.";
  if (duplicateOf != null) return `Looks like the same receipt as #${duplicateOf} (same total and date) — check before filing.`;
  if (x.total_cents == null) return "Couldn't read the total.";
  if (x.match.confidence === "likely") return `Probably ${x.match.project_slug}, but nothing on it names the job${x.match.reason ? ` (${x.match.reason})` : ""}.`;
  return x.job_hint ? `"${x.job_hint}" is written on it but doesn't match one job.` : "Nothing on it names a job.";
}

/** Another receipt with the same total on the same day — an unsorted doc, or
 *  an expense already on a job. Returns its unsorted id (or 0 for an expense). */
export async function findDuplicate(run: Run, id: number, x: ReceiptExtract): Promise<number | null> {
  if (x.total_cents == null || !x.date) return null;
  const [doc] = await run<{ id: number }>(
    `SELECT id::int AS id FROM unsorted_docs
      WHERE id <> $1 AND amount_cents = $2 AND doc_date = $3::date AND status <> 'dismissed'
      ORDER BY id LIMIT 1`, [id, x.total_cents, x.date]);
  if (doc) return doc.id;
  const [exp] = await run(`SELECT 1 FROM expenses WHERE amount_cents = $1 AND expense_date = $2::date AND source_ref NOT LIKE 'scan:%' AND source_ref NOT LIKE 'sms:%' LIMIT 1`, [x.total_cents, x.date]);
  return exp ? 0 : null;
}

export interface ApplyResult {
  status: "filed" | "pending";
  project_slug?: string;
  /** A filing agent run was queued to place the cost (the caller kicks it). */
  agent_queued: boolean;
}

/** Save Claude's read on the doc, then file it if it can go on its own. */
export async function applyRead(
  run: Run,
  id: number,
  x: ReceiptExtract,
  opts: { senderProjectSlug: string | null; today: string; by: string },
): Promise<ApplyResult> {
  const [doc] = await run<{ source_ref: string; status: string; from_label: string; subject: string }>(
    `SELECT source_ref, status, from_label, subject FROM unsorted_docs WHERE id = $1 FOR UPDATE`, [id]);
  if (!doc) throw new Error(`unsorted doc ${id} is gone`);
  const dup = await findDuplicate(run, id, x);
  const target = doc.status === "pending" ? autoFileTarget(x, opts.senderProjectSlug, dup) : null;
  const suggestions: Suggestion[] = [
    ...(opts.senderProjectSlug ? [{ project_slug: opts.senderProjectSlug, reason: "The sender picked this job" }] : []),
    ...(x.match.project_slug ? [{ project_slug: x.match.project_slug, reason: x.match.reason }] : []),
    ...x.guesses,
  ];
  const kind: DocKind = !x.is_receipt ? "other" : x.kind;
  const summary = [x.summary, x.location && `at ${x.location}`].filter(Boolean).join(" ");
  const staged = await stageDoc(run, {
    sourceRef: doc.source_ref,
    kind,
    fromLabel: doc.from_label,
    subject: doc.subject,
    vendorLabel: x.vendor,
    amountCents: x.total_cents,
    docDate: x.date,
    docNumber: x.number,
    summary,
    whyUnsure: target ? "" : whyUnsure(x, dup),
    suggestions,
    overheadLikely: x.overhead_likely,
    stagedBy: "Claude",
  });
  if (!staged.ok) throw new Error(staged.error);
  await run(
    `UPDATE unsorted_docs SET extracted = $2::jsonb, extract_state = 'done', extract_error = '', updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(x)]);
  if (!target) return { status: "pending", agent_queued: false };
  const r = await fileDoc(run, id, { to: "project", projectSlug: target.projectSlug }, {
    by: opts.by,
    note: `Filed from the photo: ${target.why.replace(/[.\s]+$/, "")}.`,
    today: opts.today,
    placeCost: true,
  });
  if (!r.ok) {
    await run(`UPDATE unsorted_docs SET why_unsure = $2 WHERE id = $1`, [id, `Tried to file it to ${target.projectSlug}: ${r.error}`]);
    return { status: "pending", agent_queued: false };
  }
  return { status: "filed", project_slug: target.projectSlug, agent_queued: !!r.agent_queued };
}

"use server";

// Money write paths (Review-round-3 S5A; A07a/A07b billing gate). Owner-gated
// invoices. Reads stay in lib/money.ts; the service boundary is lib/billing/*.
// P1-B7 removed the retainer ledger — SJC is fixed-price only.
//
// Amounts are integer CENTS everywhere (Phase 5.0). Every caller enforces the
// same gate: numbers come from the allocator (never count(*)+1), milestone
// invoices carry a stable economic_key (issueMilestoneInvoice is idempotent
// on it), delivery is recorded ONLY from sendInvoiceOp's result (a failed send
// never marks sent), and "paid" is a ledger row (recordInvoicePayment), never
// a status flip.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireAccess } from "@/lib/dal";
import { ai } from "@/lib/ai";
import { emit } from "@/lib/notify";
import { usd, type InvoiceLine } from "@/lib/money";
import { sendInvoiceOp } from "@/lib/send-ops";
import { withTransaction, userPrincipal } from "@/lib/commands/db";
import {
  allocateInvoiceNumber,
  issueMilestoneInvoice,
  recordInvoicePayment,
  recordDeliveryOutcome,
  invoiceBalance,
  voidInvoice as voidInvoiceCore,
  creditInvoice as creditInvoiceCore,
  setInvoiceTerms as setInvoiceTermsCore,
  logInvoiceEvent,
  BillingError,
} from "@/lib/billing/core";

type Result = { ok: boolean; error?: string };

/** Pull the first dollar figure out of a display value and return CENTS, e.g.
 *  "$3,000 – $4,000" → 300000, "$12,400" → 1240000. 0 when none found. */
function parseAmountCents(value: string): number {
  const m = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? Math.round(Number(m[0]) * 100) : 0;
}

async function projectBySlug(slug: string) {
  return queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM projects WHERE slug = $1`,
    [slug],
  );
}

/** Clean a list of line items: trim labels, round amounts to whole non-negative
 *  CENTS (the client already converted typed dollars → cents), drop blank rows. */
function sanitizeLines(raw: { label: string; amount: number | string }[]): InvoiceLine[] {
  return raw
    .map((l) => ({
      label: String(l.label ?? "").trim(),
      amount: Math.max(0, Math.round(Number(String(l.amount).replace(/[$,\s]/g, "")) || 0)),
    }))
    .filter((l) => l.label !== "" || l.amount > 0);
}

function failure(err: unknown, fallback: string): Result {
  if (err instanceof BillingError) return { ok: false, error: err.message };
  console.error("[money]", err);
  return { ok: false, error: fallback };
}

/** Draft a new invoice for a project milestone. With mode "ai" (default) Qwen
 *  drafts the line items; with "blank" the invoice starts with a single empty
 *  line for the owner to fill in (no slow inference). Saved as status='draft'.
 *  Manual drafts carry no economic key (they are the owner's own identity);
 *  the collision report lists them. */
export async function createInvoice(
  slug: string,
  input: { milestone: string; notes?: string; mode?: "ai" | "blank" },
): Promise<Result> {
  const user = await requireAccess("invoices");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };
  const milestone = input.milestone.trim() || "Progress draw";

  let lines: InvoiceLine[] = [];
  if (input.mode === "blank") {
    lines = [{ label: milestone, amount: 0 }];
  } else {
    try {
      const est = await ai.estimate({
        name: project.name,
        scope: `Construction invoice — "${milestone}" for ${project.name}`,
        intake: [],
        notes:
          `${input.notes ?? ""}. Produce 2–5 invoice line items for this draw with ` +
          `FIRM single dollar amounts (not ranges).`.trim(),
      });
      lines = est.lines.map((l) => ({ label: l.label, amount: parseAmountCents(l.value) }));
    } catch {
      lines = [{ label: milestone, amount: 0 }];
    }
  }
  if (lines.length === 0) lines = [{ label: milestone, amount: 0 }];
  const amount = lines.reduce((s, l) => s + l.amount, 0);

  try {
    await withTransaction(async (run) => {
      const { number } = await allocateInvoiceNumber(run, project.id);
      const [row] = await run<{ id: number }>(
        `INSERT INTO invoices (project_id, number, milestone, amount, line_items, status, source)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'draft', 'manual') RETURNING id::int AS id`,
        [project.id, number, milestone, amount, JSON.stringify(lines)],
      );
      await logInvoiceEvent(run, row.id, "drafted", userPrincipal(user), { mode: input.mode ?? "ai", amountCents: amount });
    });
  } catch (err) {
    return failure(err, "Could not create the invoice.");
  }
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Create a single-line invoice for a fixed milestone amount (in CENTS) and
 *  optionally send it (7-inv milestone automation). Used by advanceProjectStatus
 *  when a project reaches a status that bills a draw. `economicKey` is the
 *  draw's stable identity (`draw:<index>:<label-slug>`): re-flipping a status
 *  finds the existing invoice instead of billing again. Returns whether it was
 *  sent and whether a new invoice was created. */
export async function createMilestoneInvoice(
  slug: string,
  input: { milestone: string; amount: number; autoSend: boolean; economicKey: string; estimateId?: number | null },
): Promise<{ ok: boolean; sent?: boolean; created?: boolean; invoiceId?: number; error?: string }> {
  const user = await requireAccess("invoices");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };

  const milestone = input.milestone.trim() || "Progress draw";
  const amount = Math.max(0, Math.round(input.amount)); // cents

  let invoiceId: number;
  let created: boolean;
  let status: string;
  try {
    const r = await withTransaction((run) =>
      issueMilestoneInvoice(run, {
        projectId: project.id,
        economicKey: input.economicKey,
        milestone,
        amountCents: amount,
        source: "draw",
        estimateId: input.estimateId ?? null,
        // Drafted for the owner's review; sending is what issues it to the
        // client (sendInvoiceOp accepts drafts). Idempotent on the key either way.
        status: "draft",
        principal: userPrincipal(user),
      }),
    );
    invoiceId = r.invoice.id;
    created = r.created;
    status = r.invoice.status;
  } catch (err) {
    return failure(err, "Could not create the milestone invoice.");
  }
  revalidatePath(`/projects/${slug}`);

  let sent = false;
  if (input.autoSend && created && status === "draft") {
    const res = await sendInvoice(invoiceId);
    sent = res.ok;
  }
  return { ok: true, sent, created, invoiceId };
}

/** Edit a draft invoice's milestone + line items (owner only). Issued/sent/paid
 *  invoices are locked — correct them with credit / void. Recomputes the total. */
export async function updateInvoice(
  id: number,
  input: { milestone: string; lines: { label: string; amount: number | string }[] },
): Promise<Result> {
  await requireAccess("invoices");
  const inv = await invoiceById(id);
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status !== "draft") {
    return { ok: false, error: "Only draft invoices can be edited. Credit or void an issued one." };
  }

  const milestone = input.milestone.trim() || inv.milestone || "Progress draw";
  const lines = sanitizeLines(input.lines);
  if (lines.length === 0) return { ok: false, error: "Add at least one line item." };
  const amount = lines.reduce((s, l) => s + l.amount, 0);

  await query(
    `UPDATE invoices SET milestone = $2, line_items = $3::jsonb, amount = $4 WHERE id = $1 AND status = 'draft'`,
    [id, milestone, JSON.stringify(lines), amount],
  );
  revalidatePath(`/projects/${inv.slug}`);
  return { ok: true };
}

/** Delete a draft invoice (owner only). Anything issued is locked: void it. */
export async function deleteInvoice(id: number): Promise<Result> {
  await requireAccess("invoices");
  const inv = await invoiceById(id);
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status !== "draft") {
    return { ok: false, error: "Only draft invoices can be deleted. Void an issued one instead." };
  }
  await query(`DELETE FROM invoices WHERE id = $1 AND status = 'draft'`, [id]);
  revalidatePath(`/projects/${inv.slug}`);
  return { ok: true };
}

interface InvoiceJoin {
  number: string;
  milestone: string;
  amount: number;
  line_items: InvoiceLine[];
  status: string;
  slug: string;
  project_name: string;
}

async function invoiceById(id: number) {
  return queryOne<InvoiceJoin>(
    `SELECT i.number, i.milestone, i.amount, i.line_items, i.status,
            p.slug, p.name AS project_name
       FROM invoices i JOIN projects p ON p.id = i.project_id
      WHERE i.id = $1`,
    [id],
  );
}

/** Email a drafted invoice to the project's client. The send core in
 *  lib/send-ops.ts is the ONLY authority on whether it went out: its result is
 *  recorded as the delivery state, and a failure never marks the invoice sent
 *  (sendInvoiceOp refuses before flipping status; we only record). Agents
 *  reach it via an owner grant / the send_invoice intent. */
export async function sendInvoice(id: number): Promise<Result> {
  const user = await requireAccess("invoices");
  const inv = await invoiceById(id);
  if (!inv) return { ok: false, error: "Invoice not found." };
  const res = await sendInvoiceOp(id);
  try {
    await withTransaction((run) =>
      recordDeliveryOutcome(run, { invoiceId: id, ok: res.ok, error: res.ok ? null : res.error, principal: userPrincipal(user) }),
    );
  } catch (err) {
    console.error("[money] delivery outcome not recorded:", err);
  }
  if (!res.ok) return res;
  revalidatePath(`/projects/${inv.slug}`);
  revalidatePath("/notifications");
  return { ok: true };
}

/** Mark an open invoice paid by hand (check / cash / bank transfer Joe saw
 *  land). Goes through the ledger: a settled manual payment for the verified
 *  open balance, actor recorded. Emits a MONEY notification. */
export async function markInvoicePaid(id: number, input?: { method?: string; note?: string }): Promise<Result> {
  const user = await requireAccess("invoices");
  const inv = await invoiceById(id);
  if (!inv) return { ok: false, error: "Invoice not found." };
  try {
    const applied = await withTransaction(async (run) => {
      const b = await invoiceBalance(run, id);
      if (!b) throw new BillingError("not_found", "Invoice not found.");
      if (b.status === "draft") throw new BillingError("draft", `Invoice ${inv.number} is a draft; send it before recording a payment.`);
      if (b.balanceCents <= 0) throw new BillingError("nothing_due", `Invoice ${inv.number} has no open balance.`);
      if (b.hasPending) throw new BillingError("pending", `Invoice ${inv.number} has an online payment in flight; wait for it to settle before recording a manual one.`);
      await recordInvoicePayment(run, {
        invoiceId: id,
        kind: "payment",
        amountCents: b.balanceCents,
        method: input?.method?.trim() || "manual",
        note: input?.note ?? "Marked paid by hand",
        principal: userPrincipal(user),
      });
      return b.balanceCents;
    });
    await emit({
      kind: "money",
      tag: "Money",
      accent: "money",
      icon: "money",
      title: `${usd(applied)} cleared · ${inv.project_name}`,
      subline: `Invoice ${inv.number} · ${inv.milestone} marked paid by ${user.name || "owner"}`,
      href: `/projects/${inv.slug}`,
    });
  } catch (err) {
    return failure(err, "Could not record the payment.");
  }
  revalidatePath(`/projects/${inv.slug}`);
  revalidatePath("/notifications");
  return { ok: true };
}

/** Record a partial manual payment (cents) against an open invoice. */
export async function recordManualPayment(id: number, input: { amountCents: number; method?: string; note?: string; receivedAt?: string }): Promise<Result> {
  const user = await requireAccess("invoices");
  const inv = await invoiceById(id);
  if (!inv) return { ok: false, error: "Invoice not found." };
  const amount = Math.round(Number(input.amountCents));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Enter a positive amount." };
  try {
    await withTransaction(async (run) => {
      const b = await invoiceBalance(run, id);
      if (!b || b.status === "draft") throw new BillingError("draft", "Send the invoice before recording a payment.");
      if (amount > b.balanceCents) throw new BillingError("over", `That is more than the ${usd(b.balanceCents)} open on ${inv.number}.`);
      await recordInvoicePayment(run, {
        invoiceId: id,
        kind: "payment",
        amountCents: amount,
        method: input.method?.trim() || "manual",
        note: input.note ?? "",
        receivedAt: input.receivedAt || null,
        principal: userPrincipal(user),
      });
    });
  } catch (err) {
    return failure(err, "Could not record the payment.");
  }
  revalidatePath(`/projects/${inv.slug}`);
  return { ok: true };
}

/** Void an issued invoice with a reason (no settled cash on it). */
export async function voidInvoice(id: number, reason: string): Promise<Result> {
  const user = await requireAccess("invoices");
  const inv = await invoiceById(id);
  if (!inv) return { ok: false, error: "Invoice not found." };
  try {
    await withTransaction((run) => voidInvoiceCore(run, { invoiceId: id, reason, principal: userPrincipal(user) }));
  } catch (err) {
    return failure(err, "Could not void the invoice.");
  }
  revalidatePath(`/projects/${inv.slug}`);
  return { ok: true };
}

/** Credit part of an issued invoice with a reason. */
export async function creditInvoice(id: number, input: { amountCents: number; reason: string }): Promise<Result> {
  const user = await requireAccess("invoices");
  const inv = await invoiceById(id);
  if (!inv) return { ok: false, error: "Invoice not found." };
  try {
    await withTransaction((run) => creditInvoiceCore(run, { invoiceId: id, amountCents: Math.round(Number(input.amountCents)), reason: input.reason, principal: userPrincipal(user) }));
  } catch (err) {
    return failure(err, "Could not credit the invoice.");
  }
  revalidatePath(`/projects/${inv.slug}`);
  return { ok: true };
}

/** Set verified terms (e.g. "Net 30") on an invoice whose terms were unknown. */
export async function setInvoiceTerms(id: number, terms: string): Promise<Result> {
  const user = await requireAccess("invoices");
  const inv = await invoiceById(id);
  if (!inv) return { ok: false, error: "Invoice not found." };
  try {
    await withTransaction((run) => setInvoiceTermsCore(run, { invoiceId: id, terms, principal: userPrincipal(user) }));
  } catch (err) {
    return failure(err, "Could not set the terms.");
  }
  revalidatePath(`/projects/${inv.slug}`);
  return { ok: true };
}

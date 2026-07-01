"use server";

// Money write paths (Review-round-3 S5A). Owner-gated invoices + retainers.
// Reads stay in lib/money.ts. Invoice line items are drafted by Qwen (ai.estimate)
// and coerced to firm integer dollars. Sending an invoice emails the client via
// Gmail and emits a MONEY notification; paying one emits another.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { ai } from "@/lib/ai";
import { emit } from "@/lib/notify";
import { usd, type InvoiceLine } from "@/lib/money";
import { sendNewEmailAction } from "@/lib/actions/inbox";

type Result = { ok: boolean; error?: string };

/** Pull the first dollar figure out of a display value, e.g.
 *  "$3,000 – $4,000" → 3000, "$12,400" → 12400. 0 when none found. */
function parseAmount(value: string): number {
  const m = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? Math.round(Number(m[0])) : 0;
}

async function projectBySlug(slug: string) {
  return queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM projects WHERE slug = $1`,
    [slug],
  );
}

/** Clean a list of line items: trim labels, floor amounts to whole non-negative
 *  dollars, drop fully-blank rows. */
function sanitizeLines(raw: { label: string; amount: number | string }[]): InvoiceLine[] {
  return raw
    .map((l) => ({
      label: String(l.label ?? "").trim(),
      amount: Math.max(0, Math.floor(Number(String(l.amount).replace(/[$,\s]/g, "")) || 0)),
    }))
    .filter((l) => l.label !== "" || l.amount > 0);
}

/** Draft a new invoice for a project milestone. With mode "ai" (default) Qwen
 *  drafts the line items; with "blank" the invoice starts with a single empty
 *  line for the owner to fill in (no slow inference). Saved as status='draft'. */
export async function createInvoice(
  slug: string,
  input: { milestone: string; notes?: string; mode?: "ai" | "blank" },
): Promise<Result> {
  await requireRole("owner");
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
      lines = est.lines.map((l) => ({ label: l.label, amount: parseAmount(l.value) }));
    } catch {
      lines = [{ label: milestone, amount: 0 }];
    }
  }
  if (lines.length === 0) lines = [{ label: milestone, amount: 0 }];
  const amount = lines.reduce((s, l) => s + l.amount, 0);

  const { count } = (await queryOne<{ count: number }>(
    `SELECT count(*)::int AS count FROM invoices WHERE project_id = $1`,
    [project.id],
  )) ?? { count: 0 };
  const number = `INV-${String(count + 1).padStart(3, "0")}`;

  await query(
    `INSERT INTO invoices (project_id, number, milestone, amount, line_items, status)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'draft')`,
    [project.id, number, milestone, amount, JSON.stringify(lines)],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Create a single-line invoice for a fixed milestone amount and optionally send
 *  it (7-inv milestone automation). Used by advanceProjectStatus when a project
 *  reaches a status that bills a draw. Returns whether it was sent. */
export async function createMilestoneInvoice(
  slug: string,
  input: { milestone: string; amount: number; autoSend: boolean },
): Promise<{ ok: boolean; sent?: boolean; error?: string }> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };

  const milestone = input.milestone.trim() || "Progress draw";
  const amount = Math.max(0, Math.round(input.amount));
  const lines: InvoiceLine[] = [{ label: milestone, amount }];

  const { count } = (await queryOne<{ count: number }>(
    `SELECT count(*)::int AS count FROM invoices WHERE project_id = $1`,
    [project.id],
  )) ?? { count: 0 };
  const number = `INV-${String(count + 1).padStart(3, "0")}`;

  const ins = await queryOne<{ id: string }>(
    `INSERT INTO invoices (project_id, number, milestone, amount, line_items, status)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'draft')
     RETURNING id`,
    [project.id, number, milestone, amount, JSON.stringify(lines)],
  );
  revalidatePath(`/projects/${slug}`);

  let sent = false;
  if (input.autoSend && ins) {
    const res = await sendInvoice(Number(ins.id));
    sent = res.ok;
  }
  return { ok: true, sent };
}

/** Edit a draft invoice's milestone + line items (owner only). Sent/paid
 *  invoices are locked. Recomputes the total from the edited lines. */
export async function updateInvoice(
  id: number,
  input: { milestone: string; lines: { label: string; amount: number | string }[] },
): Promise<Result> {
  await requireRole("owner");
  const inv = await invoiceById(id);
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status !== "draft") {
    return { ok: false, error: "Only draft invoices can be edited." };
  }

  const milestone = input.milestone.trim() || inv.milestone || "Progress draw";
  const lines = sanitizeLines(input.lines);
  if (lines.length === 0) return { ok: false, error: "Add at least one line item." };
  const amount = lines.reduce((s, l) => s + l.amount, 0);

  await query(
    `UPDATE invoices SET milestone = $2, line_items = $3::jsonb, amount = $4 WHERE id = $1`,
    [id, milestone, JSON.stringify(lines), amount],
  );
  revalidatePath(`/projects/${inv.slug}`);
  return { ok: true };
}

/** Delete a draft invoice (owner only). Sent/paid invoices are locked. */
export async function deleteInvoice(id: number): Promise<Result> {
  await requireRole("owner");
  const inv = await invoiceById(id);
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status !== "draft") {
    return { ok: false, error: "Only draft invoices can be deleted." };
  }
  await query(`DELETE FROM invoices WHERE id = $1`, [id]);
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

/** Email a drafted invoice to the project's client, then mark it sent. */
export async function sendInvoice(id: number): Promise<Result> {
  await requireRole("owner");
  const inv = await invoiceById(id);
  if (!inv) return { ok: false, error: "Invoice not found." };

  const client = await queryOne<{ email: string; name: string }>(
    `SELECT email, name FROM users WHERE link_slug = $1 AND role = 'client' AND active = true LIMIT 1`,
    [inv.slug],
  );
  if (!client?.email) {
    return { ok: false, error: "No client email on file for this project." };
  }

  const first = client.name.split(/\s+/)[0] || "there";
  const lineText = (inv.line_items ?? [])
    .map((l) => `  • ${l.label}: ${usd(l.amount)}`)
    .join("\n");
  const body =
    `Hi ${first},\n\nPlease find the invoice for "${inv.milestone}" on the ` +
    `${inv.project_name} project below.\n\n${lineText}\n\nTotal due: ${usd(inv.amount)}\n\n` +
    `You can reply here with any questions. Thank you!\n\nBest,\nJoe\nSJ Carpentry`;

  const res = await sendNewEmailAction({
    to: client.email,
    subject: `Invoice ${inv.number} — ${inv.project_name} (${inv.milestone})`,
    body,
  });
  if (!res.ok) return { ok: false, error: res.error ?? "Could not send the invoice." };

  await query(
    `UPDATE invoices SET status = 'sent', sent_at = now() WHERE id = $1`,
    [id],
  );
  await emit({
    kind: "money",
    tag: "Money",
    accent: "money",
    icon: "money",
    title: `Invoice ${inv.number} sent · ${inv.project_name}`,
    subline: `${usd(inv.amount)} · ${inv.milestone}`,
    href: `/projects/${inv.slug}`,
  });
  revalidatePath(`/projects/${inv.slug}`);
  revalidatePath("/notifications");
  return { ok: true };
}

/** Mark a sent invoice paid. Emits a MONEY notification. */
export async function markInvoicePaid(id: number): Promise<Result> {
  await requireRole("owner");
  const inv = await invoiceById(id);
  if (!inv) return { ok: false, error: "Invoice not found." };

  await query(
    `UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1`,
    [id],
  );
  await emit({
    kind: "money",
    tag: "Money",
    accent: "money",
    icon: "money",
    title: `${usd(inv.amount)} cleared · ${inv.project_name}`,
    subline: `Invoice ${inv.number} · ${inv.milestone} marked paid`,
    href: `/projects/${inv.slug}`,
  });
  revalidatePath(`/projects/${inv.slug}`);
  revalidatePath("/notifications");
  return { ok: true };
}

async function upsertRetainer(slug: string, deltaCollected: number, deltaApplied: number) {
  const project = await projectBySlug(slug);
  if (!project) return null;
  await query(
    `INSERT INTO retainers (project_id, collected, applied)
     VALUES ($1, GREATEST($2, 0), GREATEST($3, 0))
     ON CONFLICT (project_id) DO UPDATE
       SET collected = GREATEST(retainers.collected + $2, 0),
           applied   = GREATEST(retainers.applied + $3, 0),
           updated_at = now()`,
    [project.id, deltaCollected, deltaApplied],
  );
  return project;
}

/** Record a retainer collection. Emits a MONEY notification. */
export async function collectRetainer(slug: string, amount: number): Promise<Result> {
  await requireRole("owner");
  const amt = Math.round(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: "Enter an amount." };
  const project = await upsertRetainer(slug, amt, 0);
  if (!project) return { ok: false, error: "Project not found." };
  await emit({
    kind: "money",
    tag: "Money",
    accent: "money",
    icon: "money",
    title: `Retainer collected · ${project.name}`,
    subline: `${usd(amt)} received`,
    href: `/projects/${slug}`,
  });
  revalidatePath(`/projects/${slug}`);
  revalidatePath("/notifications");
  return { ok: true };
}

/** Apply retainer toward draws (reduces the balance). */
export async function applyRetainer(slug: string, amount: number): Promise<Result> {
  await requireRole("owner");
  const amt = Math.round(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: "Enter an amount." };
  const project = await upsertRetainer(slug, 0, amt);
  if (!project) return { ok: false, error: "Project not found." };
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

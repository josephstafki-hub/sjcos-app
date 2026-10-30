// The client email for an invoice. One builder for every path that emails
// one: Joe's Send button, approved invoice cards and agent sends
// (lib/send-ops.ts sendInvoiceOp), and the invoices billing issues on its own
// (lib/billing/commands.ts enqueueSend: acceptance, milestone, sign-off).
// The billing path used to queue `{ invoiceId }` alone; the email provider
// refuses an empty To, so no automatically issued invoice was ever emailed.
//
// Pure over `run` so node --test drives it. The parts that need the app (the
// PDF, the portal pay link, Square's card setup) come in as `extras` from
// lib/send-ops.ts invoiceEmailExtras.

import { createHash } from "node:crypto";
import type { Run } from "../commands/core.ts";
import { fmtUsd as usd } from "../cost-book-units.ts";
import type { EmailAttachmentRef } from "../providers/email.ts";
import type { InvoiceLine } from "./core.ts";

export interface InvoiceEmail {
  id: number;
  number: string;
  milestone: string;
  amount: number;
  line_items: InvoiceLine[];
  status: string;
  delivery_state: string;
  /** State of the invoice's queued send intent, if it has one. */
  send_state: string | null;
  slug: string;
  project_name: string;
  /** email: trimmed + lowercased, null when there is none on file. */
  client: { email: string | null; name: string };
  lineText: string;
  subject: string;
}

export interface InvoiceEmailExtras {
  attachments: EmailAttachmentRef[];
  payUrl: string | null;
  surchargeNote: string | null;
}

export async function loadInvoiceEmail(run: Run, id: number): Promise<InvoiceEmail | null> {
  const [inv] = await run<Omit<InvoiceEmail, "client" | "lineText" | "subject">>(
    `SELECT i.id::int AS id, i.number, i.milestone, i.amount, i.line_items, i.status, i.delivery_state,
            a.state AS send_state, p.slug, p.name AS project_name
       FROM invoices i JOIN projects p ON p.id = i.project_id
       LEFT JOIN action_intents a ON a.id = i.send_intent_id
      WHERE i.id = $1`,
    [id],
  );
  if (!inv) return null;
  // A link-only client's account sits on a synthetic <slug>@client-portal.invalid
  // address — never a mailbox. Fall back to the project's client_email, as the
  // e-sign and portal-publish sends do.
  const [client] = await run<{ email: string | null; name: string }>(
    `SELECT COALESCE(NULLIF(trim(u.email), ''), NULLIF(trim(p.client_email), '')) AS email,
            COALESCE(u.name, p.client_name, '') AS name
       FROM projects p
       LEFT JOIN users u ON u.role = 'client' AND u.link_slug = p.slug AND u.active = true
                        AND u.email NOT LIKE '%@client-portal.invalid'
      WHERE p.slug = $1
      LIMIT 1`,
    [inv.slug],
  );
  const lineText = (inv.line_items ?? []).map((l) => `  • ${l.label}: ${usd(l.amount)}`).join("\n");
  return {
    ...inv,
    client: { email: client?.email ? client.email.trim().toLowerCase() : null, name: client?.name ?? "" },
    lineText,
    subject: `Invoice ${inv.number} — ${inv.project_name} (${inv.milestone})`,
  };
}

export function invoiceEmailBody(p: { name: string; inv: Pick<InvoiceEmail, "number" | "milestone" | "project_name" | "amount">; lineText: string; attached: boolean; payUrl: string | null; surchargeNote: string | null }): string {
  const first = p.name.split(/\s+/)[0] || "there";
  const payText = p.payUrl ? `Pay online by card or bank transfer:\n${p.payUrl}\n${p.surchargeNote ? `${p.surchargeNote}\n` : ""}\n` : "";
  return (
    `Hi ${first},\n\nPlease find invoice ${p.inv.number} for "${p.inv.milestone}" on the ` +
    `${p.inv.project_name} project ${p.attached ? "attached. A summary is below." : "below."}\n\n` +
    `${p.lineText}\n\nTotal due: ${usd(p.inv.amount)}\n\n` +
    payText +
    `You can reply here with any questions. Thank you!\n\nBest,\nJoe\nSJ Carpentry`
  );
}

/** Content revision of the email: keys Joe's Send (`invoice:<id>:send:<rev>`)
 *  and the stored PDF, so a retry of the same content reuses both. */
export function invoiceEmailRevision(e: InvoiceEmail): string {
  return createHash("sha256").update(`${e.client.email ?? ""}\n${e.subject}\n${e.lineText}\n${e.amount}`).digest("hex").slice(0, 12);
}

/** The send_invoice intent payload: To, Subject, the body (pay link and card
 *  surcharge line included), the PDF reference and the labels the bell and
 *  approval cards show. */
export function invoiceEmailPayload(e: InvoiceEmail, x: InvoiceEmailExtras): Record<string, unknown> {
  return {
    to: e.client.email ?? "",
    subject: e.subject,
    bodyText: invoiceEmailBody({ name: e.client.name, inv: e, lineText: e.lineText, attached: x.attachments.length > 0, payUrl: x.payUrl, surchargeNote: x.surchargeNote }),
    attachments: x.attachments,
    number: e.number,
    milestone: e.milestone,
    project_name: e.project_name,
    amount_label: usd(e.amount),
    slug: e.slug,
    pay_url: x.payUrl,
    _auth: { action: "send_invoice", target_kind: "invoice", target_id: String(e.id), amount_cents: Number(e.amount) },
  };
}

/** Why this invoice can't be emailed now, or null when it can: a draft, or an
 *  issued invoice that never went out (billing found no client email, or its
 *  send failed). One whose send is queued, in doubt or done is never sent twice. */
export function invoiceSendBlock(e: InvoiceEmail): string | null {
  if (e.status === "draft") return null;
  if (e.status !== "issued") return `Invoice ${e.number} is already ${e.status}.`;
  if (e.delivery_state === "none" || e.delivery_state === "failed") return null;
  // Queued before the billing payload fix: the intent died without marking the invoice.
  if (e.delivery_state === "queued" && (e.send_state === "permanent_failure" || e.send_state === "cancelled")) return null;
  if (e.delivery_state === "queued") return `Invoice ${e.number} is already queued to send to the client.`;
  if (e.delivery_state === "unknown") return `Invoice ${e.number} may already have gone out; its send is being checked with the mail provider.`;
  return `Invoice ${e.number} was already sent.`;
}

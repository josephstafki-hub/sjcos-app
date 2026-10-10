// Client payment receipt (Joe, 2026-10-10). Square does not email receipts
// for Payments API charges, so when a Square payment COMPLETES we email the
// client a short "payment received" note with Square's receipt link.
//
// Staged inside the same transaction that records the payment, as ONE
// send_email intent keyed on the attempt (payment:<attempt>:receipt), so the
// checkout response, the webhook and the reconcile sweep can all reach this
// and the client still gets exactly one email. Never for PENDING (an ACH in
// flight is not money received).
//
// Authority: the active `payment.receipt` policy (Joe asked for these to go
// out automatically). With the policy off, the same email is staged as a
// decision Joe approves; nothing is sent on its own.
//
// Pure: `run` only.

import type { Run } from "../commands/core.ts";
import type { Principal } from "../commands/principal.ts";
import { enqueueIntent } from "../commands/intents.ts";
import { stageDecision } from "../commands/decisions.ts";
import { activePolicy, policyRef } from "../commands/policies.ts";
import { invoiceBalance } from "../billing/core.ts";

export const RECEIPT_POLICY_KEY = "payment.receipt";

export type ReceiptOutcome =
  | { staged: "intent"; intentId: string; to: string }
  | { staged: "decision"; decisionId: string; intentId: string; to: string }
  | { staged: "skipped"; reason: string };

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export interface ReceiptInput {
  attemptId: string;
  invoiceId: number;
  amountCents: number;
  method: "card" | "ach";
  receiptUrl: string | null;
  principal: Principal;
}

export async function stagePaymentReceipt(run: Run, input: ReceiptInput): Promise<ReceiptOutcome> {
  const [inv] = await run<{ number: string; milestone: string; project_id: string; project_name: string; client_name: string | null; email: string | null }>(
    `SELECT i.number, i.milestone, p.id AS project_id, p.name AS project_name, p.client_name,
            COALESCE(NULLIF((SELECT u.email FROM users u WHERE u.role = 'client' AND u.active AND u.link_slug = p.slug
                               AND u.email NOT LIKE '%@client-portal.invalid' LIMIT 1), ''),
                     NULLIF(trim(p.client_email), '')) AS email
       FROM invoices i JOIN projects p ON p.id = i.project_id WHERE i.id = $1`,
    [input.invoiceId],
  );
  if (!inv) return { staged: "skipped", reason: "invoice not found" };
  const to = inv.email?.trim().toLowerCase();
  if (!to) return { staged: "skipped", reason: "no client email on file" };

  const first = (inv.client_name ?? "").split(/\s+/)[0] || "there";
  const balance = (await invoiceBalance(run, input.invoiceId))?.balanceCents ?? 0;
  const how = input.method === "ach" ? "bank transfer" : "card";
  const subject = `Payment received — Invoice ${inv.number}`;
  const bodyText =
    `Hi ${first},\n\n` +
    `Thank you. We received your ${how} payment of ${usd(input.amountCents)} for invoice ${inv.number} (${inv.milestone}) on ${inv.project_name}.\n\n` +
    (balance > 0 ? `Remaining balance on this invoice: ${usd(balance)}.\n\n` : `This invoice is now paid in full.\n\n`) +
    (input.receiptUrl ? `Your receipt from Square:\n${input.receiptUrl}\n\n` : "") +
    `Any questions, just reply to this email.\n\nThanks,\nJoe\nSJ Carpentry LLC\n612-361-6585`;
  const payload = { to, subject, bodyText, kind: "payment_receipt", invoice_number: inv.number, amount_cents: input.amountCents };
  const operationKey = `payment:${input.attemptId}:receipt`;
  const common = {
    operationKey,
    kind: "send_email",
    targetKind: "payment_attempt",
    targetId: input.attemptId,
    recipient: to,
    projectId: inv.project_id,
    payload,
    principal: input.principal,
  };

  const policy = await activePolicy(run, RECEIPT_POLICY_KEY);
  if (policy) {
    const { intent } = await enqueueIntent(run, { ...common, policyRef: policyRef(policy) });
    return { staged: "intent", intentId: intent.id, to };
  }
  // Policy off: Joe approves this receipt; the intent waits on that decision.
  const { decision } = await stageDecision(run, {
    kind: "payment_receipt",
    action: "send_email",
    title: `${subject} → ${to}`,
    summary: { recipients: [{ name: first, address: to }], effect: bodyText.slice(0, 400) },
    targetKind: "payment_attempt",
    targetId: input.attemptId,
    recipient: to,
    content: payload,
    projectId: inv.project_id,
    dedupeKey: operationKey,
    requestedBy: input.principal,
  });
  const { intent } = await enqueueIntent(run, { ...common, decisionId: decision.id });
  return { staged: "decision", decisionId: decision.id, intentId: intent.id, to };
}

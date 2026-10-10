import "server-only";

// Pool-bound glue for the pure billing modules (lib/billing/core.ts,
// commands.ts, reminders.ts). Everything here runs inside one transaction on
// lib/db's pool and derives its principal on the server.

import { withTransaction, runDirect, sessionPrincipal } from "@/lib/commands/db";
import type { Principal } from "@/lib/commands/principal";
import { onSignatureSigned, type DecisionInvoiceOutcome, type SignatureSignedOutcome } from "./commands";
import { routineReminderCandidates } from "./reminders";
import { verifiedBalances, invoiceBalance, recordDeliveryOutcome } from "./core";
import { sendInvoiceOp } from "@/lib/send-ops";
import { notifyOwner } from "@/lib/notify-owner";

export { withTransaction as billingTx };

/** The signed-in user as a principal, or a named service principal. */
export async function billingPrincipal(fallback = "billing"): Promise<Principal> {
  return (await sessionPrincipal()) ?? { kind: "service", name: fallback };
}

/** Hook for lib/actions/esign.ts (and WS-worker's source-event processor):
 *  run the acceptance / contract-link / sign-off billing for a signature
 *  request. Idempotent — safe on repeated signature events. */
export async function billingOnSignatureSigned(signatureRequestId: number, principal?: Principal): Promise<SignatureSignedOutcome> {
  const p = principal ?? { kind: "service", name: "esign:signed" };
  return onSignatureSigned(withTransaction, signatureRequestId, p);
}

/** After an approved first-draw card commits (app button or Telegram): email
 *  the draft invoice it created. The approval is Joe's, so the send carries
 *  the owner's authority with the decision named. Returns the line to show;
 *  a failure leaves the draft on the project (its Send button still works)
 *  and pushes Joe the reason. */
export async function emailApprovedInvoice(outcome: DecisionInvoiceOutcome | null | undefined, decisionId: string): Promise<string | null> {
  if (!outcome?.issued || outcome.status !== "draft") return null;
  const res = await sendInvoiceOp(outcome.invoiceId, { actor: `decision:${decisionId}` });
  try {
    await withTransaction((run) => recordDeliveryOutcome(run, { invoiceId: outcome.invoiceId, ok: res.ok, error: res.ok ? null : res.error, principal: `decision:${decisionId}` }));
  } catch (err) {
    console.error("[billing] delivery outcome not recorded:", (err as Error).message);
  }
  if (res.ok) return res.summary;
  await notifyOwner({ kind: "urgent_item", title: `Invoice ${outcome.invoiceNumber} was created but not emailed`, body: res.error.slice(0, 160), href: "/money" }).catch(() => undefined);
  return `Invoice ${outcome.invoiceNumber} was created but not emailed: ${res.error}`;
}

export function reminderCandidates() {
  return routineReminderCandidates(runDirect);
}

export function projectVerifiedBalances(projectId: string) {
  return verifiedBalances(runDirect, { projectId });
}

export function readInvoiceBalance(invoiceId: number) {
  return invoiceBalance(runDirect, invoiceId);
}

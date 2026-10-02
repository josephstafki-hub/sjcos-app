import "server-only";

// Pool-bound glue for the pure billing modules (lib/billing/core.ts,
// commands.ts, reminders.ts). Everything here runs inside one transaction on
// lib/db's pool and derives its principal on the server.

import { withTransaction, runDirect, sessionPrincipal } from "@/lib/commands/db";
import type { Principal } from "@/lib/commands/principal";
import { onSignatureSigned, type SignatureSignedOutcome } from "./commands";
import { routineReminderCandidates } from "./reminders";
import { verifiedBalances, invoiceBalance } from "./core";

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

export function reminderCandidates() {
  return routineReminderCandidates(runDirect);
}

export function projectVerifiedBalances(projectId: string) {
  return verifiedBalances(runDirect, { projectId });
}

export function readInvoiceBalance(invoiceId: number) {
  return invoiceBalance(runDirect, invoiceId);
}

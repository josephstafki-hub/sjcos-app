import "server-only";

// What a binding signature sets off, after it is recorded (lib/actions/esign.ts):
//   billing    — acceptance issues the initial invoice, a contract links to it,
//                a completion sign-off issues the final invoice (A07b);
//   workflow   — W02 preparation for a pre-con agreement, stage moves, the
//                operating agent woken (A23);
//   closeout   — a completion sign-off schedules after-job care (W12);
//   agreement  — an accepted formal estimate drafts the construction
//                agreement (W08, lib/workflow/agreement.ts).
// Every step is idempotent, and none may fail the signature. A step that
// throws used to be only logged; now the whole set is recorded as a failed
// 'esign' source event and the worker runs it again (lib/worker/esign-processor.ts)
// until it goes through or runs out of attempts (then health flags it).

import { withTransaction, runDirect } from "@/lib/commands/db";
import { recordSourceEvent } from "@/lib/commands/source-events";
import { billingOnSignatureSigned } from "@/lib/billing/server";
import { workflowOnSignatureSigned } from "@/lib/workflow/server";
import { recordWrittenSignoffCmd } from "@/lib/closeout/server";
import { prepareAgreementOnAcceptance } from "@/lib/workflow/agreement";

/** Run every step; returns the ones that failed ("step: message"). */
export async function runSignatureHooks(signatureRequestId: number): Promise<string[]> {
  const failed: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      console.error(`[esign] ${name} hook failed for request ${signatureRequestId}:`, err);
      failed.push(`${name}: ${(err as Error)?.message ?? String(err)}`.slice(0, 400));
    }
  };
  await step("billing", () => billingOnSignatureSigned(signatureRequestId));
  await step("workflow", () => workflowOnSignatureSigned(signatureRequestId));
  const [sr] = await runDirect<{ doc_type: string }>(`SELECT doc_type FROM signature_requests WHERE id = $1`, [signatureRequestId]);
  if (sr?.doc_type === "completion") await step("closeout", () => recordWrittenSignoffCmd({ kind: "service", name: "esign:signed" }, signatureRequestId));
  if (sr?.doc_type === "estimate") await step("agreement", () => prepareAgreementOnAcceptance(signatureRequestId));
  return failed;
}

/** The signature path's call: run the steps, and if any failed leave a
 *  failed source event the worker retries. Never throws. */
export async function signatureHooksWithRetry(signatureRequestId: number): Promise<void> {
  try {
    const failed = await runSignatureHooks(signatureRequestId);
    if (!failed.length) return;
    await withTransaction(async (run) => {
      const { event } = await recordSourceEvent(run, { provider: "esign", eventId: `signed:${signatureRequestId}`, eventType: "signature.signed", payload: { signature_request_id: signatureRequestId }, verified: true });
      await run(
        `UPDATE source_events SET state = 'failed', last_error = $2, next_attempt_at = now() + interval '2 minutes' WHERE id = $1 AND state IN ('pending','failed','done')`,
        [event.id, failed.join(" · ").slice(0, 2000)],
      );
    });
  } catch (err) {
    console.error(`[esign] could not queue the retry for request ${signatureRequestId}:`, err);
  }
}

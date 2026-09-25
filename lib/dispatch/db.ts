import "server-only";

// Next.js-side glue for the dispatcher: the pool-bound transaction runner,
// the real provider registry, and the two entry points every adapter and
// the cron route use.

import { runDirect, withTransaction } from "@/lib/commands/db";
import { expireStaleDecisions } from "@/lib/commands/decisions";
import { defaultProviders } from "@/lib/providers";
import { dispatchOnce, reconcileUnknown, sweepForDispatch, type DispatchDeps, type DispatchOutcome } from "./core";
import { announceUnannouncedDecisions } from "@/lib/decisions/notify";

const WORKER = () => `${process.env.SJC_WORKER_NAME ?? "app"}:${process.pid}`;

let registry: ReturnType<typeof defaultProviders> | null = null;
function deps(): DispatchDeps {
  registry ??= defaultProviders();
  return { tx: withTransaction, run: runDirect, providers: registry, worker: WORKER() };
}

/** Dispatch exactly these intents now (inline, after staging) and return the
 *  truthful per-intent outcome. */
export async function dispatchIntentsNow(intentIds: string[]): Promise<DispatchOutcome[]> {
  if (!intentIds.length) return [];
  return dispatchOnce(deps(), { intentIds });
}

/** One dispatch pass over whatever is due (the 2-minute timer). */
export async function runDispatchPass(opts: { limit?: number } = {}): Promise<{
  swept: { unknown: number; requeued: number; releasedHolds: number };
  expiredDecisions: number;
  announced: number;
  dispatched: DispatchOutcome[];
  reconciled: Awaited<ReturnType<typeof reconcileUnknown>>;
}> {
  const d = deps();
  const swept = await withTransaction((run) => sweepForDispatch(run));
  const expiredDecisions = await withTransaction((run) => expireStaleDecisions(run));
  const announced = await announceUnannouncedDecisions();
  const dispatched = await dispatchOnce(d, { limit: opts.limit ?? 50 });
  const reconciled = await reconcileUnknown(d);
  return { swept, expiredDecisions, announced, dispatched, reconciled };
}

/** The agent-facing verdict for one intent's dispatch outcome. `ok` is true
 *  only when the provider accepted or confirmed; an unknown outcome is
 *  reported as held (not failed, not sent) and never refunded. */
export function describeOutcome(o: DispatchOutcome | undefined, what: string): { ok: true; summary: string; state: string } | { ok: false; error: string; state: string; held?: boolean } {
  if (!o) return { ok: false, error: `${what}: the action was not dispatched (already in flight or not dispatchable).`, state: "unknown" };
  switch (o.responseClass) {
    case "accepted":
    case "confirmed":
      return { ok: true, summary: `${what} — ${o.responseClass}${o.providerRef ? ` (${o.providerRef})` : ""}.`, state: o.state ?? o.responseClass };
    case "unknown":
      return { ok: false, held: true, state: "unknown", error: `${what}: the provider did not confirm whether it went out (${o.error ?? "no detail"}). It is HELD for reconciliation — not resent, and the approval was not given back. Do not send it again by hand.` };
    case "retryable":
      return { ok: false, state: o.state ?? "retryable_failure", error: `${what}: not sent yet (${o.error ?? "temporary failure"}). The dispatcher will retry on its own; do not resend.` };
    case "refused":
      return { ok: false, state: o.state ?? "held", error: `${what}: ${o.error ?? "refused at dispatch"}` };
    default:
      return { ok: false, state: o.state ?? "permanent_failure", error: `${what}: ${o.error ?? "the provider rejected it"}` };
  }
}

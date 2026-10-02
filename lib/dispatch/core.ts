// The intent dispatcher (A05/A06). Owns every provider call in the system.
//
//   dispatchOnce()
//     1. tx: claim intents (lease + fencing token), then for each one, still
//        inside the SAME transaction: lane open? payload unchanged? recipient
//        not opted out? authority (decision / grant / policy / owner) valid —
//        spent on first dispatch, re-verified on retries. A refusal settles
//        the intent right there (held / cancelled / permanent) and nothing is
//        sent. COMMIT.
//     2. Provider call OUTSIDE any transaction (network never holds a lock).
//     3. tx: finishAttempt (fenced on the lease token), transmitted flag,
//        refund of authority ONLY when nothing ever transmitted, kind effects
//        (status flips) ONLY on accepted/confirmed. COMMIT.
//
//   reconcileUnknown()  — asks each provider what really happened to
//                         'unknown'/'accepted' intents; never resends.
//
// Pure: takes `tx` (transaction runner) and `run` (autocommit) so node --test
// drives it against the disposable harness with fake providers.

import { randomUUID } from "node:crypto";
import type { Run } from "../commands/core.ts";
import {
  claimIntents,
  finishAttempt,
  hashPayload,
  holdIntent,
  INTENT_COLS,
  reconcileIntent,
  sweepExpiredLeases,
  type ActionIntent,
  type IntentState,
} from "../commands/intents.ts";
import { laneOpen } from "../commands/policies.ts";
import type { Provider, ProviderContext, ProviderResult } from "../providers/types.ts";
import { markTransmitted, recordGrantResultRun, refundAuthorityIfUntransmitted, verifyAuthority } from "./authority.ts";
import { EFFECTS, type Effect } from "./effects.ts";
import { ALL_KINDS, KINDS, REQUEUE_ON_LEASE_EXPIRY, specFor } from "./kinds.ts";

export type Tx = <T>(fn: (run: Run) => Promise<T>) => Promise<T>;

export interface DispatchDeps {
  tx: Tx;
  run: Run;
  providers: Record<string, Provider<Record<string, unknown>>>;
  worker: string;
  effects?: Record<string, Effect>;
  leaseSeconds?: number;
}

export interface DispatchOutcome {
  intentId: string;
  operationKey: string;
  kind: string;
  /** Final state after this pass (null = a stale worker's write was fenced). */
  state: IntentState | null;
  responseClass: ProviderResult["responseClass"] | "refused";
  providerRef: string | null;
  error: string | null;
  transmitted: boolean;
}

export interface DispatchOnceOptions {
  kinds?: string[];
  /** Dispatch exactly these intents (inline dispatch after staging). */
  intentIds?: string[];
  limit?: number;
}

export async function dispatchOnce(deps: DispatchDeps, opts: DispatchOnceOptions = {}): Promise<DispatchOutcome[]> {
  const worker = deps.worker;
  const effects = deps.effects ?? EFFECTS;
  const outcomes: DispatchOutcome[] = [];

  // ── 1. claim + preflight, one transaction ────────────────────────────────
  const { token, ready } = await deps.tx(async (run) => {
    const claim = opts.intentIds?.length
      ? await claimSpecific(run, opts.intentIds, deps.leaseSeconds ?? 120)
      : await claimIntents(run, { kinds: opts.kinds, limit: opts.limit ?? 20, worker, leaseSeconds: deps.leaseSeconds ?? 120 });
    const ready: ActionIntent[] = [];
    for (const intent of claim.intents) {
      const refusal = await preflight(run, intent, worker);
      if (refusal) {
        const state = await settleRefusal(run, intent, claim.token, worker, refusal);
        outcomes.push({ intentId: intent.id, operationKey: intent.operation_key, kind: intent.kind, state, responseClass: "refused", providerRef: null, error: refusal.reason, transmitted: false });
        continue;
      }
      ready.push(intent);
    }
    return { token: claim.token, ready };
  });

  // ── 2 + 3. provider call outside the tx, outcome inside a fresh one ──────
  for (const intent of ready) {
    const spec = specFor(intent.kind)!;
    const provider = deps.providers[spec.provider];
    const ctx: ProviderContext = { operationKey: intent.operation_key, intentId: intent.id, attempt: intent.attempts };
    let result: ProviderResult;
    if (!provider) {
      result = { responseClass: "permanent", error: `No provider registered for ${intent.kind}.`, transmitted: false };
    } else {
      try {
        result = await provider.send(intent.payload, ctx);
      } catch (err) {
        // A provider adapter must never throw; if one does we cannot know
        // whether the request left the box.
        result = { responseClass: "unknown", error: `adapter threw: ${(err as Error).message}`, transmitted: true };
      }
    }
    const state = await deps.tx(async (run) => recordOutcome(run, intent, token, worker, result, effects));
    outcomes.push({ intentId: intent.id, operationKey: intent.operation_key, kind: intent.kind, state, responseClass: result.responseClass, providerRef: result.providerRef ?? null, error: result.error ?? null, transmitted: result.transmitted });
  }
  return outcomes;
}

interface Refusal {
  reason: string;
  disposition: "hold" | "cancel" | "permanent";
}

/** Everything that must still be true at the moment of dispatch. */
async function preflight(run: Run, intent: ActionIntent, worker: string): Promise<Refusal | null> {
  const spec = specFor(intent.kind);
  if (!spec) return { reason: `Unknown intent kind "${intent.kind}".`, disposition: "permanent" };
  if (hashPayload(intent.payload) !== intent.payload_hash) return { reason: "The payload changed after it was staged; stage a new revision.", disposition: "permanent" };
  const lane = await laneOpen(run, spec.lane);
  if (!lane.open) return { reason: `Lane "${lane.lane}" is paused: ${lane.reason}`, disposition: "hold" };
  if (spec.optout && intent.recipient) {
    const opted = await optedOut(run, spec.optout, intent.recipient, intent.kind);
    if (opted) return { reason: opted, disposition: "cancel" };
  }
  const auth = await verifyAuthority(run, intent, worker);
  if (!auth.ok) return { reason: auth.reason, disposition: auth.disposition };
  return null;
}

async function optedOut(run: Run, channel: "email" | "sms" | "phone", recipient: string, kind: string): Promise<string | null> {
  const rec = recipient.trim().toLowerCase();
  const [o] = await run<{ reason: string; created_at: string }>(`SELECT reason, created_at::text AS created_at FROM communication_optouts WHERE channel = $1 AND address = $2 AND revoked_at IS NULL`, [channel, rec]);
  if (o) return `${rec} opted out of ${channel} (${o.reason || "no reason recorded"}, ${o.created_at.slice(0, 10)}); nothing was sent.`;
  if (channel === "sms") {
    const [t] = await run<{ opted_out: boolean; opted_out_at: string | null }>(`SELECT opted_out, opted_out_at::text AS opted_out_at FROM sms_threads WHERE phone = $1`, [rec]);
    if (t?.opted_out) return `${rec} opted out of texts (STOP${t.opted_out_at ? ` on ${t.opted_out_at.slice(0, 10)}` : ""}); nothing was sent.`;
  }
  if (channel === "email" && kind === "release_newsletter") {
    const [r] = await run<{ active: boolean }>(`SELECT active FROM newsletter_recipients WHERE lower(email) = $1`, [rec]);
    if (r && !r.active) return `${rec} unsubscribed from the newsletter; nothing was sent.`;
  }
  return null;
}

async function settleRefusal(run: Run, intent: ActionIntent, token: string, worker: string, refusal: Refusal): Promise<IntentState | null> {
  if (refusal.disposition === "hold") {
    // Undo this claim's attempt count: a hold is not an attempt.
    await run(`UPDATE action_intents SET attempts = GREATEST(attempts - 1, 0) WHERE id = $1 AND lease_token = $2`, [intent.id, token]);
    await run(`UPDATE action_intents SET state = 'held', hold_reason = $3, lease_token = NULL, lease_until = NULL WHERE id = $1 AND lease_token = $2`, [intent.id, token, refusal.reason.slice(0, 500)]);
    return "held";
  }
  const cls = refusal.disposition === "cancel" ? "skipped" : "permanent";
  const state = await finishAttempt(run, intent.id, token, worker, { responseClass: cls, error: refusal.reason, requestSummary: { refused: true } });
  if (state) {
    await refundAuthorityIfUntransmitted(run, intent.id, `refused before dispatch: ${refusal.reason}`);
    if (intent.grant_id) await recordGrantResultRun(run, intent.grant_id, `refused: ${refusal.reason}`);
  }
  return state;
}

async function recordOutcome(run: Run, intent: ActionIntent, token: string, worker: string, result: ProviderResult, effects: Record<string, Effect>): Promise<IntentState | null> {
  if (result.transmitted) await markTransmitted(run, intent.id);
  const state = await finishAttempt(run, intent.id, token, worker, {
    responseClass: result.responseClass,
    providerRef: result.providerRef ?? null,
    providerState: result.providerState ?? null,
    provider: specFor(intent.kind)?.provider ?? null,
    error: result.error ?? null,
    retryInSeconds: result.retryInSeconds,
    requestSummary: { transmitted: result.transmitted, recipient: intent.recipient },
  });
  if (state === null) {
    // Fenced: our lease was lost before we could write. If the request left
    // the box, the truthful state is "unknown" — someone must reconcile
    // before anything else is sent for this operation.
    if (result.transmitted) {
      await run(
        `UPDATE action_intents SET state = 'unknown', lease_token = NULL, lease_until = NULL,
                last_error = 'a worker transmitted after losing its lease; outcome unknown until reconciled'
          WHERE id = $1 AND state NOT IN ('confirmed','permanent_failure','cancelled')`,
        [intent.id],
      );
    }
    return null;
  }
  if (state === "permanent_failure" || state === "cancelled") {
    await refundAuthorityIfUntransmitted(run, intent.id, `never transmitted: ${result.error ?? state}`);
  }
  if (intent.grant_id) {
    const line = state === "accepted" || state === "confirmed" ? `ok: ${state}${result.providerRef ? ` (${result.providerRef})` : ""}` : state === "unknown" ? `unknown: held for reconciliation — ${result.error ?? ""}` : `${state}: ${result.error ?? ""}`;
    await recordGrantResultRun(run, intent.grant_id, line);
  }
  const effect = effects[intent.kind];
  if (effect) await effect(run, intent, result, state);
  return state;
}

/** Claim exactly these ids (inline dispatch). Same guards as claimIntents. */
async function claimSpecific(run: Run, ids: string[], leaseSeconds: number): Promise<{ token: string; intents: ActionIntent[] }> {
  const token = randomUUID();
  const picked = await run<{ id: string }>(
    `WITH picked AS (
       SELECT id FROM action_intents
        WHERE id = ANY($1::uuid[]) AND state IN ('pending','retryable_failure')
          AND next_attempt_at <= now() AND (lease_until IS NULL OR lease_until < now())
        FOR UPDATE SKIP LOCKED)
     UPDATE action_intents a SET state = 'leased', lease_token = $2, lease_until = now() + ($3::int * interval '1 second'), attempts = attempts + 1
       FROM picked WHERE a.id = picked.id RETURNING a.id`,
    [ids, token, leaseSeconds],
  );
  if (!picked.length) return { token, intents: [] };
  const intents = await run<ActionIntent>(`SELECT ${INTENT_COLS} FROM action_intents WHERE id = ANY($1::uuid[]) ORDER BY created_at`, [picked.map((p) => p.id)]);
  return { token, intents };
}

// ── Reconciliation ───────────────────────────────────────────────────────────

export interface ReconcileResult {
  checked: number;
  confirmed: number;
  failed: number;
  requeued: number;
  stillUnknown: number;
}

/** Ask providers what happened to intents whose outcome we could not
 *  establish. Only reconciliation evidence moves them; a "pending" answer
 *  (provably never happened) makes them dispatchable again. */
export async function reconcileUnknown(deps: DispatchDeps, opts: { limit?: number; minAgeSeconds?: number } = {}): Promise<ReconcileResult> {
  const effects = deps.effects ?? EFFECTS;
  const res: ReconcileResult = { checked: 0, confirmed: 0, failed: 0, requeued: 0, stillUnknown: 0 };
  const rows = await deps.run<ActionIntent & { attempted_at: string | null }>(
    `SELECT ${INTENT_COLS}, (SELECT max(started_at)::text FROM action_attempts t WHERE t.intent_id = action_intents.id) AS attempted_at
       FROM action_intents
      WHERE state IN ('unknown','accepted') AND updated_at < now() - ($1::int * interval '1 second')
      ORDER BY updated_at LIMIT $2`,
    [opts.minAgeSeconds ?? 120, opts.limit ?? 50],
  );
  for (const intent of rows) {
    const spec = specFor(intent.kind);
    const provider = spec ? deps.providers[spec.provider] : null;
    if (!provider?.reconcile) continue;
    res.checked++;
    let outcome;
    try {
      outcome = await provider.reconcile({ id: intent.id, operationKey: intent.operation_key, payload: intent.payload, providerRef: intent.provider_ref, attemptedAt: intent.attempted_at });
    } catch (err) {
      outcome = { state: "unknown" as const, note: `reconcile threw: ${(err as Error).message}` };
    }
    await deps.tx(async (run) => {
      if (outcome.state === "unknown") {
        await run(`UPDATE action_intents SET last_error = $2 WHERE id = $1`, [intent.id, `reconcile: ${outcome.note}`.slice(0, 2000)]);
        res.stillUnknown++;
        return;
      }
      if (outcome.state === "pending") {
        // Nothing transmitted after all: the earlier attempt's transmitted
        // flag was pessimistic. Authority stays spent (it was bound to this
        // intent) and the retry reuses it.
        await reconcileIntent(run, intent.id, { state: "pending", note: `reconcile: ${outcome.note}` });
        res.requeued++;
        return;
      }
      await reconcileIntent(run, intent.id, { state: outcome.state, providerRef: outcome.state === "confirmed" ? outcome.providerRef ?? null : null, providerState: outcome.state === "confirmed" ? outcome.providerState ?? null : null, note: `reconcile: ${outcome.note}` });
      if (outcome.state === "confirmed") {
        res.confirmed++;
        const effect = effects[intent.kind];
        if (effect) await effect(run, intent, { responseClass: "confirmed", providerRef: outcome.providerRef ?? intent.provider_ref, providerState: outcome.providerState ?? null, transmitted: true }, "confirmed");
      } else {
        res.failed++;
        const effect = effects[intent.kind];
        if (effect) await effect(run, intent, { responseClass: "permanent", error: outcome.note, transmitted: true }, "permanent_failure");
      }
    });
  }
  return res;
}

/** Sweep helpers the cron route runs alongside a dispatch pass. */
export async function sweepForDispatch(run: Run): Promise<{ unknown: number; requeued: number; releasedHolds: number }> {
  const swept = await sweepExpiredLeases(run, { retryableKinds: REQUEUE_ON_LEASE_EXPIRY });
  // Intents held for a decision that has since been approved wake up here
  // too (resolveFromChannel wakes them directly; this is the safety net).
  const woke = await run<{ id: string }>(
    `UPDATE action_intents a SET state = 'pending', hold_reason = NULL, next_attempt_at = now()
       FROM decisions d
      WHERE a.decision_id = d.id AND a.state = 'held' AND a.hold_reason LIKE 'awaiting decision%' AND d.status IN ('approved','consumed')
      RETURNING a.id`,
  );
  // Lane pauses lifted → held-for-lane intents of kinds on open lanes wake.
  let lanes = 0;
  for (const kind of ALL_KINDS) {
    const open = await laneOpen(run, KINDS[kind].lane);
    if (!open.open) continue;
    const rows = await run<{ id: string }>(
      `UPDATE action_intents SET state = 'pending', hold_reason = NULL, next_attempt_at = now()
        WHERE state = 'held' AND kind = $1 AND hold_reason LIKE 'Lane "%" is paused%' RETURNING id`,
      [kind],
    );
    lanes += rows.length;
  }
  return { unknown: swept.unknown, requeued: swept.requeued, releasedHolds: woke.length + lanes };
}

export { holdIntent };

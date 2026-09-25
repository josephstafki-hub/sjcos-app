// Dispatch-time authority (A05/A06). The intent says WHAT will go out; this
// module proves, inside the dispatch transaction, that something still
// authorises it RIGHT NOW: an approved decision bound to the same action /
// content / recipient / amount, a live owner grant covering the action +
// target, an ACTIVE policy version, or the owner's own click. The first
// successful dispatch spends the authority and records it in
// intent_authority; later retries of the same intent re-verify (revocation
// bites) but never spend twice. A use is given back only when no provider
// call ever left the box for that intent.
//
// Pure: takes `run`, no db/server imports.

import type { Run } from "../commands/core.ts";
import { consumeDecision, DECISION_COLS, type Decision } from "../commands/decisions.ts";
import type { ActionIntent } from "../commands/intents.ts";
import { activePolicy } from "../commands/policies.ts";
import { grantCovers, isGatedAction, type OwnerGrant } from "../owner-grant-types.ts";
import { specFor } from "./kinds.ts";

export interface IntentAuthority {
  intent_id: string;
  kind: "decision" | "grant" | "policy" | "owner";
  ref: string;
  consumed_at: string;
  transmitted: boolean;
  refunded_at: string | null;
  note: string | null;
}

export type AuthorityCheck =
  | { ok: true; kind: IntentAuthority["kind"]; ref: string; fresh: boolean }
  | { ok: false; reason: string; disposition: "hold" | "cancel" };

const GRANT_COLS = `id, status, actions, target_kind, target_id, scope, reason, requested_by, conversation_id, run_id, max_uses, uses,
  expires_at::text AS expires_at, decided_at::text AS decided_at, used_at::text AS used_at, audit, created_at::text AS created_at`;

/** The `_auth` block a stager may put in the payload to name the gated action
 *  and target the grant/decision was asked for (bulk sends: the grant names
 *  the package, the intent names one recipient). */
interface AuthHint {
  action?: string;
  target_kind?: string;
  target_id?: string;
  to?: string;
  /** Hash of the approved content this per-recipient intent derives from. */
  content_hash?: string;
  amount_cents?: number;
}

function authHint(intent: ActionIntent): AuthHint {
  const a = (intent.payload as { _auth?: AuthHint })._auth;
  return a && typeof a === "object" ? a : {};
}

export async function getIntentAuthority(run: Run, intentId: string): Promise<IntentAuthority | null> {
  const [row] = await run<IntentAuthority>(`SELECT intent_id, kind, ref, consumed_at::text AS consumed_at, transmitted, refunded_at::text AS refunded_at, note FROM intent_authority WHERE intent_id = $1`, [intentId]);
  return row ?? null;
}

/** Verify (and on first dispatch, spend) the authority behind an intent. */
export async function verifyAuthority(run: Run, intent: ActionIntent, worker: string): Promise<AuthorityCheck> {
  const spec = specFor(intent.kind);
  const hint = authHint(intent);
  const action = hint.action ?? spec?.action ?? intent.kind;
  const existing = await getIntentAuthority(run, intent.id);

  if (existing) {
    if (existing.refunded_at) return { ok: false, reason: "The approval behind this action was already given back; it needs a fresh approval.", disposition: "cancel" };
    if (existing.kind === "decision") {
      const [d] = await run<Decision>(`SELECT ${DECISION_COLS} FROM decisions WHERE id = $1`, [existing.ref]);
      if (!d) return { ok: false, reason: "The decision behind this action no longer exists.", disposition: "cancel" };
      if (d.status === "revoked" || d.status === "rejected") return { ok: false, reason: `The decision behind this action was ${d.status}.`, disposition: "cancel" };
      if (d.status !== "approved" && d.status !== "consumed") return { ok: false, reason: `The decision behind this action is ${d.status}.`, disposition: "cancel" };
      return { ok: true, kind: "decision", ref: d.id, fresh: false };
    }
    if (existing.kind === "grant") {
      const [g] = await run<{ status: string }>(`SELECT status FROM owner_grants WHERE id = $1`, [existing.ref]);
      if (!g || g.status !== "approved") return { ok: false, reason: `The permission behind this action was ${g?.status ?? "removed"}.`, disposition: "cancel" };
      return { ok: true, kind: "grant", ref: existing.ref, fresh: false };
    }
    if (existing.kind === "policy") {
      const live = await policyStillActive(run, existing.ref);
      if (!live) return { ok: false, reason: `Policy ${existing.ref} is no longer active; the action is held.`, disposition: "hold" };
    }
    return { ok: true, kind: existing.kind, ref: existing.ref, fresh: false };
  }

  // ── First dispatch: spend something. ──────────────────────────────────────
  if (intent.decision_id) {
    const [d] = await run<Decision>(`SELECT ${DECISION_COLS} FROM decisions WHERE id = $1`, [intent.decision_id]);
    if (!d) return { ok: false, reason: "The decision this action was staged under no longer exists.", disposition: "cancel" };
    if (d.status === "pending") return { ok: false, reason: `awaiting decision ${d.id}`, disposition: "hold" };
    // Bulk decisions name their recipients on the card; a per-recipient intent
    // must be one of them.
    const listed = recipientsOf(d);
    if (!d.recipient && listed.length && intent.recipient && !listed.includes(intent.recipient)) {
      return { ok: false, reason: `${intent.recipient} is not one of the recipients the decision approved.`, disposition: "cancel" };
    }
    const r = await consumeDecision(run, {
      id: d.id,
      action,
      contentHash: hint.content_hash ?? intent.payload_hash,
      recipient: intent.recipient,
      amountCents: hint.amount_cents ?? null,
      targetKind: hint.target_kind ?? intent.target_kind,
      targetId: hint.target_id ?? intent.target_id,
      consumer: worker,
    });
    if (!r.ok) return { ok: false, reason: r.reason, disposition: "cancel" };
    await bind(run, intent.id, "decision", d.id);
    return { ok: true, kind: "decision", ref: d.id, fresh: true };
  }

  if (intent.grant_id) {
    if (!isGatedAction(action)) return { ok: false, reason: `"${action}" is not a gated action a grant can cover.`, disposition: "cancel" };
    const target = { kind: hint.target_kind ?? intent.target_kind ?? "", id: hint.target_id ?? intent.target_id ?? intent.recipient ?? "", to: hint.to ?? intent.recipient ?? undefined };
    const r = await consumeGrantRun(run, intent.grant_id, action, target, `intent ${intent.operation_key}`);
    if (!r.ok) {
      const [g] = await run<{ status: string }>(`SELECT status FROM owner_grants WHERE id = $1`, [intent.grant_id]);
      return { ok: false, reason: r.error, disposition: g?.status === "requested" ? "hold" : "cancel" };
    }
    await bind(run, intent.id, "grant", intent.grant_id);
    return { ok: true, kind: "grant", ref: intent.grant_id, fresh: true };
  }

  if (intent.policy_ref) {
    if (/^owner\b/.test(intent.policy_ref)) {
      await bind(run, intent.id, "owner", intent.policy_ref);
      return { ok: true, kind: "owner", ref: intent.policy_ref, fresh: true };
    }
    const live = await policyStillActive(run, intent.policy_ref);
    if (!live) return { ok: false, reason: `Policy ${intent.policy_ref} is not active; automatic action held until the owner activates it.`, disposition: "hold" };
    await bind(run, intent.id, "policy", intent.policy_ref);
    return { ok: true, kind: "policy", ref: intent.policy_ref, fresh: true };
  }

  return { ok: false, reason: "No decision, grant or active policy is attached to this action.", disposition: "hold" };
}

function recipientsOf(d: Decision): string[] {
  const list = (d.summary as { recipients?: { address?: string }[] })?.recipients;
  if (!Array.isArray(list)) return [];
  return list.map((r) => String(r?.address ?? "").trim().toLowerCase()).filter(Boolean);
}

async function policyStillActive(run: Run, ref: string): Promise<boolean> {
  const m = /^policy:([^@]+)@(\d+)$/.exec(ref);
  if (!m) return false;
  const p = await activePolicy(run, m[1]);
  return Boolean(p && p.version === Number(m[2]));
}

async function bind(run: Run, intentId: string, kind: IntentAuthority["kind"], ref: string): Promise<void> {
  await run(`INSERT INTO intent_authority (intent_id, kind, ref) VALUES ($1, $2, $3) ON CONFLICT (intent_id) DO NOTHING`, [intentId, kind, ref]);
}

export async function markTransmitted(run: Run, intentId: string): Promise<void> {
  await run(`UPDATE intent_authority SET transmitted = true WHERE intent_id = $1`, [intentId]);
}

/** Give the authority back — ONLY when the provider was provably never
 *  called for this intent (no attempt transmitted). Returns what happened. */
export async function refundAuthorityIfUntransmitted(run: Run, intentId: string, note: string): Promise<"refunded" | "kept" | "none"> {
  const a = await getIntentAuthority(run, intentId);
  if (!a) return "none";
  if (a.transmitted || a.refunded_at) return "kept";
  if (a.kind === "grant") {
    await refundGrantUseRun(run, a.ref);
  } else if (a.kind === "decision") {
    await run(
      `UPDATE decisions SET uses = GREATEST(uses - 1, 0), status = CASE WHEN status = 'consumed' THEN 'approved' ELSE status END
        WHERE id = $1 AND status IN ('approved','consumed')`,
      [a.ref],
    );
    await run(`INSERT INTO decision_events (decision_id, kind, actor, detail) VALUES ($1, 'use_released', 'dispatcher', $2::jsonb)`, [a.ref, JSON.stringify({ intentId, note })]);
  } else {
    return "kept";
  }
  await run(`UPDATE intent_authority SET refunded_at = now(), note = $2 WHERE intent_id = $1`, [intentId, note.slice(0, 500)]);
  return "refunded";
}

// ── Owner grants over `run` (mirrors lib/owner-grants.ts, which is pool-bound) ─

export async function getGrantRun(run: Run, id: string): Promise<OwnerGrant | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [g] = await run<OwnerGrant>(`SELECT ${GRANT_COLS} FROM owner_grants WHERE id = $1`, [id]);
  return g ?? null;
}

/** Atomically spend one use of a grant for `action` on `target`. */
export async function consumeGrantRun(
  run: Run,
  grantId: string,
  action: string,
  target: { kind: string; id: string; to?: string },
  note = "",
): Promise<{ ok: true; grant: OwnerGrant } | { ok: false; error: string }> {
  if (!isGatedAction(action)) return { ok: false, error: `"${action}" is not a gated action.` };
  const g = await getGrantRun(run, grantId);
  const covers = grantCovers(g, action, target);
  if (!covers.ok) return covers;
  const entry = { at: new Date().toISOString(), action, target: `${target.kind}:${target.id}`, result: "pending", note };
  const [updated] = await run<OwnerGrant>(
    `UPDATE owner_grants
        SET uses = uses + 1, used_at = now(), updated_at = now(), audit = audit || $2::jsonb
      WHERE id = $1 AND status = 'approved' AND uses < max_uses AND expires_at > now()
      RETURNING ${GRANT_COLS}`,
    [grantId, JSON.stringify([entry])],
  );
  if (!updated) return { ok: false, error: "That permission was spent or revoked a moment ago." };
  return { ok: true, grant: updated };
}

export async function refundGrantUseRun(run: Run, grantId: string): Promise<void> {
  await run(`UPDATE owner_grants SET uses = GREATEST(uses - 1, 0), updated_at = now() WHERE id = $1`, [grantId]);
}

/** Fill the newest 'pending' audit entry with how the use turned out. */
export async function recordGrantResultRun(run: Run, grantId: string, result: string): Promise<void> {
  const g = await getGrantRun(run, grantId);
  if (!g) return;
  const audit = [...(g.audit ?? [])];
  for (let i = audit.length - 1; i >= 0; i--) {
    if (audit[i].result === "pending") {
      audit[i] = { ...audit[i], result: result.slice(0, 300) };
      break;
    }
  }
  await run(`UPDATE owner_grants SET audit = $2::jsonb, updated_at = now() WHERE id = $1`, [grantId, JSON.stringify(audit)]);
}

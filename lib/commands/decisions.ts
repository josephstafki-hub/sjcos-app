// Exact one-tap decisions (A05/A06, A10, A22).
//
// A decision binds WHO may resolve it (owner, or a staff member holding an
// authority grant for this action type / project / amount), WHAT it covers
// (action, target, recipient, amount, content hash, artifact revision) and
// HOW LONG it lives. One decision id is delivered on every channel; the first
// valid tap resolves it everywhere (UPDATE … WHERE status='pending' is the
// race arbiter) and later taps are recorded as replay_ignored. A material
// change to the underlying artifact supersedes the pending decision.
//
// Consuming a decision (consumeDecision) is how a send/charge proves it was
// authorised: the consumer presents the action + content hash + recipient +
// amount it is about to act on; any mismatch refuses. Uses are counted
// atomically. An unknown provider outcome never refunds a use.

import { createHash } from "node:crypto";
import type { Run } from "./core.ts";
import { canonicalJson, redactPrincipal } from "./core.ts";
import { humanOf, isOwner, type Principal } from "./principal.ts";

export type DecisionStatus = "pending" | "approved" | "rejected" | "expired" | "revoked" | "superseded" | "consumed";

export interface Decision {
  id: string;
  kind: string;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  recipient: string | null;
  amount_cents: number | null;
  currency: string;
  content_hash: string | null;
  artifact_revision: string | null;
  project_id: string | null;
  lead_id: string | null;
  title: string;
  summary: Record<string, unknown>;
  href: string | null;
  options: string[];
  status: DecisionStatus;
  requested_by: string;
  decided_by_user_id: string | null;
  decided_via: string | null;
  decided_at: string | null;
  decision_note: string | null;
  expires_at: string;
  max_uses: number;
  uses: number;
  policy_version: string | null;
  dedupe_key: string | null;
  superseded_by: string | null;
  work_item_id: string | null;
  created_at: string;
}

export const DECISION_COLS = `id, kind, action, target_kind, target_id, recipient, amount_cents::bigint AS amount_cents, currency, content_hash,
  artifact_revision, project_id, lead_id, title, summary, href, options, status, requested_by, decided_by_user_id, decided_via,
  decided_at::text AS decided_at, decision_note, expires_at::text AS expires_at, max_uses, uses, policy_version, dedupe_key,
  superseded_by, work_item_id, created_at::text AS created_at`;

/** Review-card summary shape (WORKFLOW W06). Every field is optional so a
 *  small decision (a refund) can carry only what applies, but package
 *  releases are expected to fill recipients/inclusions/exclusions/changes. */
export interface DecisionSummary {
  recipients?: { name: string; address?: string; role?: string }[];
  inclusions?: string[];
  exclusions?: string[];
  quantities?: { label: string; qty: number | string; unit?: string }[];
  attachments?: { label: string; revision?: string; fileId?: string }[];
  assumptions?: string[];
  gaps?: string[];
  changes?: string[];
  effect?: string;
  recommendation?: string;
  [k: string]: unknown;
}

export interface StageDecisionInput {
  kind: string;
  action: string;
  title: string;
  summary: DecisionSummary;
  targetKind?: string | null;
  targetId?: string | number | null;
  recipient?: string | null;
  amountCents?: number | null;
  currency?: string;
  /** The exact content this decision authorises (payload/artifact). Hashed. */
  content?: unknown;
  contentHash?: string | null;
  artifactRevision?: string | null;
  projectId?: string | null;
  leadId?: string | null;
  href?: string | null;
  options?: string[];
  expiresInMinutes?: number;
  maxUses?: number;
  policyVersion?: string | null;
  /** One pending decision per dedupe key; a new revision supersedes the old one. */
  dedupeKey?: string | null;
  workItemId?: string | null;
  requestedBy: Principal;
}

export function contentHashOf(content: unknown): string {
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

/** Stage a decision. Same dedupe key + same content → the existing pending
 *  decision (no duplicate alert). Same key + changed content → the old one is
 *  superseded and a fresh decision is staged. Returns { decision, created,
 *  superseded } so the caller knows whether to notify. */
export async function stageDecision(
  run: Run,
  input: StageDecisionInput,
): Promise<{ decision: Decision; created: boolean; superseded: string | null }> {
  const contentHash = input.contentHash ?? (input.content !== undefined ? contentHashOf(input.content) : null);
  let superseded: string | null = null;
  if (input.dedupeKey) {
    const [existing] = await run<Decision>(
      `SELECT ${DECISION_COLS} FROM decisions WHERE dedupe_key = $1 AND status = 'pending' FOR UPDATE`,
      [input.dedupeKey],
    );
    if (existing) {
      const same =
        existing.content_hash === contentHash &&
        (existing.recipient ?? null) === (input.recipient?.trim().toLowerCase() ?? null) &&
        Number(existing.amount_cents ?? null) === Number(input.amountCents ?? null) &&
        (existing.artifact_revision ?? null) === (input.artifactRevision ?? null);
      if (same) return { decision: existing, created: false, superseded: null };
      superseded = existing.id;
    }
  }
  const [row] = await run<Decision>(
    `INSERT INTO decisions
       (kind, action, target_kind, target_id, recipient, amount_cents, currency, content_hash, artifact_revision, project_id, lead_id,
        title, summary, href, options, requested_by, requested_principal, expires_at, max_uses, policy_version, dedupe_key, work_item_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15::jsonb, $16, $17::jsonb,
             now() + ($18::int * interval '1 minute'), $19, $20, $21, $22)
     RETURNING ${DECISION_COLS}`,
    [
      input.kind,
      input.action,
      input.targetKind ?? null,
      input.targetId == null ? null : String(input.targetId),
      input.recipient?.trim().toLowerCase() ?? null,
      input.amountCents ?? null,
      input.currency ?? "USD",
      contentHash,
      input.artifactRevision ?? null,
      input.projectId ?? null,
      input.leadId ?? null,
      input.title.slice(0, 300),
      JSON.stringify(input.summary ?? {}),
      input.href ?? null,
      JSON.stringify(input.options ?? ["approve", "reject"]),
      labelOf(input.requestedBy),
      JSON.stringify(redactPrincipal(input.requestedBy)),
      Math.max(5, Math.min(input.expiresInMinutes ?? 7 * 24 * 60, 30 * 24 * 60)),
      Math.max(1, input.maxUses ?? 1),
      input.policyVersion ?? null,
      superseded ? null : (input.dedupeKey ?? null),
      input.workItemId ?? null,
    ],
  );
  if (superseded) {
    // Move the dedupe key to the new decision in the same transaction: the
    // old row loses it as it leaves 'pending'.
    await run(`UPDATE decisions SET status = 'superseded', superseded_by = $2, dedupe_key = NULL WHERE id = $1 AND status = 'pending'`, [superseded, row.id]);
    await run(`UPDATE decisions SET dedupe_key = $2 WHERE id = $1`, [row.id, input.dedupeKey]);
    await run(`INSERT INTO decision_events (decision_id, kind, actor, detail) VALUES ($1, 'superseded', $2, $3::jsonb)`, [
      superseded,
      labelOf(input.requestedBy),
      JSON.stringify({ by: row.id }),
    ]);
  }
  await run(`INSERT INTO decision_events (decision_id, kind, actor, detail) VALUES ($1, 'staged', $2, $3::jsonb)`, [
    row.id,
    labelOf(input.requestedBy),
    JSON.stringify({ contentHash, recipient: row.recipient, amountCents: row.amount_cents }),
  ]);
  return { decision: row, created: true, superseded };
}

function labelOf(p: Principal): string {
  if (p.kind === "user") return `${p.role}:${p.name}`;
  if (p.kind === "service") return p.name;
  return p.onBehalfOf ? `${p.agent} for ${p.onBehalfOf.name}` : p.agent;
}

export async function getDecision(run: Run, id: string): Promise<Decision | null> {
  const [row] = await run<Decision>(`SELECT ${DECISION_COLS} FROM decisions WHERE id = $1`, [id]);
  return row ?? null;
}

export async function listPendingDecisions(run: Run, opts: { projectId?: string | null; limit?: number } = {}): Promise<Decision[]> {
  return run<Decision>(
    `SELECT ${DECISION_COLS} FROM decisions
      WHERE status = 'pending' AND expires_at > now() AND ($1::uuid IS NULL OR project_id = $1)
      ORDER BY created_at DESC LIMIT $2`,
    [opts.projectId ?? null, opts.limit ?? 100],
  );
}

// ── Authority ──────────────────────────────────────────────────────────────

export type AuthorityVerdict = { ok: true; via: "owner" | "authority_grant"; grantId?: string } | { ok: false; reason: string };

/** May this principal resolve this decision? Owner: yes. Staff: only with a
 *  live authority_grants row for the decision's action/kind that covers the
 *  project and the amount. Agents inherit their human's authority; an
 *  unattended agent or a service can never resolve a decision. */
export async function authorityFor(run: Run, principal: Principal, decision: Decision): Promise<AuthorityVerdict> {
  const human = humanOf(principal);
  if (!human) return { ok: false, reason: "Only a signed-in person can resolve a decision; agents and services cannot approve their own work." };
  if (isOwner(principal)) return { ok: true, via: "owner" };
  if (human.role !== "staff") return { ok: false, reason: "Portal accounts cannot approve company decisions." };
  // Re-read the account row every time: revocation must bite immediately.
  const [acct] = await run<{ active: boolean; role: string }>(`SELECT active, role FROM users WHERE id = $1`, [human.userId]);
  if (!acct?.active || acct.role !== "staff") return { ok: false, reason: "This account is no longer an active team member." };
  const grants = await run<{ id: string; max_amount_cents: string | null; project_id: string | null }>(
    `SELECT id, max_amount_cents::text AS max_amount_cents, project_id FROM authority_grants
      WHERE user_id = $1 AND revoked_at IS NULL AND action_type IN ($2, $3)
        AND (project_id IS NULL OR project_id = $4)`,
    [human.userId, decision.action, decision.kind, decision.project_id],
  );
  if (!grants.length) return { ok: false, reason: `${human.name} has no approval authority for "${decision.kind}" decisions${decision.project_id ? " on this project" : ""}.` };
  const amount = decision.amount_cents == null ? null : Number(decision.amount_cents);
  const fits = grants.find((g) => g.max_amount_cents == null || amount == null || amount <= Number(g.max_amount_cents));
  if (!fits) return { ok: false, reason: `This decision (${amount == null ? "no amount" : `$${(amount / 100).toFixed(2)}`}) exceeds ${human.name}'s approval limit.` };
  return { ok: true, via: "authority_grant", grantId: fits.id };
}

export interface ResolveInput {
  id: string;
  outcome: "approved" | "rejected";
  principal: Principal;
  via: "app" | "telegram" | "push" | "mcp";
  note?: string | null;
  /** If supplied, the tap is only valid for this content hash (stale buttons). */
  expectedContentHash?: string | null;
}

export type ResolveResult =
  | { ok: true; decision: Decision; first: boolean }
  | { ok: false; code: "not_found" | "unauthorized" | "expired" | "already_resolved" | "stale"; reason: string; decision?: Decision };

/** Resolve a decision exactly once. Repeat taps (any channel) return
 *  already_resolved with the stored outcome and log replay_ignored. */
export async function resolveDecision(run: Run, input: ResolveInput): Promise<ResolveResult> {
  const [d] = await run<Decision>(`SELECT ${DECISION_COLS} FROM decisions WHERE id = $1 FOR UPDATE`, [input.id]);
  if (!d) return { ok: false, code: "not_found", reason: "No such decision." };
  const actor = labelOf(input.principal);
  const log = (kind: string, detail: Record<string, unknown> = {}) =>
    run(`INSERT INTO decision_events (decision_id, kind, actor, channel, detail) VALUES ($1, $2, $3, $4, $5::jsonb)`, [
      d.id,
      kind,
      actor,
      input.via,
      JSON.stringify(detail),
    ]);
  if (input.expectedContentHash && d.content_hash && input.expectedContentHash !== d.content_hash) {
    await log("replay_ignored", { reason: "stale content hash" });
    return { ok: false, code: "stale", reason: "This card is out of date — the package changed after it was sent. Open the current version.", decision: d };
  }
  if (d.status !== "pending") {
    await log("replay_ignored", { status: d.status });
    return { ok: false, code: "already_resolved", reason: `Already ${d.status}${d.decided_at ? ` at ${d.decided_at}` : ""}.`, decision: d };
  }
  if (new Date(d.expires_at).getTime() <= Date.now()) {
    await run(`UPDATE decisions SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [d.id]);
    await log("expired");
    return { ok: false, code: "expired", reason: "This decision expired before it was answered; a fresh card is needed.", decision: d };
  }
  const auth = await authorityFor(run, input.principal, d);
  if (!auth.ok) {
    await log("unauthorized", { reason: auth.reason });
    return { ok: false, code: "unauthorized", reason: auth.reason, decision: d };
  }
  const human = humanOf(input.principal)!;
  const [updated] = await run<Decision>(
    `UPDATE decisions
        SET status = $2, decided_by_user_id = $3, decided_via = $4, decided_at = now(), decision_note = $5
      WHERE id = $1 AND status = 'pending'
      RETURNING ${DECISION_COLS}`,
    [d.id, input.outcome, human.userId, input.via, input.note?.slice(0, 1000) ?? null],
  );
  if (!updated) {
    await log("replay_ignored", { reason: "lost race" });
    return { ok: false, code: "already_resolved", reason: "Someone answered this a moment ago.", decision: (await getDecision(run, d.id))! };
  }
  await log(input.outcome, { via: auth.via, grantId: auth.ok && auth.via === "authority_grant" ? auth.grantId : undefined });
  await run(
    `INSERT INTO owner_touches (kind, actor_user_id, decision_id, project_id, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [input.outcome === "approved" ? "approve" : "reject", human.userId, d.id, d.project_id, JSON.stringify({ via: input.via, kind: d.kind })],
  );
  return { ok: true, decision: updated, first: true };
}

export interface ConsumeInput {
  id: string;
  action: string;
  contentHash?: string | null;
  recipient?: string | null;
  amountCents?: number | null;
  targetKind?: string | null;
  targetId?: string | number | null;
  consumer: string;
}

export type ConsumeResult = { ok: true; decision: Decision } | { ok: false; reason: string };

/** Spend one use of an approved decision for EXACTLY the presented action.
 *  Any mismatch (action, content, recipient, amount, target, expiry, uses)
 *  refuses. The UPDATE's WHERE re-checks status/uses so two concurrent
 *  consumers cannot both succeed on a single-use decision. */
export async function consumeDecision(run: Run, input: ConsumeInput): Promise<ConsumeResult> {
  const [d] = await run<Decision>(`SELECT ${DECISION_COLS} FROM decisions WHERE id = $1 FOR UPDATE`, [input.id]);
  if (!d) return { ok: false, reason: "No such decision." };
  if (d.status !== "approved") return { ok: false, reason: d.status === "pending" ? "That decision is still waiting for approval." : `That decision was ${d.status}.` };
  if (new Date(d.expires_at).getTime() <= Date.now()) return { ok: false, reason: "That approval expired." };
  if (d.uses >= d.max_uses) return { ok: false, reason: "That approval has already been used." };
  if (d.action !== input.action) return { ok: false, reason: `That approval covers ${d.action}, not ${input.action}.` };
  if (d.content_hash && input.contentHash && d.content_hash !== input.contentHash) return { ok: false, reason: "The content changed after it was approved; a fresh approval is required." };
  if (d.content_hash && !input.contentHash) return { ok: false, reason: "This action must present the content it is about to send." };
  const rec = input.recipient?.trim().toLowerCase() ?? null;
  if (d.recipient && rec !== d.recipient) return { ok: false, reason: `That approval is for ${d.recipient}, not ${rec ?? "an unspecified recipient"}.` };
  if (d.amount_cents != null && input.amountCents != null && Number(d.amount_cents) !== Number(input.amountCents)) return { ok: false, reason: "The amount changed after it was approved; a fresh approval is required." };
  if (d.target_id && input.targetId != null && String(input.targetId) !== d.target_id) return { ok: false, reason: `That approval is for ${d.target_kind ?? "target"} ${d.target_id}.` };
  if (d.target_kind && input.targetKind && d.target_kind !== input.targetKind) return { ok: false, reason: `That approval is for a ${d.target_kind}, not a ${input.targetKind}.` };
  const [updated] = await run<Decision>(
    `UPDATE decisions SET uses = uses + 1, status = CASE WHEN uses + 1 >= max_uses THEN 'consumed' ELSE status END
      WHERE id = $1 AND status = 'approved' AND uses < max_uses AND expires_at > now()
      RETURNING ${DECISION_COLS}`,
    [d.id],
  );
  if (!updated) return { ok: false, reason: "That approval was spent a moment ago." };
  await run(`INSERT INTO decision_events (decision_id, kind, actor, detail) VALUES ($1, 'consumed', $2, $3::jsonb)`, [
    d.id,
    input.consumer,
    JSON.stringify({ action: input.action, recipient: rec, amountCents: input.amountCents ?? null, uses: updated.uses }),
  ]);
  return { ok: true, decision: updated };
}

export async function revokeDecision(run: Run, id: string, principal: Principal, reason: string): Promise<boolean> {
  if (!isOwner(principal)) return false;
  const rows = await run(`UPDATE decisions SET status = 'revoked', decision_note = $2 WHERE id = $1 AND status IN ('pending','approved') RETURNING id`, [id, reason]);
  if (rows.length) await run(`INSERT INTO decision_events (decision_id, kind, actor, detail) VALUES ($1, 'revoked', $2, $3::jsonb)`, [id, labelOf(principal), JSON.stringify({ reason })]);
  return rows.length === 1;
}

export async function expireStaleDecisions(run: Run): Promise<number> {
  const rows = await run(`UPDATE decisions SET status = 'expired' WHERE status = 'pending' AND expires_at <= now() RETURNING id`);
  for (const r of rows) await run(`INSERT INTO decision_events (decision_id, kind, actor) VALUES ($1, 'expired', 'sweep')`, [(r as { id: string }).id]);
  return rows.length;
}

export async function recordDelivery(run: Run, decisionId: string, channel: "app" | "telegram" | "push" | "email", externalRef: string | null, status: "queued" | "sent" | "failed" | "updated" = "sent", error?: string | null): Promise<void> {
  await run(
    `INSERT INTO decision_deliveries (decision_id, channel, external_ref, status, error) VALUES ($1, $2, $3, $4, $5)`,
    [decisionId, channel, externalRef, status, error ?? null],
  );
}

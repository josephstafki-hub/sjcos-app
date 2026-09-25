// One resolution path for every channel (app button, Telegram callback, MCP
// wait/answer, future push). Wraps lib/commands/decisions.ts resolveDecision
// — first tap wins, later taps are replay_ignored — and then does the two
// things a resolution must cause: settle a bridged owner grant, and wake or
// cancel the intents parked on this decision. Returns the reply text every
// channel shows ("Approved ✓", "Approved ✓ — already approved 2 min ago").
//
// Pure: `run` only. The Next glue (actions.ts) kicks the dispatcher after
// commit and edits the Telegram card.

import { onDecisionResolved } from "../agent-runtime/hooks.ts";
import type { Run } from "../commands/core.ts";
import { DECISION_COLS, getDecision, resolveDecision, type Decision, type ResolveResult } from "../commands/decisions.ts";
import { isOwner, type Principal } from "../commands/principal.ts";
import { settleGrantFromDecision } from "./grants.ts";

export type Channel = "app" | "telegram" | "push" | "mcp";

export interface ResolveFromChannelInput {
  decisionId: string;
  /** The content hash the button/card was rendered for (stale-card guard). */
  contentHash?: string | null;
  via: Channel;
  principal: Principal;
  outcome: "approved" | "rejected" | "changes_requested";
  note?: string | null;
}

export interface ResolveFromChannelResult {
  ok: boolean;
  code: "approved" | "rejected" | "changes_requested" | "not_found" | "unauthorized" | "expired" | "already_resolved" | "stale";
  reply: string;
  decision: Decision | null;
  /** Intents woken (approved) or cancelled (rejected). */
  intentIds: string[];
  grantId: string | null;
  /** True when THIS call flipped the decision (the winning tap). */
  first: boolean;
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

const VERB: Record<string, string> = { approved: "Approved ✓", rejected: "Rejected", changes_requested: "Changes requested", expired: "Expired", revoked: "Revoked", superseded: "Superseded by a newer card", consumed: "Approved ✓ (already used)" };

export function replyTextFor(r: ResolveResult, requested: ResolveFromChannelInput["outcome"]): string {
  if (r.ok) return requested === "changes_requested" ? "Changes requested — the requester has been told." : requested === "approved" ? "Approved ✓" : "Rejected.";
  switch (r.code) {
    case "already_resolved": {
      const d = r.decision;
      const st = d?.status ?? "resolved";
      const verb = d?.decision_note?.startsWith("Changes requested") ? VERB.changes_requested : VERB[st] ?? st;
      return `${verb} — already ${st === "consumed" ? "approved" : st} ${ago(d?.decided_at ?? null)}${d?.decided_via ? ` via ${d.decided_via}` : ""}.`;
    }
    case "stale":
      return "This card is out of date — the package changed. Open the current card in SJC OS.";
    case "expired":
      return "Expired before it was answered — a fresh card is needed.";
    case "unauthorized":
      return `Not allowed: ${r.reason}`;
    default:
      return r.reason;
  }
}

export async function resolveFromChannel(run: Run, input: ResolveFromChannelInput): Promise<ResolveFromChannelResult> {
  const outcome = input.outcome === "changes_requested" ? "rejected" : input.outcome;
  const note = input.outcome === "changes_requested" ? `Changes requested${input.note?.trim() ? `: ${input.note.trim()}` : ""}` : input.note?.trim() || null;
  const r = await resolveDecision(run, { id: input.decisionId, outcome, principal: input.principal, via: input.via, note, expectedContentHash: input.contentHash ?? null });
  const reply = replyTextFor(r, input.outcome);
  if (!r.ok) {
    return { ok: false, code: r.code, reply, decision: r.decision ?? null, intentIds: [], grantId: null, first: false };
  }
  const d = r.decision;
  if (input.outcome === "changes_requested") {
    await run(`INSERT INTO decision_events (decision_id, kind, actor, channel, detail) VALUES ($1, 'changes_requested', $2, $3, $4::jsonb)`, [d.id, actorOf(input.principal), input.via, JSON.stringify({ note: input.note ?? null })]);
  }
  const grantId = await settleGrantFromDecision(run, d, outcome === "approved" ? "approved" : "rejected");
  let intentIds: string[] = [];
  if (outcome === "approved") {
    const rows = await run<{ id: string }>(
      `UPDATE action_intents SET state = 'pending', hold_reason = NULL, next_attempt_at = now()
        WHERE decision_id = $1 AND state = 'held' RETURNING id`,
      [d.id],
    );
    intentIds = rows.map((x) => x.id);
  } else {
    const rows = await run<{ id: string }>(
      `UPDATE action_intents SET state = 'cancelled', last_error = $2, completed_at = now(), lease_token = NULL, lease_until = NULL
        WHERE decision_id = $1 AND state IN ('held','pending','retryable_failure') RETURNING id`,
      [d.id, note ?? `decision ${outcome}`],
    );
    intentIds = rows.map((x) => x.id);
  }
  // A24: wake the operating agent so the approved (or refused) work resumes
  // without Joe opening the panel. Idempotent on the decision id.
  await onDecisionResolved(run, d.id).catch(() => null);
  return { ok: true, code: input.outcome, reply, decision: d, intentIds, grantId, first: true };
}

function actorOf(p: Principal): string {
  if (p.kind === "user") return `${p.role}:${p.name}`;
  if (p.kind === "service") return p.name;
  return p.onBehalfOf ? `${p.agent} for ${p.onBehalfOf.name}` : p.agent;
}

/** Hold (snooze) a pending decision: it leaves the pending list until
 *  `hours` from now and its expiry is pushed out at least that far. Owner or
 *  an authorised delegate only (checked by the caller via authorityFor). */
export async function holdDecision(run: Run, id: string, hours: number, principal: Principal, note?: string | null): Promise<Decision | null> {
  const h = Math.max(1, Math.min(hours, 24 * 14));
  const [d] = await run<Decision>(
    `UPDATE decisions SET held_until = now() + ($2::int * interval '1 hour'), hold_note = $3,
            expires_at = GREATEST(expires_at, now() + ($2::int * interval '1 hour') + interval '1 hour')
      WHERE id = $1 AND status = 'pending' RETURNING ${DECISION_COLS}`,
    [id, h, note?.slice(0, 500) ?? null],
  );
  if (!d) return null;
  await run(`INSERT INTO decision_events (decision_id, kind, actor, detail) VALUES ($1, 'held', $2, $3::jsonb)`, [id, actorOf(principal), JSON.stringify({ hours: h, note: note ?? null })]);
  return d;
}

/** Owner revocation that reaches everywhere a decision still has effect:
 *  the row (pending / approved / consumed-but-not-yet-transmitted), the
 *  bridged grant, and every intent parked on it that has not transmitted.
 *  lib/commands/decisions.ts revokeDecision only covers pending/approved;
 *  a single-use decision is already 'consumed' the moment its intent is
 *  leased, so revocation must also cancel the intent itself. */
export async function revokeDecisionEverywhere(run: Run, id: string, principal: Principal, reason: string): Promise<{ ok: boolean; cancelledIntents: number }> {
  if (!isOwner(principal)) return { ok: false, cancelledIntents: 0 };
  const rows = await run<{ id: string }>(`UPDATE decisions SET status = 'revoked', decision_note = $2 WHERE id = $1 AND status IN ('pending','approved','consumed') RETURNING id`, [id, reason.slice(0, 1000)]);
  if (!rows.length) return { ok: false, cancelledIntents: 0 };
  await run(`INSERT INTO decision_events (decision_id, kind, actor, detail) VALUES ($1, 'revoked', $2, $3::jsonb)`, [id, actorOf(principal), JSON.stringify({ reason })]);
  await run(`UPDATE owner_grants SET status = 'revoked', decided_at = now(), updated_at = now() WHERE decision_id = $1 AND status IN ('requested','approved')`, [id]);
  const cancelled = await run<{ id: string }>(
    `UPDATE action_intents SET state = 'cancelled', last_error = $2, completed_at = now(), lease_token = NULL, lease_until = NULL
      WHERE decision_id = $1 AND state IN ('held','pending','retryable_failure') RETURNING id`,
    [id, `decision revoked: ${reason}`.slice(0, 500)],
  );
  return { ok: true, cancelledIntents: cancelled.length };
}

export interface DecisionRow extends Decision {
  held_until: string | null;
  hold_note: string | null;
}

/** Pending decisions for the surfaces: not expired, not held (or hold
 *  elapsed), newest first. */
export async function listOpenDecisions(run: Run, opts: { projectId?: string | null; includeHeld?: boolean; limit?: number } = {}): Promise<DecisionRow[]> {
  return run<DecisionRow>(
    `SELECT ${DECISION_COLS}, held_until::text AS held_until, hold_note FROM decisions
      WHERE status = 'pending' AND expires_at > now()
        AND ($1::uuid IS NULL OR project_id = $1)
        AND ($2::boolean OR held_until IS NULL OR held_until <= now())
      ORDER BY created_at DESC LIMIT $3`,
    [opts.projectId ?? null, Boolean(opts.includeHeld), opts.limit ?? 100],
  );
}

export async function recentResolvedDecisions(run: Run, limit = 30): Promise<DecisionRow[]> {
  return run<DecisionRow>(
    `SELECT ${DECISION_COLS}, held_until::text AS held_until, hold_note FROM decisions
      WHERE status <> 'pending' ORDER BY COALESCE(decided_at, updated_at) DESC LIMIT $1`,
    [limit],
  );
}

export { getDecision };

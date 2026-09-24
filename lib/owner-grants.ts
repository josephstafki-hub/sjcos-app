// Owner grants — express permission for agent sends.
//
// The standing rule is that agents draft and stage, and client-/vendor-facing
// sends are owner-approved. A grant is HOW the owner approves one: a row that
// names the action (and optionally the exact target), who asked, how many
// uses, and when it lapses. Every gated send goes through consumeGrant(), so
// there is exactly one place that decides "is this agent allowed to send this
// right now", and the grant's audit column is the proof afterwards.
//
// Three ways a grant comes to exist:
//   • Ask window: Joe ticks "Express permission" on a message → a run-scoped
//     '*' grant (mintRunGrant) that Claude is told about in its prompt.
//   • /engine/permissions: Joe creates one by hand for any MCP client.
//   • An agent calls request_owner_permission → a 'requested' row + a
//     Decision notification; Joe approves/denies on /engine/permissions.

import { query, queryOne } from "@/lib/db";
import { notifyOwner } from "@/lib/notify-owner";
import { runDirect, sessionPrincipal, withTransaction } from "@/lib/commands/db";
import type { Principal } from "@/lib/commands/principal";
import { settleDecisionFromGrant, stageGrantDecision } from "@/lib/decisions/grants";
import { decisionKeyboard } from "@/lib/decisions/telegram";
import { consumeGrantRun, recordGrantResultRun, refundGrantUseRun } from "@/lib/dispatch/authority";

export {
  GATED_ACTIONS,
  ACTION_LABEL,
  ACTION_TARGET_KIND,
  grantCovers,
  isGatedAction,
  type GatedAction,
  type GrantStatus,
  type OwnerGrant,
} from "@/lib/owner-grant-types";
import { GATED_ACTIONS, ACTION_LABEL, ACTION_TARGET_KIND, grantCovers, isGatedAction, type GatedAction, type GrantStatus, type OwnerGrant } from "@/lib/owner-grant-types";

const ISO = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const COLS = `id, status, actions, target_kind, target_id, scope, reason, requested_by,
  conversation_id, run_id, max_uses, uses,
  ${ISO("expires_at")} AS expires_at, ${ISO("decided_at")} AS decided_at,
  ${ISO("used_at")} AS used_at, audit, ${ISO("created_at")} AS created_at, decision_id`;

/** Is a grant currently spendable (approved, unexpired, uses left)? */
export function grantLive(g: OwnerGrant): boolean {
  return g.status === "approved" && g.uses < g.max_uses && new Date(g.expires_at).getTime() > Date.now();
}

export async function getGrant(id: string): Promise<OwnerGrant | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return queryOne<OwnerGrant>(`SELECT ${COLS} FROM owner_grants WHERE id = $1`, [id]);
}

export async function listGrants(limit = 60): Promise<OwnerGrant[]> {
  const { rows } = await query<OwnerGrant>(
    `SELECT ${COLS} FROM owner_grants
      ORDER BY (status = 'requested') DESC, created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/** Owner mints a grant directly (Ask checkbox or /engine/permissions). */
export async function createGrant(input: {
  actions: string[];
  targetKind?: string | null;
  targetId?: string | null;
  scope?: Record<string, unknown>;
  reason?: string;
  requestedBy?: string;
  conversationId?: string | null;
  runId?: string | null;
  maxUses?: number;
  expiresInMinutes?: number;
  status?: GrantStatus;
}): Promise<OwnerGrant> {
  const actions = input.actions.map((a) => a.trim()).filter((a) => a === "*" || isGatedAction(a));
  if (!actions.length) throw new Error("A grant needs at least one gated action (or '*').");
  const mins = Math.max(1, Math.min(input.expiresInMinutes ?? 24 * 60, 7 * 24 * 60));
  const status = input.status ?? "approved";
  const row = await queryOne<OwnerGrant>(
    `INSERT INTO owner_grants
       (status, actions, target_kind, target_id, scope, reason, requested_by,
        conversation_id, run_id, max_uses, expires_at, decided_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10,
             now() + ($11::int * interval '1 minute'),
             CASE WHEN $1 = 'approved' THEN now() ELSE NULL END)
     RETURNING ${COLS}`,
    [
      status,
      actions,
      input.targetKind?.trim() || null,
      input.targetId?.toString().trim() || null,
      JSON.stringify(input.scope ?? {}),
      (input.reason ?? "").trim().slice(0, 1000),
      input.requestedBy ?? "owner",
      input.conversationId ?? null,
      input.runId ?? null,
      Math.max(1, Math.min(input.maxUses ?? 1, 100)),
      mins,
    ],
  );
  return row!;
}

/** Run-scoped "do what I asked in this message" grant from the Ask window's
 *  Express-permission checkbox. Short-lived: it covers one Claude turn (the
 *  runner's own timeout is 8 min). */
export async function mintRunGrant(runId: string, conversationId: string | null, prompt: string): Promise<OwnerGrant> {
  return createGrant({
    actions: ["*"],
    reason: `Express permission given in the Ask window for: "${prompt.replace(/\s+/g, " ").slice(0, 240)}"`,
    requestedBy: "owner",
    conversationId,
    runId,
    maxUses: 25,
    expiresInMinutes: 20,
    status: "approved",
  });
}

/** An agent asks for permission. Lands 'requested' + a Decision notification;
 *  the owner approves/denies on /engine/permissions. */
export async function requestGrant(input: {
  action: string;
  targetId?: string | null;
  reason: string;
  requestedBy?: string;
  conversationId?: string | null;
  workItemId?: string | null;
}): Promise<{ ok: true; grant: OwnerGrant } | { ok: false; error: string }> {
  if (!isGatedAction(input.action)) {
    return { ok: false, error: `Unknown gated action "${input.action}". One of: ${GATED_ACTIONS.join(", ")}.` };
  }
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Say what you want to send and why (reason is required)." };
  const grant = await createGrant({
    actions: [input.action],
    targetKind: ACTION_TARGET_KIND[input.action],
    targetId: input.targetId ?? null,
    reason,
    requestedBy: input.requestedBy ?? "agent",
    conversationId: input.conversationId ?? null,
    maxUses: 1,
    expiresInMinutes: 24 * 60,
    status: "requested",
  });
  // A05/A06 bridge: the same ask is ONE decision row (kind 'grant') so
  // /engine/permissions, /engine/decisions and the Telegram buttons all
  // point at the same thing. Deciding either side settles both.
  const requester: Principal = { kind: "agent", agent: grant.requested_by, runId: null, onBehalfOf: null };
  const staged = await withTransaction((run) => stageGrantDecision(run, grant, requester, { workItemId: input.workItemId ?? null }));
  const withDecision = { ...grant, decision_id: staged.decision.id };
  // notifyOwner writes the same Decision notification emit() used to (the
  // `emit` overrides keep the established card copy) and, when the Telegram
  // channel is configured, pushes to Joe's phone with Approve / Request
  // changes / Hold buttons — a waiting agent is blocked on this decision, so
  // grants skip the hourly push cap (not quiet hours).
  await notifyOwner({
    kind: "grant",
    title: `Grant request: ${ACTION_LABEL[input.action]}${grant.target_id ? ` — ${grant.target_id}` : ""}`,
    body: `Reason: ${reason.slice(0, 160)}`,
    href: `/engine/decisions?d=${staged.decision.id}`,
    emit: {
      title: `${grant.requested_by} asks to: ${ACTION_LABEL[input.action]}${grant.target_id ? ` (${grant.target_id})` : ""}`,
      subline: reason.slice(0, 160),
      href: "/engine/permissions",
    },
    telegram: staged.created ? { buttons: decisionKeyboard(staged.decision.id, staged.decision.content_hash), decisionId: staged.decision.id } : undefined,
  });
  return { ok: true, grant: withDecision };
}

/** Owner decides a grant on /engine/permissions. Settles the bridged
 *  decision the same way (the click IS the resolution), attributed to the
 *  signed-in owner when there is a session. */
export async function decideGrant(
  id: string,
  decision: "approved" | "denied" | "revoked",
  principal?: Principal | null,
): Promise<OwnerGrant | null> {
  const allowedFrom = decision === "revoked" ? ["approved", "requested"] : ["requested"];
  const row = await queryOne<OwnerGrant>(
    `UPDATE owner_grants SET status = $2, decided_at = now(), updated_at = now()
      WHERE id = $1 AND status = ANY($3::text[])
      RETURNING ${COLS}`,
    [id, decision, allowedFrom],
  );
  if (!row) return null;
  try {
    const p = principal ?? (await sessionPrincipal().catch(() => null));
    const by = p && p.kind === "user" ? { userId: p.userId, label: `${p.role}:${p.name}` } : null;
    await withTransaction((run) => settleDecisionFromGrant(run, id, decision, by));
    if (decision !== "approved") {
      // Intents parked on this grant will never be allowed: cancel them.
      await withTransaction((run) => run(`UPDATE action_intents SET state = 'cancelled', last_error = $2, completed_at = now() WHERE grant_id = $1 AND state IN ('held','pending','retryable_failure')`, [id, `grant ${decision}`]));
    } else {
      await withTransaction((run) => run(`UPDATE action_intents SET state = 'pending', hold_reason = NULL, next_attempt_at = now() WHERE grant_id = $1 AND state = 'held'`, [id]));
    }
  } catch (err) {
    console.error("[owner-grants] decision bridge failed:", (err as Error).message);
  }
  return row;
}

/** Atomically spend one use of a grant for `action` on `target`. Returns the
 *  reason when the grant doesn't cover it — phrased so an agent can relay it. */
export async function consumeGrant(
  grantId: string,
  action: GatedAction,
  target: { kind: string; id: string; to?: string },
): Promise<{ ok: true; grant: OwnerGrant } | { ok: false; error: string }> {
  // The decision is the pure rule in lib/owner-grant-types.ts (unit-tested);
  // the UPDATE re-checks status/uses/expiry so two concurrent spends can't
  // both succeed. Since A05/A06 the dispatcher spends grants at dispatch
  // time (lib/dispatch/authority.ts); this pool-bound wrapper remains for
  // callers that still spend up front (document signature).
  return consumeGrantRun(runDirect, grantId, action, target);
}

/** Give a use back when a send failed before anything transmitted (bad id,
 *  missing email, Gmail down). The audit entry stays so the attempt is visible. */
export async function refundGrantUse(grantId: string): Promise<void> {
  try {
    await refundGrantUseRun(runDirect, grantId);
  } catch {
    /* best-effort */
  }
}

/** Record how a consumed use turned out (fills the last 'pending' audit entry). */
export async function recordGrantResult(grantId: string, result: string): Promise<void> {
  try {
    await recordGrantResultRun(runDirect, grantId, result);
  } catch {
    /* audit is best-effort */
  }
}

/** Is the grant (if any) live enough to attach to an intent? Used by the
 *  adapters before staging so a typo'd id fails fast with a relayable
 *  reason instead of a held intent. */
export async function checkGrantCovers(grantId: string, action: GatedAction, target: { kind: string; id: string; to?: string }): Promise<{ ok: true; grant: OwnerGrant } | { ok: false; error: string }> {
  const g = await getGrant(grantId);
  const covers = grantCovers(g, action, target);
  if (!covers.ok) return covers;
  return { ok: true, grant: g! };
}

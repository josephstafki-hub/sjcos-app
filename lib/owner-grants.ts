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
import { emit } from "@/lib/notify";

export {
  GATED_ACTIONS,
  ACTION_LABEL,
  ACTION_TARGET_KIND,
  type GatedAction,
  type GrantStatus,
  type OwnerGrant,
} from "@/lib/owner-grant-types";
import { GATED_ACTIONS, ACTION_LABEL, ACTION_TARGET_KIND, type GatedAction, type GrantStatus, type OwnerGrant } from "@/lib/owner-grant-types";

const ISO = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const COLS = `id, status, actions, target_kind, target_id, scope, reason, requested_by,
  conversation_id, run_id, max_uses, uses,
  ${ISO("expires_at")} AS expires_at, ${ISO("decided_at")} AS decided_at,
  ${ISO("used_at")} AS used_at, audit, ${ISO("created_at")} AS created_at`;

export function isGatedAction(a: string): a is GatedAction {
  return (GATED_ACTIONS as readonly string[]).includes(a);
}

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
  await emit({
    kind: "decision",
    tag: "Permission",
    accent: "ai",
    icon: "shield",
    flagged: true,
    title: `${grant.requested_by} asks to: ${ACTION_LABEL[input.action]}${grant.target_id ? ` (${grant.target_id})` : ""}`,
    subline: reason.slice(0, 160),
    href: "/engine/permissions",
  });
  return { ok: true, grant };
}

export async function decideGrant(
  id: string,
  decision: "approved" | "denied" | "revoked",
): Promise<OwnerGrant | null> {
  const allowedFrom = decision === "revoked" ? ["approved", "requested"] : ["requested"];
  return queryOne<OwnerGrant>(
    `UPDATE owner_grants SET status = $2, decided_at = now(), updated_at = now()
      WHERE id = $1 AND status = ANY($3::text[])
      RETURNING ${COLS}`,
    [id, decision, allowedFrom],
  );
}

/** Atomically spend one use of a grant for `action` on `target`. Returns the
 *  reason when the grant doesn't cover it — phrased so an agent can relay it. */
export async function consumeGrant(
  grantId: string,
  action: GatedAction,
  target: { kind: string; id: string; to?: string },
): Promise<{ ok: true; grant: OwnerGrant } | { ok: false; error: string }> {
  const g = await getGrant(grantId);
  if (!g) {
    return { ok: false, error: "No such owner grant. Ask Joe for express permission first (request_owner_permission)." };
  }
  if (g.status === "requested") {
    return { ok: false, error: "That permission is still waiting for Joe's approval on /engine/permissions." };
  }
  if (g.status !== "approved") return { ok: false, error: `That permission was ${g.status}.` };
  if (new Date(g.expires_at).getTime() <= Date.now()) return { ok: false, error: "That permission has expired — ask again." };
  if (g.uses >= g.max_uses) return { ok: false, error: "That permission has already been used up." };
  if (!g.actions.includes("*") && !g.actions.includes(action)) {
    return { ok: false, error: `That permission covers ${g.actions.join(", ")}, not ${action}.` };
  }
  if (g.target_kind && g.target_kind !== target.kind) {
    return { ok: false, error: `That permission is for a ${g.target_kind}, not a ${target.kind}.` };
  }
  if (g.target_id && g.target_id.toLowerCase() !== target.id.toLowerCase()) {
    return { ok: false, error: `That permission is for ${g.target_kind ?? "target"} ${g.target_id} only.` };
  }
  const scopeTo = typeof g.scope?.to === "string" ? g.scope.to.toLowerCase() : "";
  if (scopeTo && target.to && scopeTo !== target.to.toLowerCase()) {
    return { ok: false, error: `That permission only allows sending to ${String(g.scope.to)}.` };
  }
  const entry = { at: new Date().toISOString(), action, target: `${target.kind}:${target.id}`, result: "pending" };
  const updated = await queryOne<OwnerGrant>(
    `UPDATE owner_grants
        SET uses = uses + 1, used_at = now(), updated_at = now(),
            audit = audit || $2::jsonb
      WHERE id = $1 AND status = 'approved' AND uses < max_uses AND expires_at > now()
      RETURNING ${COLS}`,
    [grantId, JSON.stringify([entry])],
  );
  if (!updated) return { ok: false, error: "That permission was spent or revoked a moment ago." };
  return { ok: true, grant: updated };
}

/** Give a use back when a send failed before anything transmitted (bad id,
 *  missing email, Gmail down). The audit entry stays so the attempt is visible. */
export async function refundGrantUse(grantId: string): Promise<void> {
  try {
    await query(`UPDATE owner_grants SET uses = GREATEST(uses - 1, 0), updated_at = now() WHERE id = $1`, [grantId]);
  } catch {
    /* best-effort */
  }
}

/** Record how a consumed use turned out (fills the last 'pending' audit entry). */
export async function recordGrantResult(grantId: string, result: string): Promise<void> {
  try {
    const g = await getGrant(grantId);
    if (!g) return;
    const audit = [...g.audit];
    for (let i = audit.length - 1; i >= 0; i--) {
      if (audit[i].result === "pending") {
        audit[i] = { ...audit[i], result: result.slice(0, 300) };
        break;
      }
    }
    await query(`UPDATE owner_grants SET audit = $2::jsonb, updated_at = now() WHERE id = $1`, [
      grantId,
      JSON.stringify(audit),
    ]);
  } catch {
    /* audit is best-effort */
  }
}

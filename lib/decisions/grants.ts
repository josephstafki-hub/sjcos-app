// Bridge between the transitional owner_grants and decisions (A05/A06 §4).
//
// An agent's request_owner_permission stages ONE thing Joe sees on both
// /engine/permissions and /engine/decisions: a 'requested' grant and a
// pending decision of kind 'grant' pointing at each other. Deciding either
// side settles both. The decision's content is the grant's exact ask (action,
// target, recipient scope, reason) so a changed target would hash
// differently and supersede the card.
//
// Pure: `run` only.

import type { Run } from "../commands/core.ts";
import { contentHashOf, stageDecision, type Decision, type StageDecisionInput } from "../commands/decisions.ts";
import type { Principal } from "../commands/principal.ts";
import type { OwnerGrant } from "../owner-grant-types.ts";
import { ACTION_LABEL, type GatedAction } from "../owner-grant-types.ts";

export function grantDecisionContent(g: Pick<OwnerGrant, "id" | "actions" | "target_kind" | "target_id" | "scope" | "reason">) {
  return {
    grant_id: g.id,
    actions: [...g.actions].sort(),
    target_kind: g.target_kind ?? null,
    target_id: g.target_id ?? null,
    to: typeof g.scope?.to === "string" ? String(g.scope.to).toLowerCase() : null,
    reason: g.reason,
  };
}

/** Stage (or re-find) the decision that mirrors a requested grant. */
export async function stageGrantDecision(run: Run, g: OwnerGrant, requestedBy: Principal, opts: { workItemId?: string | null } = {}): Promise<{ decision: Decision; created: boolean; superseded: string | null }> {
  const action = g.actions[0] ?? "*";
  const label = action === "*" ? "Any send" : (ACTION_LABEL[action as GatedAction] ?? action);
  const to = typeof g.scope?.to === "string" ? String(g.scope.to) : null;
  const content = grantDecisionContent(g);
  const input: StageDecisionInput = {
    kind: "grant",
    action,
    title: `${g.requested_by} asks to: ${label}${g.target_id ? ` (${g.target_id})` : ""}${to ? ` → ${to}` : ""}`,
    summary: {
      recipients: to ? [{ name: to, address: to }] : [],
      inclusions: [label + (g.target_id ? ` — ${g.target_kind ?? "target"} ${g.target_id}` : "")],
      assumptions: g.reason ? [`Agent's reason: ${g.reason}`] : [],
      effect: `Approving lets ${g.requested_by} perform "${label}"${g.target_id ? ` on ${g.target_kind ?? "target"} ${g.target_id}` : ""}${to ? ` to ${to}` : ""} once (${g.max_uses} use${g.max_uses === 1 ? "" : "s"}), until ${g.expires_at.slice(0, 16).replace("T", " ")}. The send itself still goes through the dispatcher and can be refused there.`,
      grantId: g.id,
    },
    targetKind: g.target_kind ?? null,
    targetId: g.target_id ?? null,
    recipient: to,
    content,
    contentHash: contentHashOf(content),
    href: "/engine/permissions",
    options: ["approve", "reject"],
    expiresInMinutes: Math.max(5, Math.round((new Date(g.expires_at).getTime() - Date.now()) / 60_000)),
    maxUses: g.max_uses,
    dedupeKey: `grant:${g.id}`,
    workItemId: opts.workItemId ?? null,
    requestedBy,
  };
  const staged = await stageDecision(run, input);
  await run(`UPDATE owner_grants SET decision_id = $2, updated_at = now() WHERE id = $1`, [g.id, staged.decision.id]);
  return staged;
}

/** A decision of kind 'grant' was resolved → settle the grant the same way.
 *  Returns the grant id touched, or null. */
export async function settleGrantFromDecision(run: Run, decision: Decision, outcome: "approved" | "rejected" | "revoked"): Promise<string | null> {
  if (decision.kind !== "grant") return null;
  const status = outcome === "approved" ? "approved" : outcome === "rejected" ? "denied" : "revoked";
  const from = outcome === "revoked" ? ["requested", "approved"] : ["requested"];
  const rows = await run<{ id: string }>(
    `UPDATE owner_grants SET status = $2, decided_at = now(), updated_at = now()
      WHERE decision_id = $1 AND status = ANY($3::text[]) RETURNING id`,
    [decision.id, status, from],
  );
  return rows[0]?.id ?? null;
}

/** A grant was decided on /engine/permissions → settle its decision. Writes
 *  the decision row directly (the owner's click on the grant page IS the
 *  resolution; the principal is recorded when known). */
export async function settleDecisionFromGrant(run: Run, grantId: string, outcome: "approved" | "denied" | "revoked", by: { userId: string | null; label: string } | null): Promise<string | null> {
  const [g] = await run<{ decision_id: string | null }>(`SELECT decision_id FROM owner_grants WHERE id = $1`, [grantId]);
  if (!g?.decision_id) return null;
  const status = outcome === "approved" ? "approved" : outcome === "denied" ? "rejected" : "revoked";
  const from = outcome === "revoked" ? ["pending", "approved"] : ["pending"];
  const rows = await run<{ id: string }>(
    `UPDATE decisions SET status = $2, decided_by_user_id = COALESCE($3, decided_by_user_id), decided_via = COALESCE(decided_via, 'app'), decided_at = COALESCE(decided_at, now())
      WHERE id = $1 AND status = ANY($4::text[]) RETURNING id`,
    [g.decision_id, status, by?.userId ?? null, from],
  );
  if (rows.length) {
    await run(`INSERT INTO decision_events (decision_id, kind, actor, channel, detail) VALUES ($1, $2, $3, 'app', $4::jsonb)`, [g.decision_id, status, by?.label ?? "owner", JSON.stringify({ via: "grant page", grantId })]);
  }
  return g.decision_id;
}

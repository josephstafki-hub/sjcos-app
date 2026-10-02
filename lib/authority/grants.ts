// Approval authority — grant / revoke / list / check (A22).
//
// Pure module: every function takes a `run(sql, params)` so node --test can
// drive it against the disposable harness and lib/authority/commands.ts can
// wrap it in a real command transaction. No db import, no server-only.
//
// Rules enforced HERE, on every caller (UI action, MCP, worker, test):
//   • Only a signed-in OWNER (principal.kind === 'user', role 'owner') may
//     grant or revoke. An agent — even one acting for the owner — cannot
//     touch policy/permissions (AuthorityAdminError). Text in an email or a
//     model's suggestion is data; it never reaches this module as a principal.
//   • Nobody may grant themselves authority (self-approval).
//   • action_type must be a delegable catalog kind; 'grant' (authority
//     administration) is owner-only and never a row.
//   • Every change writes a permission_audit row and bumps
//     users.last_permission_change_at; a revoke also revokes sessions so the
//     JWT stops working without re-login.
//   • effectiveAuthority() answers "may this principal approve this action
//     for this project / amount?" for callers that are not resolving a
//     decision row — the same semantics as lib/commands/decisions.ts
//     authorityFor (owner yes; staff only with a live, fitting grant; agents
//     inherit their human; unattended agents/services never).

import type { Run } from "../commands/core.ts";
import { humanOf, isOwner, type Principal, type UserPrincipal } from "../commands/principal.ts";
import { authorityActionDef, isAuthorityActionType, type AuthorityActionType } from "./catalog.ts";

export class AuthorityAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorityAdminError";
  }
}

export interface AuthorityGrant {
  id: string;
  user_id: string;
  action_type: string;
  project_id: string | null;
  project_name: string | null;
  max_amount_cents: string | null;
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  note: string;
}

const GRANT_COLS = `g.id, g.user_id, g.action_type, g.project_id, p.name AS project_name, g.max_amount_cents::text AS max_amount_cents,
  g.granted_by, g.granted_at::text AS granted_at, g.revoked_at::text AS revoked_at, g.revoked_by, g.note`;

/** The only principal that may administer authority: a signed-in owner
 *  account. Not an agent for the owner, not a service, not staff. */
export function assertAuthorityAdmin(principal: Principal): UserPrincipal {
  if (principal.kind !== "user") {
    throw new AuthorityAdminError("Permission and authority changes must be made by the owner in the app — an agent or automation cannot make them, even on the owner's behalf.");
  }
  if (principal.role !== "owner") {
    throw new AuthorityAdminError("Only the owner can grant or revoke approval authority.");
  }
  return principal;
}

export function principalLabelFor(p: Principal): string {
  if (p.kind === "user") return `${p.role}:${p.name}`;
  if (p.kind === "service") return p.name;
  return p.onBehalfOf ? `${p.agent} for ${p.onBehalfOf.name}` : `${p.agent} (unattended)`;
}

export async function auditPermissionChange(
  run: Run,
  input: { actor: Principal; subjectUserId: string | null; change: string; detail?: Record<string, unknown>; commandId?: string | null },
): Promise<void> {
  const h = humanOf(input.actor);
  await run(
    `INSERT INTO permission_audit (actor_user_id, actor_label, subject_user_id, change, detail, command_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [h?.userId ?? null, principalLabelFor(input.actor), input.subjectUserId, input.change, JSON.stringify(input.detail ?? {}), input.commandId ?? null],
  );
  if (input.subjectUserId) {
    await run(`UPDATE users SET last_permission_change_at = now() WHERE id = $1`, [input.subjectUserId]);
  }
}

/** Refuse every JWT for this user minted before now (lib/dal.ts /
 *  lib/api-auth.ts read this). Also refuses a revoked user id at the MCP
 *  principal check for the rest of any live agent run. */
export async function revokeSessions(run: Run, input: { userId: string; by: Principal; reason: string }): Promise<void> {
  const h = humanOf(input.by);
  await run(`INSERT INTO session_revocations (user_id, revoked_before, reason, revoked_by) VALUES ($1, now(), $2, $3)`, [
    input.userId,
    input.reason.slice(0, 300),
    h?.userId ?? null,
  ]);
}

/** Was this user's session (minted at `authAtSeconds`, epoch seconds) revoked
 *  since? Missing auth time = treat as revoked when any revocation exists. */
export async function sessionRevokedSince(run: Run, userId: string, authAtSeconds: number | null | undefined): Promise<boolean> {
  const [row] = await run<{ revoked_before: string | null }>(
    `SELECT max(revoked_before)::text AS revoked_before FROM session_revocations WHERE user_id = $1`,
    [userId],
  );
  if (!row?.revoked_before) return false;
  if (authAtSeconds == null || !Number.isFinite(authAtSeconds)) return true;
  return new Date(row.revoked_before).getTime() > authAtSeconds * 1000;
}

export interface GrantAuthorityInput {
  userId: string;
  actionType: string;
  projectId?: string | null;
  maxAmountCents?: number | null;
  note?: string;
}

/** Grant one action type to a staff account. Idempotent: an identical live
 *  grant (same scope + cap) is returned, not duplicated. */
export async function grantAuthority(
  run: Run,
  principal: Principal,
  input: GrantAuthorityInput,
  opts: { commandId?: string | null } = {},
): Promise<AuthorityGrant> {
  const admin = assertAuthorityAdmin(principal);
  if (admin.userId === input.userId) throw new AuthorityAdminError("You cannot grant authority to your own account.");
  if (!isAuthorityActionType(input.actionType)) throw new AuthorityAdminError(`Unknown approval type "${input.actionType}".`);
  const def = authorityActionDef(input.actionType)!;
  if (def.ownerOnly) throw new AuthorityAdminError(`"${def.label}" can never be delegated.`);
  const cap = input.maxAmountCents == null ? null : Math.floor(Number(input.maxAmountCents));
  if (cap != null && (!Number.isFinite(cap) || cap <= 0)) throw new AuthorityAdminError("The dollar limit must be a positive amount (or blank for no limit).");
  const [subject] = await run<{ id: string; role: string; active: boolean; name: string }>(`SELECT id, role, active, name FROM users WHERE id = $1`, [input.userId]);
  if (!subject) throw new AuthorityAdminError("That user no longer exists.");
  if (subject.role !== "staff") throw new AuthorityAdminError("Approval authority is assigned to team-member (staff) accounts only.");
  if (!subject.active) throw new AuthorityAdminError("Re-enable the account before assigning authority.");
  if (input.projectId) {
    const [p] = await run<{ id: string }>(`SELECT id FROM projects WHERE id = $1`, [input.projectId]);
    if (!p) throw new AuthorityAdminError("That project no longer exists.");
  }
  const [existing] = await run<AuthorityGrant>(
    `SELECT ${GRANT_COLS} FROM authority_grants g LEFT JOIN projects p ON p.id = g.project_id
      WHERE g.user_id = $1 AND g.action_type = $2 AND g.revoked_at IS NULL
        AND g.project_id IS NOT DISTINCT FROM $3 AND g.max_amount_cents IS NOT DISTINCT FROM $4::bigint`,
    [input.userId, input.actionType, input.projectId ?? null, cap],
  );
  if (existing) return existing;
  const [row] = await run<{ id: string }>(
    `INSERT INTO authority_grants (user_id, action_type, project_id, max_amount_cents, granted_by, note)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.userId, input.actionType, input.projectId ?? null, cap, admin.userId, (input.note ?? "").slice(0, 500)],
  );
  await auditPermissionChange(run, {
    actor: principal,
    subjectUserId: input.userId,
    change: "authority.grant",
    detail: { grantId: row.id, actionType: input.actionType, projectId: input.projectId ?? null, maxAmountCents: cap },
    commandId: opts.commandId ?? null,
  });
  const [full] = await run<AuthorityGrant>(`SELECT ${GRANT_COLS} FROM authority_grants g LEFT JOIN projects p ON p.id = g.project_id WHERE g.id = $1`, [row.id]);
  return full;
}

/** Revoke one grant. Sessions of the subject are revoked in the same
 *  transaction so a stale JWT (browser tab, mobile token, Telegram button
 *  resolving through a session) is refused immediately. */
export async function revokeAuthority(
  run: Run,
  principal: Principal,
  input: { grantId: string; reason?: string },
  opts: { commandId?: string | null } = {},
): Promise<AuthorityGrant | null> {
  const admin = assertAuthorityAdmin(principal);
  const [g] = await run<AuthorityGrant>(`SELECT ${GRANT_COLS} FROM authority_grants g LEFT JOIN projects p ON p.id = g.project_id WHERE g.id = $1 FOR UPDATE OF g`, [input.grantId]);
  if (!g) return null;
  if (g.revoked_at) return g;
  await run(`UPDATE authority_grants SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL`, [g.id, admin.userId]);
  await auditPermissionChange(run, {
    actor: principal,
    subjectUserId: g.user_id,
    change: "authority.revoke",
    detail: { grantId: g.id, actionType: g.action_type, projectId: g.project_id, reason: input.reason ?? "" },
    commandId: opts.commandId ?? null,
  });
  await revokeSessions(run, { userId: g.user_id, by: principal, reason: `authority revoked: ${g.action_type}` });
  const [after] = await run<AuthorityGrant>(`SELECT ${GRANT_COLS} FROM authority_grants g LEFT JOIN projects p ON p.id = g.project_id WHERE g.id = $1`, [g.id]);
  return after;
}

/** Live (and optionally revoked) grants for a user. Any signed-in owner may
 *  list; a staff member may list their own. */
export async function listUserAuthority(run: Run, userId: string, opts: { includeRevoked?: boolean } = {}): Promise<AuthorityGrant[]> {
  return run<AuthorityGrant>(
    `SELECT ${GRANT_COLS} FROM authority_grants g LEFT JOIN projects p ON p.id = g.project_id
      WHERE g.user_id = $1 AND ($2::boolean OR g.revoked_at IS NULL)
      ORDER BY (g.revoked_at IS NULL) DESC, g.granted_at DESC`,
    [userId, opts.includeRevoked ?? false],
  );
}

export type EffectiveAuthority = { ok: true; via: "owner" | "authority_grant"; grantId?: string } | { ok: false; reason: string };

export interface AuthorityQuery {
  actionType: AuthorityActionType | string;
  projectId?: string | null;
  amountCents?: number | null;
}

/** May this principal approve/execute `actionType` for this project and
 *  amount? Same semantics as decisions.ts authorityFor, for callers that
 *  hold no decision row (dispatch re-check, MCP gate, UI gating). Re-reads
 *  the account row every time: revocation must bite mid-session. */
export async function effectiveAuthority(run: Run, principal: Principal, q: AuthorityQuery): Promise<EffectiveAuthority> {
  const human = humanOf(principal);
  if (!human) return { ok: false, reason: "Only a signed-in person can approve; agents and automations cannot approve their own work." };
  if (isOwner(principal)) {
    // Even the owner is re-read: a disabled owner row (second owner account) holds nothing.
    const [acct] = await run<{ active: boolean; role: string }>(`SELECT active, role FROM users WHERE id = $1`, [human.userId]);
    if (!acct?.active || acct.role !== "owner") return { ok: false, reason: "This owner account is not active." };
    return { ok: true, via: "owner" };
  }
  if (human.role !== "staff") return { ok: false, reason: "Portal accounts cannot approve company decisions." };
  if (!isAuthorityActionType(q.actionType)) return { ok: false, reason: `"${q.actionType}" is not an approval type anyone can be granted.` };
  if (authorityActionDef(q.actionType)?.ownerOnly) return { ok: false, reason: "Authority administration is owner-only." };
  const [acct] = await run<{ active: boolean; role: string }>(`SELECT active, role FROM users WHERE id = $1`, [human.userId]);
  if (!acct?.active || acct.role !== "staff") return { ok: false, reason: "This account is no longer an active team member." };
  const grants = await run<{ id: string; max_amount_cents: string | null; project_id: string | null }>(
    `SELECT id, max_amount_cents::text AS max_amount_cents, project_id FROM authority_grants
      WHERE user_id = $1 AND revoked_at IS NULL AND action_type = $2
        AND (project_id IS NULL OR project_id = $3)`,
    [human.userId, q.actionType, q.projectId ?? null],
  );
  if (!grants.length) {
    return { ok: false, reason: `${human.name} has no approval authority for "${authorityActionDef(q.actionType)?.label ?? q.actionType}"${q.projectId ? " on this project" : ""}.` };
  }
  const amount = q.amountCents == null ? null : Number(q.amountCents);
  const fits = grants.find((g) => g.max_amount_cents == null || amount == null || amount <= Number(g.max_amount_cents));
  if (!fits) return { ok: false, reason: `${amount == null ? "This" : `$${(amount / 100).toFixed(2)}`} exceeds ${human.name}'s approval limit.` };
  return { ok: true, via: "authority_grant", grantId: fits.id };
}

/** A staff member's whole delegable picture — for the Team editor. */
export async function authoritySummary(run: Run, userId: string): Promise<{ live: AuthorityGrant[]; revoked: AuthorityGrant[] }> {
  const all = await listUserAuthority(run, userId, { includeRevoked: true });
  return { live: all.filter((g) => !g.revoked_at), revoked: all.filter((g) => !!g.revoked_at) };
}

import "server-only";

// App-side authority commands (A22): the pure grants.ts logic wrapped in the
// shared command layer (lib/commands/db.ts) so every grant / revoke is a
// keyed, audited command row with a server-derived principal.

import { command, runDirect, sessionPrincipal } from "@/lib/commands/db";
import type { Principal } from "@/lib/commands/principal";
import { hashInput } from "@/lib/commands/core";
import {
  AuthorityAdminError,
  assertAuthorityAdmin,
  authoritySummary,
  effectiveAuthority,
  grantAuthority,
  listUserAuthority,
  revokeAuthority,
  revokeSessions,
  auditPermissionChange,
  type AuthorityGrant,
  type AuthorityQuery,
  type EffectiveAuthority,
  type GrantAuthorityInput,
} from "./grants";

export { AuthorityAdminError, listUserAuthority, authoritySummary, type AuthorityGrant };

/** Grant as a command. Request key = the exact grant shape, so a double
 *  submit collapses. Only a signed-in owner passes (assertAuthorityAdmin). */
export async function grantAuthorityCommand(principal: Principal, input: GrantAuthorityInput): Promise<AuthorityGrant> {
  assertAuthorityAdmin(principal);
  const key = `authority:grant:${input.userId}:${input.actionType}:${input.projectId ?? "any"}:${input.maxAmountCents ?? "none"}:${hashInput(input).slice(0, 12)}`;
  const { result } = await command<GrantAuthorityInput, AuthorityGrant>(
    { name: "authority.grant", requestKey: key, input, principal, authRef: "owner" },
    async ({ run, commandId }, i) => ({ result: await grantAuthority(run, principal, i, { commandId }) }),
  );
  return result;
}

export async function revokeAuthorityCommand(principal: Principal, input: { grantId: string; reason?: string }): Promise<AuthorityGrant | null> {
  assertAuthorityAdmin(principal);
  const { result } = await command<{ grantId: string; reason?: string }, AuthorityGrant | null>(
    { name: "authority.revoke", requestKey: `authority:revoke:${input.grantId}`, input, principal, authRef: "owner" },
    async ({ run, commandId }, i) => ({ result: await revokeAuthority(run, principal, i, { commandId }) }),
  );
  return result;
}

/** Sign a user out everywhere (every JWT minted before now is refused). */
export async function revokeSessionsCommand(principal: Principal, input: { userId: string; reason: string }): Promise<void> {
  assertAuthorityAdmin(principal);
  await command<{ userId: string; reason: string; at: number }, null>(
    { name: "sessions.revoke", requestKey: `sessions:revoke:${input.userId}:${Date.now()}`, input: { ...input, at: Date.now() }, principal, authRef: "owner" },
    async ({ run, commandId }, i) => {
      await revokeSessions(run, { userId: i.userId, by: principal, reason: i.reason });
      await auditPermissionChange(run, { actor: principal, subjectUserId: i.userId, change: "sessions.revoke", detail: { reason: i.reason }, commandId });
      return { result: null };
    },
  );
}

/** "May the signed-in person approve this?" for UI gating and dispatch
 *  re-checks. Uses the request's session principal; null → refused. */
export async function currentUserAuthority(q: AuthorityQuery): Promise<EffectiveAuthority> {
  const p = await sessionPrincipal();
  if (!p) return { ok: false, reason: "Not signed in." };
  return effectiveAuthority(runDirect, p, q);
}

export async function principalAuthority(principal: Principal, q: AuthorityQuery): Promise<EffectiveAuthority> {
  return effectiveAuthority(runDirect, principal, q);
}

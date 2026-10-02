// MCP principal gate (A08a / A22). Pure: takes a run(sql, params).
//
// The MCP server receives a principal user id from the app (per-run env for
// stdio, X-SJC-Principal-User + bearer for HTTP). Before a gated send tool
// spends an owner grant, the app must ask: is the PERSON behind this agent
// allowed to release this action at all? The owner: yes (the grant is his).
// A staff member: only with a live authority_grants row for the kind the
// gated action maps to (lib/authority/catalog.ts GATED_ACTION_AUTHORITY),
// within the project / amount presented. Unattended (no user): refused —
// an agent with nobody behind it cannot spend anyone's grant on its own.
//
// Integration point (WS-approvals): app/api/internal/owner-grants/route.ts
// "perform" branch, before performGrantedAction():
//
//   const gate = await principalMaySpendGrant(runDirect, body.principal_user_id ?? null, gated_action, { projectId, amountCents });
//   if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason }, { status: 403 });
//
// The MCP server also applies this check itself (mcp/sjcos-mcp.mjs
// grantsCall wrapper) so a staff principal is refused even before the route
// is updated — belt and braces, same function.

import type { Run } from "../commands/core.ts";
import { authorityForGatedAction } from "./catalog.ts";
import { effectiveAuthority } from "./grants.ts";
import { sessionRevokedSince } from "./grants.ts";

export type PrincipalGate = { ok: true; via: "owner" | "authority_grant"; userId: string } | { ok: false; reason: string };

export interface PrincipalRow {
  id: string;
  role: "owner" | "staff" | "sub" | "client";
  name: string;
  active: boolean;
  permissions: string[] | null;
}

/** Load the person behind a principal id. null when unknown / inactive /
 *  revoked since the run started (authAtSeconds = run start). */
export async function loadPrincipalUser(run: Run, userId: string | null | undefined, authAtSeconds?: number | null): Promise<PrincipalRow | null> {
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const [u] = await run<PrincipalRow>(`SELECT id, role, name, active, permissions FROM users WHERE id = $1`, [userId]);
  if (!u || !u.active) return null;
  if (authAtSeconds != null && (await sessionRevokedSince(run, u.id, authAtSeconds))) return null;
  return u;
}

/** May the person behind an agent spend an owner grant for `gatedAction`? */
export async function principalMaySpendGrant(
  run: Run,
  userId: string | null | undefined,
  gatedAction: string,
  scope: { projectId?: string | null; amountCents?: number | null; authAtSeconds?: number | null } = {},
): Promise<PrincipalGate> {
  if (!userId) {
    return { ok: false, reason: "This run has no person behind it, so it cannot spend an owner grant. Ask the owner to run the send from the app." };
  }
  const u = await loadPrincipalUser(run, userId, scope.authAtSeconds ?? null);
  if (!u) return { ok: false, reason: "The account this agent acts for is no longer active or its session was revoked." };
  if (u.role === "owner") return { ok: true, via: "owner", userId: u.id };
  if (u.role !== "staff") return { ok: false, reason: "Portal accounts cannot release company sends." };
  const kind = authorityForGatedAction(gatedAction);
  if (!kind) return { ok: false, reason: `"${gatedAction}" is not something a team member can be delegated; only the owner can release it.` };
  const verdict = await effectiveAuthority(
    run,
    { kind: "user", userId: u.id, role: "staff", name: u.name, permissions: [] },
    { actionType: kind, projectId: scope.projectId ?? null, amountCents: scope.amountCents ?? null },
  );
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  return { ok: true, via: verdict.via, userId: u.id };
}

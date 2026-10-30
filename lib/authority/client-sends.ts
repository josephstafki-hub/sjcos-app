// Client sends a team member releases from the app (A22).
//
// Joe's own click on Send invoice / Send for signature IS the decision — his
// path is untouched. A team member holding the invoices or estimates AREA may
// see and draft those records, but sending one to the client puts money
// paperwork (an invoice, or an offer to sign) in front of the client in the
// company's name. That needs delegated AUTHORITY, the same rule the MCP gate
// applies to an agent acting for them (mcp-gate.ts principalMaySpendGrant),
// so the button and the agent can never disagree:
//   • send_invoice                → catalog GATED_ACTION_AUTHORITY → 'proposal'
//   • send_document_for_signature → 'proposal' (an estimate out for
//                                    signature is an offer to the client)
// checked with effectiveAuthority() for the project and the dollar amount.
//
// Pure: takes run(sql, params) like grants.ts, so node --test drives it
// against the disposable harness.

import type { Run } from "../commands/core.ts";
import type { UserPrincipal } from "../commands/principal.ts";
import { authorityForGatedAction } from "./catalog.ts";
import { effectiveAuthority } from "./grants.ts";

/** The gated action an agent would use for the same send. */
export type ClientSendAction = "send_invoice" | "send_document_for_signature";

/** What a team member sees when they can't release the send. */
export const CLIENT_SEND_REFUSAL = "Joe needs to send this, or give you permission to under Settings › Team.";

export type ClientSendVerdict =
  | { ok: true; via: "owner" }
  | { ok: true; via: "authority_grant"; grantId: string | null; actor: string }
  | { ok: false; error: string; reason: string };

/** The audit actor for a send released under a team member's authority. It
 *  goes into SendAuth.actor, so the send names the person and the authority
 *  grant — never the owner's click. */
export function staffSendActor(userId: string, grantId: string | null | undefined): string {
  return grantId ? `staff:${userId}/authority:${grantId}` : `staff:${userId}`;
}

/** May this signed-in user send `action` to the client for this project and
 *  amount? The owner: yes, as before (no lookup). Anyone else: only with a
 *  live, fitting authority grant. */
export async function clientSendVerdict(
  run: Run,
  user: UserPrincipal,
  action: ClientSendAction,
  scope: { projectId?: string | null; amountCents?: number | null } = {},
): Promise<ClientSendVerdict> {
  if (user.role === "owner") return { ok: true, via: "owner" };
  const kind = authorityForGatedAction(action);
  if (!kind) return { ok: false, error: CLIENT_SEND_REFUSAL, reason: `"${action}" can't be delegated.` };
  const v = await effectiveAuthority(run, user, { actionType: kind, projectId: scope.projectId ?? null, amountCents: scope.amountCents ?? null });
  if (!v.ok) return { ok: false, error: CLIENT_SEND_REFUSAL, reason: v.reason };
  // effectiveAuthority re-reads the row: a non-owner session never comes back "owner".
  if (v.via !== "authority_grant") return { ok: false, error: CLIENT_SEND_REFUSAL, reason: "No delegated authority." };
  return { ok: true, via: "authority_grant", grantId: v.grantId ?? null, actor: staffSendActor(user.userId, v.grantId) };
}

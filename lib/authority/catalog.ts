// Approval authority catalog (A22). The action types a staff account can be
// trusted to approve, mirroring the decision kinds in
// docs/automation-reliability/DECISIONS.md "Action authority matrix". An
// authority_grants row names ONE of these (never '*' — the table refuses it),
// optionally scoped to a project and capped at an amount.
//
// Visibility (lib/permissions.ts areas) and authority (this catalog) are two
// different things: seeing the estimates tab does not let you issue a
// proposal; holding 'proposal' authority does not open tabs you cannot see.
//
// Pure module — no db, no server-only — so the Team editor (client), the
// decision layer and the MCP server can all read it.

export type AuthorityActionType =
  | "package_release"
  | "proposal"
  | "purchase"
  | "payment"
  | "refund"
  | "publication"
  | "schedule"
  | "funding"
  | "markup"
  | "change_order"
  | "design_package"
  | "grant";

export interface AuthorityActionDef {
  key: AuthorityActionType;
  label: string;
  /** One line for the editor — what approving this actually releases. */
  description: string;
  /** A dollar limit makes sense for this kind (shown in the editor). */
  amountBound: boolean;
  /** Never delegable: only the owner may ever hold it (authority administration). */
  ownerOnly?: boolean;
}

export const AUTHORITY_ACTIONS: readonly AuthorityActionDef[] = [
  { key: "package_release", label: "Release scope / bid packages", description: "Send a scope, bid package or supplier pricing request (initial or revised) to subs and suppliers.", amountBound: false },
  { key: "proposal", label: "Issue estimates & proposals", description: "Release a rough estimate, formal proposal or pre-con change to the client.", amountBound: true },
  { key: "purchase", label: "Commit purchases", description: "Accept a binding supplier or sub offer (award a bid, place an order).", amountBound: true },
  { key: "payment", label: "Pay approved bills", description: "Release payment on a matched vendor/sub bill.", amountBound: true },
  { key: "refund", label: "Refund a client payment", description: "Return money to a client on an original payment.", amountBound: true },
  { key: "publication", label: "Publish newsletter / social", description: "Release a newsletter issue or social post to its audience.", amountBound: false },
  { key: "schedule", label: "Confirm construction schedule", description: "Confirm dates with the client and subs (after agreement + initial payment).", amountBound: false },
  { key: "funding", label: "Approve company cash for a project", description: "Let a project spend company money beyond what the client has paid in.", amountBound: true },
  { key: "markup", label: "Change markup / profit targets", description: "Alter default markup or profit targets on estimates.", amountBound: false },
  { key: "change_order", label: "Issue change orders", description: "Send a change order to the client for signature.", amountBound: true },
  { key: "design_package", label: "Present mood boards & selections", description: "Release a mood board or selection package to the client.", amountBound: false },
  { key: "grant", label: "Administer authority (owner only)", description: "Grant or revoke approval authority and areas. Never delegable.", amountBound: false, ownerOnly: true },
];

export const AUTHORITY_ACTION_KEYS: readonly AuthorityActionType[] = AUTHORITY_ACTIONS.map((a) => a.key);

export function isAuthorityActionType(k: string): k is AuthorityActionType {
  return (AUTHORITY_ACTION_KEYS as readonly string[]).includes(k);
}

export function authorityActionDef(k: string): AuthorityActionDef | undefined {
  return AUTHORITY_ACTIONS.find((a) => a.key === k);
}

/** The delegable kinds — everything a staff account may be trusted with. */
export const DELEGABLE_ACTIONS: readonly AuthorityActionDef[] = AUTHORITY_ACTIONS.filter((a) => !a.ownerOnly);

/** Which authority kind a transition-era owner-grant gated action (lib/
 *  owner-grant-types.ts GATED_ACTIONS) maps to. An agent acting FOR a staff
 *  member may spend a grant only when that person holds the matching
 *  authority; the owner needs no mapping. Unmapped actions (send_email,
 *  send_sms, place_call) are one-off communications that no delegable kind
 *  covers today → staff cannot spend them through an agent. */
export const GATED_ACTION_AUTHORITY: Readonly<Record<string, AuthorityActionType | null>> = {
  send_bid_package: "package_release",
  send_purchase_order: "purchase",
  send_invoice: "proposal",
  release_newsletter_issue: "publication",
  release_newsletter_outbox_item: "publication",
  send_document_for_signature: "proposal",
  send_email: null,
  send_sms: null,
  place_call: null,
};

export function authorityForGatedAction(gated: string): AuthorityActionType | null {
  return GATED_ACTION_AUTHORITY[gated] ?? null;
}

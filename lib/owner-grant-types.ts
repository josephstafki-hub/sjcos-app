// Client-safe half of lib/owner-grants.ts: the gated-action catalogue + row
// type + the pure "does this grant cover this call" rule, with no db import so
// UI components and unit tests can use them.

/** Every action an agent needs a grant for. Keep in sync with the MCP tool
 *  surface (mcp/grants-tools.mjs) and lib/agent-sends.ts. */
export const GATED_ACTIONS = [
  "send_bid_package",
  "send_purchase_order",
  "send_invoice",
  "release_newsletter_issue",
  "release_newsletter_outbox_item",
  "send_document_for_signature",
  "send_email",
  "send_sms",
  "place_call",
] as const;
export type GatedAction = (typeof GATED_ACTIONS)[number];

export const ACTION_LABEL: Record<GatedAction, string> = {
  send_bid_package: "Send a bid package to subs",
  send_purchase_order: "Send a purchase order to a vendor",
  send_invoice: "Email an invoice to a client",
  release_newsletter_issue: "Release a queued newsletter issue",
  release_newsletter_outbox_item: "Release one newsletter outbox row",
  send_document_for_signature: "Send a document for signature",
  send_email: "Send an email",
  send_sms: "Send a text message",
  place_call: "Place a phone call (Joe's cell rings first)",
};

/** What each action's target_kind is, for narrowing a grant. */
export const ACTION_TARGET_KIND: Record<GatedAction, string> = {
  send_bid_package: "bid_package",
  send_purchase_order: "purchase_order",
  send_invoice: "invoice",
  release_newsletter_issue: "newsletter_issue",
  release_newsletter_outbox_item: "newsletter_outbox",
  send_document_for_signature: "document_draft",
  send_email: "email", // target_id = recipient address
  send_sms: "phone", // target_id = recipient +E.164
  place_call: "phone", // target_id = the number dialed (+E.164)
};

export type GrantStatus = "requested" | "approved" | "denied" | "revoked";

export interface OwnerGrant {
  id: string;
  status: GrantStatus;
  actions: string[];
  target_kind: string | null;
  target_id: string | null;
  scope: Record<string, unknown>;
  reason: string;
  requested_by: string;
  conversation_id: string | null;
  run_id: string | null;
  max_uses: number;
  uses: number;
  expires_at: string;
  decided_at: string | null;
  used_at: string | null;
  audit: { at: string; action: string; target: string; result: string }[];
  created_at: string;
}

export function isGatedAction(a: string): a is GatedAction {
  return (GATED_ACTIONS as readonly string[]).includes(a);
}

/** Pure decision: may `grant` (null = none found) be spent on `action` for
 *  `target` right now? The ONE rule every gated send runs through
 *  (consumeGrant applies it, then spends atomically). Reasons are phrased so
 *  an agent can relay them to Joe. */
export function grantCovers(
  grant: OwnerGrant | null,
  action: GatedAction,
  target: { kind: string; id: string; to?: string },
  nowMs: number = Date.now(),
): { ok: true } | { ok: false; error: string } {
  if (!grant) {
    return { ok: false, error: "No such owner grant. Ask Joe for express permission first (request_owner_permission)." };
  }
  if (grant.status === "requested") {
    return { ok: false, error: "That permission is still waiting for Joe's approval on /engine/permissions." };
  }
  if (grant.status !== "approved") return { ok: false, error: `That permission was ${grant.status}.` };
  if (new Date(grant.expires_at).getTime() <= nowMs) return { ok: false, error: "That permission has expired — ask again." };
  if (grant.uses >= grant.max_uses) return { ok: false, error: "That permission has already been used up." };
  if (!grant.actions.includes("*") && !grant.actions.includes(action)) {
    return { ok: false, error: `That permission covers ${grant.actions.join(", ")}, not ${action}.` };
  }
  if (grant.target_kind && grant.target_kind !== target.kind) {
    return { ok: false, error: `That permission is for a ${grant.target_kind}, not a ${target.kind}.` };
  }
  if (grant.target_id && grant.target_id.toLowerCase() !== target.id.toLowerCase()) {
    return { ok: false, error: `That permission is for ${grant.target_kind ?? "target"} ${grant.target_id} only.` };
  }
  const scopeTo = typeof grant.scope?.to === "string" ? grant.scope.to.toLowerCase() : "";
  if (scopeTo && target.to && scopeTo !== target.to.toLowerCase()) {
    return { ok: false, error: `That permission only allows sending to ${String(grant.scope.to)}.` };
  }
  return { ok: true };
}

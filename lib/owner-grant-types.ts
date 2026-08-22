// Client-safe half of lib/owner-grants.ts: the gated-action catalogue + row
// type, with no db import so UI components can use them.

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


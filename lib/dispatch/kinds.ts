// Intent kinds the dispatcher knows: which provider carries them, which lane
// kill switch governs them, which opt-out channel is checked at dispatch and
// which gated action name a decision/grant must cover. Pure.

import type { Lane } from "../commands/policies.ts";
import type { ProviderName } from "../providers/index.ts";

export type OptoutChannel = "email" | "sms" | "phone";

export interface KindSpec {
  provider: ProviderName;
  /** Lane whose pause stops new dispatch ('all' always applies). */
  lane: Lane;
  optout: OptoutChannel | null;
  /** Default gated action a decision/grant must name (payload._auth.action overrides). */
  action: string;
  /** Payload keys shown on cards / audit lines (never the whole body). */
  label: string;
}

export const KINDS = {
  send_email: { provider: "email", lane: "sends", optout: "email", action: "send_email", label: "Email" },
  send_invoice: { provider: "email", lane: "sends", optout: "email", action: "send_invoice", label: "Invoice email" },
  send_purchase_order: { provider: "email", lane: "purchases", optout: "email", action: "send_purchase_order", label: "Purchase order email" },
  send_bid_package: { provider: "email", lane: "sends", optout: "email", action: "send_bid_package", label: "Bid package email" },
  release_newsletter: { provider: "email", lane: "publication", optout: "email", action: "release_newsletter_outbox_item", label: "Newsletter email" },
  send_sms: { provider: "sms", lane: "sends", optout: "sms", action: "send_sms", label: "Text message" },
  place_call: { provider: "voice", lane: "sends", optout: "phone", action: "place_call", label: "Phone call" },
  telegram_owner: { provider: "telegram", lane: "agents", optout: null, action: "telegram_owner", label: "Owner push" },
} as const satisfies Record<string, KindSpec>;

export type IntentKind = keyof typeof KINDS;

export const ALL_KINDS = Object.keys(KINDS) as IntentKind[];

/** Kinds whose lease expiry is safe to requeue (a duplicate is harmless). */
export const REQUEUE_ON_LEASE_EXPIRY: IntentKind[] = ["telegram_owner"];

export function specFor(kind: string): KindSpec | null {
  return (KINDS as Record<string, KindSpec>)[kind] ?? null;
}

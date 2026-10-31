// Where a marketing post stands, in Joe's words on its /marketing card,
// from the draft, its approval card and its latest send. Pure.

import { needsOwnerCheck } from "./core.ts";

export type PostStage = "draft" | "awaiting_approval" | "queued" | "posting" | "check" | "posted" | "failed";

export interface PostState {
  status: string;
  decision_status: string | null;
  intent_id: string | null;
  intent_state: string | null;
  intent_error: string | null;
  hold_reason: string | null;
  post_error: string | null;
}

const clean = (s: string | null) => (s ?? "").replace(/^reconcile: /, "").replace(/^CHECK: /, "").trim() || null;

/** The card's stage from the draft, its card and its latest send. */
export function postStage(r: PostState): { stage: PostStage; note: string | null } {
  if (r.status === "posted") return { stage: "posted", note: null };
  if (r.status === "pending_decision") {
    if (r.decision_status === "pending") return { stage: "awaiting_approval", note: null };
    const why: Record<string, string> = { rejected: "You declined it.", expired: "The approval card expired.", superseded: "Edited after you asked; ask again.", revoked: "The approval was taken back." };
    return { stage: "draft", note: why[r.decision_status ?? ""] ?? null };
  }
  if (r.status === "queued" || r.status === "posting") {
    switch (r.intent_state) {
      case "confirmed":
        return { stage: "posted", note: null };
      case "permanent_failure":
      case "cancelled":
        return { stage: "failed", note: clean(r.intent_error) ?? r.post_error };
      case "unknown":
        return { stage: "check", note: clean(r.intent_error) ?? "The agent pressed Post but couldn't confirm it." };
      case "held":
        return { stage: "queued", note: r.hold_reason };
      case "pending":
      case "retryable_failure":
        return { stage: "queued", note: r.intent_error };
      default:
        if (needsOwnerCheck(r.intent_error)) return { stage: "check", note: clean(r.intent_error) };
        return { stage: "posting", note: clean(r.intent_error) };
    }
  }
  if (r.status === "failed") return { stage: "failed", note: r.post_error };
  return { stage: "draft", note: null };
}

// Today v2: triage lane classifier. Pure (no DB) so it can run at read time in
// lib/today.ts, in the queue actions, and be mirrored in the MCP server
// (get_today_queue). An explicit work_items.effort_class always wins; otherwise
// keyword rules decide, defaulting to "quick".

// The lane patterns live in lib/triage-lanes.mjs so mcp/sjcos-mcp.mjs (plain
// ESM, can't import TS) shares the exact same definitions.
import { DEEP_RE, CHAT_RE } from "./triage-lanes.mjs";

export type Lane = "chat" | "quick" | "deep";

/** Keyword rules, checked in order against `${title} ${body}` (lowercased).
 *  First hit wins; default is "quick". An explicit work_items.effort_class
 *  overrides everything. */
export function laneFor(item: {
  title: string;
  body?: string | null;
  effortClass?: string | null;
}): Lane {
  if (item.effortClass === "chat" || item.effortClass === "quick" || item.effortClass === "deep")
    return item.effortClass;
  const hay = `${item.title} ${item.body ?? ""}`.toLowerCase();
  if (DEEP_RE.test(hay)) return "deep";
  if (CHAT_RE.test(hay)) return "chat";
  return "quick";
}

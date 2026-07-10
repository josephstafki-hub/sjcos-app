// Today v2: triage lane classifier. Pure (no DB) so it can run at read time in
// lib/today.ts, in the queue actions, and be mirrored in the MCP server
// (get_today_queue). An explicit work_items.effort_class always wins; otherwise
// keyword rules decide, defaulting to "quick".
//
// KEEP IN LOCKSTEP: mcp/sjcos-mcp.mjs duplicates DEEP_RE / CHAT_RE (the MCP
// server is plain .mjs and can't import this TS module). If you touch the
// regexes here, update them there too.

export type Lane = "chat" | "quick" | "deep";

/** Real page work: money, documents, selections, client-facing steps. */
const DEEP_RE =
  /\b(estimate|invoice|draw|bill|payment|selection|contract|sign|proposal|permit|coi|insurance|upload|photo|drawing|plan|design|order|purchase|schedule the|change order)\b/;

/** An agent can complete it end-to-end with internal MCP writes. */
const CHAT_RE =
  /\b(follow.?up|check.?in|reply|respond|draft|note|log|capture|summar|remind|status|update .*(status|log)|research|look.?up|find out|ask)\b/;

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

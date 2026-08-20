// Today v2: the triage-lane keyword patterns — THE single definition site.
// Plain .mjs (no TS, no imports) so both consumers can load it:
//   • lib/today-triage.ts (the Next app's laneFor classifier)
//   • mcp/sjcos-mcp.mjs   (get_today_queue's laneForMjs — an ESM server that
//     can't import TS modules, which is why these live here and not in
//     lib/today-triage.ts)
// Change a pattern here and both lanes stay in sync by construction.

/** Real page work: money, documents, selections, client-facing steps. */
export const DEEP_RE =
  /\b(estimate|invoice|draw|bill|payment|selection|contract|sign|proposal|permit|coi|insurance|upload|photo|drawing|plan|design|order|purchase|schedule the|change order)\b/;

/** An agent can complete it end-to-end with internal MCP writes. */
export const CHAT_RE =
  /\b(follow.?up|check.?in|reply|respond|draft|note|log|capture|summar|remind|status|update .*(status|log)|research|look.?up|find out|ask)\b/;

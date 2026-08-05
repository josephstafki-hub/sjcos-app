import type { PanelAgent } from "@/lib/dev-agents-meta";

/**
 * Starter chips for an empty panel thread, aware of which app page is on
 * screen. These absorb the per-surface starters the old scattered chat boxes
 * carried (the /ai defaults, the newsletter assistant's list).
 */

const DEFAULT_STARTERS = [
  "What should I focus on today?",
  "Draft a follow-up to a stalled lead.",
  "What COIs expire in the next 30 days?",
];

const CLAUDE_STARTERS = [
  "Fix what I described on the page I was just on.",
  "What files render this route?",
];

const NEWSLETTER_STARTERS = [
  "Who's on the newsletter list right now?",
  "Add a subscriber and start their welcome sequence.",
  "Draft this month's issue from our recent jobs.",
  "Queue the latest draft for release.",
];

export function startersForRoute(pathname: string | null, agent: PanelAgent): string[] {
  if (agent === "claude") return CLAUDE_STARTERS;
  if (pathname?.startsWith("/newsletter")) return NEWSLETTER_STARTERS;
  return DEFAULT_STARTERS;
}

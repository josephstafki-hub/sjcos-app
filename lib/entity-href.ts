// Client-safe: where in the app a change to a given table is best seen.
// Used by the operator panel's live-action navigation — when an agent writes
// and the exact record isn't known (app_change_log carries table names only),
// this picks the section page to open. Null/absent = don't navigate for it
// (audit rows, chat plumbing, tables with no obvious home).

const SCOPE_HREF: Record<string, string> = {
  leads: "/leads",
  lead_activity: "/leads",
  projects: "/projects",
  project_daily_logs: "/projects",
  selections: "/projects",
  selection_options: "/projects",
  mood_boards: "/projects",
  mood_items: "/projects",
  work_items: "/today",
  purchase_orders: "/projects",
  purchase_order_lines: "/projects",
  vendors: "/vendors",
  subs: "/subs",
  compliance_documents: "/compliance",
  knowledge: "/engine",
  skills: "/engine",
  newsletter_recipients: "/newsletter",
  newsletter_issues: "/newsletter",
  newsletter_outbox: "/newsletter",
  newsletter_sequences: "/newsletter",
  document_drafts: "/files",
  chat_messages: "/chat",
  notifications: "/notifications",
};

/** Tables whose writes are agent/audit plumbing, never worth navigating to. */
const IGNORED = new Set([
  "app_change_log",
  "dev_agent_runs",
  "ai_conversations",
  "ai_messages",
  "agent_runs",
  "agent_receipts",
  "sessions",
]);

/** Where a live run is working right now, resolved from its run_effects
 *  (lib/run-focus.ts) — an exact page, unlike the table-level hrefForScope. */
export interface RunFocus {
  href: string;
  /** Human label for the chip: "Miller kitchen · Documents". */
  label: string;
}

export function hrefForScope(scope: string): string | null {
  if (!scope || IGNORED.has(scope)) return null;
  return SCOPE_HREF[scope] ?? null;
}

// Folders and filters for the /engine work queue (Joe, 2026-10-02: "add other
// filters/folder/views for items assigned to different people agents etc").
//
// THE single definition of what each folder holds, written twice side by side:
// matchesQueueFilter() filters the board in the browser, queueFilterSql() the
// Archived view in Postgres (it's paged, so it can't be filtered client-side).
// tests/work-item-archive-db.test.mjs runs both over the same rows and fails if
// they ever disagree. Client-safe: no db, no React — its one import is the
// plain-.mjs assignment rule the MCP server shares.
//
// Two different "who"s live on a to-do, and the folders keep them apart:
//   • PEOPLE — work_item_assignees. Nobody on it = the owner's own (the same
//     rule as Today and MCP list_work_items assigned_to).
//   • AGENTS — assignee_kind 'agent' + assignee_key, the bot runtime that runs
//     it (hermes-telegram, claude-code-server, …).
// An agent's work with nobody on it sits in that agent's folder, not in the
// owner's — it isn't his to do. Put a person on it and it shows in both.

import { isOnItemSql } from "./work-item-assignees.mjs";

export interface QueueFilter {
  /** "all" · "person:<user id>" · "agent:<assignee_key>" ("agent:" alone = an
   *  agent item with no runtime named). */
  who: string;
  /** "" · "project:<slug>" · "lead:<slug>" */
  job: string;
  /** Exact created_by ("inbox-cron", "claude-in-app", …); "" = anyone. */
  by: string;
  /** Free text over the title, details and job name. */
  q: string;
}

export const NO_FILTER: QueueFilter = { who: "all", job: "", by: "", q: "" };

/** The fields a folder or filter looks at — WorkItemView has them all. */
export interface QueueFilterItem {
  title: string;
  body: string;
  assigneeKind: "human" | "agent";
  assigneeKey: string | null;
  /** Empty = the owner's own. */
  assignedTo: { userId: string }[];
  projectSlug: string | null;
  projectName: string | null;
  leadSlug: string | null;
  leadName: string | null;
  createdBy: string;
}

/** The bot runtimes that pick up queue work. Each gets a folder even when it
 *  has nothing on it, so an empty one reads as "nothing waiting", not "gone". */
export const AGENT_RUNTIMES: { key: string; label: string }[] = [
  { key: "hermes-telegram", label: "Hermes" },
  { key: "claude-code-server", label: "Claude Code" },
  { key: "claude-in-app", label: "Claude (in app)" },
  { key: "codex-server", label: "Codex" },
];

export function agentLabel(key: string | null): string {
  if (!key) return "Agent (none named)";
  return AGENT_RUNTIMES.find((a) => a.key === key)?.label ?? key;
}

/** "person:abc" → ["person", "abc"]; "all" → ["all", ""]. */
export function splitWho(who: string): [string, string] {
  const i = who.indexOf(":");
  return i < 0 ? [who, ""] : [who.slice(0, i), who.slice(i + 1)];
}

/** Is `userId` on this to-do? The owner also holds every to-do a person does
 *  with nobody on it. */
export function isOnPerson(item: QueueFilterItem, userId: string, ownerId: string | null): boolean {
  if (item.assignedTo.some((a) => a.userId === userId)) return true;
  return userId === ownerId && item.assignedTo.length === 0 && item.assigneeKind === "human";
}

export function matchesQueueFilter(item: QueueFilterItem, f: QueueFilter, ownerId: string | null): boolean {
  const [kind, key] = splitWho(f.who);
  if (kind === "person" && !isOnPerson(item, key, ownerId)) return false;
  if (kind === "agent" && !(item.assigneeKind === "agent" && (item.assigneeKey ?? "") === key)) return false;

  const [jobKind, slug] = splitWho(f.job);
  if (jobKind === "project" && item.projectSlug !== slug) return false;
  if (jobKind === "lead" && item.leadSlug !== slug) return false;

  if (f.by && item.createdBy !== f.by) return false;

  const q = f.q.trim().toLowerCase();
  if (q && ![item.title, item.body, item.projectName, item.leadName].some((s) => s?.toLowerCase().includes(q)))
    return false;
  return true;
}

/** The same filter as SQL conditions over `work_items w` LEFT JOIN `projects p`
 *  and `leads l`. Values are appended to `params` and bound as $n. A person id
 *  must be a uuid — the caller checks. */
export function queueFilterSql(f: QueueFilter, ownerId: string | null, params: unknown[]): string[] {
  const bind = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const conds: string[] = [];

  const [kind, key] = splitWho(f.who);
  if (kind === "person") {
    const p = bind(key);
    conds.push(
      key === ownerId
        ? `(${isOnItemSql(p)} OR (w.assignee_kind = 'human' AND NOT EXISTS (
             SELECT 1 FROM work_item_assignees wx WHERE wx.work_item_id = w.id)))`
        : isOnItemSql(p),
    );
  }
  if (kind === "agent") conds.push(`w.assignee_kind = 'agent' AND COALESCE(w.assignee_key, '') = ${bind(key)}`);

  const [jobKind, slug] = splitWho(f.job);
  if (jobKind === "project") conds.push(`p.slug = ${bind(slug)}`);
  if (jobKind === "lead") conds.push(`l.slug = ${bind(slug)}`);

  if (f.by) conds.push(`w.created_by = ${bind(f.by)}`);

  const q = f.q.trim();
  if (q) {
    const like = bind(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    conds.push(`(w.title ILIKE ${like} OR w.body ILIKE ${like} OR p.name ILIKE ${like} OR l.name ILIKE ${like})`);
  }
  return conds;
}

/** One folder in the queue's rail. `open` counts what's still to do in it. */
export interface QueueFolder {
  who: string;
  label: string;
  open: number;
}

/** The rail: everything, then each person (owner first), then each agent —
 *  the known runtimes always, plus any other runtime something was filed to. */
export function queueFolders(
  items: (QueueFilterItem & { status: string })[],
  people: { userId: string; name: string }[],
  ownerId: string | null,
): { all: QueueFolder; people: QueueFolder[]; agents: QueueFolder[] } {
  const open = items.filter((i) => i.status !== "done" && i.status !== "cancelled");
  const count = (who: string) => open.filter((i) => matchesQueueFilter(i, { ...NO_FILTER, who }, ownerId)).length;

  const agentKeys = AGENT_RUNTIMES.map((a) => a.key);
  for (const i of items) {
    const k = i.assigneeKey ?? "";
    if (i.assigneeKind === "agent" && !agentKeys.includes(k)) agentKeys.push(k);
  }

  return {
    all: { who: "all", label: "Everything", open: open.length },
    people: people.map((p) => ({ who: `person:${p.userId}`, label: p.name, open: count(`person:${p.userId}`) })),
    agents: agentKeys.map((k) => ({ who: `agent:${k}`, label: agentLabel(k || null), open: count(`agent:${k}`) })),
  };
}

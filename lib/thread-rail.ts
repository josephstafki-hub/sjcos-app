// Client-safe logic for the panel's thread rail (components/panel/ThreadList):
// per-thread status resolution, the pinned / active / settled partition, folder
// grouping, and the route → entity mapping that files a new thread under the
// job whose page the app view is on. No db / server-only imports — pure
// functions over the rows lib/ai-chat.ts listThreadRail() returns, so they are
// unit-testable (tests/thread-rail.test.mjs) and the rail can re-partition
// without a round trip.
//
// The lifecycle model is T3 Code's (docs/thread-folders-plan.md §1):
//   status pill priority  approval > input > working > failed > completed > idle
//   partition             pinned · active · settled   (archived never listed)
//   active ordering       max(created_at, unsettled_at) DESC — activity never
//                         reorders the list; only an explicit re-entry does.

import type { PanelAgent } from "@/lib/dev-agents-meta";

export type ThreadStatus = "approval" | "input" | "working" | "failed" | "completed" | "idle";

export type FolderEntityKind = "project" | "lead" | "vendor" | "sub";

export interface FolderEntityRef {
  kind: FolderEntityKind;
  /** Slug (from a route) or uuid, as text — resolved server-side either way. */
  id: string;
}

export interface RailFolder {
  id: string;
  /** Display name: the row's own name, or the bound entity's name when blank. */
  name: string;
  entityKind: FolderEntityKind | null;
  entityId: string | null;
  /** The bound entity's page, when it resolves. */
  entityHref: string | null;
  collapsed: boolean;
  archivedAt: string | null;
  sortKey: string | null;
}

export interface RailThread {
  id: string;
  agent: PanelAgent;
  title: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
  unsettledAt: string | null;
  settledOverride: "settled" | "active" | null;
  settledAt: string | null;
  archivedAt: string | null;
  pinnedAt: string | null;
  pinOrderKey: string | null;
  /** An owner grant is waiting on Joe (owner_grants 'requested'). */
  needsApproval: boolean;
  /** A question box / CLI permission prompt is waiting (agent_interactions). */
  needsInput: boolean;
  /** A run is pending/running right now. */
  working: boolean;
  /** When the live run started (for the elapsed label). */
  workingSince: string | null;
  /** The newest run in the thread, for unseen completed/failed pills. */
  lastRunId: string | null;
  lastRunStatus: "pending" | "running" | "done" | "error" | null;
  /** When the newest run last wrote (its finish time once done/error). */
  lastRunEndedAt: string | null;
  /** Unfiled threads only: the one job the latest run touched, if exactly one
   *  — the "File under …?" chip. Never applied silently. */
  suggestedFolder: (FolderEntityRef & { name: string }) | null;
}

export interface StatusMeta {
  label: string;
  /** Tailwind classes for the dot. */
  dot: string;
  pulse: boolean;
}

/** Pill styling per status. Tones use the app's semantic palette: flag
 *  (amber-ish red) for approval, info (blue) for input, ai (sage) for working,
 *  flag for failed, money (green) for an unseen completion. */
export const STATUS_META: Record<ThreadStatus, StatusMeta> = {
  approval: { label: "Needs approval", dot: "bg-flag", pulse: true },
  input: { label: "Awaiting your answer", dot: "bg-info", pulse: true },
  working: { label: "Working", dot: "bg-ai", pulse: true },
  failed: { label: "Failed", dot: "bg-flag", pulse: false },
  completed: { label: "Done — unread", dot: "bg-money", pulse: false },
  idle: { label: "", dot: "", pulse: false },
};

/**
 * One status per thread, in T3's strict priority. A finished run only reads
 * as "done-unread"/"failed" when it ended after `sinceMs` (this tab's start —
 * older history is not news) and `seen(runId)` hasn't been stamped by opening
 * the thread here; the open thread is always "seen" — its transcript is on
 * screen.
 */
export function resolveThreadStatus(
  t: Pick<
    RailThread,
    "needsApproval" | "needsInput" | "working" | "lastRunId" | "lastRunStatus" | "lastRunEndedAt" | "id"
  >,
  opts: { seen: (runId: string) => boolean; currentId: string | null; sinceMs?: number },
): ThreadStatus {
  if (t.needsApproval) return "approval";
  if (t.needsInput) return "input";
  if (t.working) return "working";
  const fresh = opts.sinceMs == null || ms(t.lastRunEndedAt) >= opts.sinceMs;
  const unseen = fresh && t.lastRunId != null && t.id !== opts.currentId && !opts.seen(t.lastRunId);
  if (unseen && t.lastRunStatus === "error") return "failed";
  if (unseen && t.lastRunStatus === "done") return "completed";
  return "idle";
}

const STATUS_RANK: Record<ThreadStatus, number> = {
  approval: 0,
  input: 1,
  working: 2,
  failed: 3,
  completed: 4,
  idle: 5,
};

/** The most urgent of several statuses (a folder header's roll-up). */
export function rollupStatus(statuses: ThreadStatus[]): ThreadStatus {
  let best: ThreadStatus = "idle";
  for (const s of statuses) if (STATUS_RANK[s] < STATUS_RANK[best]) best = s;
  return best;
}

/** Whether a thread is blocked from settle/archive right now. */
export function isThreadBusy(t: Pick<RailThread, "needsApproval" | "needsInput" | "working">): boolean {
  return t.working || t.needsApproval || t.needsInput;
}

/** Epoch ms from a pg `timestamptz::text` ("2026-09-14 19:48:02.453+00") or
 *  an ISO string. pg's short "+00" zone suffix is not valid for Date.parse —
 *  it is normalised to "+00:00". 0 for null/unparseable. */
export function ms(ts: string | null | undefined): number {
  if (!ts) return 0;
  let s = ts.includes("T") ? ts : ts.replace(" ", "T");
  s = s.replace(/([+-]\d\d)$/, "$1:00");
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Active-list anchor: creation, re-anchored on explicit re-entry only. */
export function activeAnchorMs(t: Pick<RailThread, "createdAt" | "unsettledAt">): number {
  return Math.max(ms(t.createdAt), ms(t.unsettledAt));
}

/** Settled shelf sort key: when the work ended. */
export function settledAnchorMs(
  t: Pick<RailThread, "settledAt" | "lastActivityAt" | "updatedAt">,
): number {
  return ms(t.settledAt) || ms(t.lastActivityAt) || ms(t.updatedAt);
}

export interface ThreadPartition {
  pinned: RailThread[];
  active: RailThread[];
  settled: RailThread[];
}

/**
 * pinned · active · settled, each sorted. Archived rows are dropped (they are
 * listed by a separate query). `forceId` (the open thread) is always kept in
 * whichever bucket it belongs to — the caller un-collapses the shelf for it.
 */
export function partitionThreads(threads: RailThread[]): ThreadPartition {
  const pinned: RailThread[] = [];
  const active: RailThread[] = [];
  const settled: RailThread[] = [];
  for (const t of threads) {
    if (t.archivedAt) continue;
    if (t.settledOverride === "settled") settled.push(t);
    else if (t.pinnedAt) pinned.push(t);
    else active.push(t);
  }
  // Keyed pins first in key order, then keyless pins newest-pinned first.
  pinned.sort((a, b) => {
    if (a.pinOrderKey && b.pinOrderKey) return a.pinOrderKey < b.pinOrderKey ? -1 : a.pinOrderKey > b.pinOrderKey ? 1 : 0;
    if (a.pinOrderKey) return -1;
    if (b.pinOrderKey) return 1;
    return ms(b.pinnedAt) - ms(a.pinnedAt);
  });
  active.sort((a, b) => activeAnchorMs(b) - activeAnchorMs(a) || (a.id < b.id ? -1 : 1));
  settled.sort((a, b) => settledAnchorMs(b) - settledAnchorMs(a) || (a.id < b.id ? -1 : 1));
  return { pinned, active, settled };
}

export interface RailGroup {
  /** null = Unfiled. */
  folder: RailFolder | null;
  key: string;
  name: string;
  threads: ThreadPartition;
  /** Newest activity of any thread inside — the group's sort key. */
  activityMs: number;
  count: number;
}

export const UNFILED_KEY = "__unfiled";

/** Manual folder order: `sortKey` (zero-padded index written on a drag
 *  reorder) first, keyed folders above unkeyed, then the list's own order
 *  (creation). Stable across activity. */
export function compareFolderOrder(a: RailFolder, b: RailFolder, listOrder: Map<string, number>): number {
  const ak = a.sortKey ?? null;
  const bk = b.sortKey ?? null;
  if (ak && bk && ak !== bk) return ak < bk ? -1 : 1;
  if (ak && !bk) return -1;
  if (!ak && bk) return 1;
  return (listOrder.get(a.id) ?? 0) - (listOrder.get(b.id) ?? 0);
}

/** Folders in rail order (the same order groupThreads renders). */
export function orderedFolders(folders: RailFolder[]): RailFolder[] {
  const order = new Map(folders.map((f, i) => [f.id, i]));
  return folders.filter((f) => !f.archivedAt).sort((a, b) => compareFolderOrder(a, b, order));
}

/** Zero-padded keys for a full manual order (one row per folder). */
export function sortKeysFor(ids: string[]): { id: string; sortKey: string }[] {
  return ids.map((id, i) => ({ id, sortKey: String(i + 1).padStart(6, "0") }));
}

/**
 * Group threads under their folders. Unfiled always comes first; folders sit
 * below it in a fixed manual order (`sortKey`, then creation order) — activity
 * never moves a folder, so the rail stays where your hands expect it. Empty
 * folders still render so a fresh job folder is visible; archived folders are
 * dropped along with their threads (they live behind "Show archived").
 */
export function groupThreads(folders: RailFolder[], threads: RailThread[]): RailGroup[] {
  const byFolder = new Map<string, RailThread[]>();
  const archivedFolders = new Set(folders.filter((f) => f.archivedAt).map((f) => f.id));
  const unfiled: RailThread[] = [];
  for (const t of threads) {
    if (t.archivedAt) continue;
    if (t.folderId && archivedFolders.has(t.folderId)) continue;
    if (t.folderId) {
      const list = byFolder.get(t.folderId) ?? [];
      list.push(t);
      byFolder.set(t.folderId, list);
    } else unfiled.push(t);
  }
  const groups: RailGroup[] = [];
  for (const f of folders) {
    if (f.archivedAt) continue;
    const list = byFolder.get(f.id) ?? [];
    groups.push({
      folder: f,
      key: f.id,
      name: f.name,
      threads: partitionThreads(list),
      activityMs: Math.max(0, ...list.map((t) => ms(t.lastActivityAt) || ms(t.updatedAt))),
      count: list.filter((t) => t.settledOverride !== "settled").length,
    });
  }
  // Threads whose folder row is missing (deleted concurrently) fall to Unfiled.
  const known = new Set(folders.map((f) => f.id));
  for (const [fid, list] of byFolder) if (!known.has(fid)) unfiled.push(...list);
  if (unfiled.length || groups.length === 0) {
    groups.push({
      folder: null,
      key: UNFILED_KEY,
      name: "Unfiled",
      threads: partitionThreads(unfiled),
      activityMs: Math.max(0, ...unfiled.map((t) => ms(t.lastActivityAt) || ms(t.updatedAt))),
      count: unfiled.filter((t) => t.settledOverride !== "settled").length,
    });
  }
  const order = new Map(folders.map((f, i) => [f.id, i]));
  groups.sort((a, b) => {
    if (!a.folder) return -1;
    if (!b.folder) return 1;
    return compareFolderOrder(a.folder, b.folder, order);
  });
  return groups;
}

/**
 * The job an app route is about, for filing a new thread: /projects/<slug>,
 * /leads/<slug>, /vendors/<slug>, /subs/<slug>. Anything else (lists, /today,
 * settings) → null → the thread starts Unfiled (or in the scoped folder).
 */
export function entityFromRoute(pathname: string | null | undefined): FolderEntityRef | null {
  if (!pathname) return null;
  const m = /^\/(projects|leads|vendors|subs)\/([^/?#]+)/.exec(pathname);
  if (!m) return null;
  const kind = ({ projects: "project", leads: "lead", vendors: "vendor", subs: "sub" } as const)[
    m[1] as "projects" | "leads" | "vendors" | "subs"
  ];
  try {
    return { kind, id: decodeURIComponent(m[2]) };
  } catch {
    return { kind, id: m[2] };
  }
}

/** "3m" / "1h 20m" for a working pill. */
export function formatElapsed(sinceIso: string | null, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms(sinceIso)) / 1000));
  if (!ms(sinceIso)) return "";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

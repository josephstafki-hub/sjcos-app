"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderInput,
  FolderPlus,
  Link2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  archiveConversationAction,
  archiveFolderAction,
  bindFolderAction,
  createFolderAction,
  deleteConversationAction,
  deleteFolderAction,
  ensureEntityFolderAction,
  fileConversationUnderAction,
  listArchivedThreadsAction,
  listThreadRailAction,
  moveConversationAction,
  pinConversationAction,
  reorderFoldersAction,
  renameConversationAction,
  renameFolderAction,
  setFolderCollapsedAction,
  settleConversationAction,
  unsettleConversationAction,
} from "@/lib/actions/ai-chat";
import { AGENT_META } from "@/lib/dev-agents-meta";
import {
  STATUS_META,
  entityFromRoute,
  formatElapsed,
  groupThreads,
  ms,
  orderedFolders,
  sortKeysFor,
  resolveThreadStatus,
  rollupStatus,
  type RailFolder,
  type RailThread,
  type ThreadStatus,
} from "@/lib/thread-rail";
import type { JobPick } from "@/lib/thread-folders";
import { JobPicker } from "./JobPicker";
import { postPanelMessage, requestAppNav, subscribePanelBus } from "./panelBus";
import { isRunSeen, markRunSeen, panelTabStartedAt, readPanelState } from "./panelStore";

/** "2m" / "3h" / "5d" / "Aug 12" from a pg timestamptz::text. */
function timeAgo(ts: string | null, now: number): string {
  const t = ms(ts);
  if (!t) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const SETTLED_INITIAL = 10;
const SETTLED_PAGE = 25;

/**
 * The panel's thread navigator, T3-style (docs/thread-folders-plan.md):
 * threads grouped under nameable folders (one per job, bound to the project /
 * lead so the name follows it), each group partitioned pinned · active ·
 * ▸ Settled, with one status dot per thread in strict priority — needs
 * approval, awaiting your answer, working (pulsing, with elapsed time), failed,
 * done-unread. Active order never moves on activity; only a new thread or an
 * explicit un-settle re-anchors. Archived threads/folders live behind "Show
 * archived".
 *
 * One component, two placements: a persistent rail beside the chat when the
 * dock/popout is wide enough ("rail"), and the History overlay on narrow docks
 * and mobile ("drawer"). Clicking a folder name scopes the rail to it (per
 * tab) and new chats file under it; the scope also lets a second tab sit on a
 * different job.
 */
export function ThreadList({
  currentId,
  onOpen,
  onNew,
  onClose,
  onCurrentRemoved,
  variant,
  refreshKey,
  scopeFolderId,
  onScopeChange,
  pageRoute,
  className = "",
}: {
  /** The open thread, for highlight. */
  currentId: string | null;
  onOpen: (id: string) => void;
  /** New chat; `folderId` files it there (scope or a folder's "+"). */
  onNew: (folderId?: string | null) => void;
  /** Drawer only: the ✕ that closes the overlay. */
  onClose?: () => void;
  /** The open thread was archived/deleted from the list — fall to a new chat. */
  onCurrentRemoved: () => void;
  variant: "rail" | "drawer";
  /** Any value change triggers a reload (e.g. a settled turn retitles). */
  refreshKey?: string;
  /** This tab's folder scope (panelStore). */
  scopeFolderId: string | null;
  onScopeChange: (folderId: string | null) => void;
  /** The app view's route — a project/lead page highlights its folder. */
  pageRoute?: string | null;
  className?: string;
}) {
  const [folders, setFolders] = useState<RailFolder[]>([]);
  const [threads, setThreads] = useState<RailThread[]>([]);
  const [archived, setArchived] = useState<RailThread[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [flash, setFlash] = useState("");
  /** Per-group "Settled" shelf open state + how many rows it shows. */
  const [shelf, setShelf] = useState<Record<string, { open: boolean; count: number }>>({});
  /** Client-only collapse for the Unfiled group (folders persist theirs). */
  const [unfiledCollapsed, setUnfiledCollapsed] = useState(false);
  const [menu, setMenu] = useState<{ kind: "thread" | "folder"; id: string } | null>(null);
  const [mover, setMover] = useState<string | null>(null);
  /** The job picker: link a folder to a job, or start a new folder (for a
   *  job, or free-standing by typing a name). `thenMove` files that thread
   *  into the resulting folder. */
  /** Drag-and-drop filing: the thread being dragged, and the folder key
   *  ("unfiled" or a folder id) the pointer is over. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  /** Folder reorder by drag: the folder header being dragged, and where it
   *  would land (before/after another folder). */
  const [dragFolderId, setDragFolderId] = useState<string | null>(null);
  const [folderDrop, setFolderDrop] = useState<{ id: string; pos: "before" | "after" } | null>(null);
  const [picker, setPicker] = useState<{ mode: "link"; folderId: string } | { mode: "new"; thenMove?: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** Completions older than this tab are history, not "new". Read on each
   *  reload (sessionStorage is client-only, so never during render). */
  const [sinceMs, setSinceMs] = useState<number | null>(null);
  // The latest reload wins; a stale slow response must not clobber a newer one.
  const seqRef = useRef(0);
  const router = useRouter();

  /** Open an app page: locally when docked, via the app window when this
   *  rail lives in the detached /panel window. */
  const openHref = (href: string) => {
    if (readPanelState().where === "window") requestAppNav(href);
    else router.push(href);
  };

  const flashNotice = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((n) => (n === msg ? "" : n)), 3000);
  };

  const reload = async () => {
    const seq = ++seqRef.current;
    const [rail, arch] = await Promise.all([
      listThreadRailAction(),
      showArchived ? listArchivedThreadsAction() : Promise.resolve(null),
    ]);
    if (seq !== seqRef.current) return;
    setFolders(rail.folders);
    setThreads(rail.threads);
    setArchived(arch);
    setLoaded(true);
    setNow(Date.now());
    setSinceMs(panelTabStartedAt());
  };

  // Reload on triggers, plus a slow tick: an abandoned thread's run settles
  // server-side with no client polling it, so its status (and the relative
  // times) refresh here rather than never.
  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived, refreshKey]);

  // Elapsed labels on working rows tick without a round trip.
  useEffect(() => {
    if (!threads.some((t) => t.working)) return;
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, [threads]);

  // Run start/end or a thread/folder edit anywhere (this window or the popout)
  // moves rows and flips dots — refresh so the list tracks other windows' work.
  useEffect(
    () =>
      subscribePanelBus((m) => {
        if (m.type === "run" || m.type === "threads") void reload();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showArchived],
  );

  // The open thread's result is on screen — its latest run counts as seen so
  // it never shows "done-unread" here once Joe steps away from it.
  useEffect(() => {
    if (!currentId) return;
    const cur = threads.find((t) => t.id === currentId);
    if (cur?.lastRunId && !cur.working) markRunSeen(cur.lastRunId);
  }, [currentId, threads]);

  // Close any open menu on outside click / Escape.
  useEffect(() => {
    if (!menu && !mover && !picker) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      setMenu(null);
      setMover(null);
      setPicker(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu, mover, picker]);

  /** After a mutation: reload here and tell other windows' rails. */
  const changed = async () => {
    postPanelMessage({ type: "threads" });
    await reload();
  };

  // ─── Thread actions ────────────────────────────────────────────────────────

  const rename = async (id: string, current: string) => {
    const next = window.prompt("Rename conversation", current);
    if (next && next.trim()) {
      await renameConversationAction(id, next.trim());
      await changed();
    }
  };

  const setArchivedThread = async (id: string, value: boolean) => {
    const r = await archiveConversationAction(id, value);
    if (!r.ok) return flashNotice(r.error ?? "Couldn't archive.");
    if (value && id === currentId) onCurrentRemoved();
    await changed();
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this conversation permanently?")) return;
    await deleteConversationAction(id);
    if (id === currentId) onCurrentRemoved();
    await changed();
  };

  const settle = async (id: string) => {
    const r = await settleConversationAction(id);
    if (!r.ok) return flashNotice(r.error ?? "Couldn't settle.");
    await changed();
  };

  const unsettle = async (id: string) => {
    await unsettleConversationAction(id);
    await changed();
  };

  const pin = async (id: string, value: boolean) => {
    await pinConversationAction(id, value);
    await changed();
  };

  const move = async (id: string, folderId: string | null) => {
    setMover(null);
    await moveConversationAction(id, folderId);
    await changed();
  };

  /** Persist a new folder order (optimistic: keys are rewritten locally so
   *  the rail re-sorts at once, then the same keys go to the server). */
  const reorder = async (movedId: string, target: { id: string; pos: "before" | "after" }) => {
    const cur = orderedFolders(folders).map((f) => f.id);
    if (movedId === target.id) return;
    const rest = cur.filter((id) => id !== movedId);
    const at = rest.indexOf(target.id);
    if (at < 0) return;
    rest.splice(target.pos === "before" ? at : at + 1, 0, movedId);
    if (rest.join() === cur.join()) return;
    const keys = new Map(sortKeysFor(rest).map((k) => [k.id, k.sortKey]));
    setFolders((fs) => fs.map((f) => (keys.has(f.id) ? { ...f, sortKey: keys.get(f.id)! } : f)));
    await reorderFoldersAction(rest);
    postPanelMessage({ type: "threads" });
  };

  /** Drop-target props for a group header: a dragged thread files into the
   *  folder (`folderId` null = Unfiled); a dragged folder header lands before
   *  or after this folder (upper / lower half of the row). */
  const dropProps = (key: string, folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (dragFolderId) {
        if (!folderId || folderId === dragFolderId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pos = e.clientY < r.top + r.height / 2 ? "before" : "after";
        if (folderDrop?.id !== folderId || folderDrop.pos !== pos) setFolderDrop({ id: folderId, pos });
        return;
      }
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropKey !== key) setDropKey(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return;
      if (dropKey === key) setDropKey(null);
      if (folderDrop?.id === folderId) setFolderDrop(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragFolderId) {
        const target = folderDrop;
        setDragFolderId(null);
        setFolderDrop(null);
        if (folderId && target && target.id === folderId) void reorder(dragFolderId, target);
        return;
      }
      const id = dragId ?? e.dataTransfer.getData("text/x-sjcos-thread");
      setDragId(null);
      setDropKey(null);
      if (!id) return;
      const t = threads.find((x) => x.id === id);
      if (!t || t.folderId === folderId) return;
      void move(id, folderId);
    },
  });

  const fileUnder = async (t: RailThread) => {
    if (!t.suggestedFolder) return;
    const r = await fileConversationUnderAction(t.id, { kind: t.suggestedFolder.kind, id: t.suggestedFolder.id });
    if (!r.ok) return flashNotice("That job could not be found.");
    await changed();
  };

  // ─── Folder actions ────────────────────────────────────────────────────────

  /** "New folder": opens the picker — pick a job (its folder is created on
   *  first use, or reused) or type a name for a free folder. */
  const newFolder = (thenMove?: string) => {
    setMenu(null);
    setMover(null);
    setPicker({ mode: "new", thenMove });
  };

  const createFreeFolder = async (name: string, thenMove?: string) => {
    const r = await createFolderAction(name.trim());
    if (thenMove) await moveConversationAction(thenMove, r.id);
    setPicker(null);
    await changed();
  };

  const folderForJob = async (job: JobPick, thenMove?: string) => {
    const r = await ensureEntityFolderAction({ kind: job.kind, id: job.slug });
    if (!r.ok || !r.id) return flashNotice("Couldn't open a folder for that job.");
    if (thenMove) await moveConversationAction(thenMove, r.id);
    setPicker(null);
    await changed();
  };

  const renameFolder = async (f: RailFolder) => {
    const next = window.prompt("Rename folder", f.name);
    if (next == null) return;
    await renameFolderAction(f.id, next);
    await changed();
  };

  const linkFolderTo = async (f: RailFolder, job: JobPick | null) => {
    const r = await bindFolderAction(f.id, job ? { kind: job.kind, id: job.slug } : null);
    if (!r.ok) return flashNotice(r.error ?? "Couldn't link.");
    setPicker(null);
    await changed();
  };

  const toggleCollapsed = async (f: RailFolder) => {
    // Optimistic: the persisted flag is the same in every tab and window.
    setFolders((cur) => cur.map((x) => (x.id === f.id ? { ...x, collapsed: !f.collapsed } : x)));
    await setFolderCollapsedAction(f.id, !f.collapsed);
    postPanelMessage({ type: "threads" });
  };

  const archiveFolder = async (f: RailFolder, value: boolean) => {
    const r = await archiveFolderAction(f.id, value);
    if (!r.ok) return flashNotice(r.error ?? "Couldn't archive.");
    if (value) {
      if (scopeFolderId === f.id) onScopeChange(null);
      if (currentId && threads.some((t) => t.id === currentId && t.folderId === f.id)) onCurrentRemoved();
    }
    await changed();
  };

  const removeFolder = async (f: RailFolder) => {
    if (!window.confirm(`Delete the folder "${f.name}"? Its threads move to Unfiled.`)) return;
    const r = await deleteFolderAction(f.id);
    if (!r.ok) return flashNotice(r.error ?? "Couldn't delete.");
    if (scopeFolderId === f.id) onScopeChange(null);
    await changed();
  };

  // ─── Derived view ──────────────────────────────────────────────────────────

  const statusOf = (t: RailThread): ThreadStatus =>
    resolveThreadStatus(t, { seen: isRunSeen, currentId, sinceMs: sinceMs ?? Number.POSITIVE_INFINITY });

  const allGroups = groupThreads(folders, threads);
  const scoped = scopeFolderId ? allGroups.filter((g) => g.key === scopeFolderId) : allGroups;
  const scopeFolder = scopeFolderId ? folders.find((f) => f.id === scopeFolderId) ?? null : null;
  // A scope whose folder vanished (deleted in another window) falls back to all.
  useEffect(() => {
    if (loaded && scopeFolderId && !folders.some((f) => f.id === scopeFolderId)) onScopeChange(null);
  }, [loaded, scopeFolderId, folders, onScopeChange]);

  const routeEntity = entityFromRoute(pageRoute);
  const routeFolderId = routeEntity
    ? folders.find((f) => f.entityKind === routeEntity.kind && f.entityId === routeEntity.id)?.id ?? null
    : null;

  // Headers are noise when everything is Unfiled and there are no folders.
  const showHeaders = folders.some((f) => !f.archivedAt) || scoped.length > 1;

  const shelfState = (key: string) => shelf[key] ?? { open: false, count: SETTLED_INITIAL };

  return (
    <aside
      className={`flex min-h-0 flex-col overflow-hidden ${
        variant === "rail" ? "rounded-[10px] border border-rule bg-paper shadow-card" : "bg-paper"
      } ${className}`}
    >
      <div className="relative flex items-center gap-1.5 border-b border-rule px-3 py-2">
        {picker?.mode === "new" && (
          <JobPicker
            title="New folder"
            placeholder="New folder: job or name…"
            allowCreate
            onPick={(job) => folderForJob(job, picker.thenMove)}
            onCreate={(name) => createFreeFolder(name, picker.thenMove)}
            onDone={() => setPicker(null)}
          />
        )}
        {scopeFolder ? (
          <button
            onClick={() => onScopeChange(null)}
            title="Show all folders"
            className="flex min-w-0 items-center gap-1 rounded-md bg-paper-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 hover:bg-paper-3"
          >
            <span className="truncate">{scopeFolder.name}</span>
            <X className="size-3 flex-none" strokeWidth={2} />
          </button>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Threads</span>
        )}
        <div className="flex-1" />
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => (picker?.mode === "new" ? setPicker(null) : newFolder())}
          aria-label="New folder"
          title="New folder"
          className={`rounded-md p-1 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink-2 ${
            picker?.mode === "new" ? "bg-paper-2 text-ink-2" : ""
          }`}
        >
          <FolderPlus className="size-3.5" strokeWidth={1.75} />
        </button>
        <button
          onClick={() => onNew(scopeFolderId)}
          aria-label="New chat"
          title={scopeFolder ? `New chat in ${scopeFolder.name}` : "New chat"}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink-2"
        >
          <Plus className="size-3" strokeWidth={2} /> New
        </button>
        {onClose && (
          <button onClick={onClose} aria-label="Close threads" className="rounded p-0.5 text-ink-3 hover:bg-paper-2">
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {flash && <p className="border-b border-rule bg-flag-soft px-3 py-1.5 text-[11px] text-flag">{flash}</p>}

      <div className="flex-1 overflow-y-auto p-1.5">
        {loaded && threads.length === 0 && folders.length === 0 ? (
          <p className="px-2 py-3 text-[11.5px] text-ink-4">No chats yet.</p>
        ) : (
          scoped.map((g) => {
            const f = g.folder;
            const collapsed = f ? f.collapsed : unfiledCollapsed;
            const allRows = [...g.threads.pinned, ...g.threads.active, ...g.threads.settled];
            const roll = rollupStatus(allRows.map(statusOf));
            const holdsCurrent = !!currentId && allRows.some((t) => t.id === currentId);
            const isRouteFolder = f != null && f.id === routeFolderId;
            const sh = shelfState(g.key);
            const settledOpen = sh.open || (!!currentId && g.threads.settled.some((t) => t.id === currentId));
            const settledRows = settledOpen ? g.threads.settled.slice(0, sh.count) : [];
            const settledMore = g.threads.settled.length - settledRows.length;
            return (
              <div key={g.key} className="mb-1">
                {showHeaders && (
                  <div
                    {...dropProps(g.key, f ? f.id : null)}
                    draggable={!!f && !menu && !picker}
                    onDragStart={(e) => {
                      if (!f) return;
                      e.dataTransfer.setData("text/x-sjcos-folder", f.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragFolderId(f.id);
                      setMenu(null);
                      setMover(null);
                    }}
                    onDragEnd={() => {
                      setDragFolderId(null);
                      setFolderDrop(null);
                    }}
                    className={`group/f relative flex items-center gap-1 rounded-md px-1 py-1 ${
                      dropKey === g.key
                        ? "bg-ai-soft ring-1 ring-ai-2/50"
                        : isRouteFolder
                          ? "bg-ai-soft/60"
                          : "hover:bg-card/60"
                    } ${dragId || dragFolderId ? "transition-colors" : ""} ${
                      f && dragFolderId === f.id ? "opacity-40" : ""
                    } ${
                      f && folderDrop?.id === f.id
                        ? folderDrop.pos === "before"
                          ? "shadow-[inset_0_2px_0_0_var(--ai-2)]"
                          : "shadow-[inset_0_-2px_0_0_var(--ai-2)]"
                        : ""
                    }`}
                  >
                    <button
                      onClick={() => (f ? void toggleCollapsed(f) : setUnfiledCollapsed((v) => !v))}
                      aria-label={collapsed ? "Expand" : "Collapse"}
                      className="rounded p-0.5 text-ink-4 hover:bg-paper-2"
                    >
                      {collapsed ? (
                        <ChevronRight className="size-3" strokeWidth={2} />
                      ) : (
                        <ChevronDown className="size-3" strokeWidth={2} />
                      )}
                    </button>
                    <button
                      onClick={() => f && onScopeChange(scopeFolderId === f.id ? null : f.id)}
                      title={f ? (scopeFolderId === f.id ? "Show all folders" : `Only ${f.name}`) : "Threads not filed under a job"}
                      className="min-w-0 flex-1 truncate text-left font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 hover:text-ink"
                    >
                      {g.name}
                    </button>
                    {roll !== "idle" && (collapsed || !holdsCurrent) && <StatusDot status={roll} />}
                    <span className="font-mono text-[10px] text-ink-4 group-hover/f:hidden">{g.count}</span>
                    {f && (
                      <div className="hidden items-center gap-0.5 group-hover/f:flex">
                        <button
                          onClick={() => onNew(f.id)}
                          aria-label="New chat here"
                          title={`New chat in ${f.name}`}
                          className="rounded p-0.5 hover:bg-paper-2"
                        >
                          <Plus className="size-3 text-ink-4" strokeWidth={2} />
                        </button>
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => setMenu(menu?.id === f.id ? null : { kind: "folder", id: f.id })}
                          aria-label="Folder menu"
                          className="rounded p-0.5 hover:bg-paper-2"
                        >
                          <MoreHorizontal className="size-3 text-ink-4" strokeWidth={2} />
                        </button>
                      </div>
                    )}
                    {f && menu?.kind === "folder" && menu.id === f.id && (
                      <Menu onDone={() => setMenu(null)}>
                        {f.entityHref && (
                          <MenuItem icon={ExternalLink} label={`Open ${f.entityKind}`} onClick={() => openHref(f.entityHref!)} />
                        )}
                        <MenuItem icon={Pencil} label="Rename" onClick={() => void renameFolder(f)} />
                        <MenuItem icon={Link2} label={f.entityId ? "Change linked job" : "Link to a job…"} onClick={() => setPicker({ mode: "link", folderId: f.id })} />
                        <MenuItem icon={Archive} label="Archive folder" onClick={() => void archiveFolder(f, true)} />
                        <MenuItem icon={Trash2} label="Delete folder" danger onClick={() => void removeFolder(f)} />
                      </Menu>
                    )}
                    {f && picker?.mode === "link" && picker.folderId === f.id && (
                      <JobPicker
                        title="Link"
                        placeholder="Link to a job…"
                        current={f.entityKind && f.entityId ? { kind: f.entityKind, id: f.entityId } : null}
                        allowUnlink={!!f.entityId}
                        onPick={(job) => linkFolderTo(f, job)}
                        onUnlink={() => linkFolderTo(f, null)}
                        onDone={() => setPicker(null)}
                      />
                    )}
                  </div>
                )}

                {!collapsed && (
                  <div className={showHeaders ? "ml-1.5 border-l border-rule-soft pl-1" : ""}>
                    {g.threads.pinned.map((t) => renderRow(t, { pinned: true }))}
                    {g.threads.pinned.length > 0 && g.threads.active.length > 0 && (
                      <div className="mx-2 my-1 border-t border-rule-soft" />
                    )}
                    {g.threads.active.map((t) => renderRow(t))}
                    {g.threads.settled.length > 0 && (
                      <>
                        <button
                          onClick={() =>
                            setShelf((s) => ({ ...s, [g.key]: { open: !settledOpen, count: sh.count } }))
                          }
                          className="mt-0.5 flex w-full items-center gap-1 rounded-md px-2 py-1 text-left font-mono text-[10px] text-ink-4 hover:bg-card/60 hover:text-ink-3"
                        >
                          {settledOpen ? (
                            <ChevronDown className="size-3" strokeWidth={2} />
                          ) : (
                            <ChevronRight className="size-3" strokeWidth={2} />
                          )}
                          Settled ({g.threads.settled.length})
                        </button>
                        {settledRows.map((t) => renderRow(t, { settled: true }))}
                        {settledOpen && settledMore > 0 && (
                          <button
                            onClick={() =>
                              setShelf((s) => ({ ...s, [g.key]: { open: true, count: sh.count + SETTLED_PAGE } }))
                            }
                            className="w-full px-2 py-1 text-left text-[10.5px] text-ink-4 hover:text-ink-3"
                          >
                            Show {Math.min(settledMore, SETTLED_PAGE)} more
                          </button>
                        )}
                      </>
                    )}
                    {allRows.length === 0 && (
                      <p className="px-2 py-1 text-[11px] text-ink-4">Empty — start a chat here.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {showArchived && archived && (
          <div className="mt-2 border-t border-rule pt-1.5">
            <div className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Archived</div>
            {archived.length === 0 && <p className="px-2 py-1 text-[11px] text-ink-4">Nothing archived.</p>}
            {archived.map((t) => (
              <div key={t.id} className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 opacity-60 hover:bg-card/60 hover:opacity-100">
                <AgentBadge agent={t.agent} />
                <button onClick={() => onOpen(t.id)} className="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink-2" title={t.title}>
                  {t.title}
                </button>
                <span className="flex-none font-mono text-[10px] text-ink-4 group-hover:hidden">{timeAgo(t.archivedAt, now)}</span>
                <div className="hidden flex-none items-center gap-0.5 group-hover:flex">
                  {t.archivedAt && (
                    <button onClick={() => void setArchivedThread(t.id, false)} aria-label="Restore" title="Restore" className="rounded p-0.5 hover:bg-paper-2">
                      <ArchiveRestore className="size-3 text-ink-4" strokeWidth={1.5} />
                    </button>
                  )}
                  <button onClick={() => void remove(t.id)} aria-label="Delete" title="Delete" className="rounded p-0.5 hover:bg-paper-2">
                    <Trash2 className="size-3 text-flag" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => setShowArchived((v) => !v)}
        className="border-t border-rule px-3 py-1.5 text-left text-[10.5px] text-ink-4 transition-colors hover:bg-paper-2 hover:text-ink-3"
      >
        {showArchived ? "Hide archived" : "Show archived"}
      </button>
    </aside>
  );

  // ─── Row ───────────────────────────────────────────────────────────────────
  // A render function, not a nested component: a component declared inside
  // the parent gets a new identity every render and React would remount every
  // row (dropping open menus) on each 10s tick.
  function renderRow(t: RailThread, opts: { pinned?: boolean; settled?: boolean } = {}) {
    const { pinned = false, settled = false } = opts;
    const status = statusOf(t);
    const meta = STATUS_META[status];
    const isCurrent = t.id === currentId;
    const menuOpen = menu?.kind === "thread" && menu.id === t.id;
    const moverOpen = mover === t.id;
    // The time slot doubles as the status word so a narrow rail still reads.
    const slot =
      status === "working"
        ? formatElapsed(t.workingSince, now) || "…"
        : status === "approval"
          ? "approve"
          : status === "input"
            ? "answer"
            : status === "failed"
              ? "failed"
              : status === "completed"
                ? "new"
                : timeAgo(settled ? t.settledAt ?? t.lastActivityAt : t.lastActivityAt ?? t.updatedAt, now);
    const recede = settled || (status === "idle" && !isCurrent);
    return (
      <div
        key={t.id}
        draggable={!menuOpen && !moverOpen}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/x-sjcos-thread", t.id);
          e.dataTransfer.effectAllowed = "move";
          setDragId(t.id);
          setMenu(null);
          setMover(null);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropKey(null);
        }}
        className={`group relative flex flex-col rounded-md px-2 py-1.5 ${
          isCurrent ? "bg-card" : "hover:bg-card/60"
        } ${recede ? "opacity-70 hover:opacity-100" : ""} ${dragId === t.id ? "opacity-40" : ""} ${dragId ? "cursor-grabbing" : ""}`}
      >
        <div className="flex items-center gap-1.5">
          {pinned ? (
            <Pin className="size-3 flex-none text-ink-4" strokeWidth={1.75} />
          ) : (
            <AgentBadge agent={t.agent} />
          )}
          <button
            onClick={() => onOpen(t.id)}
            className={`min-w-0 flex-1 truncate text-left text-[12.5px] ${settled ? "text-ink-3" : "text-ink-2"}`}
            title={t.title}
          >
            {t.title}
          </button>
          {status !== "idle" && <StatusDot status={status} />}
          <span
            className={`flex-none font-mono text-[10px] group-hover:hidden ${
              status === "idle" ? "text-ink-4" : status === "working" ? "text-ai-2" : status === "completed" ? "text-money" : "text-flag"
            }`}
            title={meta.label || undefined}
          >
            {slot}
          </span>
          <div className="hidden flex-none items-center gap-0.5 group-hover:flex">
            {settled ? (
              <button onClick={() => void unsettle(t.id)} aria-label="Un-settle" title="Back to active (auto-settle leaves it alone)" className="rounded p-0.5 hover:bg-paper-2">
                <Undo2 className="size-3 text-ink-4" strokeWidth={1.75} />
              </button>
            ) : (
              <button
                onClick={() => void settle(t.id)}
                aria-label="Settle"
                title={t.working ? "Still working" : "Settle — I'm done with this"}
                disabled={t.working || t.needsApproval || t.needsInput}
                className="rounded p-0.5 hover:bg-paper-2 disabled:opacity-40"
              >
                <Check className="size-3 text-ink-4" strokeWidth={2} />
              </button>
            )}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                setMover(null);
                setMenu(menuOpen ? null : { kind: "thread", id: t.id });
              }}
              aria-label="More"
              className="rounded p-0.5 hover:bg-paper-2"
            >
              <MoreHorizontal className="size-3 text-ink-4" strokeWidth={2} />
            </button>
          </div>
        </div>
        {!t.folderId && t.suggestedFolder && !settled && (
          <button
            onClick={() => void fileUnder(t)}
            title={`File this thread under ${t.suggestedFolder.name}`}
            className="mt-0.5 flex items-center gap-1 self-start rounded-full bg-ai-soft px-1.5 py-px text-[10px] text-ai-2 hover:bg-ai-soft/70"
          >
            <FolderInput className="size-2.5" strokeWidth={2} />
            <span className="truncate">File under {t.suggestedFolder.name}?</span>
          </button>
        )}
        {menuOpen && (
          <Menu onDone={() => setMenu(null)}>
            <MenuItem icon={Pencil} label="Rename" onClick={() => void rename(t.id, t.title)} />
            <MenuItem
              icon={FolderInput}
              label="Move to folder…"
              keepOpen
              onClick={() => {
                setMenu(null);
                setMover(t.id);
              }}
            />
            {pinned ? (
              <MenuItem icon={PinOff} label="Unpin" onClick={() => void pin(t.id, false)} />
            ) : (
              <MenuItem icon={Pin} label="Pin" onClick={() => void pin(t.id, true)} />
            )}
            <MenuItem
              icon={Archive}
              label="Archive"
              disabled={t.working}
              onClick={() => void setArchivedThread(t.id, true)}
            />
            <MenuItem icon={Trash2} label="Delete" danger onClick={() => void remove(t.id)} />
          </Menu>
        )}
        {moverOpen && (
          <Menu onDone={() => setMover(null)}>
            <div className="px-2 pb-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-4">Move to</div>
            {t.folderId && <MenuItem icon={X} label="Unfiled" onClick={() => void move(t.id, null)} />}
            {folders
              .filter((f) => !f.archivedAt && f.id !== t.folderId)
              .map((f) => (
                <MenuItem key={f.id} icon={FolderInput} label={f.name} onClick={() => void move(t.id, f.id)} />
              ))}
            <MenuItem icon={FolderPlus} label="New folder…" onClick={() => void newFolder(t.id)} />
          </Menu>
        )}
      </div>
    );
  }
}

function AgentBadge({ agent }: { agent: RailThread["agent"] }) {
  return (
    <span
      className="flex size-4 flex-none items-center justify-center rounded bg-paper-2 font-mono text-[9px] text-ink-3"
      title={AGENT_META[agent].label}
    >
      {AGENT_META[agent].initials}
    </span>
  );
}

/** The one status dot: colour by tone, pulsing while something is live. */
function StatusDot({ status }: { status: ThreadStatus }) {
  const m = STATUS_META[status];
  if (!m.label) return null;
  return (
    <span
      className={`size-1.5 flex-none rounded-full ${m.dot} ${m.pulse ? "animate-pulse" : ""}`}
      title={m.label}
      aria-label={m.label}
    />
  );
}

/** A small anchored menu; clicks inside don't bubble to the outside-click
 *  closer, and every item closes it when done unless it opens another. */
function Menu({ children, onDone }: { children: React.ReactNode; onDone: () => void }) {
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest("[data-keep-open]")) return;
        if (el.closest("button")) onDone();
      }}
      className="absolute right-1 top-full z-20 mt-0.5 min-w-40 rounded-md border border-rule bg-paper py-1 shadow-card"
    >
      {children}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  keepOpen = false,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  keepOpen?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-keep-open={keepOpen ? "" : undefined}
      className={`flex w-full items-center gap-2 px-2.5 py-1 text-left text-[11.5px] hover:bg-paper-2 disabled:opacity-40 ${
        danger ? "text-flag" : "text-ink-2"
      }`}
    >
      <Icon className="size-3 flex-none" strokeWidth={1.75} />
      <span className="truncate">{label}</span>
    </button>
  );
}

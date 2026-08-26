"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  archiveConversationAction,
  deleteConversationAction,
  listAllConversationsAction,
  renameConversationAction,
} from "@/lib/actions/ai-chat";
import type { ThreadListItem } from "@/lib/ai-chat";
import { AGENT_META } from "@/lib/dev-agents-meta";
import { subscribePanelBus } from "./panelBus";

/** "2m" / "3h" / "5d" / "Aug 12" from a pg timestamptz::text. */
function timeAgo(ts: string): string {
  const t = new Date(ts.replace(" ", "T")).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The panel's thread navigator — every conversation across all agents, most
 * recent first, with a live dot on threads whose run is still working (threads
 * keep running server-side after Joe switches away; there is no runtime limit).
 * One component, two placements: a persistent rail beside the chat when the
 * dock/popout is wide enough ("rail"), and the History overlay on narrow docks
 * and mobile ("drawer"). Opening a thread of another agent switches the whole
 * panel to it (openConversation adopts the thread's agent).
 */
export function ThreadList({
  currentId,
  onOpen,
  onNew,
  onClose,
  onCurrentRemoved,
  variant,
  refreshKey,
  className = "",
}: {
  /** The open thread, for highlight. */
  currentId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** Drawer only: the ✕ that closes the overlay. */
  onClose?: () => void;
  /** The open thread was archived/deleted from the list — fall to a new chat. */
  onCurrentRemoved: () => void;
  variant: "rail" | "drawer";
  /** Any value change triggers a reload (e.g. a settled turn retitles). */
  refreshKey?: string;
  className?: string;
}) {
  const [items, setItems] = useState<ThreadListItem[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // The latest reload wins; a stale slow response must not clobber a newer one.
  const seqRef = useRef(0);

  const reload = async (archived = showArchived) => {
    const seq = ++seqRef.current;
    const rows = await listAllConversationsAction(archived);
    if (seq !== seqRef.current) return;
    setItems(rows);
    setLoaded(true);
  };

  // Reload on triggers, plus a slow tick: an abandoned thread's run settles
  // server-side with no client polling it, so its live dot (and the relative
  // times) refresh here rather than never.
  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived, refreshKey]);

  // Run start/end anywhere (this window or the popout) moves threads and
  // flips live dots — refresh so the list tracks other windows' work too.
  useEffect(
    () =>
      subscribePanelBus((m) => {
        if (m.type === "run") void reload();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showArchived],
  );

  const rename = async (id: string, current: string) => {
    const next = window.prompt("Rename conversation", current);
    if (next && next.trim()) {
      await renameConversationAction(id, next.trim());
      await reload();
    }
  };

  const setArchived = async (id: string, archived: boolean) => {
    await archiveConversationAction(id, archived);
    if (archived && id === currentId) onCurrentRemoved();
    await reload();
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this conversation permanently?")) return;
    await deleteConversationAction(id);
    if (id === currentId) onCurrentRemoved();
    await reload();
  };

  return (
    <aside
      className={`flex min-h-0 flex-col overflow-hidden ${
        variant === "rail" ? "rounded-[10px] border border-rule bg-paper shadow-card" : "bg-paper"
      } ${className}`}
    >
      <div className="flex items-center gap-1.5 border-b border-rule px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          Threads
        </span>
        <div className="flex-1" />
        <button
          onClick={onNew}
          aria-label="New chat"
          title="New chat"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink-2"
        >
          <Plus className="size-3" strokeWidth={2} /> New
        </button>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close threads"
            className="rounded p-0.5 text-ink-3 hover:bg-paper-2"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {loaded && items.length === 0 ? (
          <p className="px-2 py-3 text-[11.5px] text-ink-4">No chats yet.</p>
        ) : (
          items.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1.5 rounded-md px-2 py-1.5 ${
                c.id === currentId ? "bg-card" : "hover:bg-card/60"
              } ${c.archived ? "opacity-60" : ""}`}
            >
              <span
                className="flex size-4 flex-none items-center justify-center rounded bg-paper-2 font-mono text-[9px] text-ink-3"
                title={AGENT_META[c.agent].label}
              >
                {AGENT_META[c.agent].initials}
              </span>
              <button
                onClick={() => onOpen(c.id)}
                className="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink-2"
                title={c.title}
              >
                {c.title}
              </button>
              {c.live && (
                <span
                  className="size-1.5 flex-none animate-pulse rounded-full bg-ai"
                  title="A run is still working in this thread"
                />
              )}
              <span className="flex-none font-mono text-[10px] text-ink-4 group-hover:hidden">
                {timeAgo(c.updatedAt)}
              </span>
              <div className="hidden flex-none items-center gap-0.5 group-hover:flex">
                <button onClick={() => void rename(c.id, c.title)} aria-label="Rename" title="Rename" className="rounded p-0.5 hover:bg-paper-2">
                  <Pencil className="size-3 text-ink-4" strokeWidth={1.5} />
                </button>
                <button
                  onClick={() => void setArchived(c.id, !c.archived)}
                  aria-label={c.archived ? "Restore" : "Archive"}
                  title={c.archived ? "Restore" : "Archive"}
                  className="rounded p-0.5 hover:bg-paper-2"
                >
                  {c.archived ? (
                    <ArchiveRestore className="size-3 text-ink-4" strokeWidth={1.5} />
                  ) : (
                    <Archive className="size-3 text-ink-4" strokeWidth={1.5} />
                  )}
                </button>
                <button onClick={() => void remove(c.id)} aria-label="Delete" title="Delete" className="rounded p-0.5 hover:bg-paper-2">
                  <Trash2 className="size-3 text-flag" strokeWidth={1.5} />
                </button>
              </div>
            </div>
          ))
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
}

"use client";

import {
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useTransition,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Filter,
  Mail,
  MessageSquare,
  UserRound,
  UserCheck,
  Globe,
  Tag,
  MoreHorizontal,
  ChevronLeft,
  Send,
  PenSquare,
  Inbox,
  X,
  Star,
  MailOpen,
  Archive,
  Trash2,
  Flag,
  ExternalLink,
  OctagonAlert,
  Check,
  Clock,
  ListPlus,
  ChevronRight,
  Search,
  Keyboard,
  Link as LinkIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Button,
  EmptyState,
  Segmented,
  Chip,
  Avatar,
  VoiceButton,
} from "@/components/ui";
import { smsSegments } from "@/lib/inbox-rules";
import { mergeTranscript } from "@/lib/append-transcript";
import {
  draftReplyAction,
  getThreadHtmlAction,
  sendReplyAction,
  sendChannelReplyAction,
  sendNewEmailAction,
  setThreadStarredAction,
  setThreadReadAction,
  setThreadImportantAction,
  archiveThreadAction,
  trashThreadAction,
  loadMoreInboxAction,
  loadLabelInboxAction,
  loadSystemViewAction,
  linkThread,
  unlinkThread,
  disconnectMyMailboxAction,
} from "@/lib/actions/inbox";
import { runAction } from "@/lib/run-action";
import type { ThreadChannel, ThreadStatus, SystemViewKey } from "@/lib/types";
import { SYSTEM_VIEWS } from "@/lib/types";
import type {
  InboxData,
  InboxThread,
  MailboxState,
  ThreadReader,
} from "@/lib/inbox";

import {
  INBOX_TABS,
  matchesInboxTab,
  tabCounts,
  shortcutFor,
  draftKey,
  readDraft,
  writeDraft,
  type InboxTab,
  type SavedInboxDraft,
} from "@/lib/inbox-experience";
import { markChannelDoneAction } from "@/lib/actions/inbox-experience";
import {
  ContextPanel,
  LinkPicker,
  MessageTaskDialog,
  ShortcutHelp,
  ThreadSummary,
} from "./InboxPanels";

/** Views scope the source; the counted split tabs refine that source. */
type Lens =
  | { kind: "all" }
  | { kind: "inbox" }
  | { kind: "view"; view: ThreadStatus }
  | { kind: "channel"; channel: ThreadChannel }
  | { kind: "label"; id: string; name: string }
  | { kind: "system"; view: SystemViewKey }
  | { kind: "project"; slug: string; label: string };

/** Namespaced cache key for a server-fetched lens (label or system view). One
 *  slot holds whichever is open; switching keys refetches, re-clicking is a
 *  cache hit. `null` for lenses served from the already-loaded thread list. */
function remoteKeyOf(lens: Lens): string | null {
  if (lens.kind === "label") return `label:${lens.id}`;
  if (lens.kind === "system") return `system:${lens.view}`;
  return null;
}

const SYSTEM_ICON: Record<SystemViewKey, LucideIcon> = {
  unread: MailOpen,
  starred: Star,
  sent: Send,
  spam: OctagonAlert,
  trash: Trash2,
};

/** labelId for the label-scoped system views, so the client can filter the
 *  already-loaded threads as a fallback before the server-scoped fetch lands. */
const SYSTEM_LABEL_ID: Partial<Record<SystemViewKey, string>> =
  Object.fromEntries(
    SYSTEM_VIEWS.filter((v) => v.labelId).map((v) => [v.key, v.labelId!]),
  );

const CHANNEL_ICON: Record<ThreadChannel, LucideIcon> = {
  email: Mail,
  sms: MessageSquare,
  client_portal: UserRound,
  sub_portal: UserCheck,
  site_form: Globe,
};

/** Small-caps mono section label for the light-background rail. */
function RailLabel({ children }: { children: string }) {
  return (
    <div className="px-1 pb-1 pt-2 text-meta font-medium text-ink-3">
      {children}
    </div>
  );
}

const DOT_BG: Record<string, string> = {
  flag: "bg-flag",
  accent: "bg-accent",
  ghost: "bg-ink-4",
};

/** A single row in the reader's ⋮ dropdown menu. */
function MenuItem({
  icon: Icon,
  onClick,
  danger,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-2 min-h-11 px-3 py-1.5 text-left text-meta hover:bg-paper-3",
        danger ? "text-flag" : "text-ink-2",
      ].join(" ")}
    >
      <Icon className="size-3.5 flex-none" strokeWidth={1.5} />
      {children}
    </button>
  );
}

export function InboxClient({
  data,
  selfEmail,
}: {
  data: InboxData;
  /** The signed-in person's own address — the connected mailbox when there is
   *  one, else their login email. Used only to prefill Compose's To: field.
   *  Was `ownerEmail`, which handed Joe's address to every staff login. */
  selfEmail: string;
}) {
  const [lens, setLens] = useState<Lens>({ kind: "all" });
  const [tab, setTab] = useState<InboxTab | null>("needs");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [context, setContext] = useState<"person" | "job" | null>(null);
  const [linking, setLinking] = useState(false);
  const [task, setTask] = useState<{
    thread: InboxThread;
    remind: boolean;
  } | null>(null);
  const [help, setHelp] = useState(false);
  const [selectedId, setSelectedId] = useState(data.selectedId);
  // Mobile master/detail: below lg, show the thread list OR the reader, not both.
  const router = useRouter();
  const [mobileReader, setMobileReader] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [composing, setComposing] = useState(false);
  // Threads/readers grow as "Load more" pages in from Gmail.
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set());
  const onDraftReady = useCallback(
    (id: string, ready: boolean) =>
      setDraftIds((previous) => {
        if (previous.has(id) === ready) return previous;
        const next = new Set(previous);
        if (ready) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const [threads, setThreads] = useState(data.threads);
  const [readers, setReaders] = useState(data.readers);
  const [pageToken, setPageToken] = useState(data.nextPageToken);
  const [pagePausedAt, setPagePausedAt] = useState<number | null>(null);
  // Follow the server's first page: a refresh (LiveUpdates, or an action's own
  // revalidate) re-reads Gmail — new mail, read state, links. Plain useState
  // kept the first render forever, so counts and the list went stale. Pages
  // pulled in with "Load more" stay after it; render-phase adjustment, as in
  // lib/use-server-state.ts.
  const serverJson = JSON.stringify([
    data.threads,
    data.readers,
    data.lastSyncedAt,
    data.emailPaused,
  ]);
  const [seenServer, setSeenServer] = useState({
    json: serverJson,
    ids: data.threads.map((t) => t.id),
    token: data.nextPageToken,
  });
  if (serverJson !== seenServer.json) {
    const oldFirst = new Set(seenServer.ids);
    const fresh = new Set(data.threads.map((t) => t.id));
    setSeenServer({
      json: serverJson,
      ids: [...fresh],
      token: data.nextPageToken,
    });
    if (!data.emailPaused) setPagePausedAt(null);
    setThreads((prev) => [
      ...data.threads,
      ...prev.filter((t) => !oldFirst.has(t.id) && !fresh.has(t.id)),
    ]);
    setReaders((prev) => ({ ...prev, ...data.readers }));
    // Nothing paged in past the first page yet — the next page starts after the new one.
    if (pageToken === seenServer.token) setPageToken(data.nextPageToken);
  }
  const [loadingMore, setLoadingMore] = useState(false);
  // Label + system-view lists are fetched server-side (scoped to that Gmail
  // label / mailbox) so they show the full mail, not just whatever paged into
  // the inbox window. One slot, namespaced by remoteKeyOf; null until opened.
  const [remoteData, setRemoteData] = useState<{
    key: string;
    threads: InboxThread[];
    pageToken?: string;
    emailPaused?: boolean;
    lastSyncedAt?: number;
  } | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Optimistic star state, keyed by thread id, until the revalidate lands.
  const [starOverride, setStarOverride] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    try {
      setDraftIds(
        new Set(
          [...threads, ...(remoteData?.threads ?? [])]
            .filter((t) => {
              const d = readDraft(localStorage, draftKey(selfEmail, t.id));
              return d?.ai && d.body.trim();
            })
            .map((t) => t.id),
        ),
      );
    } catch {}
  }, [selfEmail, threads, remoteData]);

  // Threads under the current lens, before the audience filter is applied.
  const baseVisible = useMemo(() => {
    switch (lens.kind) {
      case "all":
        return threads;
      case "inbox":
        return threads.filter((t) =>
          t.channel === "email" ? t.inInbox : t.view !== "done",
        );
      case "view":
        return threads.filter(
          (t) =>
            t.view === lens.view ||
            (lens.view === "needs_reply" && draftIds.has(t.id)),
        );
      case "channel":
        return threads.filter((t) => t.channel === lens.channel);
      case "label": {
        // Prefer the server-fetched, label-scoped list once it's loaded; until
        // then (or if it fails) fall back to client-filtering the loaded inbox.
        const key = `label:${lens.id}`;
        return remoteData?.key === key
          ? remoteData.threads
          : threads.filter((t) => (t.labelIds ?? []).includes(lens.id));
      }
      case "system": {
        // Prefer the server-fetched mailbox page once it lands. Before then,
        // fall back to filtering loaded threads by the view's system label
        // (Unread/Starred/Sent); Spam/Trash have no local match, so show
        // nothing until the fetch returns (the loading state covers the gap).
        const key = `system:${lens.view}`;
        if (remoteData?.key === key) return remoteData.threads;
        const labelId = SYSTEM_LABEL_ID[lens.view];
        return labelId
          ? threads.filter((t) => (t.labelIds ?? []).includes(labelId))
          : [];
      }
      case "project":
        return threads.filter((t) => t.projectSlug === lens.slug);
    }
  }, [threads, lens, remoteData, draftIds]);

  const visible = useMemo(
    () =>
      baseVisible.filter(
        (t) =>
          (!tab || matchesInboxTab(t, tab, draftIds.has(t.id))) &&
          `${t.fromName} ${t.subject} ${t.preview} ${t.projectLabel ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [baseVisible, tab, draftIds, query],
  );
  // Count of threads sitting in the Gmail inbox (the plain "Inbox" rail view).
  const inboxCount = useMemo(
    () => threads.filter((t) => t.inInbox).length,
    [threads],
  );

  const counts = useMemo(
    () => tabCounts(baseVisible, draftIds),
    [baseVisible, draftIds],
  );
  // Keep the selection valid as the lens narrows the list.
  const selected =
    visible.find((t) => t.id === selectedId) ?? visible[0] ?? null;
  const reader = selected ? readers[selected.id] : undefined;
  // Email gets its mailbox controls; every channel has its own reply adapter.
  const readerIsEmail = (reader?.channel ?? "email") === "email";

  const linkOptions = data.linkOptions;
  const currentLink =
    selected?.linkedType && selected?.linkedSlug
      ? `${selected.linkedType}:${selected.linkedSlug}`
      : "";

  // A shared link is stored through the existing inbox link action on every channel.
  function relink(next: string) {
    if (!selected) return;
    const id = selected.id;
    const [type, slug] = next.split(":") as ["project" | "lead", string];
    const option = (
      type === "project" ? linkOptions?.projects : linkOptions?.leads
    )?.find((o) => o.slug === slug);
    startTransition(async () => {
      const r = await runAction(
        () => (next ? linkThread(id, type, slug) : unlinkThread(id)),
        { fallback: "Could not link this conversation." },
      );
      if (!r.ok) {
        setNotice(r.error ?? "Could not link this conversation.");
        return;
      }
      const patch = (t: InboxThread): InboxThread =>
        t.id !== id
          ? t
          : {
              ...t,
              linkedType: next ? type : undefined,
              linkedSlug: next ? slug : undefined,
              projectSlug: next && type === "project" ? slug : undefined,
              projectLabel: option?.name,
              contactStage: option?.stage,
            };
      setThreads((ts) => ts.map(patch));
      setRemoteData((d) => (d ? { ...d, threads: d.threads.map(patch) } : d));
      router.refresh();
    });
  }

  // Open a server-fetched lens (a Gmail label or a system mailbox): fetch its
  // mail scoped server-side, with its own pagination. Re-clicking the open one
  // is a no-op (cache stays); switching keys refetches.
  const fetchRemote = (
    key: string,
    loader: () => Promise<{
      ok: boolean;
      threads?: InboxThread[];
      readers?: Record<string, ThreadReader>;
      nextPageToken?: string;
      emailPaused?: boolean;
      lastSyncedAt?: number;
      error?: string;
    }>,
    force = false,
  ) => {
    if (!force && remoteData?.key === key) return;
    if (remoteData?.key !== key) setRemoteData(null);
    setNotice(null);
    setRemoteLoading(true);
    startTransition(async () => {
      const r = await runAction(loader, {
        fallback: "Couldn't load that view.",
      });
      if (r.ok && r.threads) {
        setReaders((prev) => ({ ...prev, ...(r.readers ?? {}) }));
        setRemoteData({
          key,
          threads: r.threads,
          pageToken: r.nextPageToken,
          emailPaused: r.emailPaused,
          lastSyncedAt: r.lastSyncedAt,
        });
      } else if (!r.ok) {
        setNotice(r.error ?? "Couldn't load that view.");
      }
      setRemoteLoading(false);
    });
  };

  const selectLabel = (id: string, name: string) => {
    setLens({ kind: "label", id, name });
    fetchRemote(`label:${id}`, () => loadLabelInboxAction(id));
  };

  const selectSystem = (view: SystemViewKey) => {
    setLens({ kind: "system", view });
    fetchRemote(`system:${view}`, () => loadSystemViewAction(view));
  };

  const remoteKey = remoteKeyOf(lens);
  const onRemote = remoteKey !== null && remoteData?.key === remoteKey;
  const remotePaused = onRemote && remoteData?.emailPaused;
  const emailPaused = data.emailPaused || remotePaused || pagePausedAt !== null;
  const lastSyncedAt = remotePaused
    ? remoteData?.lastSyncedAt
    : (pagePausedAt ?? data.lastSyncedAt);
  const retryEmail = () => {
    if (lens.kind === "label")
      fetchRemote(
        `label:${lens.id}`,
        () => loadLabelInboxAction(lens.id),
        true,
      );
    else if (lens.kind === "system")
      fetchRemote(
        `system:${lens.view}`,
        () => loadSystemViewAction(lens.view),
        true,
      );
    router.refresh();
  };
  // "Load more" pages within the open remote lens when one is selected, else the
  // main inbox.
  const moreToken = onRemote ? remoteData?.pageToken : pageToken;

  const loadMore = () => {
    if (!moreToken || loadingMore) return;
    setLoadingMore(true);
    startTransition(async () => {
      const r = await runAction(
        () =>
          onRemote
            ? lens.kind === "label"
              ? loadLabelInboxAction(lens.id, moreToken)
              : loadSystemViewAction(
                  (lens as { view: SystemViewKey }).view,
                  moreToken,
                )
            : loadMoreInboxAction(moreToken),
        { fallback: "Couldn't load more." },
      );
      if (r.ok && r.threads) {
        setPagePausedAt(
          r.emailPaused ? (r.lastSyncedAt ?? data.lastSyncedAt ?? 0) : null,
        );
        setReaders((prev) => ({ ...prev, ...(r.readers ?? {}) }));
        if (onRemote) {
          setRemoteData((prev) =>
            prev
              ? {
                  ...prev,
                  threads: [
                    ...prev.threads,
                    ...r.threads!.filter(
                      (t) => !prev.threads.some((p) => p.id === t.id),
                    ),
                  ],
                  pageToken: r.nextPageToken,
                  emailPaused: r.emailPaused,
                  lastSyncedAt: r.lastSyncedAt,
                }
              : prev,
          );
        } else {
          // Append only genuinely new threads (guard against overlap).
          setThreads((prev) => {
            const seen = new Set(prev.map((t) => t.id));
            return [...prev, ...r.threads!.filter((t) => !seen.has(t.id))];
          });
          setPageToken(r.nextPageToken);
        }
      } else if (!r.ok) {
        setNotice(r.error ?? "Couldn't load more.");
      }
      setLoadingMore(false);
    });
  };

  const lensLabel =
    lens.kind === "all"
      ? "All conversations"
      : lens.kind === "inbox"
        ? "Inbox"
        : lens.kind === "view"
          ? (data.smartViews.find((v) => v.key === lens.view)?.label ?? "Inbox")
          : lens.kind === "channel"
            ? (data.channels.find((c) => c.key === lens.channel)?.label ??
              "Channel")
            : lens.kind === "project"
              ? lens.label
              : lens.kind === "system"
                ? (SYSTEM_VIEWS.find((v) => v.key === lens.view)?.label ??
                  "Mailbox")
                : lens.name;
  const headerLabel = tab
    ? `${INBOX_TABS.find((t) => t.value === tab)?.label}${lens.kind === "all" ? "" : ` · ${lensLabel}`}`
    : lensLabel;
  const isInbox = lens.kind === "inbox";
  const isView = (k: ThreadStatus) => lens.kind === "view" && lens.view === k;
  const isChannel = (k: ThreadChannel) =>
    lens.kind === "channel" && lens.channel === k;
  const isLabel = (id: string) => lens.kind === "label" && lens.id === id;
  const isSystem = (k: SystemViewKey) =>
    lens.kind === "system" && lens.view === k;
  const isProject = (slug: string) =>
    lens.kind === "project" && lens.slug === slug;

  const selectedStarred = selected
    ? (starOverride[selected.id] ?? selected.starred ?? false)
    : false;

  // Run a Gmail mutation; surface a plain-language notice if it fails (the
  // usual cause is the modify scope not yet granted).
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setNotice(null);
      const r = await runAction(fn, {
        fallback: "Couldn't complete that action.",
      });
      if (!r.ok) setNotice(r.error ?? "Couldn't complete that action.");
    });

  const toggleStar = () => {
    if (!selected) return;
    const next = !selectedStarred;
    setStarOverride((m) => ({ ...m, [selected.id]: next }));
    run(() => setThreadStarredAction(selected.id, next));
  };

  const menuAction = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setMenuOpen(false);
    run(fn);
  };

  // Mark read/unread, optimistically: flip the row's bold treatment (and its
  // UNREAD label, so the Unread mailbox filter agrees) before Gmail confirms.
  const setReadSelected = (read: boolean) => {
    if (!selected) return;
    const id = selected.id;
    const patch = (t: InboxThread): InboxThread => {
      if (t.id !== id) return t;
      const labelIds = read
        ? t.labelIds?.filter((l) => l !== "UNREAD")
        : t.labelIds?.includes("UNREAD")
          ? t.labelIds
          : [...(t.labelIds ?? []), "UNREAD"];
      return { ...t, unread: !read, labelIds };
    };
    setThreads((ts) => ts.map(patch));
    setRemoteData((prev) =>
      prev ? { ...prev, threads: prev.threads.map(patch) } : prev,
    );
    menuAction(() => setThreadReadAction(id, read));
  };

  // Confirm the existing archive/handled path before updating the visible list.
  function doneThread(t: InboxThread) {
    startTransition(async () => {
      const r = await runAction(
        () =>
          t.channel === "email"
            ? archiveThreadAction(t.id)
            : markChannelDoneAction(
                t.id,
                readers[t.id]?.messages.at(-1)?.date ?? 0,
              ),
        { fallback: "Could not mark done." },
      );
      if (!r.ok) {
        setNotice(r.error ?? "Could not mark done.");
        return;
      }
      const patch = (v: InboxThread) =>
        v.id === t.id
          ? {
              ...v,
              inInbox: false,
              view: "done" as const,
              needsMeReason: undefined,
            }
          : v;
      setThreads((ts) => ts.map(patch));
      setRemoteData((d) => (d ? { ...d, threads: d.threads.map(patch) } : d));
      setMobileReader(false);
      router.refresh();
    });
  }
  const archiveSelected = () => {
    if (selected) doneThread(selected);
  };
  function navigate(delta: number) {
    const i = visible.findIndex((t) => t.id === selected?.id);
    const t = visible[Math.max(0, Math.min(visible.length - 1, i + delta))];
    if (t) {
      setSelectedId(t.id);
      rootRef.current
        ?.querySelector<HTMLElement>(`[data-thread-row="${CSS.escape(t.id)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (e.key === "Escape") {
        setMenuOpen(false);
        setShowSources(false);
        setContext(null);
        return;
      }
      const action = shortcutFor({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        tagName: el.tagName,
        editable: el.isContentEditable,
        inDialog:
          Boolean(el.closest('[role="dialog"],[role="menu"]')) ||
          help ||
          linking ||
          Boolean(task) ||
          composing ||
          showSources ||
          menuOpen ||
          pending,
      });
      if (!action) return;
      e.preventDefault();
      if (action === "next") navigate(1);
      else if (action === "previous") navigate(-1);
      else if (action === "open") setMobileReader(true);
      else if (action === "done") archiveSelected();
      else if (action === "remind" && selected)
        setTask({ thread: selected, remind: true });
      else if (action === "link") setLinking(true);
      else if (action === "search") {
        setMobileReader(false);
        searchRef.current?.focus();
      } else if (action === "help") setHelp(true);
      else if (action === "reply") {
        setMobileReader(true);
        rootRef.current?.dispatchEvent(new Event("inbox-reply"));
      } else if (action === "approve")
        rootRef.current?.dispatchEvent(new Event("inbox-approve"));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div
      ref={rootRef}
      data-inbox-root
      className="relative flex h-full min-h-0 flex-col [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-focus [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-focus"
    >
      <div
        className={`${mobileReader ? "hidden @4xl/page:flex" : "flex"} min-h-12 flex-none flex-wrap items-center gap-2 border-b border-rule bg-paper px-3 py-1 @4xl/page:flex-nowrap`}
      >
        <Button
          onClick={() => setShowSources((v) => !v)}
          variant="ghost"
          icon={Filter}
          aria-expanded={showSources}
          className="min-h-11 @4xl/page:min-h-8"
        >
          Views
        </Button>
        <div className="order-last w-full overflow-x-auto @4xl/page:order-none @4xl/page:w-auto @4xl/page:flex-1">
          <Segmented
            aria-label="Inbox splits"
            value={tab ?? ""}
            onChange={(v) => {
              setTab(v as InboxTab);
              setMobileReader(false);
            }}
            options={INBOX_TABS.map((t) => ({
              ...t,
              count: emailPaused ? "—" : counts[t.value],
            }))}
            className="h-11 [&_button]:h-11 @4xl/page:h-8 @4xl/page:[&_button]:h-7"
          />
        </div>
        <label className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-rule bg-card px-2 @4xl/page:min-h-8 @4xl/page:w-28 @4xl/page:flex-none">
          <Search className="size-3.5 shrink-0 text-ink-3" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search inbox"
            placeholder="Search"
            className="w-full min-w-0 bg-transparent text-body outline-none"
          />
        </label>
        <Button
          onClick={() => setHelp(true)}
          icon={Keyboard}
          iconOnly
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          className="hidden @5xl/page:inline-flex"
        />
        {data.mailbox.connected && (
          <Button
            onClick={() => setComposing(true)}
            icon={PenSquare}
            className="min-h-11 @4xl/page:min-h-8"
          >
            Compose
          </Button>
        )}
      </div>
      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-rule bg-paper-2 px-4 py-2 text-meta text-ink-2"
        >
          <span className="flex-1">{notice}</span>
          <Button
            onClick={() => setNotice(null)}
            icon={X}
            iconOnly
            aria-label="Dismiss notice"
            title="Dismiss"
            className="size-11"
          />
        </div>
      )}
      {(data.loadError || emailPaused) && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-warn/20 bg-warn-soft px-4 py-3"
        >
          <p className="min-w-0 flex-1 text-body text-ink-2">
            {emailPaused
              ? `Email paused · ${lastSyncedAt ? `last synced ${new Date(lastSyncedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "not synced yet"}`
              : data.loadError}
          </p>
          <Button variant="secondary" size="sm" onClick={retryEmail}>
            Try again
          </Button>
        </div>
      )}
      {!data.mailbox.connected && (
        <div className="border-b border-warn/20 bg-warn-soft px-4 py-3">
          <div className="flex flex-col items-start gap-2 @xl/page:flex-row @xl/page:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-subheading font-semibold text-ink">
                No email connected
              </p>
              <p className="mt-1 text-body text-ink-2">
                {data.mailbox.canConnect
                  ? "Connect Gmail to read and reply here. Saved conversations are below."
                  : "Finish Gmail setup to connect email. Saved conversations are below."}
              </p>
            </div>
            <Button
              href={
                data.mailbox.canConnect
                  ? "/api/inbox/oauth/start"
                  : "https://console.cloud.google.com/apis/credentials"
              }
              variant="primary"
              size="sm"
              className="max-sm:h-11"
              icon={Mail}
            >
              {data.mailbox.canConnect ? "Connect Gmail" : "Set up Gmail"}
            </Button>
          </div>
          {!data.mailbox.canConnect && (
            <details className="mt-2 text-body text-ink-2">
              <summary className="cursor-pointer py-1 font-semibold">
                Gmail setup checklist
              </summary>
              <ol className="mt-2 list-decimal space-y-2 pl-5">
                <li>
                  Open Google Cloud credentials for your Gmail application.
                </li>
                <li>
                  Have your account administrator securely connect Gmail sign-in
                  and the SJC OS return address.
                </li>
                <li>
                  Reload Inbox, then choose Connect Gmail and sign in to your
                  mailbox.
                </li>
              </ol>
            </details>
          )}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {showSources && (
          <button
            type="button"
            aria-label="Close views and channels"
            tabIndex={-1}
            onClick={() => setShowSources(false)}
            className="absolute inset-0 z-20 cursor-default bg-ink/10"
          />
        )}
        {/* ─── Sources rail ─────────────────────────────────────────── */}
        <aside
          aria-label="Inbox views and channels"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button")) {
              setShowSources(false);
              setTab(null);
            }
          }}
          className={`flex-none flex-col overflow-y-auto bg-paper-2 p-3 ${showSources ? "absolute left-2 top-2 z-30 flex max-h-[calc(100%-1rem)] w-72 max-w-[calc(100%-1rem)] rounded-lg border border-rule shadow-pop" : "hidden"}`}
        >
          <button
            onClick={() => setLens({ kind: "inbox" })}
            className={[
              "mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-focus text-meta",
              isInbox
                ? "bg-accent-soft font-semibold text-accent-2"
                : "text-ink-2 hover:bg-paper-3",
            ].join(" ")}
          >
            <Inbox className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
            <span className="flex-1">Inbox</span>
            <span className="text-meta text-ink-3">
              {emailPaused ? "—" : inboxCount}
            </span>
          </button>

          <RailLabel>Smart views</RailLabel>

          <div className="flex flex-col gap-0.5">
            {data.smartViews.map((v) => (
              <button
                key={v.key}
                onClick={() => setLens({ kind: "view", view: v.key })}
                className={[
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-focus text-meta",
                  isView(v.key)
                    ? "bg-accent-soft font-semibold text-accent-2"
                    : "text-ink-2 hover:bg-paper-3",
                ].join(" ")}
              >
                <span className={`size-1.5 rounded-full ${DOT_BG[v.dot]}`} />
                <span className="flex-1">{v.label}</span>
                <span className="text-meta text-ink-3">
                  {emailPaused ? "—" : (v.count ?? "—")}
                </span>
              </button>
            ))}
          </div>

          <div className="my-2 h-px bg-rule" />
          <RailLabel>Mailboxes</RailLabel>
          <div className="flex flex-col gap-0.5">
            {SYSTEM_VIEWS.map((v) => {
              const Icon = SYSTEM_ICON[v.key];
              return (
                <button
                  key={v.key}
                  onClick={() => selectSystem(v.key)}
                  className={[
                    "flex items-center gap-2 rounded-md px-2 py-1 text-left max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-focus text-meta",
                    isSystem(v.key)
                      ? "bg-accent-soft font-semibold text-accent-2"
                      : "text-ink-2 hover:bg-paper-3",
                  ].join(" ")}
                >
                  <Icon
                    className="size-3 flex-none text-ink-3"
                    strokeWidth={1.5}
                  />
                  {/* No count badge: the only honest number would be one derived
                    from what clicking shows, but these are server-fetched pages —
                    a labels.get total counts across folders (incl. spam/trash)
                    and wouldn't match the opened list. No badge beats a wrong
                    one (same principle as the smart-view/channel counts). User
                    labels DO badge from labels.get — see the Labels rail below —
                    because their trash/spam overlap is rare, unlike Unread's,
                    where every spam thread is unread and the skew is systematic. */}
                  <span className="flex-1 truncate">{v.label}</span>
                </button>
              );
            })}
          </div>

          <div className="my-2 h-px bg-rule" />
          <RailLabel>Channels</RailLabel>
          <div className="flex flex-col gap-0.5">
            {data.channels.map((c) => {
              const Icon = CHANNEL_ICON[c.key];
              return (
                <button
                  key={c.key}
                  onClick={() => setLens({ kind: "channel", channel: c.key })}
                  className={[
                    "flex items-center gap-2 rounded-md px-2 py-1 text-left max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-focus text-meta",
                    isChannel(c.key)
                      ? "bg-accent-soft font-semibold text-accent-2"
                      : "text-ink-2 hover:bg-paper-3",
                  ].join(" ")}
                >
                  <Icon
                    className="size-3 flex-none text-ink-3"
                    strokeWidth={1.5}
                  />
                  <span className="flex-1 truncate">{c.label}</span>
                  <span className="text-meta text-ink-3">
                    {c.key === "email" && emailPaused ? "—" : (c.count ?? "—")}
                  </span>
                </button>
              );
            })}
            {data.mailbox.connected && <MailboxStrip mailbox={data.mailbox} />}
          </div>

          {data.labels.length > 0 && (
            <>
              <div className="my-2 h-px bg-rule" />
              <RailLabel>Labels</RailLabel>
              <div className="flex flex-col gap-0.5">
                {data.labels.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => selectLabel(l.id, l.name)}
                    className={[
                      "flex items-center gap-2 rounded-md px-2 py-1 text-left max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-focus text-meta",
                      isLabel(l.id)
                        ? "bg-accent-soft font-semibold text-accent-2"
                        : "text-ink-2 hover:bg-paper-3",
                    ].join(" ")}
                  >
                    <Tag
                      className="size-3 flex-none text-ink-3"
                      strokeWidth={1.5}
                    />
                    <span className="flex-1 truncate">{l.name}</span>
                    <span className="text-meta text-ink-3">
                      {emailPaused ? "—" : (l.count ?? "—")}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {data.projects.length > 0 && (
            <>
              <div className="my-2 h-px bg-rule" />
              <RailLabel>By project</RailLabel>
              <div className="flex flex-col gap-0.5">
                {data.projects.map((p) => {
                  const slug = p.slug ?? p.label;
                  return (
                    <button
                      key={slug}
                      onClick={() =>
                        setLens({ kind: "project", slug, label: p.label })
                      }
                      className={[
                        "flex items-center gap-2 rounded-md px-2 py-1 text-left max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-focus text-meta",
                        isProject(slug)
                          ? "bg-accent-soft font-semibold text-accent-2"
                          : "text-ink-2 hover:bg-paper-3",
                      ].join(" ")}
                    >
                      {p.emphasis ? (
                        <span
                          className={`size-1.5 rounded-full ${DOT_BG[p.emphasis]}`}
                        />
                      ) : (
                        <span className="size-1.5" />
                      )}
                      <span className="flex-1 truncate">{p.label}</span>
                      <span className="text-meta text-ink-3">
                        {emailPaused ? "—" : p.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </aside>

        {/* ─── Thread list ──────────────────────────────────────────── */}
        <section
          className={[
            "min-w-0 w-full flex-none flex-col border-r border-rule-soft @4xl/page:w-80 @5xl/page:w-[340px]",
            mobileReader ? "hidden @4xl/page:flex" : "flex",
          ].join(" ")}
        >
          {lens.kind !== "all" && (
            <div className="flex min-h-11 items-center gap-2 border-b border-rule-soft px-3">
              <span className="min-w-0 flex-1 truncate text-meta text-ink-3">
                {lensLabel}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLens({ kind: "all" })}
              >
                Clear view
              </Button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {remoteLoading && visible.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-meta text-ink-3">Loading {headerLabel}…</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                {/* On an empty remote lens (a mailbox/label that failed to load)
                  the reader — and its notice banner — never mounts, so surface a
                  fetch error here instead of a misleading "Nothing in …". */}
                {notice && remoteKey !== null ? (
                  <>
                    <X className="size-6 text-flag" strokeWidth={1.5} />
                    <p className="text-meta text-flag">{notice}</p>
                    <Button variant="secondary" size="sm" onClick={retryEmail}>
                      Try again
                    </Button>
                  </>
                ) : emailPaused &&
                  !(lens.kind === "channel" && lens.channel !== "email") ? (
                  <p className="text-meta text-ink-3">
                    Email is paused. Try again to check this view.
                  </p>
                ) : !data.mailbox.connected ? (
                  <NoMailboxPrompt />
                ) : (
                  <>
                    <Inbox className="size-6 text-ink-3" strokeWidth={1.5} />
                    <p className="text-meta text-ink-3">
                      Nothing in {headerLabel.toLowerCase()}.
                    </p>
                  </>
                )}
              </div>
            ) : (
              visible.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={
                    draftIds.has(t.id)
                      ? { ...t, needsMeReason: "Draft ready to review" }
                      : t
                  }
                  selected={selected?.id === t.id}
                  onDone={() => doneThread(t)}
                  onRemind={() => setTask({ thread: t, remind: true })}
                  onSelect={() => {
                    setSelectedId(t.id);
                    setMobileReader(true);
                  }}
                />
              ))
            )}

            {moreToken && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full border-t border-rule px-3 py-2.5 text-center text-meta font-medium text-ink-3 hover:bg-paper-3 disabled:opacity-60"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        </section>

        {/* ─── Reader ───────────────────────────────────────────────── */}
        <section
          className={[
            "min-w-0 flex-1 flex-col",
            mobileReader ? "flex" : "hidden @4xl/page:flex",
          ].join(" ")}
        >
          {!reader || !selected ? (
            <div className="grid flex-1 place-items-center">
              <EmptyState
                icon={Mail}
                title="Select a conversation"
                description="Choose a message from the list to read it and reply."
              />
            </div>
          ) : (
            <>
              <div className="flex-none border-b border-rule bg-paper">
                <div className="flex h-13 items-center gap-1 px-2 @4xl/page:h-12">
                  <Button
                    onClick={() => setMobileReader(false)}
                    icon={ChevronLeft}
                    iconOnly
                    aria-label="Back to inbox list"
                    title="Back"
                    className="size-11 @4xl/page:hidden"
                  />
                  <span className="min-w-0 flex-1 truncate text-body font-semibold @4xl/page:hidden">
                    {selected.fromName}
                  </span>
                  <span className="shrink-0 text-meta text-ink-3 @4xl/page:hidden">
                    {reader.channelLabel}
                  </span>
                  <Button
                    onClick={archiveSelected}
                    icon={Check}
                    variant="ghost"
                    disabled={pending}
                    className="min-h-11 @4xl/page:min-h-8"
                  >
                    Done
                  </Button>
                  <Button
                    onClick={() => setTask({ thread: selected, remind: true })}
                    icon={Clock}
                    variant="ghost"
                    title="Remind me (h)"
                    className="hidden @4xl/page:inline-flex"
                  >
                    Remind me
                  </Button>
                  <Button
                    onClick={() => setTask({ thread: selected, remind: false })}
                    icon={ListPlus}
                    variant="ghost"
                    className="hidden @5xl/page:inline-flex"
                  >
                    Make to-do
                  </Button>
                  <div className="hidden flex-1 @4xl/page:block" />
                  <Button
                    onClick={() => navigate(-1)}
                    disabled={
                      visible.findIndex((t) => t.id === selected.id) <= 0
                    }
                    icon={ChevronLeft}
                    iconOnly
                    aria-label="Previous conversation"
                    title="Previous (k)"
                    className="hidden @4xl/page:inline-flex"
                  />
                  <Button
                    onClick={() => navigate(1)}
                    disabled={
                      visible.findIndex((t) => t.id === selected.id) >=
                      visible.length - 1
                    }
                    icon={ChevronRight}
                    iconOnly
                    aria-label="Next conversation"
                    title="Next (j)"
                    className="hidden @4xl/page:inline-flex"
                  />
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen((o) => !o)}
                      aria-label="More actions"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      className="inline-flex size-11 items-center justify-center rounded hover:bg-paper-3 @4xl/page:size-8"
                    >
                      <MoreHorizontal
                        className="size-3.5 text-ink-3"
                        strokeWidth={1.5}
                      />
                    </button>
                    {menuOpen && (
                      <>
                        {/* click-away backdrop */}
                        <button
                          aria-hidden
                          tabIndex={-1}
                          onClick={() => setMenuOpen(false)}
                          className="fixed inset-0 z-10 cursor-default"
                        />
                        <div
                          role="menu"
                          className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-rule bg-card py-1 shadow-lg"
                        >
                          <MenuItem
                            icon={Clock}
                            onClick={() => {
                              setMenuOpen(false);
                              setTask({ thread: selected, remind: true });
                            }}
                          >
                            Remind me
                          </MenuItem>
                          <MenuItem
                            icon={ListPlus}
                            onClick={() => {
                              setMenuOpen(false);
                              setTask({ thread: selected, remind: false });
                            }}
                          >
                            Make to-do
                          </MenuItem>
                          <MenuItem
                            icon={LinkIcon}
                            onClick={() => {
                              setMenuOpen(false);
                              setLinking(true);
                            }}
                          >
                            Link to job / lead
                          </MenuItem>
                          {readerIsEmail && (
                            <>
                              <MenuItem icon={Star} onClick={toggleStar}>
                                {selectedStarred ? "Unstar" : "Star"}
                              </MenuItem>
                              <MenuItem
                                icon={MailOpen}
                                onClick={() => setReadSelected(true)}
                              >
                                Mark as read
                              </MenuItem>
                              <MenuItem
                                icon={Mail}
                                onClick={() => setReadSelected(false)}
                              >
                                Mark as unread
                              </MenuItem>
                              <MenuItem
                                icon={Flag}
                                onClick={() =>
                                  menuAction(() =>
                                    setThreadImportantAction(selected.id, true),
                                  )
                                }
                              >
                                Mark important
                              </MenuItem>
                              <MenuItem
                                icon={Archive}
                                onClick={archiveSelected}
                              >
                                Archive
                              </MenuItem>
                              <div className="my-1 h-px bg-rule" />
                              <MenuItem
                                icon={Trash2}
                                danger
                                onClick={() =>
                                  menuAction(() =>
                                    trashThreadAction(selected.id),
                                  )
                                }
                              >
                                Trash
                              </MenuItem>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="px-4 pb-3">
                  <h1 className="font-serif text-title font-medium leading-tight text-accent-2">
                    {reader.subject}
                  </h1>
                  <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                    <button
                      onClick={() => setContext("person")}
                      className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-rule bg-card px-2.5 text-meta text-ink-2 @4xl/page:min-h-8"
                    >
                      <Avatar initials={selected.initials} size="sm" />
                      <span className="truncate">
                        {selected.fromName} · {selected.contactRole ?? "Person"}
                      </span>
                    </button>
                    <button
                      onClick={() =>
                        selected.projectLabel
                          ? setContext("job")
                          : setLinking(true)
                      }
                      className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-rule bg-card px-2.5 text-meta text-ink-2 @4xl/page:min-h-8"
                    >
                      <LinkIcon className="size-3 shrink-0" />
                      <span className="truncate">
                        {selected.projectLabel
                          ? `${selected.projectLabel}${selected.contactStage ? ` · ${selected.contactStage}` : ""}`
                          : "Link to job / lead"}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {readerIsEmail ? (
                <ReaderBody
                  key={selected.id}
                  reader={reader}
                  threadId={selected.id}
                  onDone={archiveSelected}
                  onDraftReady={onDraftReady}
                  mailbox={selfEmail}
                />
              ) : (
                <ChannelReaderBody
                  key={selected.id}
                  reader={reader}
                  threadId={selected.id}
                  visible={mobileReader}
                  mailbox={selfEmail}
                />
              )}
            </>
          )}
        </section>

        {context && selected && (
          <ContextPanel
            key={`${selected.id}:${context}`}
            thread={selected}
            threads={threads}
            initialTab={context}
            onClose={() => setContext(null)}
            onLink={() => setLinking(true)}
            onSelect={(id) => {
              setLens({ kind: "all" });
              setTab(null);
              setQuery("");
              setSelectedId(id);
              setMobileReader(true);
            }}
          />
        )}
      </div>
      {linking && (
        <LinkPicker
          options={linkOptions}
          value={currentLink}
          onPick={relink}
          onClose={() => setLinking(false)}
        />
      )}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      {task && readers[task.thread.id] && (
        <MessageTaskDialog
          thread={task.thread}
          reader={readers[task.thread.id]}
          remind={task.remind}
          options={linkOptions}
          onClose={() => setTask(null)}
          onCreated={setNotice}
        />
      )}
      {composing && (
        <ComposeModal
          selfEmail={selfEmail}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}

function ComposeModal({
  selfEmail,
  onClose,
}: {
  selfEmail: string;
  onClose: () => void;
}) {
  const [to, setTo] = useState(selfEmail);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, startSend] = useTransition();

  function send() {
    setError("");
    startSend(async () => {
      const res = await runAction(
        () => sendNewEmailAction({ to, subject, body }),
        { fallback: "Send failed." },
      );
      if (res.ok) {
        setSent(true);
        setTimeout(onClose, 900);
      } else setError(res.error ?? "Send failed.");
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New message"
        className="max-h-[90dvh] w-full max-w-[560px] overflow-y-auto rounded-xl border border-rule-soft bg-card shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
          <h3 className="flex-1 text-subheading font-semibold text-ink">
            New message
          </h3>
          <Button
            onClick={onClose}
            icon={X}
            iconOnly
            aria-label="Close new message"
            title="Close new message"
          />
        </div>
        <div className="flex flex-col gap-2 p-4">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To"
            placeholder="To"
            className="rounded-md border border-rule bg-paper px-3 py-2 text-body text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Subject"
            placeholder="Subject"
            className="rounded-md border border-rule bg-paper px-3 py-2 text-body text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            aria-label="Message"
            placeholder="Write your message…"
            className="resize-y rounded-md border border-rule bg-paper px-3 py-2 text-body leading-relaxed text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {error && <p className="text-meta text-flag">{error}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button
              onClick={send}
              icon={Send}
              disabled={!to.trim() || !body.trim() || sending || sent}
            >
              {sent ? "Sent ✓" : sending ? "Sending…" : "Send"}
            </Button>
            <VoiceButton
              compact
              onText={(t) => setBody((cur) => mergeTranscript(cur, t))}
            />
            <span className="text-meta text-ink-3">Sends from your Gmail</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Project\nPartial basement finish" — a website-form field and its value. */
const FORM_FIELD = /^([^\n]{1,40})\n([\s\S]+)$/;

/** Where the quoted earlier conversation starts in a plain-text body: the
 *  "On <date>, <name> wrote:" line, or the first "> " quoted line. */
function quoteStart(paras: string[]): number {
  const i = paras.findIndex(
    (p) => /^On .{4,200}wrote:\s*$/m.test(p) || /^>/.test(p),
  );
  return i <= 0 ? -1 : i;
}

/** A rich email body. Wide newsletter / store emails (fixed 600–700px tables)
 *  are scaled down to the reading column instead of scrolling sideways; the
 *  quoted earlier conversation (blockquotes) folds behind "Show quoted text". */
function EmailHtml({ html }: { html: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [hasQuote, setHasQuote] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  useLayoutEffect(() => {
    const fit = () => {
      const o = outer.current,
        i = inner.current;
      if (!o || !i) return;
      i.style.zoom = "1";
      // Text wraps to the column; only a fixed-width layout (a 600–700px table)
      // overflows it — that one is scaled down to fit.
      const natural = i.scrollWidth,
        room = i.clientWidth;
      setZoom(
        natural > room + 2 && room > 0 ? Math.max(0.45, room / natural) : 1,
      );
    };
    fit();
    setHasQuote(!!inner.current?.querySelector("blockquote"));
    const ro = new ResizeObserver(fit);
    if (outer.current) ro.observe(outer.current);
    const imgs = Array.from(inner.current?.querySelectorAll("img") ?? []);
    imgs.forEach((im) => im.addEventListener("load", fit));
    return () => {
      ro.disconnect();
      imgs.forEach((im) => im.removeEventListener("load", fit));
    };
  }, [html]);
  return (
    <div ref={outer} className="min-w-0 overflow-x-auto">
      <div
        ref={inner}
        style={{ zoom }}
        className={`email-html text-body leading-relaxed text-ink [&_a]:text-accent [&_a]:underline [&_img]:my-1 [&_img]:rounded ${showQuote ? "" : "[&_blockquote]:hidden"}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {hasQuote && (
        <button
          type="button"
          onClick={() => setShowQuote((v) => !v)}
          className="mt-2 inline-flex min-h-9 items-center rounded-md px-2 text-meta font-semibold text-accent-2 hover:bg-hover"
        >
          {showQuote ? "Hide quoted text" : "Show quoted text"}
        </button>
      )}
    </div>
  );
}

function PlainBody({ paras }: { paras: string[] }) {
  const [showQuote, setShowQuote] = useState(false);
  const q = quoteStart(paras);
  const shown = q > 0 && !showQuote ? paras.slice(0, q) : paras;
  return (
    <div className="flex flex-col gap-2.5">
      {shown.map((para, j) => (
        <p
          key={j}
          className="whitespace-pre-line break-words text-body leading-relaxed text-ink"
        >
          {para}
        </p>
      ))}
      {q > 0 && (
        <button
          type="button"
          onClick={() => setShowQuote((v) => !v)}
          className="inline-flex min-h-9 w-fit items-center rounded-md px-2 text-meta font-semibold text-accent-2 hover:bg-hover"
        >
          {showQuote ? "Hide quoted text" : "Show quoted text"}
        </button>
      )}
    </div>
  );
}

function useInboxDraft(
  mailbox: string,
  threadId: string,
  toEmail: string,
  initialBody = "",
) {
  const key = draftKey(mailbox, threadId);
  const [value, setValue] = useState<SavedInboxDraft>({
    body: initialBody,
    toEmail,
    model: "",
    ai: false,
  });
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    try {
      const d = readDraft(localStorage, key);
      if (d) setValue(d);
    } catch {
      setStorageError(true);
    }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (!loaded) return;
    try {
      if (!writeDraft(localStorage, key, value.body ? value : null))
        setStorageError(true);
    } catch {
      setStorageError(true);
    }
  }, [key, value, loaded]);
  function clear() {
    try {
      writeDraft(localStorage, key, null);
    } catch {}
    setValue({ body: "", toEmail, model: "", ai: false });
  }
  return { value, set: setValue, clear, loaded, storageError };
}
function useReplyShortcut(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  onOpen?: () => void,
) {
  useEffect(() => {
    const root = ref.current?.closest("[data-inbox-root]");
    const reply = () => {
      onOpen?.();
      requestAnimationFrame(() => ref.current?.focus());
    };
    root?.addEventListener("inbox-reply", reply);
    return () => root?.removeEventListener("inbox-reply", reply);
  });
}

function ChannelReaderBody({
  reader,
  threadId,
  visible,
  mailbox = "",
}: {
  reader: ThreadReader;
  threadId: string;
  visible?: boolean;
  mailbox?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const saved = useInboxDraft(mailbox, threadId, "");
  const body = saved.value.body;
  const setBody = (body: string) => saved.set({ ...saved.value, body });
  const replyRef = useRef<HTMLTextAreaElement>(null);
  useReplyShortcut(replyRef);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const chat = reader.channel !== "site_form";
  useLayoutEffect(() => {
    if (chat && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [chat, threadId, reader.messages, visible]);
  const canReply = chat || Boolean(reader.messages[0]?.fromEmail);
  function send() {
    setError("");
    start(async () => {
      const r = await runAction(
        () => sendChannelReplyAction({ threadId, body }),
        { fallback: "Could not send your reply." },
      );
      if (r.ok) {
        saved.clear();
        router.refresh();
      } else setError(r.error ?? "Could not send your reply.");
    });
  }
  return (
    <>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ThreadSummary reader={reader} />
        <div className="flex flex-col gap-3">
          {reader.messages.map((m, i) => {
            const day = m.date
              ? new Date(m.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "";
            const previous = reader.messages[i - 1]?.date;
            const newDay =
              day &&
              (!previous ||
                new Date(previous).toDateString() !==
                  new Date(m.date!).toDateString());
            return (
              <div key={m.id ?? i}>
                {chat && newDay && (
                  <div
                    role="separator"
                    className="mb-3 text-center text-meta text-ink-3"
                  >
                    {day}
                  </div>
                )}
                <div
                  className={`flex flex-col ${chat && m.outbound ? "items-end" : "items-start"}`}
                >
                  <div className="mb-1 text-meta text-ink-3">
                    {m.fromName} · {m.meta}
                  </div>
                  <div
                    className={
                      chat
                        ? `max-w-[90%] rounded-xl px-3 py-2 ${m.outbound ? "bg-accent-soft" : "border border-rule bg-card"}`
                        : "w-full"
                    }
                  >
                    {reader.channel === "site_form" &&
                    m.body.length > 1 &&
                    m.body.slice(1).every((p) => FORM_FIELD.test(p)) ? (
                      <>
                        <p className="mb-3 whitespace-pre-line text-body leading-relaxed text-ink">
                          {m.body[0]}
                        </p>
                        <dl className="grid gap-x-4 gap-y-2 @xl/page:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
                          {m.body.slice(1).map((para, j) => {
                            const [, label, value] =
                              para.match(FORM_FIELD) ?? [];
                            return (
                              <div key={j} className="contents">
                                <dt className="text-meta text-ink-3">
                                  {label}
                                </dt>
                                <dd className="mb-1 whitespace-pre-line break-words text-body text-ink">
                                  {value}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      </>
                    ) : (
                      <PlainBody paras={m.body} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex-none border-t border-rule bg-paper-2 px-4 py-3">
        <p className="mb-2 break-words text-meta text-ink-3">
          {reader.replyLabel}
        </p>
        {canReply && (
          <>
            <textarea
              ref={replyRef}
              aria-label={reader.channel === "sms" ? "Text reply" : "Reply"}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={reader.channel === "sms" ? 2 : 3}
              placeholder="Write a reply…"
              className="max-h-[30dvh] min-h-16 w-full resize-y rounded-lg border border-rule bg-card p-2 text-body text-ink"
            />
            <div className="mt-2 flex items-center gap-2">
              <span className="hidden text-meta text-ink-3 @4xl/page:inline">
                r Reply · e Done · ? Shortcuts
              </span>
              {reader.channel === "sms" && (
                <span className="text-meta text-ink-3">
                  {smsSegments(body)} segment
                  {smsSegments(body) === 1 ? "" : "s"}
                </span>
              )}
              <div className="flex-1" />
              <Button
                onClick={send}
                disabled={!body.trim() || pending}
                icon={Send}
              >
                {pending ? "Sending…" : "Send"}
              </Button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="mt-2 text-meta text-flag">
            {error}
          </p>
        )}
        {reader.actionHref && (
          <a
            href={reader.actionHref}
            className="mt-2 inline-flex min-h-11 items-center gap-1 text-meta text-accent-2 underline"
          >
            <ExternalLink className="size-3" />
            {reader.actionLabel ?? "Open project"}
          </a>
        )}
      </div>
    </>
  );
}

function ThreadRow({
  thread,
  selected,
  onSelect,
  onDone,
  onRemind,
}: {
  thread: InboxThread;
  selected: boolean;
  onSelect: () => void;
  onDone?: () => void;
  onRemind?: () => void;
}) {
  const Icon = CHANNEL_ICON[thread.channel];
  const [rowMenu, setRowMenu] = useState(false);
  const needs = Boolean(thread.needsMeReason) || thread.view === "needs_reply";
  return (
    <div
      className={`group relative border-b border-rule-soft ${selected ? "bg-selected" : "hover:bg-hover"}`}
    >
      {selected && (
        <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" />
      )}
      <button
        data-thread-row={thread.id}
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="flex min-h-16 w-full items-start gap-2 px-3 py-2 text-left [@media(hover:none)]:pr-14"
      >
        <span className="relative mt-1 shrink-0">
          <Avatar initials={thread.initials} kind={needs ? "accent" : "gray"} />
          <span
            title={thread.channel.replaceAll("_", " ")}
            className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full border border-rule bg-card"
          >
            <Icon className="size-2.5 text-accent-2" />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={`min-w-0 flex-1 truncate text-label ${needs ? "font-bold text-ink" : "text-ink-2"}`}
            >
              {thread.fromName}
            </span>
            {thread.projectLabel && (
              <Chip kind="accent" className="max-w-20">
                {thread.projectLabel}
              </Chip>
            )}
            <span className="shrink-0 text-meta text-ink-3">{thread.when}</span>
          </span>
          <span
            className={`block truncate text-meta ${needs ? "text-accent-2" : "text-ink-3"}`}
          >
            {thread.needsMeReason ??
              (thread.automated
                ? "Automated message"
                : thread.view === "done"
                  ? "Handled"
                  : thread.view === "awaiting_them"
                    ? "Waiting for their reply"
                    : thread.unread
                      ? "Unread"
                      : thread.subject)}
          </span>
          <span className="block truncate text-meta text-ink-3">
            {thread.preview || thread.subject}
          </span>
        </span>
      </button>
      <div className="absolute right-2 top-1 hidden items-center rounded-md border border-rule bg-card shadow-card group-hover:flex group-focus-within:flex [@media(hover:none)]:hidden">
        <Button
          variant="ghost"
          size="sm"
          icon={Check}
          iconOnly
          aria-label={`Done: ${thread.fromName}`}
          title="Done (e)"
          onClick={onDone}
          className="min-h-11 min-w-11 @4xl/page:min-h-7 @4xl/page:min-w-7"
        />
        <Button
          variant="ghost"
          size="sm"
          icon={Clock}
          iconOnly
          aria-label={`Remind me: ${thread.fromName}`}
          title="Remind me (h)"
          onClick={onRemind}
          className="min-h-11 min-w-11 @4xl/page:min-h-7 @4xl/page:min-w-7"
        />
      </div>
      <Button
        variant="ghost"
        icon={MoreHorizontal}
        iconOnly
        aria-label={`Actions: ${thread.fromName}`}
        title="Conversation actions"
        aria-expanded={rowMenu}
        onClick={() => setRowMenu((v) => !v)}
        className="absolute right-1 top-2 hidden size-11 [@media(hover:none)]:inline-flex"
      />
      {rowMenu && (
        <div
          role="menu"
          className="flex flex-wrap justify-end gap-2 border-t border-rule-soft bg-card px-2 py-1"
        >
          <Button
            variant="ghost"
            icon={Check}
            onClick={() => {
              setRowMenu(false);
              onDone?.();
            }}
            className="min-h-11"
          >
            Done
          </Button>
          <Button
            variant="ghost"
            icon={Clock}
            onClick={() => {
              setRowMenu(false);
              onRemind?.();
            }}
            className="min-h-11"
          >
            Remind me
          </Button>
        </div>
      )}
    </div>
  );
}

function EmailMessageCard({
  message,
  threadId,
  expanded,
  onToggle,
}: {
  message: ThreadReader["messages"][number];
  threadId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [html, setHtml] = useState("");
  const loaded = useRef(false);
  useEffect(() => {
    if (!expanded || loaded.current || !message.id) return;
    let alive = true;
    getThreadHtmlAction(threadId, message.id)
      .then((r) => {
        if (alive) {
          setHtml(r.html);
          loaded.current = true;
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [expanded, threadId, message.id]);
  return (
    <article className="overflow-hidden rounded-lg border border-rule bg-card">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex h-11 w-full items-center gap-2 px-3 text-left"
      >
        <Avatar initials={message.initials} size="sm" />
        <span className="max-w-[35%] truncate text-meta font-semibold text-ink">
          {message.fromName}
        </span>
        {!expanded && (
          <span className="min-w-0 flex-1 truncate text-meta text-ink-3">
            {message.body[0]}
          </span>
        )}
        <span className="ml-auto shrink-0 text-meta text-ink-3">
          {message.meta}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-rule-soft px-3 py-3">
          <div className="mb-3 break-words text-meta text-ink-3">
            <p>
              {message.fromName} {message.fromEmail && `<${message.fromEmail}>`}
            </p>
            <p>To: {message.to}</p>
            {Boolean(message.cc?.length) && <p>Cc: {message.cc!.join(", ")}</p>}
            {message.date && (
              <p>{new Date(message.date).toLocaleString("en-US")}</p>
            )}
          </div>
          {html ? (
            <EmailHtml html={html} />
          ) : (
            <PlainBody paras={message.body} />
          )}
          {Boolean(message.attachments?.length) && (
            <ul
              aria-label="Attachments"
              className="mt-3 space-y-1 border-t border-rule-soft pt-2"
            >
              {message.attachments!.map((a, i) => (
                <li
                  key={a.id || i}
                  className="break-words text-meta text-ink-2"
                >
                  {a.name} · {Math.ceil(a.size / 1024)} KB · {a.type}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

// Scrollable message body + AI draft card + send composer, with the draft/send
// state for this thread. Keyed on threadId by the caller so it resets on switch.
// The AI draft is generated on demand (local-LLM, too slow to prebuild for every
// thread); the mock path may arrive with aiDraft.body already filled.
function ReaderBody({
  reader,
  threadId,
  onDone,
  onDraftReady,
  mailbox = "",
}: {
  reader: ThreadReader;
  threadId: string;
  onDone?: () => void;
  onDraftReady?: (id: string, ready: boolean) => void;
  mailbox?: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set([
        reader.messages.at(-1)?.id ?? String(reader.messages.length - 1),
      ]),
  );
  const saved = useInboxDraft(
    mailbox,
    threadId,
    reader.replyTarget?.toEmail ?? "",
    reader.aiDraft.body,
  );
  const {
    body: draft,
    toEmail,
    ai: isAI,
    model,
    replyAll = false,
  } = saved.value;
  const update = (patch: Partial<SavedInboxDraft>) =>
    saved.set({ ...saved.value, ...patch });
  const [replying, setReplying] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [drafting, startDraft] = useTransition();
  const [sending, startSend] = useTransition();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const approvalRef = useRef<HTMLTextAreaElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const hasDraft = Boolean(draft.trim());
  useEffect(() => {
    onDraftReady?.(threadId, hasDraft && isAI && !sent);
  }, [threadId, hasDraft, isAI, sent, onDraftReady]);
  useEffect(() => {
    const root = regionRef.current?.closest("[data-inbox-root]");
    const reply = () => {
      if (reader.automated || !reader.replyTarget) return;
      setReplying(true);
      if (isAI) setDraftOpen(true);
      requestAnimationFrame(() =>
        (isAI ? approvalRef : composerRef).current?.focus(),
      );
    };
    const approve = () => {
      if (!isAI) return;
      setDraftOpen(true);
      requestAnimationFrame(() =>
        root?.querySelector<HTMLButtonElement>("[data-draft-send]")?.focus(),
      );
    };
    root?.addEventListener("inbox-reply", reply);
    root?.addEventListener("inbox-approve", approve);
    return () => {
      root?.removeEventListener("inbox-reply", reply);
      root?.removeEventListener("inbox-approve", approve);
    };
  }, [isAI, reader.automated, reader.replyTarget]);
  function toggleMessage(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function generate(intent = "") {
    setError("");
    setSent(false);
    setDraftOpen(true);
    startDraft(async () => {
      const r = await runAction(
        () => draftReplyAction(threadId, "hermes", intent),
        { fallback: "Could not draft a reply." },
      );
      if (r.ok) {
        saved.set({
          body: r.body ?? "",
          toEmail: toEmail || r.toEmail || "",
          ai: true,
          model: r.model ?? "Hermes",
          replyAll,
        });
      } else setError(r.error ?? "Could not draft a reply.");
    });
  }
  function discard() {
    saved.clear();
    setReplying(false);
    setDraftOpen(false);
    setSent(false);
    setError("");
    onDraftReady?.(threadId, false);
  }
  function send() {
    setError("");
    startSend(async () => {
      const r = await runAction(
        () =>
          sendReplyAction({
            threadId,
            toEmail,
            replyAll,
            subject: reader.subject,
            body: draft,
          }),
        { fallback: "Send failed." },
      );
      if (r.ok) {
        saved.clear();
        setSent(true);
        setDraftOpen(false);
        setReplying(false);
        onDraftReady?.(threadId, false);
        router.refresh();
      } else setError(r.error ?? "Send failed.");
    });
  }
  const approval = (
    <div
      className={`rounded-xl border border-ai/35 bg-card p-3 shadow-card ${draftOpen ? "" : "hidden @4xl/page:block"}`}
    >
      <div className="mb-2 flex items-start gap-2">
        <Chip kind="ai">Draft by {model || "AI"}</Chip>
        <span className="flex-1" />
        <Button
          variant="ghost"
          icon={X}
          iconOnly
          aria-label="Close draft sheet"
          title="Close draft sheet"
          onClick={() => setDraftOpen(false)}
          className="size-11 @4xl/page:hidden"
        />
      </div>
      <p className="mb-2 break-words text-meta text-ink-3">
        To {reader.replyTarget?.toName} &lt;{toEmail}&gt; · via Email · not sent
      </p>
      <textarea
        ref={approvalRef}
        aria-label="AI draft body"
        value={draft}
        disabled={sending}
        onChange={(e) => update({ body: e.target.value })}
        rows={6}
        className="max-h-[40dvh] min-h-24 w-full resize-y bg-transparent text-body leading-relaxed text-ink outline-none focus-visible:ring-1 focus-visible:ring-focus"
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button
          data-draft-send
          onClick={send}
          disabled={!hasDraft || !toEmail.trim() || sending || drafting}
          icon={Send}
          className="min-h-11 @4xl/page:min-h-8"
        >
          {sending ? "Sending…" : "Send"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => approvalRef.current?.focus()}
          className="min-h-11 @4xl/page:min-h-8"
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          onClick={() => generate()}
          disabled={drafting || sending}
          className="min-h-11 @4xl/page:min-h-8"
        >
          Regenerate
        </Button>
        <Button
          variant="ghost"
          onClick={discard}
          disabled={sending}
          className="min-h-11 @4xl/page:min-h-8"
        >
          Discard
        </Button>
      </div>
      <p className="mt-2 text-meta text-ink-3">
        Your Send click approves this draft.
      </p>
    </div>
  );
  return (
    <>
      <div ref={regionRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ThreadSummary reader={reader} />
        <div className="mx-auto flex max-w-[720px] flex-col gap-3">
          {reader.messages.length > 1 && (
            <button
              type="button"
              onClick={() =>
                setExpanded(
                  new Set(reader.messages.map((m, i) => m.id ?? String(i))),
                )
              }
              className="min-h-11 self-end px-2 text-meta font-semibold text-accent-2"
            >
              Expand all
            </button>
          )}
          {reader.messages.map((m, i) => {
            const id = m.id ?? String(i);
            return (
              <EmailMessageCard
                key={id}
                message={m}
                threadId={threadId}
                expanded={expanded.has(id)}
                onToggle={() => toggleMessage(id)}
              />
            );
          })}
          {!reader.automated && isAI && hasDraft && (
            <div
              className={`${draftOpen ? "absolute inset-x-0 bottom-0 z-40 max-h-[80%] overflow-y-auto rounded-t-2xl border-t border-rule bg-paper p-3 shadow-modal @4xl/page:static @4xl/page:z-auto @4xl/page:max-h-none @4xl/page:border-0 @4xl/page:bg-transparent @4xl/page:p-0 @4xl/page:shadow-none" : "hidden @4xl/page:block"}`}
            >
              {approval}
            </div>
          )}
        </div>
      </div>
      <div className="flex-none border-t border-rule bg-paper-2 px-4 py-2.5">
        {reader.automated ? (
          <div className="flex items-center gap-2">
            <p className="flex-1 text-meta text-ink-3">
              Automated message — no reply needed
            </p>
            <Button onClick={onDone}>Done</Button>
          </div>
        ) : !reader.replyTarget ? (
          <p className="text-meta text-ink-3">
            No incoming message to reply to.
          </p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-meta text-ink-2">
              <label className="flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-full border border-rule bg-card px-2 py-1">
                To: {reader.replyTarget.toName} &lt;
                <input
                  aria-label="Reply recipient"
                  type="email"
                  value={toEmail}
                  onChange={(e) => update({ toEmail: e.target.value })}
                  className="min-h-8 min-w-0 max-w-full bg-transparent text-meta text-ink outline-none"
                />
                &gt;
              </label>
              <label className="inline-flex min-h-11 items-center gap-1">
                <input
                  type="checkbox"
                  checked={replyAll}
                  onChange={(e) => update({ replyAll: e.target.checked })}
                />
                Reply all
              </label>
              {replyAll &&
                reader.replyTarget.cc.map((email) => (
                  <Chip key={email} kind="ghost">
                    Cc: {email}
                  </Chip>
                ))}
            </div>
            {isAI && hasDraft ? (
              <Button
                variant="ai"
                onClick={() => setDraftOpen(true)}
                className="min-h-11 @4xl/page:hidden"
              >
                Review draft
              </Button>
            ) : replying || hasDraft ? (
              <div className="rounded-lg border border-rule bg-card p-2">
                <textarea
                  ref={composerRef}
                  aria-label="Reply body"
                  value={draft}
                  onChange={(e) => {
                    setSent(false);
                    update({ body: e.target.value });
                  }}
                  rows={3}
                  placeholder={reader.replyPlaceholder}
                  className="max-h-[30dvh] min-h-16 w-full resize-y bg-transparent text-body text-ink outline-none"
                />
                <div className="flex items-center gap-2">
                  <VoiceButton
                    compact
                    onText={(t) => update({ body: mergeTranscript(draft, t) })}
                  />
                  <Button variant="ghost" onClick={discard}>
                    Discard
                  </Button>
                  <span className="flex-1" />
                  <Button
                    onClick={send}
                    disabled={
                      !hasDraft || !toEmail.trim() || sending || drafting
                    }
                    icon={Send}
                  >
                    {sending ? "Sending…" : "Send"}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setReplying(true);
                  setSent(false);
                  requestAnimationFrame(() => composerRef.current?.focus());
                }}
                className="min-h-11 w-full rounded-lg border border-rule bg-card px-3 text-left text-body text-ink-3"
              >
                {reader.replyPlaceholder}
              </button>
            )}
            {!isAI && (
              <div className="mt-2 flex items-center gap-1 overflow-x-auto">
                <span className="shrink-0 text-meta text-ink-3">
                  Draft a reply
                </span>
                {[
                  "Yes, works",
                  "Need more info",
                  "Schedule a visit",
                  "Thanks",
                ].map((intent) => (
                  <Button
                    key={intent}
                    variant="ghost"
                    size="sm"
                    onClick={() => generate(intent)}
                    disabled={drafting || sending}
                    className="min-h-11 @4xl/page:min-h-7"
                  >
                    {intent}
                  </Button>
                ))}
              </div>
            )}
            {drafting && (
              <p role="status" className="mt-1 text-meta text-ink-3">
                Drafting a reply…
              </p>
            )}
            <p className="mt-1 hidden text-meta text-ink-3 @4xl/page:block">
              r Reply · a Focus draft Send · e Done · ? Shortcuts
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="mt-1 text-meta text-flag">
            {error}
          </p>
        )}
        {sent && (
          <p role="status" className="mt-1 text-meta text-ink-3">
            Reply sent ✓
          </p>
        )}
        {saved.storageError && (
          <p className="mt-1 text-meta text-warn">
            Draft storage is unavailable in this browser. Keep this conversation
            open until you send.
          </p>
        )}
      </div>
    </>
  );
}

/** Which mailbox this inbox is reading, pinned under the Channels rail. Before
 *  staff logins the answer was hardcoded in the rail label as "Email (joe@sjc)",
 *  which is exactly the kind of detail of Joe's that has no business on someone
 *  else's account. Now it reports the connected address, and offers the Connect
 *  / Disconnect controls for a person's own mailbox. */
function MailboxStrip({ mailbox }: { mailbox: MailboxState }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!mailbox.connected) {
    return (
      <div className="mt-1 rounded-md border border-dashed border-rule px-2 py-2">
        <p className="text-meta leading-snug text-ink-3">No email connected.</p>
        {mailbox.canConnect ? (
          <a
            href="/api/inbox/oauth/start"
            className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-meta font-semibold text-white hover:bg-accent-2"
          >
            <Mail className="size-3" strokeWidth={1.5} /> Connect your email
          </a>
        ) : (
          <p className="mt-1 text-meta leading-snug text-ink-3">
            Ask Joe to finish the Gmail app setup first.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-1 px-2 py-1">
      <p
        className="truncate text-meta text-ink-3"
        title={mailbox.email ?? undefined}
      >
        {mailbox.email ?? "Gmail connected"}
      </p>
      {mailbox.linked && (
        <button
          onClick={() =>
            start(async () => {
              await runAction(() => disconnectMyMailboxAction(), {
                fallback: "Couldn't disconnect.",
              });
              router.refresh();
            })
          }
          disabled={pending}
          className="mt-0.5 text-meta text-ink-3 underline hover:text-flag disabled:opacity-50"
        >
          {pending ? "Disconnecting…" : "Disconnect"}
        </button>
      )}
    </div>
  );
}

/** Thread-list body when this account has no mailbox linked. Blank, not the
 *  demo mock and not Joe's mail (his rule, 2026-09-27: "link able to their
 *  email otherwise blank"). */
function NoMailboxPrompt() {
  return (
    <EmptyState
      icon={Inbox}
      title="Your conversations live here"
      description="Texts, portal messages and website forms appear here as they arrive. Your email will appear here once Gmail is connected."
      compact
    />
  );
}

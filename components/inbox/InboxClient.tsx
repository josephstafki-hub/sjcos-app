"use client";

import { useMemo, useState, useEffect, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Filter,
  Mail,
  MessageSquare,
  UserRound,
  UserCheck,
  Globe,
  Tag,
  Pin,
  MoreHorizontal,
  ChevronLeft,
  ArrowRight,
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
  type LucideIcon,
} from "lucide-react";
import { Button, PageHeader, EmptyState, Segmented, Chip, Avatar, VoiceButton } from "@/components/ui";
import { mergeTranscript } from "@/lib/append-transcript";
import {
  draftReplyAction,
  getThreadHtmlAction,
  sendReplyAction,
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
import { AI_NAME } from "@/lib/ai-name";
import type { Audience, InboxData, InboxThread, MailboxState, ThreadReader } from "@/lib/inbox";

/** The single active lens over the thread list. Smart view is the default; a
 *  channel, label or project selection temporarily takes over (Gmail-style —
 *  one active source at a time). The Clients/Subs/Money audience filter is NOT
 *  a lens — it layers on top of whichever lens is active (see audienceFilter). */
type Lens =
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
const SYSTEM_LABEL_ID: Partial<Record<SystemViewKey, string>> = Object.fromEntries(
  SYSTEM_VIEWS.filter((v) => v.labelId).map((v) => [v.key, v.labelId!]),
);

const AUDIENCE_LABEL: Record<Audience, string> = {
  client: "Clients",
  sub: "Subs",
  money: "Money",
};

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
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-meta hover:bg-paper-3",
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
  const [lens, setLens] = useState<Lens>({
    kind: "view",
    view: data.activeView.key,
  });
  // Clients/Subs/Money audience filter. Layers on top of the active lens (so
  // "Unread + Clients only" works) and deliberately persists across lens
  // changes until cleared with the All chip. null = no audience filter.
  const [audienceFilter, setAudienceFilter] = useState<Audience | null>(null);
  const [selectedId, setSelectedId] = useState(data.selectedId);
  // Mobile master/detail: below lg, show the thread list OR the reader, not both.
  const [mobileReader, setMobileReader] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [composing, setComposing] = useState(false);
  // Threads/readers grow as "Load more" pages in from Gmail.
  const [threads, setThreads] = useState(data.threads);
  const [readers, setReaders] = useState(data.readers);
  const [pageToken, setPageToken] = useState(data.nextPageToken);
  // Follow the server's first page: a refresh (LiveUpdates, or an action's own
  // revalidate) re-reads Gmail — new mail, read state, links. Plain useState
  // kept the first render forever, so counts and the list went stale. Pages
  // pulled in with "Load more" stay after it; render-phase adjustment, as in
  // lib/use-server-state.ts.
  const serverJson = JSON.stringify([data.threads, data.readers]);
  const [seenServer, setSeenServer] = useState({
    json: serverJson,
    ids: data.threads.map((t) => t.id),
    token: data.nextPageToken,
  });
  if (serverJson !== seenServer.json) {
    const oldFirst = new Set(seenServer.ids);
    const fresh = new Set(data.threads.map((t) => t.id));
    setSeenServer({ json: serverJson, ids: [...fresh], token: data.nextPageToken });
    setThreads((prev) => [...data.threads, ...prev.filter((t) => !oldFirst.has(t.id) && !fresh.has(t.id))]);
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
  } | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Optimistic star state, keyed by thread id, until the revalidate lands.
  const [starOverride, setStarOverride] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();

  // Threads under the current lens, before the audience filter is applied.
  const baseVisible = useMemo(() => {
    switch (lens.kind) {
      case "inbox":
        return threads.filter((t) => t.inInbox);
      case "view":
        return threads.filter((t) => t.view === lens.view);
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
  }, [threads, lens, remoteData]);

  // Layer the Clients/Subs/Money audience filter on top of the lens.
  const visible = useMemo(
    () =>
      audienceFilter
        ? baseVisible.filter((t) => t.audience === audienceFilter)
        : baseVisible,
    [baseVisible, audienceFilter],
  );

  // Count of threads sitting in the Gmail inbox (the plain "Inbox" rail view).
  const inboxCount = useMemo(
    () => threads.filter((t) => t.inInbox).length,
    [threads],
  );

  // Counts for the Clients/Subs/Money chips, scoped to the CURRENT lens (how
  // many of each audience are in this view), so the number matches what the
  // chip actually reveals rather than a global tally.
  const audienceCounts = useMemo(() => {
    const c = { client: 0, sub: 0, money: 0 };
    for (const t of baseVisible) if (t.audience) c[t.audience]++;
    return c;
  }, [baseVisible]);

  // Keep the selection valid as the lens narrows the list.
  const selected =
    visible.find((t) => t.id === selectedId) ?? visible[0] ?? null;
  const reader = selected ? readers[selected.id] : undefined;
  // Non-email channels (SMS / portals / website forms) are read-only in the
  // inbox: their reply/star/link surfaces are Gmail-only, so those controls are
  // hidden and the reader links out to each channel's own surface instead.
  const readerIsEmail = (reader?.channel ?? "email") === "email";

  const linkOptions = data.linkOptions;
  const currentLink =
    selected?.linkedType && selected?.linkedSlug ? `${selected.linkedType}:${selected.linkedSlug}` : "";

  // Manually (re)link the open thread to a project/lead, optimistically (P6-3).
  function relink(next: string) {
    if (!selected) return;
    const id = selected.id;
    if (!next) {
      setThreads((ts) =>
        ts.map((t) =>
          t.id === id ? { ...t, linkedType: undefined, linkedSlug: undefined, projectSlug: undefined, projectLabel: undefined } : t,
        ),
      );
      startTransition(async () => {
        await runAction(() => unlinkThread(id), { fallback: "Couldn't unlink the thread." });
      });
      return;
    }
    const [type, slug] = next.split(":") as ["project" | "lead", string];
    const label =
      (type === "project" ? linkOptions?.projects : linkOptions?.leads)?.find((o) => o.slug === slug)?.name ?? slug;
    setThreads((ts) =>
      ts.map((t) =>
        t.id === id
          ? {
              ...t,
              linkedType: type,
              linkedSlug: slug,
              audience: "client",
              projectSlug: type === "project" ? slug : undefined,
              projectLabel: label,
              tag: label,
            }
          : t,
      ),
    );
    startTransition(async () => {
      await runAction(() => linkThread(id, type, slug), { fallback: "Couldn't link the thread." });
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
      error?: string;
    }>,
  ) => {
    if (remoteData?.key === key) return;
    setRemoteData(null);
    setRemoteLoading(true);
    startTransition(async () => {
      const r = await runAction(loader, { fallback: "Couldn't load that view." });
      if (r.ok && r.threads) {
        setReaders((prev) => ({ ...prev, ...(r.readers ?? {}) }));
        setRemoteData({ key, threads: r.threads, pageToken: r.nextPageToken });
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
              : loadSystemViewAction((lens as { view: SystemViewKey }).view, moreToken)
            : loadMoreInboxAction(moreToken),
        { fallback: "Couldn't load more." },
      );
      if (r.ok && r.threads) {
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
    lens.kind === "inbox"
      ? "Inbox"
      : lens.kind === "view"
        ? data.smartViews.find((v) => v.key === lens.view)?.label ?? "Inbox"
        : lens.kind === "channel"
          ? data.channels.find((c) => c.key === lens.channel)?.label ?? "Channel"
          : lens.kind === "project"
            ? lens.label
            : lens.kind === "system"
              ? SYSTEM_VIEWS.find((v) => v.key === lens.view)?.label ?? "Mailbox"
              : lens.name;
  // Append the active audience filter so a persisted filter doesn't silently
  // shorten the list (e.g. "Unread · Clients").
  const headerLabel = audienceFilter
    ? `${lensLabel} · ${AUDIENCE_LABEL[audienceFilter]}`
    : lensLabel;

  const isInbox = lens.kind === "inbox";
  const isView = (k: ThreadStatus) => lens.kind === "view" && lens.view === k;
  const isChannel = (k: ThreadChannel) =>
    lens.kind === "channel" && lens.channel === k;
  const isLabel = (id: string) => lens.kind === "label" && lens.id === id;
  const isSystem = (k: SystemViewKey) => lens.kind === "system" && lens.view === k;
  const isProject = (slug: string) =>
    lens.kind === "project" && lens.slug === slug;

  const selectedStarred = selected
    ? starOverride[selected.id] ?? selected.starred ?? false
    : false;

  // Run a Gmail mutation; surface a plain-language notice if it fails (the
  // usual cause is the modify scope not yet granted).
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setNotice(null);
      const r = await runAction(fn, { fallback: "Couldn't complete that action." });
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

  // Archive, optimistically: drop the thread out of the inbox and into Done so
  // it leaves Needs reply / Inbox immediately instead of lingering until reload.
  // A snoozed thread stays snoozed (Gmail keeps SNOOZED through an archive).
  const archiveSelected = () => {
    if (!selected) return;
    const id = selected.id;
    setThreads((ts) =>
      ts.map((t) =>
        t.id === id
          ? { ...t, inInbox: false, view: t.view === "snoozed" ? t.view : "done" }
          : t,
      ),
    );
    // On mobile the reader occupies the whole screen; once the thread leaves the
    // lens there's no back button, so return to the list (matches Gmail mobile).
    setMobileReader(false);
    menuAction(() => archiveThreadAction(id));
  };

  return (
    <div className="flex h-full min-h-0 flex-col [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-focus [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-focus">
      <div className="border-b border-rule-soft px-4 py-5 @2xl/page:px-5"><PageHeader title="Inbox" meta="Email, texts and portal conversations in one place." /></div>
      {!data.mailbox.connected && (
        <div className="border-b border-warn/20 bg-warn-soft px-4 py-3">
          <div className="flex flex-col items-start gap-2 @xl/page:flex-row @xl/page:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-subheading font-semibold text-ink">No email connected</p>
              <p className="mt-1 text-body text-ink-2">{data.mailbox.canConnect ? "Connect Gmail to read and reply here. Saved conversations are below." : "Finish Gmail setup to connect email. Saved conversations are below."}</p>
            </div>
            <Button href={data.mailbox.canConnect ? "/api/inbox/oauth/start" : "https://console.cloud.google.com/apis/credentials"} variant="primary" size="sm" className="max-sm:h-11" icon={Mail}>{data.mailbox.canConnect ? "Connect Gmail" : "Set up Gmail"}</Button>
          </div>
          {!data.mailbox.canConnect && <details className="mt-2 text-body text-ink-2">
            <summary className="cursor-pointer py-1 font-semibold">Gmail setup checklist</summary>
            <ol className="mt-2 list-decimal space-y-2 pl-5">
              <li>Open Google Cloud credentials for your Gmail application.</li>
              <li>Have your account administrator securely connect Gmail sign-in and the SJC OS return address.</li>
              <li>Reload Inbox, then choose Connect Gmail and sign in to your mailbox.</li>
            </ol>
          </details>}
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-rule-soft px-3 py-2 @5xl/page:hidden"><Button onClick={() => {setShowSources(v => !v); setMobileReader(false);}} variant="secondary" size="sm" icon={Filter} aria-expanded={showSources}>Views and channels</Button><span className="min-w-0 truncate text-meta text-ink-3">{headerLabel}</span></div>
      <div className="flex min-h-0 flex-1">
      {/* ─── Sources rail ─────────────────────────────────────────── */}
      <aside aria-label="Inbox views and channels" onClick={(e) => { if ((e.target as HTMLElement).closest("button")) setShowSources(false); }} className={`flex-none flex-col overflow-y-auto border-r border-rule-soft bg-paper-2 p-3 @5xl/page:flex @5xl/page:w-52 ${showSources ? "flex w-full" : "hidden"}`}>
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
          <span className="text-meta text-ink-3">{inboxCount}</span>
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
              <span className="text-meta text-ink-3">{v.count}</span>
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
                <Icon className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
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
                <Icon className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                <span className="flex-1 truncate">{c.label}</span>
                <span className="text-meta text-ink-3">{c.count}</span>
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
                  <Tag className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                  <span className="flex-1 truncate">{l.name}</span>
                  {l.count != null && (
                    <span className="text-meta text-ink-3">{l.count}</span>
                  )}
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
                    onClick={() => setLens({ kind: "project", slug, label: p.label })}
                    className={[
                      "flex items-center gap-2 rounded-md px-2 py-1 text-left max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-focus text-meta",
                      isProject(slug)
                        ? "bg-accent-soft font-semibold text-accent-2"
                        : "text-ink-2 hover:bg-paper-3",
                    ].join(" ")}
                  >
                    {p.emphasis ? (
                      <span className={`size-1.5 rounded-full ${DOT_BG[p.emphasis]}`} />
                    ) : (
                      <span className="size-1.5" />
                    )}
                    <span className="flex-1 truncate">{p.label}</span>
                    <span className="text-meta text-ink-3">{p.count}</span>
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
          "min-w-0 w-full flex-none flex-col border-r border-rule-soft @4xl/page:w-80 @5xl/page:w-[380px]",
          showSources ? "hidden @5xl/page:flex" : mobileReader ? "hidden @4xl/page:flex" : "flex",
        ].join(" ")}
      >
        <div className="flex-none border-b border-rule px-3.5 py-3">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-subheading font-semibold text-ink">
              {headerLabel}
              <span className="ml-1.5 text-meta font-normal text-ink-3">
                {visible.length}
              </span>
            </h2>
            {data.mailbox.connected && <Button onClick={() => setComposing(true)} disabled={!data.mailbox.connected} title={!data.mailbox.connected ? "Connect Gmail before composing an email" : undefined} size="sm" icon={PenSquare}>Compose</Button>}
          </div>
          {/* Audience filter — layers on top of the active sidebar lens, so it
              refines the current view (e.g. Unread → Clients) instead of
              replacing it. All clears the filter; clicking the lit chip clears
              it too. */}
          <div className="mt-3"><Segmented aria-label="Inbox audience" value={audienceFilter ?? "all"} onChange={v => setAudienceFilter(v === "all" ? null : v as Audience)} options={[{value:"all",label:"All"},{value:"client",label:"Clients",count:audienceCounts.client || undefined},{value:"sub",label:"Subs",count:audienceCounts.sub || undefined},{value:"money",label:"Money",count:audienceCounts.money || undefined}]} /></div>
        </div>

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
              {notice && onRemote ? (
                <>
                  <X className="size-6 text-flag" strokeWidth={1.5} />
                  <p className="text-meta text-flag">{notice}</p>
                </>
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
                thread={t}
                selected={selected?.id === t.id}
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
          showSources ? "hidden @5xl/page:flex" : mobileReader ? "flex" : "hidden @4xl/page:flex",
        ].join(" ")}
      >
        {!reader || !selected ? <div className="grid flex-1 place-items-center"><EmptyState icon={Mail} title="Select a conversation" description="Choose a message from the list to read it and reply." /></div> : (
          <>
            <div className="flex-none border-b border-rule px-4 py-3">
              <div className="mb-1.5 flex items-center gap-2">
                <button
                  onClick={() => setMobileReader(false)}
                  aria-label="Back to inbox list"
                  className="-ml-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-paper-3 @4xl/page:hidden"
                >
                  <ChevronLeft className="size-4" strokeWidth={1.5} />
                </button>
                <span className="text-meta font-semibold text-ink-2">{reader.tag}</span>
                <Chip kind="ghost">
                  {(() => {
                    const Icon = CHANNEL_ICON[reader.channel];
                    return <Icon className="size-2.5" strokeWidth={1.5} />;
                  })()}
                  {reader.channelLabel}
                </Chip>
                <Chip kind="ghost">
                  {reader.messageCount} {reader.messageCount === 1 ? "message" : "messages"}
                </Chip>
                <div className="flex-1" />
                {readerIsEmail && (
                  <button
                    onClick={toggleStar}
                    disabled={pending}
                    aria-label={selectedStarred ? "Unstar" : "Star"}
                    className="rounded p-0.5 hover:bg-paper-3 disabled:opacity-50"
                  >
                    <Pin
                      className={`size-3.5 ${selectedStarred ? "fill-accent text-accent" : "text-ink-3"}`}
                      strokeWidth={1.5}
                    />
                  </button>
                )}
                {readerIsEmail && (
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen((o) => !o)}
                    aria-label="More actions"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    className="rounded p-0.5 hover:bg-paper-3"
                  >
                    <MoreHorizontal className="size-3.5 text-ink-3" strokeWidth={1.5} />
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
                        <MenuItem icon={Star} onClick={toggleStar}>
                          {selectedStarred ? "Unstar" : "Star"}
                        </MenuItem>
                        <MenuItem icon={MailOpen} onClick={() => setReadSelected(true)}>
                          Mark as read
                        </MenuItem>
                        <MenuItem icon={Mail} onClick={() => setReadSelected(false)}>
                          Mark as unread
                        </MenuItem>
                        <MenuItem
                          icon={Flag}
                          onClick={() =>
                            menuAction(() => setThreadImportantAction(selected.id, true))
                          }
                        >
                          Mark important
                        </MenuItem>
                        <MenuItem icon={Archive} onClick={archiveSelected}>
                          Archive
                        </MenuItem>
                        <div className="my-1 h-px bg-rule" />
                        <MenuItem
                          icon={Trash2}
                          danger
                          onClick={() => menuAction(() => trashThreadAction(selected.id))}
                        >
                          Trash
                        </MenuItem>
                      </div>
                    </>
                  )}
                </div>
                )}
              </div>
              <h1 className="font-serif text-title font-medium leading-tight text-accent-2">
                {reader.subject}
              </h1>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Avatar initials={reader.messages[0].initials} size="sm" />
                <span className="flex-1 text-meta text-ink-3">
                  {reader.messages[0].fromName} · {reader.messages[0].meta}
                </span>
                <ArrowRight className="size-3 text-ink-3" strokeWidth={1.5} />
                <span className="text-meta text-ink-3">{reader.messages[0].to}</span>
              </div>

              {readerIsEmail && linkOptions && (
                <div className="mt-2 flex items-center gap-1.5">
                  <Tag className="size-3 flex-none text-ink-3" strokeWidth={1.75} />
                  <span className="text-meta text-ink-3">Linked to</span>
                  <select
                    value={currentLink}
                    onChange={(e) => relink(e.target.value)}
                    className="max-w-[220px] rounded border border-rule bg-card px-1.5 py-0.5 text-meta text-ink-2 focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <option value="">— not linked —</option>
                    {linkOptions.projects.length > 0 && (
                      <optgroup label="Projects">
                        {linkOptions.projects.map((p) => (
                          <option key={`project:${p.slug}`} value={`project:${p.slug}`}>{p.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {linkOptions.leads.length > 0 && (
                      <optgroup label="Leads">
                        {linkOptions.leads.map((l) => (
                          <option key={`lead:${l.slug}`} value={`lead:${l.slug}`}>{l.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {selected?.linkedType && <Chip kind="accent" dot>linked</Chip>}
                </div>
              )}
            </div>

            {notice && (
              <div className="flex items-center gap-2 border-b border-flag/30 bg-flag-soft px-4 py-2 text-meta text-flag">
                <span className="flex-1">{notice}</span>
                <button onClick={() => setNotice(null)} aria-label="Dismiss">
                  <X className="size-3.5" strokeWidth={1.5} />
                </button>
              </div>
            )}

            {readerIsEmail ? (
              <ReaderBody key={selected.id} reader={reader} threadId={selected.id} />
            ) : (
              <ReadOnlyReaderBody key={selected.id} reader={reader} />
            )}
          </>
        )}
      </section>

      </div>
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
      const res = await runAction(() => sendNewEmailAction({ to, subject, body }), { fallback: "Send failed." });
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
        role="dialog" aria-modal="true" aria-label="New message" className="max-h-[90dvh] w-full max-w-[560px] overflow-y-auto rounded-xl border border-rule-soft bg-card shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
          <h3 className="flex-1 text-subheading font-semibold text-ink">
            New message
          </h3>
          <Button onClick={onClose} icon={X} iconOnly aria-label="Close new message" title="Close new message" />
        </div>
        <div className="flex flex-col gap-2 p-4">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To" placeholder="To"
            className="rounded-md border border-rule bg-paper px-3 py-2 text-body text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Subject" placeholder="Subject"
            className="rounded-md border border-rule bg-paper px-3 py-2 text-body text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            aria-label="Message" placeholder="Write your message…"
            className="resize-y rounded-md border border-rule bg-paper px-3 py-2 text-body leading-relaxed text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {error && <p className="text-meta text-flag">{error}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button onClick={send} icon={Send} disabled={!to.trim() || !body.trim() || sending || sent}>
              {sent ? "Sent ✓" : sending ? "Sending…" : "Send"}
            </Button>
            <VoiceButton compact onText={(t) => setBody((cur) => mergeTranscript(cur, t))} />
            <span className="text-meta text-ink-3">Sends from your Gmail</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Non-email channels are read-only in the unified inbox: render the
// conversation and link out to where a reply actually happens (the channel's
// own surface). No AI-draft/Gmail-send composer, no lazy html fetch.
function ReadOnlyReaderBody({ reader }: { reader: ThreadReader }) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex max-w-[600px] flex-col gap-4">
          {reader.messages.map((m, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-meta text-ink-3">
                <Avatar initials={m.initials} size="sm" />
                <span className="font-medium text-ink-2">{m.fromName}</span>
                <span>· {m.meta}</span>
              </div>
              <div className="flex flex-col gap-2 pl-[26px]">
                {m.body.map((para, j) => (
                  <p key={j} className="whitespace-pre-line text-body leading-relaxed text-ink">
                    {para}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-none border-t border-rule bg-paper-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-meta text-ink-3">
            Read-only here — reply on the {reader.channelLabel.toLowerCase()} surface.
          </span>
          {reader.actionHref && (
            <a
              href={reader.actionHref}
              className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-meta font-medium text-white"
            >
              <ExternalLink className="size-3" strokeWidth={1.5} />
              {reader.actionLabel ?? "Open"}
            </a>
          )}
        </div>
      </div>
    </>
  );
}

function ThreadRow({
  thread,
  selected,
  onSelect,
}: {
  thread: InboxThread;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = CHANNEL_ICON[thread.channel];
  // Email-client read/unread treatment: unread rows carry full-weight type and
  // an accent dot; read rows recede to normal weight and lighter ink.
  const unread = thread.unread ?? false;
  return (
    <button
      onClick={onSelect}
      className={[
        "relative block w-full border-b border-rule-soft px-3.5 py-2.5 text-left transition-colors last:border-b-0",
        selected ? "bg-selected" : "hover:bg-hover",
      ].join(" ")}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
      <div className="flex items-start gap-2">
        <Avatar
          initials={thread.initials}
          kind={thread.emphasis === "ghost" ? "gray" : "accent"}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={[
                "min-w-0 flex-1 break-words text-subheading",
                unread ? "font-bold text-ink" : "font-normal text-ink-2",
              ].join(" ")}
            >
              {thread.fromName}
            </span>
            {(unread || thread.urgent) && <span className={`size-1.5 flex-none rounded-full ${thread.urgent ? "bg-flag" : "bg-accent"}`} aria-label={thread.urgent ? "Needs attention" : "Unread"} />}
            <Icon className="size-2.5 flex-none text-ink-3" strokeWidth={1.5} />
            <span
              className={`text-meta ${unread ? "font-medium text-accent-2" : "text-ink-3"}`}
            >
              {thread.when}
            </span>
          </div>
          <div
            className={`mt-0.5 truncate text-meta ${unread ? "font-medium text-ink" : "text-ink-3"}`}
          >
            {thread.subject}
          </div>
          <div className={`mt-0.5 truncate text-meta ${unread ? "text-ink-2" : "text-ink-3"}`}>
            {thread.preview}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-meta text-ink-3">{thread.tag}</span>
            {thread.labelNames?.map((name) => (
              <Chip key={name} kind="ghost">
                {name}
              </Chip>
            ))}
            {thread.aiVerdict && <Chip kind="ai">AI: {thread.aiVerdict}</Chip>}
            {thread.activeJob && (
              <Chip kind="accent" dot>
                Active job
              </Chip>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// Scrollable message body + AI draft card + send composer, with the draft/send
// state for this thread. Keyed on threadId by the caller so it resets on switch.
// The AI draft is generated on demand (local-LLM, too slow to prebuild for every
// thread); the mock path may arrive with aiDraft.body already filled.
function ReaderBody({ reader, threadId }: { reader: ThreadReader; threadId: string }) {
  const [draft, setDraft] = useState(reader.aiDraft.body);
  const [meta, setMeta] = useState<{ toEmail: string; subject: string } | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [drafting, startDraft] = useTransition();
  const [sending, startSend] = useTransition();
  const hasDraft = draft.trim().length > 0;

  // Rich HTML body (with inline images) is resolved lazily on thread open so the
  // list fetch stays cheap. Empty string = no HTML / not connected → fall back to
  // the plain-text paragraphs already on the reader.
  const [html, setHtml] = useState("");
  useEffect(() => {
    let alive = true;
    getThreadHtmlAction(threadId)
      .then((r) => {
        if (alive) setHtml(r.html);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [threadId]);

  function generate() {
    setError("");
    startDraft(async () => {
      const r = await runAction(() => draftReplyAction(threadId, "hermes"), { fallback: "Could not draft a reply." });
      if (r.ok) {
        setDraft(r.body ?? "");
        setMeta({ toEmail: r.toEmail ?? "", subject: r.subject ?? reader.subject });
      } else {
        setError(r.error ?? "Could not draft a reply.");
      }
    });
  }

  function send() {
    setError("");
    startSend(async () => {
      const res = await runAction(
        () =>
          sendReplyAction({
            threadId,
            toEmail: meta?.toEmail ?? "",
            subject: meta?.subject ?? reader.subject,
            body: draft,
          }),
        { fallback: "Send failed." },
      );
      if (res.ok) setSent(true);
      else setError(res.error ?? "Send failed.");
    });
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex max-w-[600px] flex-col gap-2.5">
          {reader.messages.map((m, i) => {
            const isLatest = i === reader.messages.length - 1;
            // The rich HTML body (`fetchThreadHtml`) covers only the latest
            // message; earlier ones keep the plain-text paragraphs.
            if (isLatest && html) {
              return (
                <div
                  key={i}
                  className="email-html text-body leading-relaxed text-ink [&_a]:text-accent [&_a]:underline [&_img]:my-1 [&_img]:rounded"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              );
            }
            return (
              <div key={i} className="flex flex-col gap-2.5">
                {m.body.map((para, j) => (
                  <p key={j} className="whitespace-pre-line text-body leading-relaxed text-ink">
                    {para}
                  </p>
                ))}
              </div>
            );
          })}
        </div>


      </div>

      <div className="flex-none border-t border-rule-soft px-4 py-3">
        <div className="rounded-lg border border-rule bg-card p-3 focus-within:outline-2 focus-within:outline-focus">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="min-w-0 flex-1">{hasDraft && <Chip kind="ai">AI draft</Chip>}<p className="mt-1 text-meta text-ink-3">{reader.aiDraft.summary}</p></div><Button variant="ghost" size="sm" onClick={generate} disabled={drafting}>{drafting ? "Drafting…" : hasDraft ? "Regenerate draft" : `Draft with ${AI_NAME}`}</Button></div>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} placeholder={reader.replyPlaceholder} className="min-h-20 w-full resize-y border-0 bg-transparent text-body leading-relaxed text-ink outline-none" />
          {error && <p role="alert" className="mt-2 text-meta text-flag">{error}</p>}
          <div className="mt-2 flex items-center justify-end gap-2"><VoiceButton compact onText={t => setDraft(cur => mergeTranscript(cur,t))} /><Button onClick={send} icon={Send} disabled={!draft.trim() || sending || sent}>{sent ? "Sent" : sending ? "Sending…" : "Send"}</Button></div>
        </div>
        {sent && <p className="mt-1 text-meta text-ink-3">Reply sent ✓</p>}
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
      <p className="truncate text-meta text-ink-3" title={mailbox.email ?? undefined}>
        {mailbox.email ?? "Connected"}
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
  return <EmptyState icon={Inbox} title="Your conversations live here" description="Texts, portal messages and website forms appear here as they arrive. Your email will appear here once Gmail is connected." compact />;
}

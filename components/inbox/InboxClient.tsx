"use client";

import { useMemo, useState, useEffect, useTransition, type ReactNode } from "react";
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
  type LucideIcon,
} from "lucide-react";
import { Card, Chip, Avatar } from "@/components/ui";
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
} from "@/lib/actions/inbox";
import type { ThreadChannel, ThreadStatus } from "@/lib/types";
import type { Audience, InboxData, InboxThread, ThreadReader } from "@/lib/inbox";

/** The single active lens over the thread list. Smart view is the default; a
 *  channel, label, audience or project selection temporarily takes over
 *  (Gmail-style — one active filter at a time). */
type Lens =
  | { kind: "all" }
  | { kind: "view"; view: ThreadStatus }
  | { kind: "channel"; channel: ThreadChannel }
  | { kind: "label"; id: string; name: string }
  | { kind: "audience"; audience: Audience }
  | { kind: "project"; slug: string; label: string };

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
    <div className="px-1 pb-1 pt-2 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
      {children}
    </div>
  );
}

const DOT_BG: Record<string, string> = {
  flag: "bg-flag",
  accent: "bg-accent",
  ghost: "bg-ink-4",
};

/** A Chip rendered as a toggle button for the audience filter row. */
function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button onClick={onClick} className="focus:outline-none">
      <Chip kind={active ? "solid" : "ghost"}>{children}</Chip>
    </button>
  );
}

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
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-paper-3",
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
  ownerEmail,
}: {
  data: InboxData;
  ownerEmail: string;
}) {
  const [lens, setLens] = useState<Lens>({
    kind: "view",
    view: data.activeView.key,
  });
  const [selectedId, setSelectedId] = useState(data.selectedId);
  const [composing, setComposing] = useState(false);
  // Threads/readers grow as "Load more" pages in from Gmail.
  const [threads, setThreads] = useState(data.threads);
  const [readers, setReaders] = useState(data.readers);
  const [pageToken, setPageToken] = useState(data.nextPageToken);
  const [loadingMore, setLoadingMore] = useState(false);
  // Label view is fetched server-side (scoped to that Gmail label) so it shows
  // the label's full mail, not just whatever paged into the inbox window. Keyed
  // by label id with its own pagination token; null until a label is opened.
  const [labelData, setLabelData] = useState<{
    id: string;
    threads: InboxThread[];
    pageToken?: string;
  } | null>(null);
  const [labelLoading, setLabelLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Optimistic star state, keyed by thread id, until the revalidate lands.
  const [starOverride, setStarOverride] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();

  // Threads visible under the current lens.
  const visible = useMemo(() => {
    switch (lens.kind) {
      case "all":
        return threads;
      case "view":
        return threads.filter((t) => t.view === lens.view);
      case "channel":
        return threads.filter((t) => t.channel === lens.channel);
      case "label":
        // Prefer the server-fetched, label-scoped list once it's loaded; until
        // then (or if it fails) fall back to client-filtering the loaded inbox.
        return labelData?.id === lens.id
          ? labelData.threads
          : threads.filter((t) => (t.labelIds ?? []).includes(lens.id));
      case "audience":
        return threads.filter((t) => t.audience === lens.audience);
      case "project":
        return threads.filter((t) => t.projectSlug === lens.slug);
    }
  }, [threads, lens, labelData]);

  // Counts for the All/Clients/Subs/Money chips, derived from resolved senders.
  const audienceCounts = useMemo(() => {
    const c = { client: 0, sub: 0, money: 0 };
    for (const t of threads) if (t.audience) c[t.audience]++;
    return c;
  }, [threads]);

  // Keep the selection valid as the lens narrows the list.
  const selected =
    visible.find((t) => t.id === selectedId) ?? visible[0] ?? null;
  const reader = selected ? readers[selected.id] : undefined;

  // Open a label: fetch its mail server-side (scoped to that Gmail label) with
  // its own pagination. Re-clicking the open label is a no-op (cache stays).
  const selectLabel = (id: string, name: string) => {
    setLens({ kind: "label", id, name });
    if (labelData?.id === id) return;
    setLabelData(null);
    setLabelLoading(true);
    startTransition(async () => {
      const r = await loadLabelInboxAction(id);
      if (r.ok && r.threads) {
        setReaders((prev) => ({ ...prev, ...(r.readers ?? {}) }));
        setLabelData({ id, threads: r.threads, pageToken: r.nextPageToken });
      } else if (!r.ok) {
        setNotice(r.error ?? "Couldn't load that label.");
      }
      setLabelLoading(false);
    });
  };

  const onLabel = lens.kind === "label" && labelData?.id === lens.id;
  // "Load more" pages within the open label when one is selected, else the inbox.
  const moreToken = onLabel ? labelData?.pageToken : pageToken;

  const loadMore = () => {
    if (!moreToken || loadingMore) return;
    setLoadingMore(true);
    startTransition(async () => {
      const r = onLabel
        ? await loadLabelInboxAction(lens.id, moreToken)
        : await loadMoreInboxAction(moreToken);
      if (r.ok && r.threads) {
        setReaders((prev) => ({ ...prev, ...(r.readers ?? {}) }));
        if (onLabel) {
          setLabelData((prev) =>
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

  const headerLabel =
    lens.kind === "all"
      ? "All mail"
      : lens.kind === "view"
        ? data.smartViews.find((v) => v.key === lens.view)?.label ?? "Inbox"
        : lens.kind === "channel"
          ? data.channels.find((c) => c.key === lens.channel)?.label ?? "Channel"
          : lens.kind === "audience"
            ? AUDIENCE_LABEL[lens.audience]
            : lens.kind === "project"
              ? lens.label
              : lens.name;

  const isView = (k: ThreadStatus) => lens.kind === "view" && lens.view === k;
  const isChannel = (k: ThreadChannel) =>
    lens.kind === "channel" && lens.channel === k;
  const isLabel = (id: string) => lens.kind === "label" && lens.id === id;
  const isAudience = (a: Audience) =>
    lens.kind === "audience" && lens.audience === a;
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
      const r = await fn();
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

  return (
    <div className="flex h-full">
      {/* ─── Sources rail ─────────────────────────────────────────── */}
      <aside className="w-[220px] flex-none overflow-y-auto border-r border-rule bg-paper-2 p-3">
        <Card kind="soft" className="mb-3 flex items-center gap-1.5 px-2.5 py-1.5">
          <Filter className="size-3 text-ink-3" strokeWidth={1.5} />
          <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
            Smart views
          </span>
        </Card>

        <div className="flex flex-col gap-0.5">
          {data.smartViews.map((v) => (
            <button
              key={v.key}
              onClick={() => setLens({ kind: "view", view: v.key })}
              className={[
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px]",
                isView(v.key)
                  ? "bg-accent-soft font-semibold text-accent-2"
                  : "text-ink-2 hover:bg-paper-3",
              ].join(" ")}
            >
              <span className={`size-1.5 rounded-full ${DOT_BG[v.dot]}`} />
              <span className="flex-1">{v.label}</span>
              <span className="font-mono text-[10px] text-ink-3">{v.count}</span>
            </button>
          ))}
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
                  "flex items-center gap-2 rounded-md px-2 py-1 text-left text-[12px]",
                  isChannel(c.key)
                    ? "bg-accent-soft font-semibold text-accent-2"
                    : "text-ink-2 hover:bg-paper-3",
                ].join(" ")}
              >
                <Icon className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                <span className="flex-1 truncate">{c.label}</span>
                <span className="font-mono text-[10px] text-ink-3">{c.count}</span>
              </button>
            );
          })}
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
                    "flex items-center gap-2 rounded-md px-2 py-1 text-left text-[12px]",
                    isLabel(l.id)
                      ? "bg-accent-soft font-semibold text-accent-2"
                      : "text-ink-2 hover:bg-paper-3",
                  ].join(" ")}
                >
                  <Tag className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                  <span className="flex-1 truncate">{l.name}</span>
                  <span className="font-mono text-[10px] text-ink-3">{l.count}</span>
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
                      "flex items-center gap-2 rounded-md px-2 py-1 text-left text-[12px]",
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
                    <span className="font-mono text-[10px] text-ink-3">{p.count}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </aside>

      {/* ─── Thread list ──────────────────────────────────────────── */}
      <section className="flex w-[340px] flex-none flex-col border-r border-rule">
        <div className="flex-none border-b border-rule px-3.5 py-3">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 font-serif text-[16px] font-semibold text-ink">
              {headerLabel}
              <span className="ml-1.5 font-mono text-[11px] font-normal text-ink-3">
                {visible.length}
              </span>
            </h2>
            <button
              onClick={() => setComposing(true)}
              className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white"
            >
              <PenSquare className="size-3" strokeWidth={1.5} />
              Compose
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1">
            <ChipButton active={lens.kind === "all"} onClick={() => setLens({ kind: "all" })}>
              All
            </ChipButton>
            <ChipButton
              active={isAudience("client")}
              onClick={() => setLens({ kind: "audience", audience: "client" })}
            >
              Clients{audienceCounts.client ? ` ${audienceCounts.client}` : ""}
            </ChipButton>
            <ChipButton
              active={isAudience("sub")}
              onClick={() => setLens({ kind: "audience", audience: "sub" })}
            >
              Subs{audienceCounts.sub ? ` ${audienceCounts.sub}` : ""}
            </ChipButton>
            <ChipButton
              active={isAudience("money")}
              onClick={() => setLens({ kind: "audience", audience: "money" })}
            >
              Money{audienceCounts.money ? ` ${audienceCounts.money}` : ""}
            </ChipButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {labelLoading && visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-[12px] text-ink-3">Loading {headerLabel}…</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <Inbox className="size-6 text-ink-4" strokeWidth={1.5} />
              <p className="text-[12px] text-ink-3">
                Nothing in {headerLabel.toLowerCase()}.
              </p>
            </div>
          ) : (
            visible.map((t) => (
              <ThreadRow
                key={t.id}
                thread={t}
                selected={selected?.id === t.id}
                onSelect={() => setSelectedId(t.id)}
              />
            ))
          )}

          {moreToken && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full border-t border-rule px-3 py-2.5 text-center text-[12px] font-medium text-ink-3 hover:bg-paper-3 disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      </section>

      {/* ─── Reader ───────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col">
        {reader && selected && (
          <>
            <div className="flex-none border-b border-rule px-[18px] py-3">
              <div className="mb-1.5 flex items-center gap-2">
                <Chip kind="accent" dot>
                  {reader.tag}
                </Chip>
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
                        <MenuItem
                          icon={MailOpen}
                          onClick={() => menuAction(() => setThreadReadAction(selected.id, true))}
                        >
                          Mark as read
                        </MenuItem>
                        <MenuItem
                          icon={Mail}
                          onClick={() => menuAction(() => setThreadReadAction(selected.id, false))}
                        >
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
                        <MenuItem
                          icon={Archive}
                          onClick={() => menuAction(() => archiveThreadAction(selected.id))}
                        >
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
              </div>
              <h1 className="font-serif text-[22px] font-medium leading-tight text-accent-2">
                {reader.subject}
              </h1>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Avatar initials={reader.messages[0].initials} size="sm" />
                <span className="flex-1 text-[12px] text-ink-3">
                  {reader.messages[0].fromName} · {reader.messages[0].meta}
                </span>
                <ArrowRight className="size-3 text-ink-3" strokeWidth={1.5} />
                <span className="text-[12px] text-ink-3">{reader.messages[0].to}</span>
              </div>
            </div>

            {notice && (
              <div className="flex items-center gap-2 border-b border-flag/30 bg-flag-soft px-[18px] py-2 text-[12px] text-flag">
                <span className="flex-1">{notice}</span>
                <button onClick={() => setNotice(null)} aria-label="Dismiss">
                  <X className="size-3.5" strokeWidth={1.5} />
                </button>
              </div>
            )}

            <ReaderBody key={selected.id} reader={reader} threadId={selected.id} />
          </>
        )}
      </section>

      {composing && (
        <ComposeModal
          ownerEmail={ownerEmail}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}

function ComposeModal({
  ownerEmail,
  onClose,
}: {
  ownerEmail: string;
  onClose: () => void;
}) {
  const [to, setTo] = useState(ownerEmail);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, startSend] = useTransition();

  function send() {
    setError("");
    startSend(async () => {
      const res = await sendNewEmailAction({ to, subject, body });
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
        className="w-full max-w-[560px] rounded-xl border border-rule bg-paper shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
          <h3 className="flex-1 font-serif text-[15px] font-semibold text-ink">
            New message
          </h3>
          <button onClick={onClose} className="text-ink-3 hover:text-ink">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="To"
            className="rounded-md border border-rule bg-paper px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="rounded-md border border-rule bg-paper px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            placeholder="Write your message…"
            className="resize-y rounded-md border border-rule bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {error && <p className="text-[12px] text-flag">{error}</p>}
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={send}
              disabled={!to.trim() || !body.trim() || sending || sent}
              className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
            >
              <Send className="size-3" strokeWidth={1.5} />
              {sent ? "Sent ✓" : sending ? "Sending…" : "Send"}
            </button>
            <span className="text-[11px] text-ink-3">Sends from your Gmail</span>
          </div>
        </div>
      </div>
    </div>
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
  return (
    <button
      onClick={onSelect}
      className={[
        "relative block w-full border-b border-rule-soft px-3.5 py-2.5 text-left transition-colors last:border-b-0",
        selected ? "bg-paper-2" : thread.urgent ? "bg-flag-soft" : "hover:bg-paper-2",
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
            <span className="flex-1 truncate font-serif text-[13px] font-semibold text-ink">
              {thread.fromName}
            </span>
            <Icon className="size-2.5 flex-none text-ink-3" strokeWidth={1.5} />
            <span className="font-mono text-[9px] text-ink-3">{thread.when}</span>
          </div>
          <div className="mt-0.5 truncate text-[12px] text-ink-2">{thread.subject}</div>
          <div className="mt-0.5 truncate text-[11px] text-ink-3">{thread.preview}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Chip kind={thread.urgent ? "flag" : "ghost"}>{thread.tag}</Chip>
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
      const r = await draftReplyAction(threadId);
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
      const res = await sendReplyAction({
        threadId,
        toEmail: meta?.toEmail ?? "",
        subject: meta?.subject ?? reader.subject,
        body: draft,
      });
      if (res.ok) setSent(true);
      else setError(res.error ?? "Send failed.");
    });
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
        <div className="flex max-w-[600px] flex-col gap-2.5">
          {reader.messages.map((m, i) => {
            const isLatest = i === reader.messages.length - 1;
            // The rich HTML body (`fetchThreadHtml`) covers only the latest
            // message; earlier ones keep the plain-text paragraphs.
            if (isLatest && html) {
              return (
                <div
                  key={i}
                  className="email-html text-[13px] leading-relaxed text-ink [&_a]:text-accent [&_a]:underline [&_img]:my-1 [&_img]:rounded"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              );
            }
            return (
              <div key={i} className="flex flex-col gap-2.5">
                {m.body.map((para, j) => (
                  <p key={j} className="whitespace-pre-line text-[13px] leading-relaxed text-ink">
                    {para}
                  </p>
                ))}
              </div>
            );
          })}
        </div>

        <div className="my-4 max-w-[600px] border-t border-dashed border-ink-4" />

        <Card kind="ai" className="max-w-[600px] p-2.5">
          <div className="text-[13px] text-ai-2">
            <div className="mb-1 font-serif text-[14px] font-semibold">Qwen draft reply</div>
            <p>{reader.aiDraft.summary}</p>
            <div className="mt-2.5">
              <button
                onClick={generate}
                disabled={drafting}
                className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-60"
              >
                {drafting
                  ? "Drafting…"
                  : hasDraft
                    ? "Regenerate draft"
                    : "Draft a reply"}
              </button>
            </div>
            {error && <p className="mt-2 text-[12px] text-flag">{error}</p>}
          </div>
        </Card>
      </div>

      <div className="flex-none border-t border-rule bg-paper-2 px-[18px] py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder={reader.replyPlaceholder}
            className="min-h-[40px] flex-1 resize-y rounded-lg border border-rule bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {!hasDraft && (
            <button
              onClick={generate}
              disabled={drafting}
              className="h-9 whitespace-nowrap rounded-md px-2 text-[12px] font-medium text-ai-2 disabled:opacity-60"
            >
              {drafting ? "Drafting…" : "Use AI draft"}
            </button>
          )}
          <button
            onClick={send}
            disabled={!draft.trim() || sending || sent}
            className="flex h-9 items-center gap-1 rounded-md bg-accent px-3 text-[12px] font-medium text-white disabled:opacity-50"
          >
            <Send className="size-3" strokeWidth={1.5} />
            {sent ? "Sent" : sending ? "Sending…" : "Send"}
          </button>
        </div>
        {sent && <p className="mt-1 text-[11px] text-ink-3">Reply sent ✓</p>}
      </div>
    </>
  );
}

"use client";

import { useState, useTransition } from "react";
import {
  Filter,
  Mail,
  MessageSquare,
  UserRound,
  UserCheck,
  Globe,
  Pin,
  MoreHorizontal,
  ArrowRight,
  Send,
  PenSquare,
  X,
  type LucideIcon,
} from "lucide-react";
import { Card, Chip, Avatar } from "@/components/ui";
import {
  draftReplyAction,
  sendReplyAction,
  sendNewEmailAction,
} from "@/lib/actions/inbox";
import type { ThreadChannel } from "@/lib/types";
import type { InboxData, InboxThread, ThreadReader } from "@/lib/inbox";

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

export function InboxClient({
  data,
  ownerEmail,
}: {
  data: InboxData;
  ownerEmail: string;
}) {
  const [selectedId, setSelectedId] = useState(data.selectedId);
  const [composing, setComposing] = useState(false);
  const reader = data.readers[selectedId];

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
            <div
              key={v.key}
              className={[
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px]",
                v.active
                  ? "bg-accent-soft font-semibold text-accent-2"
                  : "text-ink-2 hover:bg-paper-3",
              ].join(" ")}
            >
              <span className={`size-1.5 rounded-full ${DOT_BG[v.dot]}`} />
              <span className="flex-1">{v.label}</span>
              <span className="font-mono text-[10px] text-ink-3">{v.count}</span>
            </div>
          ))}
        </div>

        <div className="my-2 h-px bg-rule" />
        <RailLabel>Channels</RailLabel>
        <div className="flex flex-col gap-0.5">
          {data.channels.map((c) => {
            const Icon = CHANNEL_ICON[c.key];
            return (
              <div
                key={c.key}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-[12px] text-ink-2 hover:bg-paper-3"
              >
                <Icon className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                <span className="flex-1 truncate">{c.label}</span>
                <span className="font-mono text-[10px] text-ink-3">{c.count}</span>
              </div>
            );
          })}
        </div>

        <div className="my-2 h-px bg-rule" />
        <RailLabel>By project</RailLabel>
        <div className="flex flex-col gap-0.5">
          {data.projects.map((p) => (
            <div
              key={p.label}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-[12px] text-ink-2 hover:bg-paper-3"
            >
              {p.emphasis ? (
                <span className={`size-1.5 rounded-full ${DOT_BG[p.emphasis]}`} />
              ) : (
                <span className="size-1.5" />
              )}
              <span className="flex-1 truncate">{p.label}</span>
              <span className="font-mono text-[10px] text-ink-3">{p.count}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* ─── Thread list ──────────────────────────────────────────── */}
      <section className="flex w-[340px] flex-none flex-col border-r border-rule">
        <div className="flex-none border-b border-rule px-3.5 py-3">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 font-serif text-[16px] font-semibold text-ink">
              {data.activeView.label}
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
            <Chip kind="solid">All</Chip>
            <Chip kind="ghost">Clients</Chip>
            <Chip kind="ghost">Subs</Chip>
            <Chip kind="ghost">Money</Chip>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {data.threads.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              selected={t.id === selectedId}
              onSelect={() => setSelectedId(t.id)}
            />
          ))}
        </div>
      </section>

      {/* ─── Reader ───────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col">
        {reader && (
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
                <Pin className="size-3.5 text-ink-3" strokeWidth={1.5} />
                <MoreHorizontal className="size-3.5 text-ink-3" strokeWidth={1.5} />
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

            <ReaderBody key={selectedId} reader={reader} threadId={selectedId} />
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
          {reader.messages.map((m, i) => (
            <div key={i} className="flex flex-col gap-2.5">
              {m.body.map((para, j) => (
                <p key={j} className="whitespace-pre-line text-[13px] leading-relaxed text-ink">
                  {para}
                </p>
              ))}
            </div>
          ))}
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

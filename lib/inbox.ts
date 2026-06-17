// Unified inbox data builder. Mock-backed today; swaps to DB queries in Phase 7
// (the threads table already exists — see db/schema.sql). Shape stays stable.
//
// Follows the lib/leads.ts pattern: a flat thread list drives the middle list,
// curated reader content is keyed by id with a generic fallback so every thread
// opens a real reader pane. The AI draft-reply card routes through lib/ai.ts —
// never a provider directly.

import type { ThreadChannel, ThreadStatus } from "./types";
import { ai } from "./ai";
import {
  gmailConfigured,
  fetchThreads,
  type RawGmailThread,
} from "./gmail";

// ─── Left rail: smart views, channels, by-project ───────────────────────────

/** Smart views map to ThreadStatus plus a "done today" slice of done. */
export const SMART_VIEWS: {
  key: ThreadStatus;
  label: string;
  /** Status-dot color (Chip/Avatar kind). */
  dot: "flag" | "ghost";
}[] = [
  { key: "needs_reply", label: "Needs reply", dot: "flag" },
  { key: "awaiting_them", label: "Awaiting them", dot: "ghost" },
  { key: "snoozed", label: "Snoozed", dot: "ghost" },
  { key: "done", label: "Done today", dot: "ghost" },
];

/** Channel display labels, in rail order. Icons are mapped in the component. */
export const CHANNELS: { key: ThreadChannel; label: string }[] = [
  { key: "email", label: "Email (joe@sjc)" },
  { key: "sms", label: "SMS" },
  { key: "client_portal", label: "Client portal" },
  { key: "sub_portal", label: "Sub portal" },
  { key: "site_form", label: "Website forms" },
];

// ─── Thread list ─────────────────────────────────────────────────────────────

export interface InboxThread {
  id: string;
  initials: string;
  fromName: string;
  channel: ThreadChannel;
  /** Thread subject / first line. */
  subject: string;
  /** Preview snippet. */
  preview: string;
  /** Relative timestamp display, e.g. "9:14am" / "Yesterday". */
  when: string;
  /** Which smart view the thread sits in. */
  view: ThreadStatus;
  /** Project / category tag shown as a chip, e.g. "CHEN LEAD". */
  tag: string;
  /** Avatar / accent emphasis. */
  emphasis: "flag" | "accent" | "ghost";
  /** Urgent threads get a flag-soft row background. */
  urgent?: boolean;
  /** Claude's one-word read, surfaced as an "AI: …" chip. */
  aiVerdict?: string;
  /** Marks a thread tied to an active job (accent "Active job" chip). */
  activeJob?: boolean;
}

const THREADS: InboxThread[] = [
  {
    id: "chen-quartz",
    initials: "MC",
    fromName: "Maria Chen",
    channel: "email",
    subject: "Re: Phase 1 estimate — quartz vs marble?",
    preview:
      "Hi Joe — thanks for the rough estimate. Quick Q before we move forward — we love the look of the marble but…",
    when: "9:14am",
    view: "needs_reply",
    tag: "Chen lead",
    emphasis: "flag",
    aiVerdict: "needs your reply",
  },
  {
    id: "henderson-tile",
    initials: "HR",
    fromName: "Henderson (Tom)",
    channel: "sms",
    subject: "Tile starts today right? Send pics please",
    preview: "Tile starts today right? Send pics please",
    when: "8:52am",
    view: "needs_reply",
    tag: "Henderson",
    emphasis: "accent",
    activeJob: true,
  },
  {
    id: "irs-cp2100",
    initials: "IRS",
    fromName: "IRS",
    channel: "email",
    subject: "CP2100 — 1099 mismatch notice",
    preview: "You filed Form 1099-NEC on 02/24 with a payee TIN that does not match…",
    when: "Yesterday",
    view: "needs_reply",
    tag: "Tax",
    emphasis: "flag",
    urgent: true,
    aiVerdict: "deadline in 14 days",
  },
  {
    id: "tomas-pham-bid",
    initials: "TM",
    fromName: "Tomas (electric)",
    channel: "sub_portal",
    subject: "Bid for Pham bath — wired",
    preview: "Sent the bid breakdown. Lemme know any Qs.",
    when: "Yesterday",
    view: "needs_reply",
    tag: "Pham lead",
    emphasis: "ghost",
  },
  {
    id: "olson-walkthrough",
    initials: "OL",
    fromName: "Olson (Diane)",
    channel: "client_portal",
    subject: "Final walk-through Tues?",
    preview: "Tuesday works. Should I be there for both subs?",
    when: "Yesterday",
    view: "needs_reply",
    tag: "Olson",
    emphasis: "ghost",
  },
  {
    id: "cole-basement-bar",
    initials: "AC",
    fromName: "Site form · A. Cole",
    channel: "site_form",
    subject: "New inquiry — basement bar",
    preview: "Hi, looking for a quote on a basement bar build…",
    when: "Sat",
    view: "needs_reply",
    tag: "New lead",
    emphasis: "ghost",
    aiVerdict: "new lead — triage",
  },
];

// ─── Reader pane ─────────────────────────────────────────────────────────────

export interface ReaderMessage {
  fromName: string;
  initials: string;
  /** "maria@chen.example · 9:14am" */
  meta: string;
  to: string;
  /** Body paragraphs. */
  body: string[];
}

export interface ThreadReader {
  /** Header tag chip, e.g. "CHEN LEAD · PHASE 1". */
  tag: string;
  channel: ThreadChannel;
  channelLabel: string;
  messageCount: number;
  subject: string;
  messages: ReaderMessage[];
  /** AI draft-reply card. `summary` is the human-readable read on the draft;
   *  `body` is the generated reply (from ai.draft) shown on "Review draft". */
  aiDraft: { summary: string; body: string };
  replyPlaceholder: string;
}

/** Curated reader content keyed by thread id. Threads not listed get a generic
 *  reader so every thread in the list opens a real pane. */
const READERS: Record<string, Omit<ThreadReader, "channel" | "channelLabel" | "subject" | "messageCount" | "aiDraft">> = {
  "chen-quartz": {
    tag: "Chen lead · Phase 1",
    replyPlaceholder: "Reply to Maria…",
    messages: [
      {
        fromName: "Maria Chen",
        initials: "MC",
        meta: "maria@chen.example · 9:14am",
        to: "to Joe",
        body: [
          "Hi Joe —",
          "Thanks so much for getting the rough estimate over so fast. We've been looking it over and we're excited.",
          "One thing I keep going back and forth on — the marble looks beautiful but I'm worried about staining with two kids. Could we get a number on quartz as an alternate? Even a rough one would help.",
          "Thanks!\nMaria",
        ],
      },
    ],
  },
};

// ─── Channel display helpers ─────────────────────────────────────────────────

const CHANNEL_LABEL: Record<ThreadChannel, string> = {
  email: "Email",
  sms: "SMS",
  client_portal: "Client portal",
  sub_portal: "Sub portal",
  site_form: "Website form",
};

export function channelLabel(channel: ThreadChannel): string {
  return CHANNEL_LABEL[channel];
}

// ─── Builders ────────────────────────────────────────────────────────────────

export interface InboxData {
  /** Smart views with live counts; the active one drives the list header. */
  smartViews: { key: ThreadStatus; label: string; dot: "flag" | "ghost"; count: number; active: boolean }[];
  channels: { key: ThreadChannel; label: string; count: number }[];
  projects: { label: string; count: number; emphasis?: "accent" | "flag" }[];
  activeView: { key: ThreadStatus; label: string };
  threads: InboxThread[];
  /** Full reader content, keyed by thread id. */
  readers: Record<string, ThreadReader>;
  /** Thread selected on first paint. */
  selectedId: string;
}

async function buildReader(t: InboxThread): Promise<ThreadReader> {
  // The reply draft always comes from the AI service abstraction.
  const draft = await ai.draft({
    kind: "email_reply",
    context: `${t.fromName} (${t.tag}): ${t.subject}\n\n${t.preview}`,
    tone: "warm",
  });

  const curated = READERS[t.id];

  // Curated showcase summary for the Chen thread; generic otherwise.
  const summary =
    t.id === "chen-quartz"
      ? "Quartz delta: ~$1,800 under Calacatta in the rough estimate. Suggests Cambria Brittanicca as the closest visual match and offers to drop a slab sample at her door this week. Tone: warm, brief, decisive."
      : `Drafted a ${t.channel === "sms" ? "short text" : "reply"} addressing "${t.subject}". Review before sending.`;

  return {
    tag: curated?.tag ?? t.tag,
    channel: t.channel,
    channelLabel: channelLabel(t.channel),
    messageCount: curated?.messages.length ?? 1,
    subject: t.subject,
    messages:
      curated?.messages ??
      [
        {
          fromName: t.fromName,
          initials: t.initials,
          meta: t.when,
          to: "to Joe",
          body: [t.preview],
        },
      ],
    aiDraft: { summary, body: draft.body },
    replyPlaceholder: curated?.replyPlaceholder ?? `Reply to ${t.fromName.split(" ")[0]}…`,
  };
}

export async function getInboxData(): Promise<InboxData> {
  // Live Gmail when the connector is configured; otherwise the deterministic
  // mock. On any Gmail failure we fall back to the mock so /inbox still renders
  // (mirrors the Ollama provider's degrade-gracefully behavior in lib/ai.ts).
  if (gmailConfigured()) {
    try {
      return await buildFromGmail();
    } catch (err) {
      console.error(
        `[inbox:gmail] falling back to mock — ${(err as Error).message}`,
      );
    }
  }
  return buildFromMock();
}

// ─── Gmail-backed builder ────────────────────────────────────────────────────

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Deterministic, locale-independent formatting (no toLocale*) so the value is
// identical on server and client and never triggers a hydration mismatch.
function relativeWhen(dateMs: number): string {
  const d = new Date(dateMs);
  const now = new Date();
  const ymd = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (ymd(d) === ymd(now)) {
    const ap = d.getHours() < 12 ? "am" : "pm";
    const h = d.getHours() % 12 || 12;
    return `${h}:${d.getMinutes().toString().padStart(2, "0")}${ap}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (ymd(d) === ymd(yesterday)) return "Yesterday";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function rawToThread(r: RawGmailThread): InboxThread {
  return {
    id: r.id,
    initials: initialsOf(r.fromName),
    fromName: r.fromName,
    channel: "email",
    subject: r.subject,
    preview: r.snippet,
    when: relativeWhen(r.date),
    // Heuristic until threads are linked to leads/projects: unread = needs reply.
    view: r.unread ? "needs_reply" : "awaiting_them",
    tag: "Email",
    emphasis: r.unread ? "flag" : "ghost",
    aiVerdict: r.unread ? "needs your reply" : undefined,
  };
}

// Reader WITHOUT an AI draft. Local-LLM drafting is too slow to run eagerly for
// every thread on page load (CPU inference, ~10s each), so the draft is
// generated on demand when a thread is opened — see draftReplyForThread() and
// lib/actions/inbox.ts. The reader still renders the real message immediately.
function rawToReader(r: RawGmailThread): ThreadReader {
  return {
    tag: "Email",
    channel: "email",
    channelLabel: channelLabel("email"),
    messageCount: 1,
    subject: r.subject,
    messages: [
      {
        fromName: r.fromName,
        initials: initialsOf(r.fromName),
        meta: `${r.fromEmail} · ${relativeWhen(r.date)}`,
        to: r.toLine ? `to ${r.toLine}` : "to Joe",
        body: r.bodyParas.length ? r.bodyParas : [r.snippet],
      },
    ],
    aiDraft: {
      summary: "Open this thread to draft a reply with Claude.",
      body: "",
    },
    replyPlaceholder: `Reply to ${r.fromName.split(" ")[0]}…`,
  };
}

/** On-demand AI reply draft for a single Gmail thread (called when opened). */
export async function draftReplyForThread(
  threadId: string,
): Promise<{ summary: string; body: string; toEmail: string; subject: string }> {
  const raw = (await fetchThreads(50)).find((t) => t.id === threadId);
  if (!raw) return { summary: "", body: "", toEmail: "", subject: "" };
  const draft = await ai.draft({
    kind: "email_reply",
    context: `${raw.fromName} <${raw.fromEmail}>: ${raw.subject}\n\n${raw.bodyParas.join("\n\n") || raw.snippet}`,
    tone: "warm",
  });
  return {
    summary: `Drafted a reply addressing "${raw.subject}". Review before sending.`,
    body: draft.body,
    toEmail: raw.fromEmail,
    subject: raw.subject,
  };
}

async function buildFromGmail(): Promise<InboxData> {
  const raw = await fetchThreads(50);
  const threads = raw.map(rawToThread);
  const readerEntries = raw.map((r) => [r.id, rawToReader(r)] as const);

  const needReply = threads.filter((t) => t.view === "needs_reply").length;
  const awaiting = threads.length - needReply;
  const viewCounts: Record<ThreadStatus, number> = {
    needs_reply: needReply,
    awaiting_them: awaiting,
    snoozed: 0,
    done: 0,
  };

  return {
    smartViews: SMART_VIEWS.map((v) => ({
      ...v,
      count: viewCounts[v.key],
      active: v.key === "needs_reply",
    })),
    // Only Email is wired; other channels stay at 0 until integrated.
    channels: CHANNELS.map((c) => ({
      ...c,
      count: c.key === "email" ? threads.length : 0,
    })),
    projects: [],
    activeView: { key: "needs_reply", label: "Needs reply" },
    threads,
    readers: Object.fromEntries(readerEntries),
    selectedId: threads[0]?.id ?? "",
  };
}

// ─── Mock builder ────────────────────────────────────────────────────────────

async function buildFromMock(): Promise<InboxData> {
  const needReply = THREADS.filter((t) => t.view === "needs_reply");

  // Static counts for views/channels/projects not represented in the mock list.
  const viewCounts: Record<ThreadStatus, number> = {
    needs_reply: needReply.length,
    awaiting_them: 8,
    snoozed: 3,
    done: 11,
  };
  const channelCounts: Record<ThreadChannel, number> = {
    email: 4,
    sms: 2,
    client_portal: 3,
    sub_portal: 1,
    site_form: 2,
  };

  const readerEntries = await Promise.all(
    THREADS.map(async (t) => [t.id, await buildReader(t)] as const),
  );

  return {
    smartViews: SMART_VIEWS.map((v) => ({
      ...v,
      count: viewCounts[v.key],
      active: v.key === "needs_reply",
    })),
    channels: CHANNELS.map((c) => ({ ...c, count: channelCounts[c.key] })),
    projects: [
      { label: "Henderson", count: 5, emphasis: "accent" },
      { label: "Olson", count: 2 },
      { label: "Reyes", count: 3, emphasis: "flag" },
      { label: "Chen lead", count: 1, emphasis: "flag" },
    ],
    activeView: { key: "needs_reply", label: "Needs reply" },
    threads: THREADS,
    readers: Object.fromEntries(readerEntries),
    selectedId: THREADS[0].id,
  };
}

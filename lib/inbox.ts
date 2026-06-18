// Unified inbox data builder. Mock-backed today; swaps to DB queries in Phase 7
// (the threads table already exists — see db/schema.sql). Shape stays stable.
//
// Follows the lib/leads.ts pattern: a flat thread list drives the middle list,
// curated reader content is keyed by id with a generic fallback so every thread
// opens a real reader pane. The AI draft-reply card routes through lib/ai.ts —
// never a provider directly.

import type { ThreadChannel, ThreadStatus } from "./types";
import { ai } from "./ai";
import { query } from "./db";
import {
  gmailConfigured,
  fetchThreads,
  fetchLabels,
  type RawGmailThread,
  type GmailCategory,
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
  /** Gmail STARRED — drives pin/star UI and the starred treatment. */
  starred?: boolean;
  /** Resolved user-label display names, shown as chips on the row. */
  labelNames?: string[];
  /** Raw Gmail label ids, used by the label-rail filter. */
  labelIds?: string[];
  /** Gmail category (primary/social/promotions/updates/forums). */
  category?: GmailCategory;
  /** Sender resolved against DB contacts → client / sub / money chip filter. */
  audience?: Audience;
  /** Linked project slug (sender resolved to a project's client), for the rail. */
  projectSlug?: string;
  /** Linked project display name. */
  projectLabel?: string;
}

/** Audience axis for the All/Clients/Subs/Money chip filters. A thread's
 *  audience is resolved by matching its counterparty email/domain against the
 *  leads (client), subs (sub) and known-vendor (money) sets in Postgres. */
export type Audience = "client" | "sub" | "money";

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
  projects: { slug?: string; label: string; count: number; emphasis?: "accent" | "flag" }[];
  /** User Gmail labels present on the fetched threads, with counts. */
  labels: { id: string; name: string; count: number }[];
  activeView: { key: ThreadStatus; label: string };
  threads: InboxThread[];
  /** Full reader content, keyed by thread id. */
  readers: Record<string, ThreadReader>;
  /** Thread selected on first paint. */
  selectedId: string;
}

/** Count threads per smart view from the live list. */
function countViews(threads: InboxThread[]): Record<ThreadStatus, number> {
  const counts: Record<ThreadStatus, number> = {
    needs_reply: 0,
    awaiting_them: 0,
    snoozed: 0,
    done: 0,
  };
  for (const t of threads) counts[t.view]++;
  return counts;
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

/** "Maria Chen <m@x.com>" → "Maria Chen" (or the bare address). */
function displayName(raw: string): string {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return (m[1].trim() || m[2].trim());
  return raw.trim();
}

function viewOf(r: RawGmailThread): ThreadStatus {
  if (r.snoozed) return "snoozed";
  if (!r.inInbox) return "done";
  if (r.outbound) return "awaiting_them";
  return "needs_reply";
}

function rawToThread(r: RawGmailThread, labelMap: Map<string, string>): InboxThread {
  const view = viewOf(r);
  const needsReply = view === "needs_reply" && r.unread;
  // For outbound threads the counterparty is the recipient, not "me".
  const who = r.outbound && r.toLine ? displayName(r.toLine) : r.fromName;
  const labelNames = r.labelIds
    .filter((id) => labelMap.has(id))
    .map((id) => labelMap.get(id)!);
  return {
    id: r.id,
    initials: initialsOf(who),
    fromName: who,
    channel: "email",
    subject: r.subject,
    preview: r.snippet,
    when: relativeWhen(r.date),
    view,
    tag: "Email",
    emphasis: needsReply ? "flag" : r.starred ? "accent" : "ghost",
    aiVerdict: needsReply ? "needs your reply" : undefined,
    starred: r.starred,
    labelNames: labelNames.length ? labelNames : undefined,
    labelIds: r.labelIds,
    category: r.category,
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

// ─── Sender → DB contact resolution (audience + project) ─────────────────────

interface ContactRow {
  email: string;
  name: string;
  slug: string;
  kind: "client" | "sub";
}
interface ProjectLinkRow {
  email: string;
  project_slug: string;
  project_label: string;
}

// Consumer mail providers — a sub on one of these is matched by exact address
// only, never by domain (we won't claim every gmail.com sender is that sub).
const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "aol.com",
  "comcast.net", "proton.me", "protonmail.com",
  "gmail.example", // synthetic seed contacts
]);

// Finance/vendor signals. Either a known money domain or an invoice-shaped
// subject marks a thread as "money".
const MONEY_DOMAIN_RX =
  /(intuit|quickbooks|stripe|squareup|square\.com|paypal|venmo|homedepot|lowes|menards|ferguson|build\.com|wellsfargo|chase\.com|bankofamerica|amex|americanexpress|bill\.com)/i;
const MONEY_SUBJECT_RX =
  /\b(invoice|receipt|payment|paid|statement|billing|balance due|past due|autopay|order\s*(?:#|confirmation|placed|shipped)|transaction|deposit|wire transfer)\b/i;

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

/** First email address found in a raw header value (handles "Name <a@b>"). */
function extractEmail(raw: string): string {
  const m = raw.match(/[^\s<>"]+@[^\s<>"]+/);
  return (m ? m[0] : "").toLowerCase();
}

interface ContactMaps {
  byEmail: Map<string, Audience>;
  subDomains: Set<string>;
  projectByEmail: Map<string, { slug: string; label: string }>;
}

/** Load the contact index from Postgres once per inbox build. */
async function loadContactMaps(): Promise<ContactMaps> {
  const [contacts, links] = await Promise.all([
    query<ContactRow>(
      `SELECT lower(email) AS email, name, slug, 'client' AS kind
         FROM leads WHERE email IS NOT NULL AND email <> ''
       UNION ALL
       SELECT lower(email) AS email, name, slug, 'sub' AS kind
         FROM subs WHERE email IS NOT NULL AND email <> ''`,
    ),
    query<ProjectLinkRow>(
      `SELECT lower(l.email) AS email, p.slug AS project_slug, p.name AS project_label
         FROM projects p JOIN leads l ON p.lead_id = l.id
        WHERE l.email IS NOT NULL AND l.email <> ''`,
    ),
  ]);

  const byEmail = new Map<string, Audience>();
  const subDomains = new Set<string>();
  for (const c of contacts.rows) {
    // Subs win ties over clients (businesses are the more specific match).
    if (c.kind === "sub" || !byEmail.has(c.email)) {
      byEmail.set(c.email, c.kind === "sub" ? "sub" : "client");
    }
    if (c.kind === "sub") {
      const d = domainOf(c.email);
      if (d && !CONSUMER_DOMAINS.has(d)) subDomains.add(d);
    }
  }

  const projectByEmail = new Map<string, { slug: string; label: string }>();
  for (const p of links.rows) {
    projectByEmail.set(p.email, { slug: p.project_slug, label: p.project_label });
  }

  return { byEmail, subDomains, projectByEmail };
}

/** Classify one thread's counterparty into an audience + optional project. */
function classifyThread(
  r: RawGmailThread,
  maps: ContactMaps,
): { audience?: Audience; projectSlug?: string; projectLabel?: string } {
  // For outbound mail the counterparty is the recipient, not the owner.
  const email = r.outbound ? extractEmail(r.toLine) : r.fromEmail.toLowerCase();
  const domain = domainOf(email);

  let audience = maps.byEmail.get(email);
  if (!audience && domain && maps.subDomains.has(domain)) audience = "sub";
  if (
    !audience &&
    (MONEY_DOMAIN_RX.test(domain) ||
      MONEY_SUBJECT_RX.test(`${r.subject} ${r.snippet}`))
  ) {
    audience = "money";
  }

  const project = maps.projectByEmail.get(email);
  return { audience, projectSlug: project?.slug, projectLabel: project?.label };
}

async function buildFromGmail(): Promise<InboxData> {
  const [raw, labels, contactMaps] = await Promise.all([
    fetchThreads(50),
    fetchLabels(),
    loadContactMaps(),
  ]);
  const labelMap = new Map(labels.map((l) => [l.id, l.name]));
  const threads = raw.map((r) => rawToThread(r, labelMap));

  // Resolve each thread's sender against DB contacts (threads[i] ↔ raw[i]).
  raw.forEach((r, i) => {
    const c = classifyThread(r, contactMaps);
    threads[i].audience = c.audience;
    threads[i].projectSlug = c.projectSlug;
    threads[i].projectLabel = c.projectLabel;
    // A resolved project becomes the row's tag chip (else the generic "Email").
    if (c.projectLabel) threads[i].tag = c.projectLabel;
  });
  const readerEntries = raw.map((r) => [r.id, rawToReader(r)] as const);

  const viewCounts = countViews(threads);

  // Label rail: only labels actually present on the fetched threads, with counts.
  const labelCounts = new Map<string, number>();
  for (const t of threads) {
    for (const id of t.labelIds ?? []) {
      if (labelMap.has(id)) labelCounts.set(id, (labelCounts.get(id) ?? 0) + 1);
    }
  }
  const labelRail = labels
    .filter((l) => labelCounts.has(l.id))
    .map((l) => ({ id: l.id, name: l.name, count: labelCounts.get(l.id)! }));

  // By-project rail: projects resolved on at least one thread, with counts.
  const projCounts = new Map<string, { label: string; count: number }>();
  for (const t of threads) {
    if (!t.projectSlug) continue;
    const e = projCounts.get(t.projectSlug) ?? {
      label: t.projectLabel ?? t.projectSlug,
      count: 0,
    };
    e.count++;
    projCounts.set(t.projectSlug, e);
  }
  const projectsRail = [...projCounts.entries()].map(([slug, v]) => ({
    slug,
    label: v.label,
    count: v.count,
  }));

  // First paint lands on the first thread of the default (needs_reply) view.
  const firstInDefault =
    threads.find((t) => t.view === "needs_reply") ?? threads[0];

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
    projects: projectsRail,
    labels: labelRail,
    activeView: { key: "needs_reply", label: "Needs reply" },
    threads,
    readers: Object.fromEntries(readerEntries),
    selectedId: firstInDefault?.id ?? "",
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
    labels: [],
    activeView: { key: "needs_reply", label: "Needs reply" },
    threads: THREADS,
    readers: Object.fromEntries(readerEntries),
    selectedId: THREADS[0].id,
  };
}

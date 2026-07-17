// Unified inbox data builder. Mock-backed today; swaps to DB queries in Phase 7
// (the threads table already exists — see db/schema.sql). Shape stays stable.
//
// Follows the lib/leads.ts pattern: a flat thread list drives the middle list,
// curated reader content is keyed by id with a generic fallback so every thread
// opens a real reader pane. The AI draft-reply card routes through lib/ai.ts —
// never a provider directly.

import type { SystemViewKey, ThreadChannel, ThreadStatus } from "./types";
import { ai } from "./ai";
import { query } from "./db";
import {
  gmailConfigured,
  fetchThreads,
  fetchThreadPage,
  fetchLabels,
  fetchLabelCounts,
  type RawGmailThread,
  type GmailCategory,
} from "./gmail";

// ─── Left rail: smart views, channels, by-project ───────────────────────────

/** Smart views map 1:1 to ThreadStatus. "Done" = archived or bulk (off my
 *  plate); "Snoozed" mirrors Gmail's own snooze (read-only — the Gmail API has
 *  no snooze-write endpoint, so we surface Gmail's snoozes, never set our own). */
export const SMART_VIEWS: {
  key: ThreadStatus;
  label: string;
  /** Status-dot color (Chip/Avatar kind). */
  dot: "flag" | "ghost";
}[] = [
  { key: "needs_reply", label: "Needs reply", dot: "flag" },
  { key: "awaiting_them", label: "Awaiting them", dot: "ghost" },
  { key: "snoozed", label: "Snoozed", dot: "ghost" },
  // "Done", not "Done today": Gmail exposes no archive timestamp, so a literal
  // "today" scope isn't derivable — this is the "off my plate" bucket.
  { key: "done", label: "Done", dot: "ghost" },
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
  /** Gmail INBOX label present — drives the plain "Inbox" rail view. */
  inInbox?: boolean;
  /** Sender resolved against DB contacts → client / sub / money chip filter. */
  audience?: Audience;
  /** Linked project slug (sender resolved to a project's client), for the rail. */
  projectSlug?: string;
  /** Linked project display name. */
  projectLabel?: string;
  /** Manual link (P6-3): the record this thread is pinned to, if any. */
  linkedType?: "project" | "lead";
  linkedSlug?: string;
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
    inInbox: true,
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
    inInbox: true,
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
    inInbox: true,
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
    inInbox: true,
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
    inInbox: true,
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
    inInbox: true,
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
  /** Non-email channels are read-only in the inbox (replies happen on the
   *  channel's own surface / are approval-gated). These point at that surface. */
  actionHref?: string;
  actionLabel?: string;
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
  /** All user Gmail labels with true thread totals (count = null when the
   *  per-label count fetch failed → the rail hides that badge). */
  labels: { id: string; name: string; count: number | null }[];
  activeView: { key: ThreadStatus; label: string };
  threads: InboxThread[];
  /** Full reader content, keyed by thread id. */
  readers: Record<string, ThreadReader>;
  /** Thread selected on first paint. */
  selectedId: string;
  /** Gmail page token for loading the next batch (undefined = no more). */
  nextPageToken?: string;
  /** Records the owner can manually link a thread to (P6-3). */
  linkOptions?: { projects: { slug: string; name: string }[]; leads: { slug: string; name: string }[] };
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

/** Count threads per channel from the live list, so a rail badge never
 *  advertises a channel it can't open. */
function countChannels(threads: InboxThread[]): Record<ThreadChannel, number> {
  const counts: Record<ThreadChannel, number> = {
    email: 0,
    sms: 0,
    client_portal: 0,
    sub_portal: 0,
    site_form: 0,
  };
  for (const t of threads) counts[t.channel]++;
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

/** Bulk mail that never needs a personal reply — Gmail's promotions/social/
 *  forums categories and no-reply senders. Kept out of "Needs reply" so promos
 *  (Home Depot etc.) don't get flagged as waiting on Joe. */
function isBulk(r: RawGmailThread): boolean {
  if (r.category === "promotions" || r.category === "social" || r.category === "forums") return true;
  return /\b(no-?reply|do-?not-?reply)\b|^(noreply|donotreply)/i.test(r.fromEmail);
}

function viewOf(r: RawGmailThread): ThreadStatus {
  if (r.snoozed) return "snoozed";
  if (!r.inInbox) return "done";
  if (r.outbound) return "awaiting_them";
  if (isBulk(r)) return "done";
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
    inInbox: r.inInbox,
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
      summary: "Open this thread to draft a reply with AI.",
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

interface ManualLink {
  type: "project" | "lead";
  slug: string;
  projectSlug?: string; // set for project links → drives the by-project rail
  label: string;
}
interface ContactMaps {
  byEmail: Map<string, Audience>;
  subDomains: Set<string>;
  projectByEmail: Map<string, { slug: string; label: string }>;
  linkByThread: Map<string, ManualLink>;
}

/** Load the contact index from Postgres once per inbox build. */
async function loadContactMaps(): Promise<ContactMaps> {
  const [contacts, links, threadLinks] = await Promise.all([
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
    query<{ thread_id: string; link_type: "project" | "lead"; link_slug: string; label: string; project_slug: string | null }>(
      `SELECT tl.gmail_thread_id AS thread_id, tl.link_type, tl.link_slug,
              COALESCE(p.name, l.name, tl.link_slug) AS label,
              p.slug AS project_slug
         FROM thread_links tl
         LEFT JOIN projects p ON tl.link_type = 'project' AND p.slug = tl.link_slug
         LEFT JOIN leads    l ON tl.link_type = 'lead'    AND l.slug = tl.link_slug`,
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

  const linkByThread = new Map<string, ManualLink>();
  for (const t of threadLinks.rows) {
    linkByThread.set(t.thread_id, {
      type: t.link_type,
      slug: t.link_slug,
      projectSlug: t.link_type === "project" ? t.project_slug ?? t.link_slug : undefined,
      label: t.label,
    });
  }

  return { byEmail, subDomains, projectByEmail, linkByThread };
}

/** Classify one thread's counterparty into an audience + optional project. A
 *  manual link (P6-3) wins over the email/domain guess. */
function classifyThread(
  r: RawGmailThread,
  maps: ContactMaps,
): {
  audience?: Audience;
  projectSlug?: string;
  projectLabel?: string;
  linkedType?: "project" | "lead";
  linkedSlug?: string;
} {
  // Manual link takes precedence — a linked thread is always a client thread,
  // and a project link drives the by-project rail.
  const manual = maps.linkByThread.get(r.id);
  if (manual) {
    return {
      audience: "client",
      projectSlug: manual.projectSlug,
      projectLabel: manual.label,
      linkedType: manual.type,
      linkedSlug: manual.slug,
    };
  }

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

/** Map a page of raw Gmail threads → InboxThreads (audience/project resolved)
 *  + reader entries. Shared by the first load and "Load more". */
function mapRawThreads(
  raw: RawGmailThread[],
  labelMap: Map<string, string>,
  contactMaps: ContactMaps,
): { threads: InboxThread[]; readerEntries: [string, ThreadReader][] } {
  const threads = raw.map((r) => rawToThread(r, labelMap));
  raw.forEach((r, i) => {
    const c = classifyThread(r, contactMaps);
    threads[i].audience = c.audience;
    threads[i].projectSlug = c.projectSlug;
    threads[i].projectLabel = c.projectLabel;
    threads[i].linkedType = c.linkedType;
    threads[i].linkedSlug = c.linkedSlug;
    // A resolved project becomes the row's tag chip (else the generic "Email").
    if (c.projectLabel) threads[i].tag = c.projectLabel;
  });
  const readerEntries = raw.map(
    (r) => [r.id, rawToReader(r)] as [string, ThreadReader],
  );
  return { threads, readerEntries };
}

const INBOX_PAGE = 50;

/** Fetch the next page of inbox threads (for "Load more"). */
export async function loadMoreInbox(pageToken: string): Promise<{
  threads: InboxThread[];
  readers: Record<string, ThreadReader>;
  nextPageToken?: string;
}> {
  const [page, labels, contactMaps] = await Promise.all([
    fetchThreadPage(INBOX_PAGE, pageToken),
    fetchLabels(),
    loadContactMaps(),
  ]);
  const labelMap = new Map(labels.map((l) => [l.id, l.name]));
  const { threads, readerEntries } = mapRawThreads(page.threads, labelMap, contactMaps);
  return {
    threads,
    readers: Object.fromEntries(readerEntries),
    nextPageToken: page.nextPageToken,
  };
}

/** Fetch a page of threads scoped to a single Gmail label (server-side), for
 *  when the user clicks a label in the rail. Paginates via pageToken so a label
 *  with more mail than the loaded inbox window is shown in full, not just the
 *  threads that happened to page in. */
export async function loadLabelInbox(
  labelId: string,
  pageToken?: string,
): Promise<{
  threads: InboxThread[];
  readers: Record<string, ThreadReader>;
  nextPageToken?: string;
}> {
  const [page, labels, contactMaps] = await Promise.all([
    fetchThreadPage(INBOX_PAGE, pageToken, labelId),
    fetchLabels(),
    loadContactMaps(),
  ]);
  const labelMap = new Map(labels.map((l) => [l.id, l.name]));
  const { threads, readerEntries } = mapRawThreads(page.threads, labelMap, contactMaps);
  return {
    threads,
    readers: Object.fromEntries(readerEntries),
    nextPageToken: page.nextPageToken,
  };
}

// Standard Gmail mailbox views (P1-C4): Unread / Starred / Sent scope by a
// system label; Spam / Trash need an explicit search query because the default
// thread fetch excludes them. Server-owned so no user value ever reaches the
// Gmail query — loadSystemView only ever looks up a known key here.
const SYSTEM_VIEW_FETCH: Record<SystemViewKey, { labelId?: string; q?: string }> = {
  unread: { labelId: "UNREAD" },
  starred: { labelId: "STARRED" },
  sent: { labelId: "SENT" },
  spam: { q: "in:spam" },
  trash: { q: "in:trash" },
};

/** Fetch a page of threads for a Gmail system view (Unread/Starred/Sent/Spam/
 *  Trash), the same shape loadLabelInbox returns. Paginates via pageToken. */
export async function loadSystemView(
  key: SystemViewKey,
  pageToken?: string,
): Promise<{
  threads: InboxThread[];
  readers: Record<string, ThreadReader>;
  nextPageToken?: string;
}> {
  const def = SYSTEM_VIEW_FETCH[key];
  const [page, labels, contactMaps] = await Promise.all([
    // Spam/Trash pass their own q; label-scoped views keep the default (which
    // excludes spam/trash), so "Unread" means unread mail you can actually see.
    fetchThreadPage(INBOX_PAGE, pageToken, def.labelId, def.q ?? "-in:spam -in:trash"),
    fetchLabels(),
    loadContactMaps(),
  ]);
  const labelMap = new Map(labels.map((l) => [l.id, l.name]));
  const { threads, readerEntries } = mapRawThreads(page.threads, labelMap, contactMaps);
  return {
    threads,
    readers: Object.fromEntries(readerEntries),
    nextPageToken: page.nextPageToken,
  };
}

/** Records the owner can manually link a thread to (P6-3). */
async function getLinkOptions(): Promise<InboxData["linkOptions"]> {
  const [projects, leads] = await Promise.all([
    query<{ slug: string; name: string }>(`SELECT slug, name FROM projects ORDER BY updated_at DESC`),
    query<{ slug: string; name: string }>(`SELECT slug, name FROM leads ORDER BY created_at DESC`),
  ]);
  return { projects: projects.rows, leads: leads.rows };
}

// ─── Non-email channel folding (SMS / portals / website forms) ───────────────
// The unified inbox is Gmail-centric, so the "Channels" rail only ever showed
// Email. These loaders fold each channel's REAL conversations (from Postgres)
// into the same thread list so clicking a channel surfaces its threads and the
// rail counts are truthful. Read/display only — replies happen on each
// channel's own surface (the reader links out); nothing is sent from here.

interface ChannelBuild {
  threads: InboxThread[];
  readerEntries: [string, ThreadReader][];
}

type ChatAuthor = "owner" | "ai" | "user";

/** A folded, read-only reader (no AI draft — those are Gmail-only and slow). */
function readOnlyReader(opts: {
  tag: string;
  channel: ThreadChannel;
  subject: string;
  messages: ReaderMessage[];
  actionHref?: string;
  actionLabel?: string;
}): ThreadReader {
  return {
    tag: opts.tag,
    channel: opts.channel,
    channelLabel: channelLabel(opts.channel),
    messageCount: opts.messages.length,
    subject: opts.subject,
    messages: opts.messages,
    aiDraft: { summary: "", body: "" },
    replyPlaceholder: "",
    actionHref: opts.actionHref,
    actionLabel: opts.actionLabel,
  };
}

/** "(612) 555-1234" from an E.164-ish number; passthrough if not 10 digits. */
function formatPhone(phone: string): string {
  const ten = phone.replace(/\D/g, "").slice(-10);
  if (ten.length !== 10) return phone;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

function smsLinkHref(type: string | null, slug: string | null): string | undefined {
  if (!slug) return undefined;
  if (type === "lead") return `/leads/${slug}`;
  if (type === "sub") return `/subs/${slug}`;
  if (type === "project") return `/projects/${slug}`;
  return undefined;
}

/** SMS channel: two-way texts from sms_threads/sms_messages (lib/sms.ts). */
async function loadSmsThreads(): Promise<ChannelBuild> {
  const { rows } = await query<{
    id: string;
    phone: string;
    contact_name: string | null;
    link_type: string | null;
    link_slug: string | null;
    unread: boolean;
    last_message_at: string | null;
    last_body: string | null;
    last_dir: "in" | "out" | null;
  }>(
    `SELECT t.id::text AS id, t.phone, t.contact_name, t.link_type, t.link_slug,
            t.unread, t.last_message_at, m.body AS last_body, m.direction AS last_dir
       FROM sms_threads t
       LEFT JOIN LATERAL (
         SELECT body, direction FROM sms_messages
          WHERE thread_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1
       ) m ON true
      ORDER BY t.last_message_at DESC NULLS LAST, t.id DESC`,
  );
  if (!rows.length) return { threads: [], readerEntries: [] };

  const ids = rows.map((r) => r.id);
  const { rows: msgs } = await query<{
    thread_id: string;
    direction: "in" | "out";
    body: string;
    created_at: string;
  }>(
    `SELECT thread_id::text AS thread_id, direction, body, created_at
       FROM sms_messages WHERE thread_id = ANY($1::bigint[]) ORDER BY created_at, id`,
    [ids],
  );
  const byThread = new Map<string, typeof msgs>();
  for (const m of msgs) {
    const list = byThread.get(m.thread_id) ?? [];
    list.push(m);
    byThread.set(m.thread_id, list);
  }

  const threads: InboxThread[] = [];
  const readerEntries: [string, ThreadReader][] = [];
  for (const r of rows) {
    const id = `sms:${r.id}`;
    const name = r.contact_name || formatPhone(r.phone);
    // Their text is the last (or unread) → waiting on Joe; else awaiting them.
    const view: ThreadStatus =
      r.unread || r.last_dir === "in" ? "needs_reply" : "awaiting_them";
    const audience: Audience | undefined =
      r.link_type === "sub"
        ? "sub"
        : r.link_type === "lead" || r.link_type === "client"
          ? "client"
          : undefined;
    threads.push({
      id,
      initials: initialsOf(name),
      fromName: name,
      channel: "sms",
      subject: r.last_body?.slice(0, 80) || "Text message",
      preview: r.last_body || "",
      when: r.last_message_at ? relativeWhen(Date.parse(r.last_message_at)) : "",
      view,
      tag: "SMS",
      emphasis: view === "needs_reply" ? "flag" : "ghost",
      audience,
    });
    const conv = byThread.get(r.id) ?? [];
    const messages: ReaderMessage[] = conv.map((m) => ({
      fromName: m.direction === "in" ? name : "Joe",
      initials: m.direction === "in" ? initialsOf(name) : "JS",
      meta: relativeWhen(Date.parse(m.created_at)),
      to: m.direction === "in" ? "to Joe" : `to ${name}`,
      body: [m.body],
    }));
    if (!messages.length) {
      messages.push({
        fromName: name,
        initials: initialsOf(name),
        meta: r.last_message_at ? relativeWhen(Date.parse(r.last_message_at)) : "",
        to: "to Joe",
        body: [r.last_body || ""],
      });
    }
    const href = smsLinkHref(r.link_type, r.link_slug);
    readerEntries.push([
      id,
      readOnlyReader({
        tag: `SMS · ${name}`,
        channel: "sms",
        subject: `Text — ${name}`,
        messages,
        actionHref: href,
        actionLabel: href ? "Open linked record" : undefined,
      }),
    ]);
  }
  return { threads, readerEntries };
}

/** Portal channels: client portal (portal:<project-slug>) and sub portal
 *  (dm:<sub-slug>, unified with /chat DMs) — both persist to chat_messages. */
async function loadPortalThreads(): Promise<ChannelBuild> {
  const { rows: groups } = await query<{
    channel_key: string;
    last_at: string;
    last_author: ChatAuthor;
    last_body: string;
    proj_name: string | null;
    client_name: string | null;
    sub_name: string | null;
  }>(
    `SELECT m.channel_key,
            max(m.created_at) AS last_at,
            (array_agg(m.author_kind ORDER BY m.created_at DESC, m.id DESC))[1] AS last_author,
            (array_agg(m.body        ORDER BY m.created_at DESC, m.id DESC))[1] AS last_body,
            p.name AS proj_name, l.name AS client_name, s.name AS sub_name
       FROM chat_messages m
       LEFT JOIN projects p ON m.channel_key LIKE 'portal:%' AND p.slug = split_part(m.channel_key, ':', 2)
       LEFT JOIN leads    l ON p.lead_id = l.id
       LEFT JOIN subs     s ON m.channel_key LIKE 'dm:%'     AND s.slug = split_part(m.channel_key, ':', 2)
      WHERE m.channel_key LIKE 'portal:%' OR m.channel_key LIKE 'dm:%'
      GROUP BY m.channel_key, p.name, l.name, s.name
      ORDER BY max(m.created_at) DESC`,
  );
  if (!groups.length) return { threads: [], readerEntries: [] };

  const keys = groups.map((g) => g.channel_key);
  const { rows: msgs } = await query<{
    channel_key: string;
    author_kind: ChatAuthor;
    author_name: string;
    author_initials: string;
    body: string;
    created_at: string;
  }>(
    `SELECT channel_key, author_kind, author_name, author_initials, body, created_at
       FROM chat_messages WHERE channel_key = ANY($1) ORDER BY created_at, id`,
    [keys],
  );
  const byKey = new Map<string, typeof msgs>();
  for (const m of msgs) {
    const list = byKey.get(m.channel_key) ?? [];
    list.push(m);
    byKey.set(m.channel_key, list);
  }

  const threads: InboxThread[] = [];
  const readerEntries: [string, ThreadReader][] = [];
  for (const g of groups) {
    const isSub = g.channel_key.startsWith("dm:");
    const channel: ThreadChannel = isSub ? "sub_portal" : "client_portal";
    const slug = g.channel_key.split(":")[1] ?? "";
    const name = isSub ? g.sub_name || slug : g.client_name || g.proj_name || slug;
    // Counterparty (user) sent last → waiting on Joe; owner/ai last → awaiting.
    const view: ThreadStatus = g.last_author === "user" ? "needs_reply" : "awaiting_them";
    threads.push({
      id: g.channel_key,
      initials: initialsOf(name),
      fromName: name,
      channel,
      subject:
        g.last_body?.slice(0, 80) ||
        (isSub ? "Sub portal message" : "Client portal message"),
      preview: g.last_body || "",
      when: relativeWhen(Date.parse(g.last_at)),
      view,
      tag: isSub ? "Sub portal" : "Client portal",
      emphasis: view === "needs_reply" ? "flag" : "ghost",
      audience: isSub ? "sub" : "client",
      projectSlug: !isSub && g.proj_name ? slug : undefined,
      projectLabel: !isSub && g.proj_name ? g.proj_name : undefined,
    });
    const conv = byKey.get(g.channel_key) ?? [];
    const messages: ReaderMessage[] = conv.map((m) => ({
      fromName: m.author_name,
      initials: m.author_initials || initialsOf(m.author_name),
      meta: relativeWhen(Date.parse(m.created_at)),
      to: m.author_kind === "owner" ? `to ${name}` : "to Joe",
      body: [m.body],
    }));
    readerEntries.push([
      g.channel_key,
      readOnlyReader({
        tag: isSub ? `Sub portal · ${name}` : `Client portal · ${name}`,
        channel,
        subject: isSub ? `Sub portal — ${name}` : `Client portal — ${name}`,
        messages,
        actionHref: isSub ? "/chat" : `/projects/${slug}`,
        actionLabel: isSub ? "Open in Chat" : "Open project comms",
      }),
    ]);
  }
  return { threads, readerEntries };
}

/** Website-form channel: inbound inquiries that landed as website-sourced leads
 *  (dropped once lost). The reader shows the scope + any captured intake Q&A. */
async function loadSiteFormThreads(): Promise<ChannelBuild> {
  const { rows } = await query<{
    slug: string;
    name: string;
    stage: string;
    scope: string;
    scope_city: string | null;
    created_at: string;
  }>(
    `SELECT slug, name, stage, coalesce(scope,'') AS scope, scope_city, created_at
       FROM leads
      WHERE source ILIKE '%website%' AND stage <> 'lost'
      ORDER BY created_at DESC`,
  );
  if (!rows.length) return { threads: [], readerEntries: [] };

  const slugs = rows.map((r) => r.slug);
  const { rows: intake } = await query<{ slug: string; question: string; answer: string }>(
    `SELECT l.slug, li.question, li.answer
       FROM lead_intake li JOIN leads l ON l.id = li.lead_id
      WHERE l.slug = ANY($1) AND li.answer <> ''
      ORDER BY li.sort_order`,
    [slugs],
  );
  const intakeBySlug = new Map<string, { question: string; answer: string }[]>();
  for (const r of intake) {
    const list = intakeBySlug.get(r.slug) ?? [];
    list.push({ question: r.question, answer: r.answer });
    intakeBySlug.set(r.slug, list);
  }

  const threads: InboxThread[] = [];
  const readerEntries: [string, ThreadReader][] = [];
  for (const r of rows) {
    const id = `siteform:${r.slug}`;
    // A fresh intake lead is waiting on triage; a worked lead is off the queue.
    const view: ThreadStatus = r.stage === "intake" ? "needs_reply" : "done";
    const subject = `Website inquiry — ${r.name}`;
    threads.push({
      id,
      initials: initialsOf(r.name),
      fromName: r.name,
      channel: "site_form",
      subject,
      preview: r.scope || "New website inquiry",
      when: relativeWhen(Date.parse(r.created_at)),
      view,
      tag: "Website lead",
      emphasis: view === "needs_reply" ? "flag" : "ghost",
      audience: "client",
      aiVerdict: view === "needs_reply" ? "new lead — triage" : undefined,
    });
    const body: string[] = [];
    if (r.scope) body.push(r.scope);
    for (const qa of intakeBySlug.get(r.slug) ?? []) body.push(`${qa.question}\n${qa.answer}`);
    if (!body.length) body.push("New inquiry submitted through the website form.");
    readerEntries.push([
      id,
      readOnlyReader({
        tag: r.scope_city ? `Website lead · ${r.scope_city}` : "Website lead",
        channel: "site_form",
        subject,
        messages: [
          {
            fromName: r.name,
            initials: initialsOf(r.name),
            meta: relativeWhen(Date.parse(r.created_at)),
            to: "to SJ Carpentry",
            body,
          },
        ],
        actionHref: `/leads/${r.slug}`,
        actionLabel: "Open lead",
      }),
    ]);
  }
  return { threads, readerEntries };
}

/** Fold all non-email channels, isolating each so one failing source never
 *  takes down the email inbox (it just contributes no threads). */
async function loadChannelThreads(): Promise<ChannelBuild> {
  const safe = async (
    fn: () => Promise<ChannelBuild>,
    label: string,
  ): Promise<ChannelBuild> => {
    try {
      return await fn();
    } catch (err) {
      console.error(`[inbox:channels] ${label} failed — ${(err as Error).message}`);
      return { threads: [], readerEntries: [] };
    }
  };
  const parts = await Promise.all([
    safe(loadSmsThreads, "sms"),
    safe(loadPortalThreads, "portal"),
    safe(loadSiteFormThreads, "site_form"),
  ]);
  return {
    threads: parts.flatMap((p) => p.threads),
    readerEntries: parts.flatMap((p) => p.readerEntries),
  };
}

async function buildFromGmail(): Promise<InboxData> {
  const [page, labels, contactMaps, linkOptions, folded] = await Promise.all([
    fetchThreadPage(INBOX_PAGE),
    fetchLabelCounts(),
    loadContactMaps(),
    getLinkOptions(),
    loadChannelThreads(),
  ]);
  const labelMap = new Map(labels.map((l) => [l.id, l.name]));
  const { threads: emailThreads, readerEntries: emailReaderEntries } =
    mapRawThreads(page.threads, labelMap, contactMaps);

  // First paint stays on the first email needing a reply (the triage flow) —
  // computed before folding so a chatty portal thread can't steal first paint.
  const firstInDefault =
    emailThreads.find((t) => t.view === "needs_reply") ?? emailThreads[0];

  // Fold the non-email channels into the same list so the Channels rail works.
  const threads = [...emailThreads, ...folded.threads];
  const readerEntries = [...emailReaderEntries, ...folded.readerEntries];

  const viewCounts = countViews(threads);
  const channelCounts = countChannels(threads);

  // Label rail: ALL user labels with true Gmail totals (threadsTotal), so the
  // badge reflects every email the label contains — not just the handful that
  // paged into the loaded inbox window — and matches what clicking loads (the
  // label view paginates to everything). Tiny caveat documented on
  // fetchLabelCounts: totals include labeled threads in trash/spam, which the
  // opened list filters out — acceptable for user labels.
  const labelRail = labels.map((l) => ({
    id: l.id,
    name: l.name,
    count: l.count,
  }));

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

  return {
    smartViews: SMART_VIEWS.map((v) => ({
      ...v,
      count: viewCounts[v.key],
      active: v.key === "needs_reply",
    })),
    // Truthful counts from the folded list — a channel badge never advertises
    // threads it can't open (0 when that channel has no conversations yet).
    channels: CHANNELS.map((c) => ({ ...c, count: channelCounts[c.key] })),
    projects: projectsRail,
    labels: labelRail,
    activeView: { key: "needs_reply", label: "Needs reply" },
    threads,
    readers: Object.fromEntries(readerEntries),
    selectedId: firstInDefault?.id ?? "",
    nextPageToken: page.nextPageToken,
    linkOptions,
  };
}

// ─── Mock builder ────────────────────────────────────────────────────────────

async function buildFromMock(): Promise<InboxData> {
  // Truthful smart-view counts derived from the mock list itself, so a rail
  // badge never advertises threads that aren't there when the view is opened.
  const viewCounts = countViews(THREADS);
  // Derived from the mock list itself so a channel badge matches what opening
  // that channel actually shows. (The mock is the offline degrade path — real
  // DB-backed channel folding happens in buildFromGmail.)
  const channelCounts = countChannels(THREADS);

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

import {attachInquiryContinuity} from "./inbox-continuity";
import type { InboxLinkKind } from "./inbox-directory";
// Unified inbox data builder. Mock-backed today; swaps to DB queries in Phase 7
// (the threads table already exists — see db/schema.sql). Shape stays stable.
//
// Follows the lib/leads.ts pattern: a flat thread list drives the middle list,
// curated reader content is keyed by id with a generic fallback so every thread
// opens a real reader pane. The AI draft-reply card routes through lib/ai.ts —
// never a provider directly.

import { threadNeedsMe, rememberNeedsCount, stageLabel, substantiveSnippet, splitQuotedText, conversationDraftContext, automationDetails, screeningEligible, emailAddress, inquiryReplySubject, isAutomatedSender, isNoReplyAddress, needsMeReason, resolveReplyTarget, type ReplyTarget, type ReplyMessage, stripDraftHeaders } from "./inbox-rules";
import type { SystemViewKey, ThreadChannel, ThreadStatus } from "./types";
import { ai } from "./ai";
import { query } from "./db";
import { getCurrentUser } from "./dal";
import { ensureMailboxEmail } from "./mailbox-email";
import {
  activeMailbox,
  mailboxFor,
  runWithMailbox,
  type Mailbox,
  type MailboxViewer,
} from "./mailbox";
import { askHermes } from "./dev-agents";
import type { DraftModel } from "./dev-agents-meta";
import {
  gmailOAuthAppConfigured,
  fetchConversation,
  fetchThreadPage,
  fetchLabelCounts,
  type RawGmailThread,
  type GmailCategory, } from "./gmail";

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
  { key: "needs_reply", label: "Needs me", dot: "flag" },
  { key: "awaiting_them", label: "Awaiting them", dot: "ghost" },
  { key: "snoozed", label: "Snoozed", dot: "ghost" },
  // "Done", not "Done today": Gmail exposes no archive timestamp, so a literal
  // "today" scope isn't derivable — this is the "off my plate" bucket.
  { key: "done", label: "Done", dot: "ghost" },
];

/** Channel display labels, in rail order. Icons are mapped in the component. */
// "Email" with no address: the mailbox is whoever is signed in, so hardcoding
// Joe's showed his account to every staff login. The connected address is
// reported separately (InboxData.mailbox) and rendered under the rail item.
export const CHANNELS: { key: ThreadChannel; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
  { key: "client_portal", label: "Client portal" },
  { key: "sub_portal", label: "Sub portal" },
  { key: "site_form", label: "Website forms" },
];

// ─── Thread list ─────────────────────────────────────────────────────────────

export interface InboxTodo {
  id: string;
  title: string;
  due_at: string | null;
  assignees?: string;
  thread_linked?: boolean;
}
export interface InboxThread {
  websiteInquiry?:string;
  screeningFacts?:{knownContact:boolean;hasUnsubscribe:boolean;looksPitch:boolean};
  outstandingCents?: number;
  todos?: InboxTodo[];
  fromEmail?: string;
  contactKey?: string;
  contactStage?:string;
  contactRole?: "client" | "lead" | "sub" | "vendor";
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
  needsMeReason?: string;
  automated?: boolean;
  automationKind?: import("./inbox-rules").AutomationKind;
  inboundLast?: boolean;
  receivedAt?: number;
  attentionRequired?: boolean;
  attentionEvidence?: string;
  jobTodos?: InboxTodo[];
  attentionOverride?: boolean;
  senderDecision?: string;
  hasOpenTodo?: boolean;
  newSender?: boolean;
  filedOther?: boolean;
  /** Marks a thread tied to an active job (accent "Active job" chip). */
  activeJob?: boolean;
  /** Gmail STARRED — drives pin/star UI and the starred treatment. */
  starred?: boolean;
  /** Unread (Gmail UNREAD label / SMS unread flag) — bold row treatment. */
  unread?: boolean;
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
  linkedType?: InboxLinkKind;
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
    unread: true,
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
    unread: true,
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
  deliveryState?:string;
  deliveryError?:string;
  imagesBlocked?:boolean;
  id?: string;
  fromEmail?: string;
  cc?: string[];
  date?: number;
  outbound?: boolean;
  attachments?: import("./gmail").ConversationMessage["attachments"];

  fromName: string;
  initials: string;
  /** "maria@chen.example · 9:14am" */
  meta: string;
  to: string;
  /** Body paragraphs. */
  body: string[];
}

export interface ThreadReader {
  websiteInquiry?:string;
  automationKind?: import("./inbox-rules").AutomationKind;
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
  /** Secondary link to the channel's existing project, lead or sub page. */
  actionHref?: string;
  actionLabel?: string;
  replyTarget?: ReplyTarget | null;
  automated?: boolean;
  replyLabel?: string;
  form?: {name:string;town:string;phone:string;email:string;outgoingSubject:string;contactedAt?:string;contacted?:boolean;conversations?:{id:string;subject:string}[]};
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
  smartViews: { key: ThreadStatus; label: string; dot: "flag" | "ghost"; count: number | null; active: boolean }[];
  channels: { key: ThreadChannel; label: string; count: number | null }[];
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
  linkOptions?: { projects: { slug: string; name: string; stage?:string }[]; leads: { slug: string; name: string; stage?:string }[] };
  /** Whose mailbox this payload is, and whether one is connected at all. */
  mailbox: MailboxState;
  /** A failed Gmail load. Email retains its last good snapshot, when available. */
  loadError?: string;
  emailPaused?: boolean;
  lastSyncedAt?: number;
}

/** What the Email rail needs to say about the connected account. `connected:
 *  false` is the blank state a staff member sees before they link their own
 *  mail — deliberately NOT the demo mock and never someone else's inbox. */
export interface MailboxState {
  connected: boolean;
  /** The connected address, when Gmail reported one. */
  email: string | null;
  /** True when the token came from this user's own link (so they may unlink). */
  linked: boolean;
  /** False when GMAIL_CLIENT_ID/SECRET aren't set — nothing to connect TO, so
   *  the UI offers setup instructions instead of a dead button. */
  canConnect: boolean;
}

/** Count threads per smart view from the live list. */
function countViews(threads: InboxThread[]): Record<ThreadStatus, number> {
  const counts: Record<ThreadStatus, number> = {
    needs_reply: 0,
    awaiting_them: 0,
    snoozed: 0,
    done: 0,
  };
  for (const t of threads) {
    if (t.view === "needs_reply" && !threadNeedsMe(t)) continue;
    counts[t.view]++;
  }
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

/** Read the inbox as `viewer` (defaults to whoever's session this render is).
 *  Everything Gmail-facing runs inside that person's mailbox scope, so the page,
 *  the JSON route and the mobile route all get the signed-in user's mail rather
 *  than the one account that used to live in the environment.
 *
 *  Three outcomes, in order:
 *    • mailbox linked → Gmail, keeping the last good snapshot on failure.
 *    • signed in, nothing linked → the blank state: no email threads, a Connect
 *      button. Never the demo mock, and never another person's mail.
 *    • no session at all (a build-time prerender) → the demo mock, unchanged. */
export async function getInboxData(viewer?: MailboxViewer): Promise<InboxData> {
  const who = viewer ?? (await getCurrentUser());
  if (!who) return buildFromMock(unconnectedMailbox());
  const mb = activeMailbox() ?? (await mailboxFor(who));
  return runWithMailbox(mb, async () => {
    if (!mb.refreshToken) return buildFromGmail(mailboxState(mb), [{threads:[]},[]]);
    try {
      return await buildFromGmail(mailboxState(mb));
    } catch (err) {
      // Never show the demo conversations as if they were Joe's mail: an empty
      // mailbox and a plain reason, with a way to try again.
      const message = (err as Error).message;
      console.error(`[inbox:gmail] could not load — ${message}`);
      // Texts, portal messages and website forms don't come from Gmail: keep
      // showing them; only the email half is missing.
      const snapshot = gmailSnapshots.get(mailboxCacheKey());
      const base = await buildFromGmail(mailboxState(mb), snapshot?.data ?? [{ threads: [], nextPageToken: undefined }, []]).catch(() => buildEmptyMailbox(mb));
      return {
        ...base,
        emailPaused: true,
        lastSyncedAt: snapshot?.at,
        channels: base.channels.map(c => c.key === 'email' ? {...c,count:null} : c),
        smartViews: base.smartViews.map(v => ({...v,count:null})),
        labels: base.labels.map(l => ({...l,count:null})),
        loadError: /rate limit|quota/i.test(message)
          ? "Gmail is answering too many requests right now. Try again in a minute."
          : "Gmail didn't answer, so your email can't be shown right now. Try again in a minute.",
      };
    }
  });
}

function mailboxState(mb: Mailbox): MailboxState {
  return {
    connected: Boolean(mb.refreshToken),
    email: mb.email,
    linked: mb.linked,
    canConnect: gmailOAuthAppConfigured(),
  };
}

function unconnectedMailbox(): MailboxState {
  return { connected: false, email: null, linked: false, canConnect: gmailOAuthAppConfigured() };
}

/** The signed-in-but-nothing-linked inbox: the rails and smart views still
 *  render (so the page isn't a void) with honest zero counts, and the reader
 *  pane shows the Connect prompt. */
function buildEmptyMailbox(mb: Mailbox): InboxData {
  return {
    smartViews: SMART_VIEWS.map((v) => ({ ...v, count: 0, active: v.key === "needs_reply" })),
    channels: CHANNELS.map((c) => ({ ...c, count: 0 })),
    projects: [],
    labels: [],
    activeView: { key: "needs_reply", label: "Needs me" },
    threads: [],
    readers: {},
    selectedId: "",
    mailbox: mailboxState(mb),
  };
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
/** Joe already wrote in the thread, or it is a Re:/Fwd: chain — a person, not a mailer. */
function conversational(r: RawGmailThread): boolean {
  return Boolean(r.messages?.some(m => m.outbound)) || /^(?:re|fwd?|aw)\s*:/i.test(r.subject ?? "");
}
function isBulk(r: RawGmailThread): boolean {
  const incoming = r.messages && [...r.messages].reverse().find(m => !m.outbound);
  return isAutomatedSender(incoming?.fromEmail ?? r.fromEmail, r.category, { labelIds: r.labelIds, conversational: conversational(r), body: (incoming?.body.join("\n") || incoming?.snippet || r.bodyParas.join("\n") || r.snippet) }) || Boolean(incoming?.automated);
}

function viewOf(r: RawGmailThread): ThreadStatus {
  if (r.snoozed) return "snoozed";
  if (!r.inInbox) return "done";
  if (r.outbound) return "awaiting_them";
  if (isBulk(r)) return "done";
  return "needs_reply";
}

function rawToThread(r: RawGmailThread, labelMap: Map<string, string>): InboxThread {
  const details = automationDetails(r.fromEmail, r.subject, r.snippet, (r.messages ?? []).filter(m=>!m.outbound).map(m=>splitQuotedText(m.body).text).join("\n") || splitQuotedText(r.bodyParas).text);
  const view = isBulk(r) && details.attention && r.inInbox && !r.outbound && !r.snoozed ? "needs_reply" : viewOf(r);
  const needsReply = view === "needs_reply" && r.unread;
  // For outbound threads the counterparty is the recipient, not "me".
  const who = r.outbound && r.toLine ? displayName(r.toLine) : r.fromName;
  const labelNames = r.labelIds
    .filter((id) => labelMap.has(id))
    .map((id) => labelMap.get(id)!);
  return {
    id: r.id,
    fromEmail: r.outbound ? extractEmail(r.toLine) : r.fromEmail,
    initials: initialsOf(who),
    fromName: who,
    channel: "email",
    subject: r.subject,
    preview: substantiveSnippet(([...(r.messages ?? [])].reverse().find(m=>!m.outbound)?.body) ?? r.bodyParas ?? [r.snippet], r.subject),
    receivedAt:r.date,
    inboundLast:!r.outbound,
    when: relativeWhen(r.date),
    view,
    tag: "Email",
    emphasis: needsReply ? "flag" : r.starred ? "accent" : "ghost",
    automated: isBulk(r),
    automationKind: details.kind,
    attentionRequired: Boolean(details.attention),
    attentionEvidence: details.attention,
    starred: r.starred,
    unread: r.unread,
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
  const messages: ReaderMessage[] = r.messages?.map(m => ({
    id: m.id,
    fromName: m.fromName,
    fromEmail: m.fromEmail,
    initials: initialsOf(m.fromName),
    meta: relativeWhen(m.date),
    to: m.to.join(", "),
    cc: m.cc,
    date: m.date,
    body: m.body.length ? m.body : [m.snippet],
    outbound: m.outbound,
    attachments: m.attachments,
  })) ?? [{
    id: r.id,
    fromName: r.fromName,
    fromEmail: r.fromEmail,
    initials: initialsOf(r.fromName),
    meta: relativeWhen(r.date),
    to: r.toLine,
    date: r.date,
    body: r.bodyParas.length ? r.bodyParas : [r.snippet],
    outbound: r.outbound,
  }];
  const incoming = r.messages && [...r.messages].reverse().find(m => !m.outbound);
  return {
    automationKind: automationDetails(r.fromEmail,r.subject,r.snippet).kind,
    tag: "Email",
    channel: "email",
    channelLabel: channelLabel("email"),
    messageCount: messages.length,
    subject: r.subject,
    messages,
    aiDraft: { summary: "", body: "" },
    replyPlaceholder: `Reply to ${r.fromName.split(" ")[0]}…`,
    replyTarget: r.messages ? resolveReplyTarget(r.messages, r.ownAddresses ?? []) : null,
    automated: isBulk(r) || Boolean(incoming && isAutomatedSender(incoming.fromEmail, r.category, { conversational: conversational(r) })),
  };
}

/** Related context for a reply draft: pulls Open Brain knowledge + open Open
 *  Engine work items for the project/lead this email's counterparty is linked
 *  to, so a drafted reply can be grounded in the real job (not just the email
 *  text). Read-only. Returns empty context + null matchLabel when the sender
 *  matches no project or lead (a vendor, a stranger, a money thread). Exported
 *  so it can be exercised without Gmail or an LLM. */
export async function gatherReplyContext(raw: RawGmailThread, linked?: Pick<InboxThread,"projectSlug"|"projectLabel"|"linkedType"|"linkedSlug">): Promise<{
  knowledge: { kind: string; content: string }[];
  matchLabel: string | null;
}> {
  const maps = await loadContactMaps();
  const cls = linked ?? classifyThread(raw, maps);

  const projectSlug = cls.projectSlug ?? null;
  let leadSlug = cls.linkedType === "lead" ? cls.linkedSlug ?? null : null;
  // A manually-linked lead thread already carries its lead slug (+ name via
  // projectLabel), so label it too — not just project links.
  let matchLabel: string | null = projectSlug
    ? `project ${cls.projectLabel ?? projectSlug}`
    : leadSlug
      ? `lead ${cls.projectLabel ?? leadSlug}`
      : null;

  // No project/lead yet from the thread classification → one lead-by-email look
  // (classifyThread's byEmail map drops the slug, so resolve it directly here).
  if (!projectSlug && !leadSlug) {
    const email = raw.outbound ? extractEmail(raw.toLine) : raw.fromEmail.toLowerCase();
    if (email) {
      const { rows } = await query<{ slug: string; name: string }>(
        `SELECT slug, name FROM leads WHERE lower(email) = $1 ORDER BY created_at DESC LIMIT 1`,
        [email],
      );
      if (rows[0]) {
        leadSlug = rows[0].slug;
        matchLabel = `lead ${rows[0].name}`;
      }
    }
  }

  if (!projectSlug && !leadSlug) return { knowledge: [], matchLabel: null };

  const [know, work] = await Promise.all([
    query<{ kind: string; content: string }>(
      `SELECT k.kind, k.content
         FROM knowledge_items k
         LEFT JOIN projects p ON p.id = k.project_id
         LEFT JOIN leads    l ON l.id = k.lead_id
        WHERE ($1::text IS NOT NULL AND p.slug = $1)
           OR ($2::text IS NOT NULL AND l.slug = $2)
        ORDER BY k.created_at DESC
        LIMIT 6`,
      [projectSlug, leadSlug],
    ),
    query<{ title: string; status: string }>(
      `SELECT w.title, w.status
         FROM work_items w
         LEFT JOIN projects p ON p.id = w.project_id
         LEFT JOIN leads    l ON l.id = w.lead_id
        WHERE (($1::text IS NOT NULL AND p.slug = $1)
            OR ($2::text IS NOT NULL AND l.slug = $2))
          AND w.status NOT IN ('done', 'cancelled')
        ORDER BY w.created_at DESC
        LIMIT 5`,
      [projectSlug, leadSlug],
    ),
  ]);

  const knowledge = [
    ...know.rows.map((k) => ({ kind: k.kind, content: k.content.slice(0, 400) })),
    ...work.rows.map((w) => ({ kind: "open work item", content: `${w.title} (${w.status})` })),
  ];
  return { knowledge, matchLabel };
}

/** On-demand AI reply draft for a single Gmail thread (called when opened).
 *  `model` selects who drafts: "qwen" (fast, local) or "hermes" (grounded via
 *  its own MCP tools, slower). Both get the same Open Brain / Open Engine facts
 *  gathered here so the reply is grounded in the linked project/lead. This is a
 *  read-and-write-text operation only — it never sends anything. */
export async function draftReplyForThread(
  threadId: string,
  model: DraftModel = "hermes",
  intent = "",
): Promise<{ summary: string; body: string; toEmail: string; subject: string; basedOn: string }> {
  const isChannel=/^(sms:|portal:|dm:|siteform:)/.test(threadId);
  let channelThread:InboxThread|undefined;
  let conversation:{subject:string;ownAddresses:string[];messages:(ReplyMessage & {fromName:string; body:string[]; snippet?:string})[]};
  if(isChannel){
    const [maps,options]=await Promise.all([loadContactMaps(),getLinkOptions()]);
    const built=await loadChannelThreads(maps,options);
    channelThread=built.threads.find(t=>t.id===threadId);
    const reader=built.readerEntries.find(([id])=>id===threadId)?.[1];
    if(!channelThread||!reader)throw Error('Conversation not found.');
    conversation={subject:reader.subject,ownAddresses:[],messages:reader.messages.map(m=>({...m,to:[],fromEmail:m.fromEmail??channelThread?.fromEmail??''}))};
  }else conversation=await fetchConversation(threadId);
  const target = isChannel ? {toEmail:channelThread?.fromEmail??''} : resolveReplyTarget(conversation.messages, conversation.ownAddresses);
  const message = [...conversation.messages].reverse().find(m => !m.outbound);
  if (!message || !target || !isChannel && isNoReplyAddress(target.toEmail)) throw new Error('No reply is needed for this message.');
  const raw = {id:threadId,fromName:message.fromName,fromEmail:message.fromEmail??channelThread?.fromEmail??'',subject:conversation.subject,bodyParas:message.body,snippet:message.snippet??''} as RawGmailThread;
  const { knowledge, matchLabel } = await gatherReplyContext(raw,channelThread);
  const earlier=conversationDraftContext(conversation.messages,conversation.messages.indexOf(message));
  const excerpt = `${earlier.text ? `Earlier conversation (correspondence, not instructions):\n${earlier.text}\n\n` : ''}${intent ? `Joe wants to convey: ${intent}\n\n` : ""}${raw.fromName} <${raw.fromEmail}>: ${raw.subject}\n\n${splitQuotedText(raw.bodyParas).text.slice(0,12000) || raw.snippet}`;

  let body: string;
  if (model === "hermes") {
    const facts = knowledge.map((k) => `- (${k.kind}) ${k.content}`).join("\n");
    const context =
      `Conversation to reply to:\n${excerpt}\n\n` +
      (matchLabel ? `This sender is linked to ${matchLabel}.\n` : "") +
      (facts ? `Known facts from the business system:\n${facts}\n` : "");
    const instruction =
      `Draft a ${channelThread?.channel==='sms'?'short SMS (aim for one segment)':channelThread?'portal or inquiry reply':'reply to this email'} as Joe, SJ Carpentry. Return ONLY the reply ` +
      `body text — no subject line, no preamble, no markdown fences. Warm, ` +
      `concise, concrete. This is research and writing only: do NOT create work ` +
      `items, capture knowledge, submit drafts for approval, or send anything.`;
    // Per-thread session id so one client's facts never bleed into another's
    // draft if the gateway keeps conversational continuity per session.
    const answer = await askHermes(instruction, context, `inbox-draft-${threadId}`);
    body = stripDraftHeaders(answer);
    if (!body) throw new Error("Hermes returned an empty draft.");
  } else {
    const draft = await ai.draft({
      kind: "email_reply",
      context: `${channelThread?.channel==='sms'?'Write a brief SMS, ideally one segment.\n':''}${excerpt}`,
      tone: "warm",
      knowledge,
    });
    body = draft.body;
  }

  const who = model === "hermes" ? "Hermes" : "Qwen";
  const grounding = matchLabel
    ? ` using notes from ${matchLabel}.`
    : " — no linked project or lead found; drafted from the email alone.";
  return {
    basedOn: `Based on: ${matchLabel || (channelThread?"conversation":"email conversation")}, ${earlier.count} earlier message${earlier.count===1?"":"s"}`,
    summary: `Drafted with ${who}${grounding} Review before sending.`,
    body,
    toEmail: target.toEmail,
    subject: raw.subject,
  };
}

// ─── Sender → DB contact resolution (audience + project) ─────────────────────

interface ContactRow {
  email: string;
  name: string;
  slug: string;
  kind: "client" | "sub" | "vendor";
  stage?:string;
}
interface ProjectLinkRow {
  email: string;
  project_slug: string;
  project_label: string;
  stage?:string;
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
  type: InboxLinkKind;
  slug: string;
  projectSlug?: string; // set for project links → drives the by-project rail
  label: string;
}
interface ContactMaps {
  preferences: Map<string,string>;
  staffEmails: Set<string>;
  leadEmails: Set<string>;
  contactByEmail: Map<string,ContactRow>;
  byEmail: Map<string, Audience>;
  subDomains: Set<string>;
  projectByEmail: Map<string, { slug: string; label: string; stage?:string }>;
  linkByThread: Map<string, ManualLink>;
}

/** Load the contact index from Postgres once per inbox build. */
async function loadContactMaps(): Promise<ContactMaps> {
  await ensureMailboxEmail();
  const [contacts, links, threadLinks, staff, preferences] = await Promise.all([
    query<ContactRow>(
      `SELECT lower(email) AS email, name, slug, 'client' AS kind, replace(stage,'_',' ') AS stage
         FROM leads WHERE email IS NOT NULL AND email <> ''
       UNION ALL
       SELECT lower(email) AS email, name, slug, 'sub' AS kind, NULL AS stage
         FROM subs WHERE email IS NOT NULL AND email <> ''
       UNION ALL SELECT lower(email), name, slug, 'vendor', NULL FROM vendors WHERE email IS NOT NULL AND email <> ''`,
    ),
    query<ProjectLinkRow>(
      `SELECT lower(l.email) AS email, p.slug AS project_slug, p.name AS project_label, p.status AS stage
         FROM projects p JOIN leads l ON p.lead_id = l.id
        WHERE l.email IS NOT NULL AND l.email <> ''
       UNION ALL SELECT lower(client_email), slug, name, status FROM projects WHERE client_email <> ''`,
    ),
    query<{ thread_id: string; link_type: InboxLinkKind; link_slug: string; label: string; project_slug: string | null }>(
      `SELECT tl.gmail_thread_id AS thread_id, tl.link_type, tl.link_slug,
              COALESCE(p.name, l.name, s.name, v.name, tl.link_slug) AS label,
              p.slug AS project_slug
         FROM thread_links tl
         LEFT JOIN projects p ON tl.link_type = 'project' AND p.slug = tl.link_slug
         LEFT JOIN leads    l ON tl.link_type = 'lead'    AND l.slug = tl.link_slug
         LEFT JOIN subs s ON tl.link_type='sub' AND s.slug=tl.link_slug
         LEFT JOIN vendors v ON tl.link_type='vendor' AND v.slug=tl.link_slug`,
    ),
    query<{email:string}>(`SELECT lower(email) AS email FROM users WHERE role IN ('owner','staff')`),
    query<{subject_key:string;decision:string}>(`SELECT subject_key,decision FROM inbox_preferences WHERE mailbox=$1`, [activeMailbox()?.email?.toLowerCase() ?? ""]),
  ]);

  const byEmail = new Map<string, Audience>();
  const subDomains = new Set<string>();
  for (const c of contacts.rows) {
    // Subs win ties over clients (businesses are the more specific match).
    if (c.kind === "sub" || !byEmail.has(c.email)) {
      byEmail.set(c.email, c.kind === "sub" ? "sub" : c.kind === "vendor" ? "money" : "client");
    }
    if (c.kind === "sub") {
      const d = domainOf(c.email);
      if (d && !CONSUMER_DOMAINS.has(d)) subDomains.add(d);
    }
  }

  const projectByEmail = new Map<string, { slug: string; label: string; stage?:string }>();
  for (const p of links.rows) {
    projectByEmail.set(p.email, { slug: p.project_slug, label: p.project_label,stage:stageLabel(p.stage ?? "") });
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

  return { preferences:new Map(preferences.rows.map(p=>[p.subject_key,p.decision])), contactByEmail:new Map(contacts.rows.map(c=>[c.email,c])), byEmail, subDomains, projectByEmail, linkByThread, staffEmails:new Set(staff.rows.map(r => r.email)), leadEmails:new Set(contacts.rows.filter(c=>c.kind === "client").map(c=>c.email)) };
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
  linkedType?: InboxLinkKind;
  linkedSlug?: string;
} {
  // An explicit directory link takes precedence over email/domain guesses.
  const manual = maps.linkByThread.get(r.id);
  if (manual) {
    return {
      audience: manual.type==="sub"?"sub":manual.type==="vendor"?"money":"client",
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

// Remember aliases learned from already-fetched envelopes across pagination.
// No profile/send-as fan-out; never carry addresses between mailboxes.
const learnedMailboxAliases = new Map<string, Set<string>>();

/** Map a page of raw Gmail threads → InboxThreads (audience/project resolved)
 *  + reader entries. Shared by the first load and "Load more". */
function mapRawThreads(
  raw: RawGmailThread[],
  labelMap: Map<string, string>,
  contactMaps: ContactMaps,
): { threads: InboxThread[]; readerEntries: [string, ThreadReader][] } {
  const mailboxKey = mailboxCacheKey();
  const aliases = learnedMailboxAliases.get(mailboxKey) ?? new Set<string>();
  for (const r of raw) {
    for (const address of [...(r.ownAddresses ?? []), ...(r.messages?.filter(m=>m.outbound).map(m=>m.fromEmail) ?? []), ...(r.outbound ? [r.fromEmail] : [])]) {
      if (aliases.size < 100) aliases.add(emailAddress(address));
    }
  }
  learnedMailboxAliases.set(mailboxKey, aliases);
  if (learnedMailboxAliases.size > 20) learnedMailboxAliases.delete(learnedMailboxAliases.keys().next().value!);
  const own = [emailAddress(activeMailbox()?.email ?? ''), ...aliases];
  const threads = raw.map((r) => rawToThread(r, labelMap));
  const knownIds = new Set<string>();
  raw.forEach((r, i) => {
    const c = classifyThread(r, contactMaps);
    const staff = contactMaps.staffEmails.has(r.fromEmail.toLowerCase()) || own.includes(emailAddress(r.fromEmail));
    if (staff && threads[i].view === 'needs_reply') threads[i].view = 'awaiting_them';
    const person=contactMaps.contactByEmail.get(threads[i].fromEmail ?? '');
    const known = Boolean(person || c.projectSlug || c.linkedType || c.audience === "sub");
    // A client, lead or sub is never "automated" because Gmail tagged the mail
    // Updates or their mail tool added a List-Unsubscribe header.
    if (known && !isNoReplyAddress(r.fromEmail) && threads[i].automated) {
      threads[i].automated = false;
      knownIds.add(r.id);
      if (threads[i].view === "done" && r.inInbox && !r.snoozed && !r.outbound) {
        threads[i].view = "needs_reply";
        if (r.unread) threads[i].emphasis = "flag";
      }
    }
    const bulk = Boolean(threads[i].automated);
    const decision = contactMaps.preferences.get(`sender:${threads[i].fromEmail?.toLowerCase()}`);
    const override = contactMaps.preferences.get(`thread:${r.id}`);
    threads[i].screeningFacts={knownContact:known,hasUnsubscribe:Boolean(r.messages?.some(m=>m.hasUnsubscribe)),looksPitch:/\b(?:partnership|marketing|promot(?:e|ion)|grow your|offer our|our services|pre-approved|funding offer)\b/i.test(r.subject+' '+(r.messages?.at(-1)?.body.join(' ') ?? r.snippet))};
    threads[i].senderDecision = decision;
    threads[i].filedOther = decision === 'other' || decision === 'blocked';
    threads[i].attentionOverride = override ? override === 'attention' : undefined;
    if (bulk && (threads[i].attentionOverride ?? threads[i].attentionRequired) && r.inInbox && !r.outbound && !r.snoozed) threads[i].view = 'needs_reply';
    if (bulk && override === 'other') threads[i].view = r.inInbox ? 'awaiting_them' : 'done';
    threads[i].needsMeReason = needsMeReason({
      channel: "email",
      inbound: !r.outbound,
      staff,
      automated: bulk,
      done: threads[i].view === "done" || threads[i].view === "snoozed",
      audience: c.audience,
      isLead: c.linkedType === "lead" || (contactMaps.leadEmails.has(r.fromEmail.toLowerCase()) && !c.projectSlug),

    });
    if (bulk && threads[i].view === 'needs_reply' && (threads[i].attentionOverride ?? threads[i].attentionRequired))
      threads[i].needsMeReason = `Needs attention · ${threads[i].attentionEvidence ?? 'Marked by you'}`;
    threads[i].newSender = screeningEligible({email:r.fromEmail,inbound:!r.outbound,done:!r.inInbox || r.snoozed,known,staff,automated:bulk,ownAddresses:own,decision});
    if (threads[i].newSender && threads[i].view === "needs_reply") threads[i].needsMeReason = "New sender";
    threads[i].contactKey=c.linkedType?`${c.linkedType}:${c.linkedSlug}`:person ? `${person.kind==='client'?'lead':person.kind}:${person.slug}` : c.projectSlug ? `project:${c.projectSlug}` : undefined;
    threads[i].contactStage=c.projectSlug ? contactMaps.projectByEmail.get(threads[i].fromEmail ?? '')?.stage : person?.stage;
    if(person?.kind==='client'&&!c.projectSlug&&!c.linkedType){c.linkedType='lead';c.linkedSlug=person.slug;c.projectLabel=person.name;}
    threads[i].contactRole = c.audience === "sub" ? "sub" : c.audience === "money" ? "vendor" : c.linkedType === "lead" || (contactMaps.leadEmails.has(threads[i].fromEmail ?? "") && !c.projectSlug) ? "lead" : c.projectSlug ? "client" : undefined;
    threads[i].audience = c.audience;
    threads[i].projectSlug = c.projectSlug;
    threads[i].projectLabel = c.projectLabel;
    threads[i].linkedType = c.linkedType;
    threads[i].linkedSlug = c.linkedSlug;
    // A resolved project becomes the row's tag chip (else the generic "Email").
    if (c.projectLabel) threads[i].tag = c.projectLabel;
  });
  const readerEntries = raw.map(
    (r) => {
      const reader = rawToReader(r);
      for(const message of reader.messages){
        const address=emailAddress(message.fromEmail??'');
        const screened=contactMaps.preferences.get(`sender:${address}`);
        message.imagesBlocked=!message.outbound&&!contactMaps.contactByEmail.has(address)&&!contactMaps.projectByEmail.has(address)&&!['linked','lead','sub','vendor'].includes(screened??'');
      }
      if (knownIds.has(r.id)) reader.automated = false;
      return [r.id, reader] as [string, ThreadReader];
    },
  );
  return { threads, readerEntries };
}

async function attachThreadMoney(threads: InboxThread[]): Promise<void> {
  // Job balances are money: staff without the Money area never get them.
  const who = await getCurrentUser().catch(() => null) as { role?: string; permissions?: string[] } | null;
  if (!who || !(who.role === 'owner' || (who.role === 'staff' && who.permissions?.includes('money')))) return;
  const slugs=[...new Set(threads.map(t=>t.projectSlug || (t.linkedType==='project'?t.linkedSlug:undefined)).filter((s):s is string=>Boolean(s)))];
  if(!slugs.length)return;
  try {
    const {rows}=await query<{slug:string;outstanding_cents:string}>(`SELECT slug, GREATEST(0,total_cents-collected_cents)::text AS outstanding_cents FROM projects WHERE slug=ANY($1::text[])`,[slugs]);
    const money=new Map(rows.map(r=>[r.slug,Number(r.outstanding_cents)]));
    for(const t of threads)t.outstandingCents=money.get(t.projectSlug || t.linkedSlug || '');
  } catch(error){console.error('[inbox:money] Could not load job balances.',error);}
}
async function attachThreadTodos(threads: InboxThread[]): Promise<void> {
  await attachThreadMoney(threads);
  if (!threads.length) return;
  try {
  const {rows} = await query<InboxTodo & {thread_id:string}>(
    `SELECT DISTINCT w.id::text,w.title,w.due_at,requested.id AS thread_id,
       COALESCE((w.source_id=requested.id OR EXISTS (SELECT 1 FROM obligation_sources os WHERE os.obligation_id=w.obligation_id AND os.thread_id=requested.id)),false) AS thread_linked,
       COALESCE((SELECT string_agg(u.name,', ' ORDER BY u.name) FROM work_item_assignees a JOIN users u ON u.id=a.user_id WHERE a.work_item_id=w.id),'Joe') AS assignees
     FROM jsonb_to_recordset($1::jsonb) AS requested(id text, project text, lead text)
     JOIN work_items w ON w.source_id=requested.id
       OR EXISTS (SELECT 1 FROM obligation_sources os WHERE os.obligation_id=w.obligation_id AND os.thread_id=requested.id)
       OR w.project_id IN (SELECT id FROM projects WHERE slug=requested.project)
       OR w.lead_id IN (SELECT id FROM leads WHERE slug=requested.lead)
     WHERE w.status NOT IN ('done','cancelled') AND w.archived_at IS NULL
     ORDER BY w.due_at NULLS LAST,w.id::text`,
    [JSON.stringify(threads.map(t=>({id:t.id,project:t.projectSlug || (t.linkedType==='project'?t.linkedSlug:null),lead:t.linkedType==='lead'?t.linkedSlug:t.contactKey?.startsWith('lead:')?t.contactKey.slice(5):null})))]);
  for (const thread of threads) {
    const tasks = rows.filter(r=>r.thread_id===thread.id);
    thread.todos = tasks.filter(r=>r.thread_linked!==false);
    thread.jobTodos = tasks.filter(r=>r.thread_linked===false);
    thread.hasOpenTodo = thread.todos.length > 0;
  }
  } catch (error) {
    console.error(`[inbox:tasks] Could not load linked to-dos: ${(error as Error).message}`);
  }
}

const INBOX_PAGE = 50;

/** Fetch the next page of inbox threads (for "Load more"). */
export async function loadMoreInbox(pageToken: string): Promise<{
  threads: InboxThread[];
  readers: Record<string, ThreadReader>;
  nextPageToken?: string;
  emailPaused?: boolean;
  lastSyncedAt?: number;
}> {
  return loadEmailPage("inbox", pageToken);
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
  emailPaused?: boolean;
  lastSyncedAt?: number;
}> {
  return loadEmailPage(`label:${labelId}`, pageToken, labelId);
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
  emailPaused?: boolean;
  lastSyncedAt?: number;
}> {
  const def = SYSTEM_VIEW_FETCH[key];
  if (!def) throw new Error('Unknown view.');
  return loadEmailPage(`system:${key}`, pageToken, def.labelId, def.q);
}

/** Records the owner can manually link a thread to (P6-3). */
async function getLinkOptions(): Promise<InboxData["linkOptions"]> {
  const [projects, leads] = await Promise.all([
    query<{ slug: string; name: string; stage:string }>(`SELECT slug, name, status AS stage FROM projects ORDER BY updated_at DESC`),
    query<{ slug: string; name: string; stage:string }>(`SELECT slug, name, replace(stage,'_',' ') AS stage FROM leads ORDER BY created_at DESC`),
  ]);
  return { projects: projects.rows.map(p=>({...p,stage:stageLabel(p.stage??'')})), leads: leads.rows.map(l=>({...l,stage:stageLabel(l.stage??'')})) };
}

// ─── Non-email channel folding (SMS / portals / website forms) ───────────────
// The unified inbox is Gmail-centric, so the "Channels" rail only ever showed
// Email. These loaders fold each channel's REAL conversations (from Postgres)
// into the same thread list. Replies adapt to the channel's existing actions;
// no provider sends or writes are added to these readers.

interface ChannelBuild {
  threads: InboxThread[];
  readerEntries: [string, ThreadReader][];
}

type ChatAuthor = "owner" | "ai" | "user";

/** A channel reader; no AI call is made while loading conversations. */
function channelReader(opts: {
  tag: string;
  channel: ThreadChannel;
  subject: string;
  messages: ReaderMessage[];
  actionHref?: string;
  actionLabel?: string;
  replyLabel?: string;
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
    replyLabel:opts.replyLabel,
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
      WHERE t.blocked_at IS NULL
      ORDER BY t.last_message_at DESC NULLS LAST, t.id DESC`,
  );
  if (!rows.length) return { threads: [], readerEntries: [] };

  const ids = rows.map((r) => r.id);
  const { rows: msgs } = await query<{
    id: string;
    thread_id: string;
    direction: "in" | "out";
    body: string;
    status: string;
    error_detail: string | null;
    created_at: string;
  }>(
    `SELECT id::text AS id, thread_id::text AS thread_id, direction, body, status, error_detail, created_at
       FROM sms_messages WHERE thread_id = ANY($1::bigint[]) ORDER BY created_at, sms_messages.id`,
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
    // Only their last inbound text needs Joe; unread outbound is not an ask.
    const view: ThreadStatus =
      r.last_dir === "in" ? "needs_reply" : "awaiting_them";
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
      contactKey:r.link_type && r.link_slug ? `${r.link_type}:${r.link_slug}` : undefined,
      contactRole:r.link_type === "sub" ? "sub" : r.link_type === "lead" ? "lead" : r.link_type === "vendor" ? "vendor" : r.link_type ? "client" : undefined,
      linkedType:r.link_type === "project" || r.link_type === "lead" ? r.link_type : undefined,
      linkedSlug:r.link_type === "project" || r.link_type === "lead" ? r.link_slug ?? undefined : undefined,
      emphasis: view === "needs_reply" ? "flag" : "ghost",
      unread: r.unread,
      needsMeReason: needsMeReason({channel:"sms",inbound:r.last_dir === "in",audience, isLead:r.link_type === "lead"}),
      audience,
    });
    const conv = byThread.get(r.id) ?? [];
    const messages: ReaderMessage[] = conv.map((m) => ({
      id:m.id,date:Date.parse(m.created_at),outbound:m.direction === "out",
      deliveryState:m.direction === "out"?m.status:undefined,deliveryError:m.error_detail??undefined,
      fromName: m.direction === "in" ? name : "Joe",
      initials: m.direction === "in" ? initialsOf(name) : "JS",
      meta: relativeWhen(Date.parse(m.created_at)),
      to: m.direction === "in" ? "to Joe" : `to ${name}`,
      body: [m.body],
    }));
    if (!messages.length) {
      messages.push({
        id:`sms:${r.id}:latest`,date:r.last_message_at ? Date.parse(r.last_message_at) : undefined,outbound:r.last_dir === 'out',
        fromName: r.last_dir === 'out' ? 'Joe' : name,
        initials: initialsOf(name),
        meta: r.last_message_at ? relativeWhen(Date.parse(r.last_message_at)) : "",
        to: "to Joe",
        body: [r.last_body || ""],
      });
    }
    const href = smsLinkHref(r.link_type, r.link_slug);
    readerEntries.push([
      id,
      channelReader({
        tag: `SMS · ${name}`,
        channel: "sms",
        subject: `Text — ${name}`,
        replyLabel:`To ${formatPhone(r.phone)} · ` + (process.env.SMS_FROM_NUMBER ? `Text from the SJC number ${formatPhone(process.env.SMS_FROM_NUMBER)}` : "Text from the SJC number"),
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
    last_is_staff: boolean;
    lead_slug:string|null;
  }>(
    `SELECT m.channel_key,
            max(m.created_at) AS last_at,
            (array_agg(m.author_kind ORDER BY m.created_at DESC, m.id DESC))[1] AS last_author,
            (array_agg(m.body        ORDER BY m.created_at DESC, m.id DESC))[1] AS last_body,
            p.name AS proj_name, COALESCE(l.name, lead.name) AS client_name, s.name AS sub_name, COALESCE(l.slug,lead.slug) AS lead_slug,
            (array_agg(u.role IN ('owner','staff') ORDER BY m.created_at DESC, m.id DESC))[1] AS last_is_staff
       FROM chat_messages m
       LEFT JOIN projects p ON m.channel_key LIKE 'portal:%' AND p.slug = split_part(m.channel_key, ':', 2)
       LEFT JOIN leads    l ON p.lead_id = l.id
       LEFT JOIN leads lead ON m.channel_key LIKE 'portal:lead:%' AND lead.slug = split_part(m.channel_key, ':', 3)
       LEFT JOIN users u ON u.id = m.author_user_id
       LEFT JOIN subs     s ON m.channel_key LIKE 'dm:%'     AND s.slug = split_part(m.channel_key, ':', 2)
      -- Only sub DMs (dm:<slug>) map to the sub portal. Team/client DMs (P1-D3,
      -- dm:team:% / dm:client:%) are chat-surface only — excluding them keeps a
      -- client DM from rendering as a bogus "Sub portal" thread here.
      WHERE m.channel_key LIKE 'portal:%'
         OR (m.channel_key LIKE 'dm:%'
             AND m.channel_key NOT LIKE 'dm:team:%'
             AND m.channel_key NOT LIKE 'dm:client:%')
      GROUP BY m.channel_key, p.name, l.name, lead.name, s.name, l.slug, lead.slug
      ORDER BY max(m.created_at) DESC`,
  );
  if (!groups.length) return { threads: [], readerEntries: [] };

  const keys = groups.map((g) => g.channel_key);
  const { rows: msgs } = await query<{
    id:string;
    channel_key: string;
    author_kind: ChatAuthor;
    is_staff: boolean;
    author_name: string;
    author_initials: string;
    body: string;
    created_at: string;
  }>(
    `SELECT m.id::text AS id, m.channel_key, m.author_kind, m.author_name, m.author_initials, m.body, m.created_at,
            COALESCE(u.role IN ('owner','staff'), false) AS is_staff
       FROM chat_messages m LEFT JOIN users u ON u.id = m.author_user_id
      WHERE m.channel_key = ANY($1) ORDER BY m.created_at, m.id`,
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
    const isLead = g.channel_key.startsWith("portal:lead:");
    const slug = g.channel_key.split(":")[isLead ? 2 : 1] ?? "";
    const name = isSub ? g.sub_name || slug : g.client_name || g.proj_name || slug;
    // Counterparty (user) sent last → waiting on Joe; owner/ai last → awaiting.
    const view: ThreadStatus = g.last_author === "user" && !g.last_is_staff ? "needs_reply" : "awaiting_them";
    threads.push({
      id: g.channel_key,
      contactKey: isSub ? `sub:${slug}` : g.lead_slug ? `lead:${g.lead_slug}` : isLead ? `lead:${slug}` : `project:${slug}`,
      contactRole: isSub ? "sub" : isLead ? "lead" : "client",
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
      needsMeReason: needsMeReason({channel,inbound:view === "needs_reply",isLead}),
      audience: isSub ? "sub" : "client",
      projectSlug: !isSub && g.proj_name ? slug : undefined,
      projectLabel: !isSub && g.proj_name ? g.proj_name : undefined,
    });
    const conv = byKey.get(g.channel_key) ?? [];
    const messages: ReaderMessage[] = conv.map((m) => ({
      id:m.id,date:Date.parse(m.created_at),outbound:m.author_kind !== "user" || m.is_staff,
      deliveryState:m.author_kind !== "user" || m.is_staff?"sent":undefined,
      fromName: m.author_name,
      initials: m.author_initials || initialsOf(m.author_name),
      meta: relativeWhen(Date.parse(m.created_at)),
      to: m.author_kind === "owner" ? `to ${name}` : "to Joe",
      body: [m.body],
    }));
    readerEntries.push([
      g.channel_key,
      channelReader({
        tag: isSub ? `Sub portal · ${name}` : `Client portal · ${name}`,
        channel,
        subject: isSub ? `Sub portal — ${name}` : `Client portal — ${name}`,
        messages,
        replyLabel: `Visible to ${name} in their portal`,
        actionHref: isSub ? `/subs/${slug}` : isLead ? `/leads/${slug}` : `/projects/${slug}`,
        actionLabel: isSub ? "Open sub" : isLead ? "Open lead" : "Open project",
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
    email: string | null;
    phone: string | null;
    created_at: string;
    last_contact_at?:string;
    email_thread_ids?:string[];
  }>(
    `SELECT slug, name, stage, coalesce(scope,'') AS scope, scope_city, email, phone, created_at,last_contact_at,
       ARRAY(SELECT tl.gmail_thread_id FROM thread_links tl WHERE tl.link_type='lead' AND tl.link_slug=leads.slug ORDER BY tl.created_at DESC) AS email_thread_ids
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
      linkedType:"lead", linkedSlug:r.slug, contactRole:"lead", contactKey:`lead:${r.slug}`, fromEmail:r.email ?? undefined,
      emphasis: view === "needs_reply" ? "flag" : "ghost",
      audience: "client",
      needsMeReason: needsMeReason({channel:"site_form",inbound:true,done:view === "done"}),
    });
    const body: string[] = [];
    if (r.scope) body.push(r.scope);
    for (const qa of intakeBySlug.get(r.slug) ?? []) body.push(`${qa.question}\n${qa.answer}`);
    if (!body.length) body.push("New inquiry submitted through the website form.");
    readerEntries.push([
      id,
      { ...channelReader({
        tag: r.scope_city ? `Website lead · ${r.scope_city}` : "Website lead",
        channel: "site_form",
        subject,
        replyLabel:r.email ? `Reply by email to ${r.email}` : "No email address supplied — open the lead to contact them.",
        messages: [
          {
            id,fromEmail:r.email ?? undefined,date:Date.parse(r.created_at),outbound:false,
            fromName: r.name,
            initials: initialsOf(r.name),
            meta: relativeWhen(Date.parse(r.created_at)),
            to: "to SJ Carpentry",
            body,
          },
        ],
        actionHref: `/leads/${r.slug}`,
        actionLabel: "Open lead",
      }), form: {name:r.name,town:r.scope_city ?? "",phone:r.phone ?? "",email:r.email ?? "",contactedAt:r.last_contact_at,conversations:(r.email_thread_ids ?? []).map(id=>({id,subject:"Email conversation"})),outgoingSubject:inquiryReplySubject(r.scope,r.name)} },
    ]);
  }
  return { threads, readerEntries };
}

/** Fold all non-email channels, isolating each so one failing source never
 *  takes down the email inbox (it just contributes no threads). */
async function loadChannelThreads(maps:ContactMaps,options:InboxData["linkOptions"]): Promise<ChannelBuild> {
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
  const threads=parts.flatMap(p=>p.threads);
  const readerEntries=parts.flatMap(p=>p.readerEntries);
  const {rows:handled}=await query<{inbox_key:string;last_message_at:string}>(`SELECT inbox_key,last_message_at FROM threads WHERE inbox_key=ANY($1::text[]) AND status='done'`,[threads.map(t=>t.id)]);
  const {rows:links}=await query<{thread_id:string;link_type:InboxLinkKind;link_slug:string;label:string;stage:string}>(`SELECT tl.gmail_thread_id AS thread_id,tl.link_type,tl.link_slug,COALESCE(p.name,l.name) AS label,
    COALESCE(p.status,l.stage) AS stage
    FROM thread_links tl LEFT JOIN projects p ON tl.link_type='project' AND p.slug=tl.link_slug
    LEFT JOIN leads l ON tl.link_type='lead' AND l.slug=tl.link_slug WHERE tl.gmail_thread_id=ANY($1::text[])`,[threads.map(t=>t.id)]);
  const byId=new Map(links.map(l=>[l.thread_id,l]));
  for(const t of threads){const l=byId.get(t.id);if(l){t.linkedType=l.link_type;t.linkedSlug=l.link_slug;t.projectSlug=l.link_type==='project'?l.link_slug:undefined;t.projectLabel=l.label;t.contactStage=stageLabel(l.stage ?? "");}}
  const contactsByKey=new Map([...maps.contactByEmail.values()].map(c=>[`${c.kind==='client'?'lead':c.kind}:${c.slug}`,c]));
  const projectContacts=new Map([...maps.projectByEmail].map(([email,p])=>[p.slug,{email,...p}]));
  for(const t of threads){
    const [kind,slug]=t.contactKey?.split(':') ?? [];
    const project=kind==='project'||kind==='client' ? projectContacts.get(slug) : undefined;
    const contact=contactsByKey.get(t.contactKey ?? '') ?? (project ? maps.contactByEmail.get(project.email) : undefined);
    if(project){t.fromEmail=project.email;t.projectSlug=project.slug;t.projectLabel=project.label;}
    if(contact){t.fromEmail=contact.email;t.contactKey=`${contact.kind==='client'?'lead':contact.kind}:${contact.slug}`;t.contactStage=contact.stage;}
    const job=t.projectSlug ? options?.projects.find(p=>p.slug===t.projectSlug) ?? projectContacts.get(t.projectSlug) : undefined;
    if(job){t.projectLabel='name' in job?job.name:job.label;t.contactStage=job.stage;}
    if(!t.projectSlug&&t.linkedType==='lead'){const l=options?.leads.find(l=>l.slug===t.linkedSlug);if(l){t.projectLabel=l.name;t.contactStage=stageLabel(l.stage ?? "");}}
    if(!t.projectLabel&&contact?.kind==='client'){t.projectLabel=contact.name;t.linkedType='lead';t.linkedSlug=contact.slug;}
    if(!t.contactStage&&t.projectSlug)t.contactStage=projectContacts.get(t.projectSlug)?.stage;
  }
  const readersById=new Map(readerEntries);
  for(const t of threads){
    const messages=readersById.get(t.id)?.messages;
    const inbound=messages&&[...messages].reverse().find(m=>!m.outbound);
    if(inbound)t.preview=substantiveSnippet(inbound.body,t.subject);
    if(messages?.at(-1)?.date)t.receivedAt=messages.at(-1)!.date;
  }
  const dates=new Map(handled.map(r=>[r.inbox_key,Date.parse(r.last_message_at)]));
  const readers=new Map(readerEntries);
  for(const t of threads){const through=dates.get(t.id);const last=readers.get(t.id)?.messages.at(-1)?.date;if(through&&last&&last<=through){t.view='done';t.needsMeReason=undefined;}}
  return {threads,readerEntries};
}

// The page re-renders whenever anything in the database changes (LiveUpdates
// polls every few seconds and agents write often). Re-fetching the whole
// mailbox each time — one list call plus one per thread — ran Joe's Gmail
// account into Google's per-minute limit. The Gmail half (threads + label
// counts) is kept for a short while per mailbox; texts, portal messages, forms
// and job links stay live. Any inbox action clears it (invalidateInboxCache).
const GMAIL_TTL_MS = 30_000;
type GmailLoad = [Awaited<ReturnType<typeof fetchThreadPage>>, Awaited<ReturnType<typeof fetchLabelCounts>>];
type GmailCache = Map<string, { at: number; data: Promise<GmailLoad> }>;
type GmailSnapshots = Map<string, { at: number; data: GmailLoad }>;
const gmailCache: GmailCache = new Map();
const gmailSnapshots: GmailSnapshots = new Map();
const viewCache: GmailCache = new Map();
const viewSnapshots: GmailSnapshots = new Map();

function mailboxCacheKey() {
  const mb = activeMailbox();
  return JSON.stringify([mb?.email, mb?.refreshToken]);
}

export function invalidateInboxCache(): void {
  gmailCache.clear();
  viewCache.clear();
}

function cachedLoad(cache: GmailCache, snapshots: GmailSnapshots, key: string, load: () => Promise<GmailLoad>) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < GMAIL_TTL_MS) return hit.data;
  const data = load().then(result => {
    // An invalidated request may finish after its replacement; never roll back.
    if (cache.get(key)?.data === data) snapshots.set(key, { at: Date.now(), data: result });
    while (snapshots.size > 100) snapshots.delete(snapshots.keys().next().value!);
    return result;
  });
  cache.set(key, { at: Date.now(), data });
  data.catch(() => { if (cache.get(key)?.data === data) cache.delete(key); });
  // Bound retained payloads on this shared server.
  while (cache.size > 100) cache.delete(cache.keys().next().value!);
  return data;
}

function cachedGmail() {
  return cachedLoad(gmailCache, gmailSnapshots, mailboxCacheKey(), () =>
    Promise.all([fetchThreadPage(INBOX_PAGE), fetchLabelCounts()]),
  );
}

async function loadEmailPage(view: string, pageToken?: string, labelId?: string, q?: string) {
  const key = JSON.stringify([mailboxCacheKey(), view, pageToken]);
  let payload: GmailLoad;
  let emailPaused = false;
  try {
    payload = await cachedLoad(viewCache, viewSnapshots, key, () =>
      Promise.all([fetchThreadPage(INBOX_PAGE, pageToken, labelId, q), fetchLabelCounts()]),
    );
  } catch (err) {
    const last = viewSnapshots.get(key);
    if (!last) throw err;
    payload = last.data;
    emailPaused = true;
  }
  const [page, labels] = payload;
  const maps = await loadContactMaps();
  const { threads, readerEntries } = mapRawThreads(page.threads, new Map(labels.map(l => [l.id, l.name])), maps);
  attachInquiryContinuity(threads,Object.fromEntries(readerEntries));
  await attachThreadTodos(threads);
  return {
    threads,
    readers: Object.fromEntries(readerEntries),
    nextPageToken: page.nextPageToken,
    emailPaused,
    lastSyncedAt: viewSnapshots.get(key)?.at,
  };
}

async function buildFromGmail(
  mailbox: MailboxState,
  /** Gmail's half supplied by the caller (empty when Gmail failed). */
  gmail?: [Awaited<ReturnType<typeof fetchThreadPage>>, Awaited<ReturnType<typeof fetchLabelCounts>>],
): Promise<InboxData> {
  const contacts=loadContactMaps();
  const options=getLinkOptions();
  const [[page, labels], contactMaps, linkOptions, folded] = await Promise.all([
    gmail ?? cachedGmail(),
    contacts,
    options,
    Promise.all([contacts,options]).then(([m,o])=>loadChannelThreads(m,o)),
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

  attachInquiryContinuity(threads,Object.fromEntries(readerEntries));
  await attachThreadTodos(threads);
  const viewCounts = countViews(threads);
  rememberNeedsCount(activeMailbox()?.userId ?? mailbox.email ?? "",viewCounts.needs_reply);
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
    activeView: { key: "needs_reply", label: "Needs me" },
    threads,
    readers: Object.fromEntries(readerEntries),
    selectedId: firstInDefault?.id ?? "",
    nextPageToken: page.nextPageToken,
    linkOptions,
    mailbox,
    lastSyncedAt:gmailSnapshots.get(mailboxCacheKey())?.at,
  };
}

// ─── Mock builder ────────────────────────────────────────────────────────────

async function buildFromMock(mailbox: MailboxState): Promise<InboxData> {
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
    activeView: { key: "needs_reply", label: "Needs me" },
    threads: THREADS,
    readers: Object.fromEntries(readerEntries),
    selectedId: THREADS[0].id,
    mailbox,
  };
}

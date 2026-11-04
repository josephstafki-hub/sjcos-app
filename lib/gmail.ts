import { cleanEmailText, htmlToEmailText, hasEmailContent } from './inbox-email-content.ts';
import { foldEmailQuotes } from './inbox-email-html';
// Gmail connector for the unified inbox.
//
// This is the ONLY module that imports the Google SDK. It is server-only (the
// `server-only` import makes the build fail if it is ever pulled into a client
// bundle — see the client/server bundle-leak gotcha that has bitten this app).
//
// Active only when GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN
// are all set in the environment. Until then `gmailConfigured()` is false and
// lib/inbox.ts falls back to the deterministic mock — exactly like the Ollama
// swap in lib/ai.ts. Scopes: gmail.modify + gmail.send. `modify` is a superset
// of `readonly` (read threads + change labels/state: star, archive, mark
// read/unread, important, trash) but NOT permanent delete; `send` sends the
// AI-drafted replies. The OAuth client_secret/refresh_token live only in
// .env.local (gitignored), never in code.
//
// NOTE: widening scope (readonly → modify) invalidates the old refresh token —
// re-run /api/inbox/oauth/start to mint a new one and paste it into .env.local.

import "server-only";
import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";
import sanitizeHtml from "sanitize-html";
import { activeMailbox } from "./mailbox";
import { emailAddress, splitAddresses, resolveReplyTarget, validRecipient, isAutomatedSender, isNoReplyAddress } from "./inbox-rules";
import {
  acquireGmailUnits, currentGmailPriority, mailboxQuotaKey, noteGmailRateLimited, retrySchedule, runAsGmailInteractive, sharedGmailPriority, withGmailSendSlot,
  type GmailPriority, type GmailRetryPolicy,
} from "./gmail-quota";
import { SMTP_SCOPE, SmtpAuthError, SmtpError, mimeRecipients, prepareSmtpMime, smtpFallbackEnabled, smtpSafe, smtpSend } from "./gmail-smtp";

export const GMAIL_SCOPES = [
  // modify = read + label/state changes (star, archive, mark read, important,
  // trash). Deliberately not the full mail scope and not permanent-delete.
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  // Only when the SMTP send backstop is switched on (lib/gmail-smtp.ts): the
  // mail server login needs the full-mailbox scope. Reconnect once after
  // turning it on so the stored token carries it.
  ...(smtpFallbackEnabled() ? [SMTP_SCOPE] : []),
];

const REDIRECT_URI =
  process.env.GMAIL_REDIRECT_URI ??
  "http://localhost:3017/api/inbox/oauth/callback";

/** The refresh token this call should act with: the active mailbox scope's if
 *  there is one (a signed-in person's inbox — see lib/mailbox.ts), otherwise the
 *  env token, which is the company mailbox every background path uses. Note the
 *  scope is authoritative even when its token is null: inside a user scope with
 *  nothing linked the answer is "no mailbox", never a silent fall-through to
 *  Joe's. */
function activeRefreshToken(): string | null {
  const mb = activeMailbox();
  if (mb) return mb.refreshToken;
  return process.env.GMAIL_REFRESH_TOKEN ?? null;
}

/** True once the OAuth app is set up AND the mailbox in play has a token. */
export function gmailConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && activeRefreshToken(),
  );
}

/** True once just the OAuth *app* is configured — enough to run the consent
 *  flow that mints the refresh token (which we don't have yet). */
export function gmailOAuthAppConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET,
  );
}

function oauthClient() {
  const client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    REDIRECT_URI,
  );
  const token = activeRefreshToken();
  if (token) client.setCredentials({ refresh_token: token });
  return client;
}

// ─── One-time consent flow (mint the refresh token) ──────────────────────────

/** The Google consent URL. `access_type:offline` + `prompt:consent` guarantee
 *  a refresh token comes back on the first authorization. */
export function consentUrl(): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
  });
}

/** Exchange the `code` Google redirects back with for a refresh token. */
export async function exchangeCodeForRefreshToken(
  code: string,
): Promise<string | null> {
  const { tokens } = await oauthClient().getToken(code);
  return tokens.refresh_token ?? null;
}

/** Consent-callback twin of the above that also reports WHICH address was just
 *  authorized, so a linked mailbox can be stored under its real name (and so
 *  the UI can say "Connected as marco@…" rather than just "connected"). */
export async function exchangeCodeForMailbox(
  code: string,
): Promise<{ refreshToken: string | null; email: string }> {
  const client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    REDIRECT_URI,
  );
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  let email = "";
  try {
    const api = google.gmail({ version: "v1", auth: client });
    const { data } = await api.users.getProfile({ userId: "me" });
    email = (data.emailAddress ?? "").toLowerCase();
  } catch {
    /* the token is what matters; a missing address just shows as blank */
  }
  return { refreshToken: tokens.refresh_token ?? null, email };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** Neutral, presentation-free view of a Gmail thread. lib/inbox.ts maps this
 *  onto the InboxThread / ThreadReader shapes the UI consumes. */
export interface ConversationMessage {
  hasUnsubscribe?:boolean;
  automated?: boolean;
  id: string;
  fromName: string;
  fromEmail: string;
  to: string[];
  cc: string[];
  date: number;
  body: string[];
  snippet: string;
  outbound: boolean;
  replyTo: string;
  messageId: string;
  references: string;
  attachments: { id: string; name: string; size: number; type: string }[];
}
export interface EmailConversation {
  id: string;
  subject: string;
  messages: ConversationMessage[];
  ownAddresses: string[];
  category: GmailCategory;
}

export interface RawGmailThread {
  id: string;
  fromName: string;
  fromEmail: string;
  toLine: string;
  subject: string;
  snippet: string;
  /** Epoch ms of the latest message. */
  date: number;
  unread: boolean;
  starred: boolean;
  important: boolean;
  /** True while the thread is still in the INBOX (not archived). */
  inInbox: boolean;
  /** True if Gmail has the thread snoozed. */
  snoozed: boolean;
  /** True when the latest message was sent BY the account owner (outbound). */
  outbound: boolean;
  /** Gmail category derived from CATEGORY_* system labels. */
  category: GmailCategory;
  /** Union of every label id across the thread's messages (system + user). */
  labelIds: string[];
  /** Plain-text body paragraphs of the latest message. */
  bodyParas: string[];
  messages?: ConversationMessage[];
  ownAddresses?: string[];
}

export type GmailCategory =
  | "primary"
  | "social"
  | "promotions"
  | "updates"
  | "forums";

/** A resolved user-created label (system labels are filtered out). */
export interface GmailLabel {
  id: string;
  name: string;
}

const CATEGORY_BY_LABEL: Record<string, GmailCategory> = {
  CATEGORY_PERSONAL: "primary",
  CATEGORY_SOCIAL: "social",
  CATEGORY_PROMOTIONS: "promotions",
  CATEGORY_UPDATES: "updates",
  CATEGORY_FORUMS: "forums",
};

function gmail(): gmail_v1.Gmail {
  return google.gmail({ version: "v1", auth: oauthClient() });
}

// ─── Rate-limit handling ─────────────────────────────────────────────────────
//
// Gmail meters "Units per minute per user" per Cloud project (a full
// threads.get is 120 units, metadata 40, list 10, send 100, history.list 2 —
// see lib/gmail-quota.ts). A burst of full-thread fetches can burn the whole
// minute, and any real send that lands in that window fails with
// "Quota exceeded … rateLimitExceeded". Every metered call below goes through
// withGmailRetry, which books its cost against this minute's budget (sends
// first, timers last) and backs off and recovers instead of surfacing.

/** Thrown once the retry budget for a rate-limited Gmail call is exhausted.
 *  Callers (cron guards, send paths) can `instanceof` this to tell a quota
 *  hit from a real failure. */
export class GmailRateLimitError extends Error {
  readonly attempts: number;
  readonly label: string;
  constructor(label: string, attempts: number, cause: unknown) {
    super(
      `Gmail rate limit hit (${label}) after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${errorMessage(cause)}`,
      { cause },
    );
    this.name = "GmailRateLimitError";
    this.attempts = attempts;
    this.label = label;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** True for a 403/429 whose reason is a per-user/per-minute rate limit — the
 *  transient kind worth retrying. Daily-quota exhaustion (`dailyLimitExceeded`)
 *  and auth failures are deliberately NOT matched: retrying those is noise. */
export function isGmailRateLimit(err: unknown): boolean {
  if (err instanceof GmailRateLimitError) return true;
  if (!err || typeof err !== "object") return false;
  const e = err as {
    status?: number;
    code?: number | string;
    message?: string;
    errors?: { reason?: string }[];
    response?: { status?: number; data?: { error?: { errors?: { reason?: string }[]; status?: string } } };
  };
  // Gmail's per-minute quota message is unambiguous whatever the wrapper
  // reports as status (googleapis surfaces it as code 429, older builds 403).
  if (/Quota exceeded for quota metric .*per minute/i.test(e.message ?? "")) return true;
  const status = e.status ?? e.response?.status ?? Number(e.code);
  if (status !== 403 && status !== 429) return false;
  const reasons = [
    ...(e.errors ?? []).map((x) => x.reason ?? ""),
    ...(e.response?.data?.error?.errors ?? []).map((x) => x.reason ?? ""),
    e.response?.data?.error?.status ?? "",
  ];
  if (reasons.some((r) => /rateLimitExceeded|userRateLimitExceeded|RESOURCE_EXHAUSTED/i.test(r))) return true;
  return /Quota exceeded|rate ?limit/i.test(e.message ?? "");
}

/** Process-wide tally of metered Gmail calls (every call through
 *  withGmailRetry, including retries). Read it before/after a job to report
 *  how many API hits the job cost — see syncLeadThreads' `gmailCalls`. */
let gmailCallCount = 0;
export function gmailCallsSoFar(): number {
  return gmailCallCount;
}

/** The quota ledger key for the mailbox this call acts on. */
function quotaKey(): string {
  return mailboxQuotaKey(activeRefreshToken());
}

/** Run one Gmail API call: book its units against this minute's budget
 *  (waiting by priority — see lib/gmail-quota.ts), then retry rate-limit
 *  refusals with exponential backoff. `default` = 3 tries (1.5 s, 3 s);
 *  `patient` spans a whole quota minute (~62 s) and is for sends. Exhausted
 *  retries throw a typed GmailRateLimitError; other errors propagate untouched
 *  on the first failure. */
export async function withGmailRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { policy?: GmailRetryPolicy; priority?: GmailPriority | (() => GmailPriority) } = {},
): Promise<T> {
  const { attempts, baseMs, maxMs } = retrySchedule(opts.policy ?? "default");
  const priority = opts.priority ?? currentGmailPriority();
  const key = quotaKey();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await acquireGmailUnits(key, label, priority);
    gmailCallCount++;
    try {
      return await fn();
    } catch (err) {
      if (!isGmailRateLimit(err)) throw err;
      noteGmailRateLimited(key);
      lastErr = err;
      if (attempt === attempts) break;
      const wait = Math.min(maxMs, baseMs * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500 * Math.min(1, baseMs / 1500));
      console.warn(`[gmail] rate limited on ${label} (attempt ${attempt}/${attempts}); retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new GmailRateLimitError(label, attempts, lastErr);
}

/** Map with at most `limit` promises in flight (p-limit without the dep).
 *  Results keep input order; the first rejection rejects the whole map once
 *  in-flight work settles. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const failures: unknown[] = [];
  async function worker() {
    while (failures.length === 0) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        failures.push(err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failures.length > 0) throw failures[0];
  return out;
}

function header(
  msg: gmail_v1.Schema$Message | undefined,
  name: string,
): string {
  const h = msg?.payload?.headers?.find(
    (x) => x.name?.toLowerCase() === name.toLowerCase(),
  );
  return h?.value ?? "";
}

/** Split "Maria Chen <maria@chen.com>" → { name, email }. */
function parseFrom(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim() };
  return { name: raw.trim(), email: raw.trim() };
}

/** Walk the MIME tree, decode the best text part into paragraphs. Prefers
 *  text/plain, but only if it actually looks like text — some senders stuff
 *  binary (e.g. a base64 JPEG) into the text/plain slot, in which case we fall
 *  back to text/html with tags stripped. Gmail base64url-encodes part data, so
 *  it must be decoded as "base64url" (not "base64"). */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string[] {
  if (!payload) return [];

  const plainData = findPart(payload, "text/plain");
  const plainText = plainData
    ? Buffer.from(plainData, "base64url").toString("utf-8")
    : "";

  let text: string;
  if (plainText && looksLikeText(plainText)) {
    text = plainText;
  } else {
    const htmlData = findPart(payload, "text/html");
    text = htmlData
      ? stripHtml(Buffer.from(htmlData, "base64url").toString("utf-8"))
      : "";
  }
  if (!text.trim()) return [];

  return cleanEmailText(text)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Reject parts that aren't real prose — both true binary (control/replacement
 *  chars) and printable-but-junk blobs (e.g. a base64 JPEG stuffed into the
 *  text/plain slot, which is all-printable but scores ~0.1 word-likeness while
 *  genuine emails score >0.65). */
function looksLikeText(s: string): boolean {
  const sample = s.slice(0, 2000).trim();
  if (sample.length < 1) return false;
  let control = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) continue; // tab/newline ok
    if (c < 32 || c === 0xfffd) control++; // control char or replacement char
  }
  if (control / sample.length >= 0.05) return false;

  const tokens = sample.split(/\s+/).filter(Boolean);
  // A one-word acknowledgement is still a complete message.
  if (tokens.length < 3) return sample.length < 160 && !/^[A-Za-z0-9+/=]{40,}$/.test(sample);
  const wordlike = tokens.filter((t) =>
    /^[a-zA-Z][a-zA-Z.,!?'"-]*$/.test(t),
  ).length;
  return wordlike / tokens.length >= 0.5;
}

function findPart(
  part: gmail_v1.Schema$MessagePart,
  mime: string,
): string | null {
  if (part.mimeType === mime && part.body?.data) return part.body.data;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mime);
    if (found) return found;
  }
  return null;
}

function stripHtml(html: string): string { return htmlToEmailText(html); }

// ─── Rich HTML body (with images) — resolved lazily when a thread is opened ──

/** An inline image part: cid (Content-ID without <>) → attachment to fetch. */
interface InlinePart {
  cid: string;
  attachmentId: string;
  mimeType: string;
}

/** Collect image parts that carry a Content-ID (inline cid: images, e.g. a
 *  signature logo). These get fetched + inlined as data URIs. */
function collectInlineImages(part: gmail_v1.Schema$MessagePart | undefined, out: InlinePart[] = []): InlinePart[] {
  if (!part) return out;
  const cidHeader = part.headers?.find((h) => (h.name ?? "").toLowerCase() === "content-id");
  if (
    (part.mimeType ?? "").startsWith("image/") &&
    cidHeader?.value &&
    part.body?.attachmentId
  ) {
    out.push({
      cid: cidHeader.value.replace(/^<|>$/g, "").trim(),
      attachmentId: part.body.attachmentId,
      mimeType: part.mimeType!,
    });
  }
  for (const child of part.parts ?? []) collectInlineImages(child, out);
  return out;
}

/** Sanitize untrusted email HTML for safe in-app rendering. Drops scripts,
 *  event handlers, and unknown schemes; keeps formatting + images (http(s)/data).
 *  Images are constrained to the container width via an inline max-width. */
function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(foldEmailQuotes(html), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "span", "u", "font", "center"]),
    allowedAttributes: {
      "*": ["style", "align", "valign", "width", "height", "bgcolor", "color"],
      // Layout tables (Menards' receipts) span a fixed column grid; without
      // colspan the whole body collapses into one narrow column.
      table: ["cellpadding", "cellspacing", "border"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height", "style"],
      font: ["color", "face", "size"],
    },
    // Email may format its own tables and type, but cannot position an overlay
    // over app controls or inject active CSS. Media URLs are filtered separately.
    allowedStyles: { '*': Object.fromEntries([
      'width','min-width','max-width','height','min-height','max-height',
      'padding','padding-top','padding-right','padding-bottom','padding-left',
      'margin','margin-top','margin-right','margin-bottom','margin-left',
      'border','border-top','border-right','border-bottom','border-left','border-color','border-width','border-style','border-radius','border-collapse','border-spacing',
      'table-layout','vertical-align','text-align','text-decoration','text-transform','text-indent',
      'font-family','font-size','font-weight','font-style','line-height','letter-spacing','white-space','word-break','overflow-wrap','color',
      'background','background-color','background-image','background-size','background-repeat','background-position','display',
    ].map(property=>[property,[/^(?!.*(?:expression|javascript:|@import|behavior|binding))[^{}]+$/i]])) },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
      }),
      img: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, style: `max-width:100%;height:auto;${attribs.style ?? ""}` },
      }),
    },
  });
}

// ─── Mailbox store: re-read only what Gmail says changed ─────────────────────
//
// Every thread Gmail returns carries a historyId: the last change that touched
// it (new message, label, read state). threads.list hands those out for 10
// units per page, and history.list answers "what changed since X?" for 2. So
// instead of re-reading 50 full threads (6,000 units) on every refresh, a
// mailbox keeps what it already read and asks:
//
//   1. history.list since the last check (2 units) → forget exactly the
//      threads it names. No changes → the last page is still right, done.
//   2. Something changed → threads.list (10) and re-read only threads whose
//      historyId moved or that we don't have (120 each).
//
// Per process, per mailbox credential (one person's store is never served to
// another), bounded in size. A restart just starts empty. A message's content
// never changes in Gmail, so its rendered HTML is kept until evicted.

/** Least-recently-used map bounded by entry count and (optionally) size. */
class Lru<V> {
  private map = new Map<string, { v: V; size: number }>();
  private bytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly sizeOf: (v: V) => number;
  constructor(maxEntries: number, maxBytes = Infinity, sizeOf: (v: V) => number = () => 0) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.sizeOf = sizeOf;
  }
  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (e === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e.v;
  }
  set(key: string, v: V): void {
    this.delete(key);
    const size = this.sizeOf(v);
    this.map.set(key, { v, size });
    this.bytes += size;
    while (this.map.size > 1 && (this.map.size > this.maxEntries || this.bytes > this.maxBytes)) {
      this.delete(this.map.keys().next().value!);
    }
  }
  delete(key: string): void {
    const e = this.map.get(key);
    if (e === undefined) return;
    this.bytes -= e.size;
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }
}

interface StoredThread {
  historyId: string;
  data: gmail_v1.Schema$Thread;
  /** When this copy was last fetched or confirmed unchanged. */
  at: number;
}
interface ThreadPage {
  threads: RawGmailThread[];
  nextPageToken?: string;
}
interface MailboxStore {
  full: Lru<StoredThread>;
  meta: Lru<StoredThread>;
  inflight: Map<string, { data: Promise<gmail_v1.Schema$Thread>; rank: ReturnType<typeof sharedGmailPriority> }>;
  /** Mailbox history point the store is confirmed current to (null = unknown). */
  historyId: string | null;
  syncedAt: number;
  syncing: { done: Promise<void>; rank: ReturnType<typeof sharedGmailPriority> } | null;
  /** Bumps whenever anything in the mailbox is known to have changed. */
  generation: number;
  pages: Lru<{ generation: number; listedAt: number; result: ThreadPage }>;
  labelCounts: { generation: number; at: number; data: Promise<CountedGmailLabel[]> } | null;
  html: Lru<string>;
  htmlInflight: Map<string, Promise<string>>;
  correspondence: Lru<{ generation: number; at: number; data: { id: string; subject: string }[] }>;
}

/** A copy younger than this is served without asking Gmail at all. */
const STORE_FRESH_MS = 15_000;
/** history.list is asked at most this often per mailbox (callers share it). */
const SYNC_FRESH_MS = 5_000;
/** Even with no reported change, re-list a page at least this often. */
const PAGE_RELIST_MS = 2 * 60_000;
const HISTORY_MAX_PAGES = 5;
const threadBytes = (t: StoredThread) => JSON.stringify(t.data).length;

const stores = new Map<string, MailboxStore>();
function storeFor(): MailboxStore {
  const key = quotaKey();
  let s = stores.get(key);
  if (s) {
    stores.delete(key); // most recently used last, so eviction drops idle mailboxes
    stores.set(key, s);
    return s;
  }
  // Caps are JSON length; heap use runs a few times that.
  s = {
    full: new Lru<StoredThread>(300, 24 * 1024 * 1024, threadBytes),
    meta: new Lru<StoredThread>(5_000, 8 * 1024 * 1024, threadBytes),
    inflight: new Map(),
    historyId: null,
    syncedAt: 0,
    syncing: null,
    generation: 0,
    pages: new Lru(12),
    labelCounts: null,
    html: new Lru<string>(300, 16 * 1024 * 1024, (h) => h.length),
    htmlInflight: new Map(),
    correspondence: new Lru(200),
  };
  stores.set(key, s);
  // Staff mailboxes come and go; keep the store count bounded (shared box:
  // a few MB typical per mailbox, ~50 MB of JSON worst case).
  while (stores.size > 8) stores.delete(stores.keys().next().value!);
  return s;
}

function forgetThread(s: MailboxStore, id: string): void {
  s.full.delete(id);
  s.meta.delete(id);
}

/** Our own change to a thread (send, archive, label…): re-read it next time
 *  and let every cached page know the mailbox moved. Without an id, only the
 *  latter (a new outgoing thread). */
function markMailboxChanged(threadId?: string): void {
  const s = storeFor();
  if (threadId) forgetThread(s, threadId);
  s.generation++;
}

function httpStatus(err: unknown): number | undefined {
  const e = err as { code?: number | string; status?: number; response?: { status?: number } };
  return e?.status ?? e?.response?.status ?? (Number(e?.code) || undefined);
}

function historyThreadIds(rec: gmail_v1.Schema$History): string[] {
  const ids: (string | null | undefined)[] = [
    ...(rec.messages ?? []).map((m) => m.threadId),
    ...(rec.messagesAdded ?? []).map((m) => m.message?.threadId),
    ...(rec.messagesDeleted ?? []).map((m) => m.message?.threadId),
    ...(rec.labelsAdded ?? []).map((m) => m.message?.threadId),
    ...(rec.labelsRemoved ?? []).map((m) => m.message?.threadId),
  ];
  return ids.filter((id): id is string => Boolean(id));
}

/** Start over from the mailbox's current history point (1 unit). Anything
 *  kept from before can't be vouched for, so it goes. */
async function resetBaseline(s: MailboxStore, rank?: () => GmailPriority): Promise<void> {
  const { data } = await withGmailRetry("getProfile", () => gmail().users.getProfile({ userId: "me" }), { priority: rank });
  const email = (data.emailAddress ?? "").toLowerCase();
  if (email) profileEmailCache.set(activeRefreshToken() ?? "", email);
  // Header copies check themselves against each listing's historyId, so they
  // survive; full copies serve opens without that check, so they go.
  s.full.clear();
  s.pages.clear();
  s.labelCounts = null;
  s.historyId = data.historyId ?? null;
  s.syncedAt = Date.now();
  s.generation++;
}

/** Bring the store up to date with Gmail's change log (2 units when nothing
 *  happened). Concurrent callers share one request; a recent check is reused. */
function syncMailbox(s: MailboxStore): Promise<void> {
  if (s.syncing) {
    s.syncing.rank.raise(); // a person joining a timer's check speeds it up
    return s.syncing.done;
  }
  if (s.historyId && Date.now() - s.syncedAt < SYNC_FRESH_MS) return Promise.resolve();
  const rank = sharedGmailPriority();
  const run = (async () => {
    if (!s.historyId) return resetBaseline(s, rank.get);
    const api = gmail();
    const changed = new Set<string>();
    let latest = s.historyId;
    let pageToken: string | undefined;
    let pages = 0;
    try {
      do {
        const start = s.historyId;
        const { data } = await withGmailRetry("history.list", () =>
          api.users.history.list({ userId: "me", startHistoryId: start, maxResults: 500, pageToken }),
        { priority: rank.get });
        for (const rec of data.history ?? []) for (const id of historyThreadIds(rec)) changed.add(id);
        if (data.historyId) latest = data.historyId;
        pageToken = data.nextPageToken ?? undefined;
        pages++;
      } while (pageToken && pages < HISTORY_MAX_PAGES);
    } catch (err) {
      // 404 = the history point is too old for Gmail to replay. Start over.
      if (httpStatus(err) === 404) return resetBaseline(s, rank.get);
      throw err;
    }
    if (pageToken) return resetBaseline(s, rank.get); // more changed than is worth replaying
    if (changed.size) {
      for (const id of changed) forgetThread(s, id);
      s.generation++;
    }
    s.historyId = latest;
    s.syncedAt = Date.now();
  })();
  const done = run.finally(() => {
    s.syncing = null;
  });
  s.syncing = { done, rank };
  return done;
}

/** Test hook: make the next read ask Gmail's change log again. */
export function expireGmailSyncForTests(): void {
  for (const s of stores.values()) s.syncedAt = 0;
}

/** Keep a freshly read full thread (and let it answer metadata lookups too). */
function keepFull(s: MailboxStore, id: string, data: gmail_v1.Schema$Thread): void {
  // Gmail always sends a historyId; without one the copy still serves opens
  // (kept fresh by the change log) but never matches a listing.
  s.full.set(id, { historyId: data.historyId ?? "", data, at: Date.now() });
}

/** The full thread: the kept copy when Gmail confirms it hasn't changed,
 *  otherwise one threads.get (120 units). `patient` is for the read a send
 *  depends on. */
async function cachedThread(id: string, opts: { policy?: GmailRetryPolicy; priority?: GmailPriority } = {}): Promise<gmail_v1.Schema$Thread> {
  const s = storeFor();
  const hit = s.full.get(id);
  if (hit) {
    if (Date.now() - hit.at < STORE_FRESH_MS) return hit.data;
    try {
      await syncMailbox(s);
    } catch {
      return hit.data; // Gmail is busy; what we have beats an error
    }
    const still = s.full.get(id);
    if (still) {
      still.at = Date.now();
      return still.data;
    }
  }
  const pending = s.inflight.get(id);
  if (pending) {
    pending.rank.raise(opts.priority ?? currentGmailPriority());
    try {
      return await pending.data;
    } catch (err) {
      // Joined someone else's read and it ran out of retries: a patient
      // caller (a reply about to send) tries again on its own terms.
      if (opts.policy !== "patient" || !isGmailRateLimit(err)) throw err;
    }
  }
  const rank = sharedGmailPriority(opts.priority ?? currentGmailPriority());
  const generation = s.generation;
  const data = withGmailRetry("threads.get", () => gmail().users.threads.get({ userId: "me", id, format: "full" }), { policy: opts.policy, priority: rank.get })
    .then((r) => {
      // If the mailbox moved while this read was in flight, the copy may
      // predate the change the store just forgot — use it, don't keep it.
      if (s.generation === generation) keepFull(s, id, r.data);
      return r.data;
    })
    .finally(() => {
      if (s.inflight.get(id)?.data === data) s.inflight.delete(id);
    });
  s.inflight.set(id, { data, rank });
  return data;
}
function conversationOf(id: string, data: gmail_v1.Schema$Thread, me: string): EmailConversation {
  const sorted = [...(data.messages ?? [])].sort((a,b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
  const ownAddresses = [...new Set([me, activeMailbox()?.email ?? '', ...sorted.filter(m => m.labelIds?.includes('SENT')).map(m => parseFrom(header(m,'From')).email)].filter(Boolean).map(s => s.toLowerCase()))];
  const messages = sorted.map((m): ConversationMessage => {
    const from = parseFrom(header(m,'From'));
    return {
      id: m.id ?? '', fromName: from.name, fromEmail: from.email,
      to: splitAddresses(header(m,'To')), cc: splitAddresses(header(m,'Cc')),
      date: Number(m.internalDate ?? 0), body: extractBody(m.payload), snippet: m.snippet ?? '',
      outbound: Boolean(m.labelIds?.includes('SENT')) || ownAddresses.includes(from.email.toLowerCase()),
      hasUnsubscribe:Boolean(header(m,'List-Unsubscribe')),
      automated: isAutomatedSender(from.email, undefined, {
        headers: Object.fromEntries((m.payload?.headers ?? []).map(h => [h.name ?? '', h.value ?? ''])),
        labelIds: m.labelIds ?? [], body: extractBody(m.payload).join('\n') || m.snippet || '',
        conversational: /^(?:re|fwd?|aw)\s*:/i.test(header(m,'Subject')) || Boolean(header(m,'In-Reply-To')),
      }),
      replyTo: header(m,'Reply-To'), messageId: header(m,'Message-ID'), references: header(m,'References'),
      attachments: collectFileParts(m.payload).map(p => ({id:p.body?.attachmentId ?? p.partId ?? '', name:p.filename ?? '',size:p.body?.size ?? 0,type:p.mimeType ?? 'application/octet-stream'})),
    };
  });
  return { id, subject: header(sorted.at(-1),'Subject') || '(no subject)', messages, ownAddresses, category:deriveCategory(sorted.flatMap(m=>m.labelIds ?? [])) };
}
export async function fetchConversation(
  threadId: string,
  opts: { policy?: GmailRetryPolicy; priority?: GmailPriority } = {},
): Promise<EmailConversation> {
  const [data, me] = await Promise.all([cachedThread(threadId, opts), fetchProfileEmail()]);
  return conversationOf(threadId, data, me);
}
/** Full sanitized HTML body of a thread's latest message, with cid: inline
 *  images resolved to data URIs. Returns "" when there's no HTML part. Resolved
 *  lazily (on thread open) so the inbox list fetch stays cheap. */
export async function fetchThreadHtml(threadId: string): Promise<string> {
  const data = await cachedThread(threadId);
  const message = [...(data.messages ?? [])].sort((a,b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0)).at(-1);
  if(!message?.id)throw new Error('Message content is unavailable.');
  return fetchMessageHtml(threadId,message.id);
}
/** A message's content never changes in Gmail, so its rendered HTML (inline
 *  images included — 20 units each) is kept per mailbox until evicted. */
export async function fetchMessageHtml(threadId: string, messageId: string): Promise<string> {
  const s = storeFor();
  const key = `${threadId}:${messageId}`;
  const hit = s.html.get(key);
  if (hit !== undefined) return hit;
  const pending = s.htmlInflight.get(key);
  if (pending) return pending;
  const data = renderMessageHtml(threadId, messageId)
    .then((html) => {
      s.html.set(key, html);
      return html;
    })
    .finally(() => s.htmlInflight.delete(key));
  s.htmlInflight.set(key, data);
  return data;
}
async function renderMessageHtml(threadId: string, messageId: string): Promise<string> {
  const api = gmail();
  const data = await cachedThread(threadId);
  const message = data.messages?.find(m => m.id === messageId);
  if (!message?.payload) throw new Error('Message content is unavailable.');
  const htmlData = findPart(message.payload, "text/html");
  if (!htmlData) {
    const hasHtmlPart=(part:gmail_v1.Schema$MessagePart):boolean=>part.mimeType==='text/html'||Boolean(part.parts?.some(hasHtmlPart));
    if(hasHtmlPart(message.payload))throw new Error('Formatted message part is empty or unavailable.');
    return '';
  }
  let html = Buffer.from(htmlData, "base64url").toString("utf-8");

  // Inline cid: images (signature logos etc.) → data URIs so they render.
  const inlines = collectInlineImages(message.payload);
  if (inlines.length && message.id) {
    await mapLimit(inlines, 4, async (img) => {
        try {
          const att = await withGmailRetry("attachments.get", () =>
            api.users.messages.attachments.get({
              userId: "me",
              messageId: message.id!,
              id: img.attachmentId,
            }),
          );
          const b64 = (att.data.data ?? "").replace(/-/g, "+").replace(/_/g, "/");
          if (!b64) return;
          const dataUri = `data:${img.mimeType};base64,${b64}`;
          const ref = img.cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          html = html.replace(new RegExp(`cid:${ref}`, "gi"), dataUri);
        } catch {
          /* leave the cid ref; it just won't render */
        }
    });
  }

  const sanitized = sanitizeEmailHtml(html);
  if (!hasEmailContent(sanitized)) throw new Error('Formatted message content is empty.');
  return sanitized;
}

// ─── One message, for filing (Unsorted documents) ────────────────────────────

export interface FilingAttachment {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export interface FilingMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  /** ISO timestamp the message arrived. */
  receivedAt: string | null;
  /** Sanitized HTML body with cid: images inlined, or "" when the mail is plain text. */
  html: string;
  /** Plain-text body (the HTML stripped when there's no text part). */
  text: string;
  /** Real attachments: PDFs, images, office docs — not inline signature images. */
  attachments: FilingAttachment[];
}

/** Attachment parts worth keeping: a filename, a body to fetch, and not an
 *  inline (Content-ID) image — those are signature logos, already in the HTML. */
function collectFileParts(part: gmail_v1.Schema$MessagePart | undefined, out: gmail_v1.Schema$MessagePart[] = []): gmail_v1.Schema$MessagePart[] {
  if (!part) return out;
  const hasCid = part.headers?.some((h) => (h.name ?? "").toLowerCase() === "content-id");
  const inlineImage = hasCid && (part.mimeType ?? "").startsWith("image/");
  if (part.filename && (part.body?.attachmentId || part.body?.data) && !inlineImage) out.push(part);
  for (const child of part.parts ?? []) collectFileParts(child, out);
  return out;
}

const FILING_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** One Gmail message with everything needed to file it: headers, the body as
 *  sanitized HTML + text, and the attachment bytes. Throws when the message
 *  isn't in the mailbox this call acts for. */
export async function fetchMessageForFiling(messageId: string): Promise<FilingMessage> {
  const api = gmail();
  const { data: msg } = await withGmailRetry("messages.get", () =>
    api.users.messages.get({ userId: "me", id: messageId, format: "full" }),
  );
  const payload = msg.payload;
  let html = "";
  const htmlData = payload ? findPart(payload, "text/html") : null;
  if (htmlData) {
    html = Buffer.from(htmlData, "base64url").toString("utf-8");
    for (const img of collectInlineImages(payload)) {
      try {
        const att = await withGmailRetry("attachments.get", () =>
          api.users.messages.attachments.get({ userId: "me", messageId, id: img.attachmentId }),
        );
        const b64 = (att.data.data ?? "").replace(/-/g, "+").replace(/_/g, "/");
        if (!b64) continue;
        const ref = img.cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        html = html.replace(new RegExp(`cid:${ref}`, "gi"), `data:${img.mimeType};base64,${b64}`);
      } catch {
        /* leave the cid ref; it just won't render */
      }
    }
    html = sanitizeEmailHtml(html);
  }
  const plainData = payload ? findPart(payload, "text/plain") : null;
  const plain = plainData ? Buffer.from(plainData, "base64url").toString("utf-8") : "";
  const text = cleanEmailText(plain && looksLikeText(plain) ? plain : html ? stripHtml(html) : plain);

  const attachments: FilingAttachment[] = [];
  for (const part of collectFileParts(payload)) {
    if ((part.body?.size ?? 0) > FILING_MAX_ATTACHMENT_BYTES) continue;
    let b64 = part.body?.data ?? "";
    if (!b64 && part.body?.attachmentId) {
      const att = await withGmailRetry("attachments.get", () =>
        api.users.messages.attachments.get({ userId: "me", messageId, id: part.body!.attachmentId! }),
      );
      b64 = att.data.data ?? "";
    }
    if (!b64) continue;
    attachments.push({
      filename: part.filename!,
      mimeType: part.mimeType || "application/octet-stream",
      bytes: Buffer.from(b64, "base64url"),
    });
  }

  const date = msg.internalDate ? new Date(Number(msg.internalDate)) : null;
  return {
    id: msg.id ?? messageId,
    threadId: msg.threadId ?? "",
    from: header(msg, "From"),
    subject: header(msg, "Subject"),
    receivedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    html,
    text: text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    attachments,
  };
}

/** The account's own email address (Gmail "me"), used to tell inbound from
 *  outbound. Cached per process but KEYED ON THE TOKEN: a single shared cache
 *  would hand one mailbox's address to another and flip every message's
 *  direction (the whole "outbound" / "awaiting them" read of the inbox). */
const profileEmailCache = new Map<string, string>();
export async function fetchProfileEmail(opts: { priority?: GmailPriority } = {}): Promise<string> {
  const key = activeRefreshToken() ?? "";
  const hit = profileEmailCache.get(key);
  if (hit) return hit;
  const api = gmail();
  const { data } = await withGmailRetry("getProfile", () => api.users.getProfile({ userId: "me" }), opts);
  const email = (data.emailAddress ?? "").toLowerCase();
  if (email) profileEmailCache.set(key, email);
  return email;
}

/** List the user's own (non-system) labels for resolving ids → display names. */
export async function fetchLabels(): Promise<GmailLabel[]> {
  const { data } = await withGmailRetry("labels.list", () => gmail().users.labels.list({ userId: "me" }));
  return (data.labels ?? [])
    .filter((l) => l.type === "user" && l.id && l.name)
    .map((l) => ({ id: l.id!, name: l.name! }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A user label plus its true total thread count (null when the count fetch
 *  failed — the rail hides the badge rather than advertise a wrong number). */
export interface CountedGmailLabel extends GmailLabel {
  count: number | null;
}

/** User labels with real totals for the inbox label rail. `labels.list` carries
 *  no counts, so this issues one cheap `labels.get` per label (1 quota unit each;
 *  trivial next to the ~50 `threads.get` an inbox load already does).
 *  Uses `threadsTotal`, not `messagesTotal`: rail rows and list rows are both
 *  threads, so a multi-message conversation counts once (matching what clicking
 *  the label loads). Caveat: `threadsTotal` includes labeled threads sitting in
 *  trash/spam while the opened label view excludes them (`-in:spam -in:trash`) —
 *  for USER labels that overlap is rare (Joe must have labeled AND trashed the
 *  same thread) and transient, unlike the systematic skew that keeps the
 *  system-mailbox badges off (see the Mailboxes note in InboxClient).
 *  Kept per mailbox: re-counted only after Gmail reports a change, at most
 *  once a minute, and at least every ten minutes. */
const LABEL_COUNT_MIN_MS = 60_000;
const LABEL_COUNT_MAX_MS = 10 * 60_000;
export function fetchLabelCounts(): Promise<CountedGmailLabel[]> {
  return runAsGmailInteractive(loadLabelCounts); // part of the shared inbox load
}
async function loadLabelCounts(): Promise<CountedGmailLabel[]> {
  const s = storeFor();
  try {
    await syncMailbox(s);
  } catch {
    /* can't confirm — a kept count is still better than none */
  }
  const kept = s.labelCounts;
  const age = kept ? Date.now() - kept.at : Infinity;
  if (kept && age < LABEL_COUNT_MAX_MS && (kept.generation === s.generation || age < LABEL_COUNT_MIN_MS)) return kept.data;
  const data = countLabels();
  const entry = { generation: s.generation, at: Date.now(), data };
  s.labelCounts = entry;
  data.catch(() => {
    if (s.labelCounts === entry) s.labelCounts = null;
  });
  return data;
}
async function countLabels(): Promise<CountedGmailLabel[]> {
  const labels = await fetchLabels();
  const api = gmail();
  return mapLimit(labels, 8, async (l) => {
    try {
      const { data } = await withGmailRetry("labels.get", () => api.users.labels.get({ userId: "me", id: l.id }), { policy: "once" });
      return { ...l, count: data.threadsTotal ?? 0 };
    } catch {
      return { ...l, count: null }; // hide the badge; label stays clickable
    }
  });
}

function deriveCategory(labelIds: string[]): GmailCategory {
  for (const id of labelIds) {
    if (CATEGORY_BY_LABEL[id]) return CATEGORY_BY_LABEL[id];
  }
  return "primary";
}

/** Fetch the most recent threads (inbox, archived, snoozed and sent — spam and
 *  trash excluded), newest first. Returns enough metadata for lib/inbox.ts to
 *  classify each thread into a smart view client-side. */
export async function fetchThreads(max = 20): Promise<RawGmailThread[]> {
  return (await fetchThreadPage(max)).threads;
}

/** One page of threads plus the token for the next page (undefined when there
 *  are no more). Drives the inbox's "Load more". The default `q` excludes spam
 *  and trash; pass an explicit `q` (e.g. "in:spam" / "in:trash") to reach those
 *  system mailboxes — see loadSystemView in lib/inbox.ts. */
export function fetchThreadPage(
  max = 50,
  pageToken?: string,
  labelId?: string,
  q = "-in:spam -in:trash",
): Promise<{ threads: RawGmailThread[]; nextPageToken?: string }> {
  // The inbox load is shared (lib/inbox.ts keeps one per mailbox), so even
  // when a timer starts it a person may be the one waiting: interactive.
  return runAsGmailInteractive(() => loadThreadPage(max, pageToken, labelId, q));
}
async function loadThreadPage(
  max: number,
  pageToken: string | undefined,
  labelId: string | undefined,
  q: string,
): Promise<{ threads: RawGmailThread[]; nextPageToken?: string }> {
  const s = storeFor();
  // 2 units when nothing changed. If Gmail is too busy to say, skip the kept
  // page and list — kept threads still only re-read when their historyId moved.
  let synced = true;
  try {
    await syncMailbox(s);
  } catch {
    synced = false;
  }
  const pageKey = JSON.stringify([max, pageToken ?? null, labelId ?? null, q]);
  const kept = s.pages.get(pageKey);
  if (synced && kept && kept.generation === s.generation && Date.now() - kept.listedAt < PAGE_RELIST_MS) {
    return { threads: [...kept.result.threads], nextPageToken: kept.result.nextPageToken };
  }
  const generation = s.generation;

  const api = gmail();
  const me = await fetchProfileEmail();
  const list = await withGmailRetry("threads.list", () =>
    api.users.threads.list({
      userId: "me",
      maxResults: max,
      q,
      // Scope to a single Gmail label when given (clicking a label in the rail);
      // Gmail ANDs labelIds with q, so this returns that label's mail server-side.
      ...(labelId ? { labelIds: [labelId] } : {}),
      pageToken,
    }),
  );
  const listed = (list.data.threads ?? []).filter((t): t is { id: string; historyId?: string } => Boolean(t.id));

  // Only threads Gmail says changed (or that we've never read) cost a fetch.
  // Eight at a time: a 50-thread page fanned out at once tripped Gmail's per-user
  // concurrency limit (shared with the live site's cron jobs).
  const threads = await mapLimit(listed, 8, async ({ id, historyId }) => {
    const hit = s.full.get(id);
    const data = hit && historyId && hit.historyId === historyId
      ? (hit.at = Date.now(), hit.data)
      : await cachedThreadFetch(s, id);
    return rawThreadOf(id, data, me);
  });
  const result: ThreadPage = {
    threads: threads.sort((a, b) => b.date - a.date),
    nextPageToken: list.data.nextPageToken ?? undefined,
  };
  s.pages.set(pageKey, { generation, listedAt: Date.now(), result });
  return { threads: [...result.threads], nextPageToken: result.nextPageToken };
}

/** One threads.get(full) that bypasses the kept copy (the caller already knows
 *  it's stale), sharing an in-flight read of the same thread. */
function cachedThreadFetch(s: MailboxStore, id: string): Promise<gmail_v1.Schema$Thread> {
  forgetThread(s, id);
  return cachedThread(id);
}

/** The list-row view of a full thread. */
function rawThreadOf(id: string, data: gmail_v1.Schema$Thread, me: string): RawGmailThread {
  const conversation = conversationOf(id, data, me);
  const msgs = [...(data.messages ?? [])].sort((a,b) => Number(a.internalDate ?? 0)-Number(b.internalDate ?? 0));
  const latest = msgs[msgs.length - 1];
  // Union every label id across the thread so a single read/starred/snoozed
  // message colours the whole conversation (matches Gmail's own behaviour).
  const labelIds = Array.from(
    new Set(msgs.flatMap((m) => m.labelIds ?? [])),
  );
  const { name, email } = parseFrom(header(latest, "From"));
  const dateMs = Number(latest?.internalDate ?? Date.now());
  return {
    id,
    fromName: name,
    fromEmail: email,
    toLine: header(latest, "To"),
    subject: header(latest, "Subject") || "(no subject)",
    snippet: (data.snippet ?? "").trim(),
    date: dateMs,
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED"),
    important: labelIds.includes("IMPORTANT"),
    inInbox: labelIds.includes("INBOX"),
    snoozed: labelIds.includes("SNOOZED"),
    outbound: conversation.messages.at(-1)?.outbound ?? email.toLowerCase() === me,
    category: deriveCategory(labelIds),
    labelIds,
    bodyParas: extractBody(latest?.payload),
    messages: conversation.messages,
    ownAddresses: conversation.ownAddresses,
  } satisfies RawGmailThread;
}

/** Header-only view of a thread — what the lead/needs-reply syncs need to
 *  decide "was the last word theirs or ours". No body, no snippet. */
export interface RawGmailThreadMeta {
  id: string;
  fromName: string;
  fromEmail: string;
  toLine: string;
  subject: string;
  /** Epoch ms of the latest message. */
  date: number;
  /** True when the latest message was sent BY the account owner (outbound). */
  outbound: boolean;
  /** Union of every label id across the thread's messages. */
  labelIds: string[];
}

/** Metadata-only thread scan for the timer-driven syncs. Each thread costs one
 *  `threads.get` with `format: "metadata"` (headers + labelIds + internalDate,
 *  no MIME payload) and at most `concurrency` are in flight at once, so a run
 *  never burns the per-minute quota the way the old 150-way `format: "full"`
 *  Promise.all did. `since` (epoch ms) narrows the list to threads with a
 *  message newer than that instant via Gmail's `after:` operator (second
 *  granularity), which is what makes an incremental run a handful of calls.
 *  Newest-first, like fetchThreadPage. */
export async function fetchThreadMetadata(opts: {
  max?: number;
  /** Epoch ms; only threads with a message after this instant. */
  since?: number | null;
  q?: string;
  concurrency?: number;
  /** Page through every matching thread (up to `max`), not just the first
   *  page. The result's `capped` says the cap cut it short. */
  allPages?: boolean;
} = {}): Promise<RawGmailThreadMeta[] & { capped?: boolean }> {
  const api = gmail();
  const s = storeFor();
  const me = await fetchProfileEmail();
  const baseQ = opts.q ?? "-in:spam -in:trash";
  const q = opts.since ? `${baseQ} after:${Math.floor(opts.since / 1000)}` : baseQ;
  const max = opts.max ?? 150;
  const listed: { id: string; historyId?: string }[] = [];
  let pageToken: string | undefined;
  let capped = false;
  do {
    const list = await withGmailRetry("threads.list", () =>
      api.users.threads.list({ userId: "me", maxResults: Math.min(500, max - listed.length), q, pageToken }),
    );
    for (const t of list.data.threads ?? []) if (t.id) listed.push({ id: t.id, historyId: t.historyId ?? undefined });
    pageToken = opts.allPages ? (list.data.nextPageToken ?? undefined) : undefined;
    if (pageToken && listed.length >= max) {
      capped = true;
      pageToken = undefined;
    }
  } while (pageToken);

  // A thread whose historyId hasn't moved since we last read it (headers or
  // full) is answered from the kept copy: an hourly 45-day scan costs one
  // list call plus 40 units per thread that actually changed.
  const threads = await mapLimit(listed, opts.concurrency ?? 3, async ({ id, historyId }) => {
    const kept = historyId ? [s.meta.get(id), s.full.get(id)].find((t) => t?.historyId === historyId) : undefined;
    let data: gmail_v1.Schema$Thread;
    if (kept) {
      kept.at = Date.now();
      data = kept.data;
    } else {
      ({ data } = await withGmailRetry("threads.get(metadata)", () =>
        api.users.threads.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date"],
        }),
      ));
      s.meta.set(id, { historyId: data.historyId ?? "", data, at: Date.now() });
    }
    const msgs = data.messages ?? [];
    const latest = msgs[msgs.length - 1];
    const labelIds = Array.from(new Set(msgs.flatMap((m) => m.labelIds ?? [])));
    const { name, email } = parseFrom(header(latest, "From"));
    return {
      id,
      fromName: name,
      fromEmail: email,
      toLine: header(latest, "To"),
      subject: header(latest, "Subject") || "(no subject)",
      date: Number(latest?.internalDate ?? Date.now()),
      outbound: email.toLowerCase() === me,
      labelIds,
    } satisfies RawGmailThreadMeta;
  });
  return Object.assign(threads.sort((a, b) => b.date - a.date), { capped });
}

// ─── Sending ─────────────────────────────────────────────────────────────────

// RFC-2822 headers must be 7-bit ASCII. Dropping a raw UTF-8 string (e.g. a
// subject with an em dash) straight into a header produces mojibake in the
// recipient's client — it needs RFC 2047 encoded-word syntax instead.
function encodeHeader(value: string): string {
  return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

// Attachment filenames go in a header *parameter*, which RFC 2047 doesn't
// cover — that needs RFC 2231 (filename*=UTF-8''<percent-encoded>). Pair it
// with an ASCII-sanitized plain `filename` for clients that don't support
// RFC 2231, so the attachment still has a sane name everywhere.
function contentDispositionFilename(filename: string): string {
  if (/^[\x00-\x7F]*$/.test(filename)) return `filename="${filename}"`;
  const ascii = filename.replace(/[^\x00-\x7F]/g, "-");
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Build the RFC-2822 message as a plain string (see buildRaw for the
 *  base64url form the JSON endpoint wants). */
function buildMime(
  to: string,
  subject: string,
  bodyText: string,
  attachments?: MailAttachment[],
  bodyHtml?: string,
): string {
  // Renders the message body: a plain text/plain part, or — when an HTML
  // alternative is given (P2-5 newsletter open-pixel) — a multipart/alternative
  // wrapping text + HTML so clients that hide images still get the text.
  for(const file of attachments ?? []){
    if(/[\r\n"\\]/.test(file.filename)|| !/^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType))throw Error('Invalid attachment headers.');
  }
  const altBoundary = `sjcos_alt_${Math.random().toString(36).slice(2)}`;
  const bodyLines = bodyHtml
    ? [
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
        "",
        `--${altBoundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        bodyText,
        `--${altBoundary}`,
        "Content-Type: text/html; charset=utf-8",
        "",
        bodyHtml,
        `--${altBoundary}--`,
      ]
    : ["Content-Type: text/plain; charset=utf-8", "", bodyText];

  if (!attachments || attachments.length === 0) {
    return [`To: ${to}`, `Subject: ${encodeHeader(subject)}`, "MIME-Version: 1.0", ...bodyLines].join("\r\n");
  }

  // multipart/mixed: the body part(s) + one part per attachment (base64, wrapped
  // at 76 cols per RFC 2045).
  const boundary = `sjcos_${Math.random().toString(36).slice(2)}`;
  const parts: string[] = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...bodyLines,
  ];
  for (const a of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${a.mimeType}; name="${a.filename.replace(/[^\x00-\x7F]/g, "-")}"`,
      `Content-Disposition: attachment; ${contentDispositionFilename(a.filename)}`,
      "Content-Transfer-Encoding: base64",
      "",
      a.content.toString("base64").replace(/(.{76})/g, "$1\r\n"),
    );
  }
  parts.push(`--${boundary}--`, "");
  return parts.join("\r\n");
}

/** Send a reply on an existing thread. Posts with the threadId so Gmail keeps
 *  it in the same conversation. */
export async function sendReply(opts: {
  threadId: string;
  toEmail?: string;
  cc?: string;
  subject?: string;
  bodyText: string;
  replyAll?: boolean;
  attachments?: MailAttachment[];
}): Promise<void> {
  // The reply is built from this read, so it gets the same patience as the send.
  const conversation = await fetchConversation(opts.threadId, { policy: "patient", priority: sendPriority() });
  const target = resolveReplyTarget(conversation.messages, conversation.ownAddresses);
  const incoming = [...conversation.messages].reverse().find(m => !m.outbound);
  if (!target) throw new Error("Automated message — no reply needed.");
  const to = opts.toEmail?.trim() || target.toEmail;
  if (isNoReplyAddress(to)) throw new Error("That address doesn't accept replies.");
  if (!validRecipient(to)) throw new Error("Enter a valid recipient email.");
  const subject = /^re:/i.test(conversation.subject) ? conversation.subject : `Re: ${conversation.subject}`;
  if (opts.cc && (/[\r\n]/.test(opts.cc) || splitAddresses(opts.cc).some(v => !validRecipient(emailAddress(v))))) throw Error("Enter valid Cc email addresses.");
  const cc = [...new Set([...(opts.replyAll ? target.cc : []), ...splitAddresses(opts.cc ?? "")])];
  const extra = [
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    ...(target.inReplyTo ? [`In-Reply-To: ${target.inReplyTo}`] : []),
    ...(target.references ? [`References: ${target.references}`] : []),
  ];
  const mime = [...extra, buildMime(to, subject, opts.bodyText, opts.attachments)].join('\r\n');
  await sendMime(mime, opts.threadId);
}

/** On opening a website inquiry, one address search discovers older mail too.
 * Headers/bodies are not fetched: no per-thread fan-out or render polling.
 * Kept per address until the mailbox changes (or 10 minutes). */
export async function findCorrespondence(email:string):Promise<{id:string;subject:string}[]> {
  if(!validRecipient(email))throw Error('Invalid inquiry address.');
  const s=storeFor(),key=email.toLowerCase();
  try{await syncMailbox(s);}catch{/* fall through to a fresh search */}
  const kept=s.correspondence.get(key);
  if(kept&&kept.generation===s.generation&&Date.now()-kept.at<10*60_000)return [...kept.data];
  const generation=s.generation;
  const {data}=await withGmailRetry('threads.list(inquiry)',()=>gmail().users.threads.list({
    userId:'me',maxResults:20,q:`-in:spam -in:trash {from:${email} to:${email}}`,
  }));
  const found=(data.threads ?? []).filter(t=>Boolean(t.id)).map(t=>({id:t.id!,subject:'Email conversation'}));
  s.correspondence.set(key,{generation,at:Date.now(),data:found});
  return [...found];
}

/** Compose and send a brand-new email (not part of an existing thread). */
/** A file to attach to an outgoing email. */
export interface MailAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export async function sendNewEmail(opts: {
  to: string;
  cc?: string;
  subject: string;
  bodyText: string;
  attachments?: MailAttachment[];
  bodyHtml?: string;
}): Promise<{threadId?:string}> {
  if (!splitAddresses(opts.to).length || splitAddresses(opts.to).some(v=>!validRecipient(emailAddress(v))) || /[\r\n]/.test(opts.to)) throw Error("Enter a valid recipient email.");
  if (opts.cc && (/[\r\n]/.test(opts.cc) || splitAddresses(opts.cc).some(v=>!validRecipient(emailAddress(v))))) throw Error("Enter valid Cc email addresses.");
  if (/[\r\n]/.test(opts.subject)) throw Error("Invalid subject.");
  const mime = (opts.cc ? `Cc: ${opts.cc}\r\n` : "") + buildMime(opts.to, opts.subject || "(no subject)", opts.bodyText, opts.attachments, opts.bodyHtml);
  return sendMime(mime);
}

/** A person pressing Send outranks everything; a timer's send (bid nudges,
 *  drips) still leaves the last tenth of the minute for them. */
function sendPriority(): GmailPriority {
  return currentGmailPriority() === "background" ? "interactive" : "send";
}

/** Credentials whose mail-server login was refused (no full-mailbox scope):
 *  don't try SMTP again for an hour. */
const smtpRefusedUntil = new Map<string, number>();

/** Both replies and new mail use the same upload/JSON transport. A send that
 *  Gmail refuses for quota keeps trying for about a minute (background work
 *  stands aside meanwhile). With the SMTP backstop switched on and permitted,
 *  a refused send goes straight to Gmail's mail server instead of waiting. */
async function sendMime(mime:string,threadId?:string):Promise<{threadId?:string}> {
  const api = gmail();
  const key = quotaKey();
  const priority = sendPriority();
  const viaApi = (policy: GmailRetryPolicy) => withGmailRetry("messages.send", () => api.users.messages.send(
    Buffer.byteLength(mime)>4*1024*1024
      ? {userId:"me",requestBody:threadId?{threadId}:undefined,media:{mimeType:"message/rfc822",body:mime}}
      : {userId:"me",requestBody:{raw:Buffer.from(mime).toString("base64url"),...(threadId?{threadId}:{})}}
  ), { policy, priority });
  return withGmailSendSlot(key, async () => {
    let sentThreadId: string | undefined;
    const smtpReady = smtpFallbackEnabled() && (smtpRefusedUntil.get(key) ?? 0) < Date.now();
    try {
      sentThreadId = (await viaApi(smtpReady ? "once" : "patient")).data.threadId ?? undefined;
    } catch (err) {
      if (!smtpReady || !isGmailRateLimit(err)) throw err;
      const viaSmtp = await sendViaSmtp(mime, key);
      if (viaSmtp) {
        sentThreadId = threadId ?? viaSmtp.threadId;
      } else {
        sentThreadId = (await viaApi("patient")).data.threadId ?? undefined;
      }
    }
    markMailboxChanged(threadId);
    return { threadId: sentThreadId };
  });
}

/** Submit through smtp.gmail.com. Returns null when the mail server login is
 *  refused (so the caller keeps waiting on the API); other SMTP failures throw
 *  — the API already refused, so there is nothing safer to fall back to. */
async function sendViaSmtp(mime: string, key: string): Promise<{ threadId?: string } | null> {
  let from = "";
  let token: string | null | undefined;
  try {
    from = await fetchProfileEmail({ priority: "send" });
    ({ token } = await oauthClient().getAccessToken());
  } catch {
    return null;
  }
  if (!from || !token) return null;
  const prepared = prepareSmtpMime(mime, from);
  if (!smtpSafe(prepared.mime)) return null; // over-long lines: API only
  try {
    await smtpSend({ user: from, accessToken: token, recipients: mimeRecipients(prepared.mime), mime: prepared.mime });
  } catch (err) {
    if (err instanceof SmtpAuthError) {
      smtpRefusedUntil.set(key, Date.now() + 60 * 60_000);
      console.warn(`[gmail] SMTP backstop not permitted for this mailbox (reconnect with full mail access to enable): ${err.message}`);
      return null;
    }
    // The one unsafe moment: handed over, never confirmed. Don't send it twice.
    if (err instanceof SmtpError && err.mayHaveSent) throw err;
    console.warn(`[gmail] SMTP backstop failed before sending (${(err as Error).message}); waiting on the API instead`);
    return null;
  }
  console.warn("[gmail] send refused by the API quota; delivered through Gmail's mail server instead");
  // New mail: find its thread (5 units) so callers can link it. Best effort —
  // Gmail is busy right now, so give up quietly rather than fail a sent email.
  try {
    const { data } = await withGmailRetry("messages.list", () =>
      gmail().users.messages.list({ userId: "me", q: `rfc822msgid:${prepared.messageId.replace(/[<>]/g, "")}`, maxResults: 1 }),
    { policy: "once", priority: "send" });
    return { threadId: data.messages?.[0]?.threadId ?? undefined };
  } catch {
    return { threadId: undefined };
  }
}

// ─── Mutations (require the gmail.modify scope) ──────────────────────────────

/** Add/remove Gmail label ids across every message in a thread. Retried on a
 *  quota refusal (setting labels twice is harmless). */
export async function modifyThread(
  threadId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
): Promise<void> {
  await withGmailRetry("threads.modify", () => gmail().users.threads.modify({
    userId: "me",
    id: threadId,
    requestBody: {
      addLabelIds: changes.addLabelIds,
      removeLabelIds: changes.removeLabelIds,
    },
  }));
  markMailboxChanged(threadId);
}

/** Move a whole thread to Trash (recoverable; not a permanent delete). */
export async function trashThread(threadId: string): Promise<void> {
  await withGmailRetry("threads.trash", () => gmail().users.threads.trash({ userId: "me", id: threadId }));
  markMailboxChanged(threadId);
}

/** Unread thread count in the INBOX — a single cheap labels.get (no thread
 *  fetching), suitable for the nav badge. */
export async function gmailInboxUnread(): Promise<number> {
  const { data } = await withGmailRetry("labels.get", () => gmail().users.labels.get({ userId: "me", id: "INBOX" }));
  return data.threadsUnread ?? 0;
}

/** One authorized attachment requested on click, using the cached message envelope. */
export async function fetchInboxAttachment(threadId: string, messageId: string, attachmentId: string): Promise<{bytes:Buffer;name:string;type:string}> {
  const thread=await cachedThread(threadId);
  const message=thread.messages?.find(m=>m.id===messageId);
  const part=collectFileParts(message?.payload).find(p=>(p.body?.attachmentId??p.partId)===attachmentId);
  if(!message||!part)throw Error('Attachment not found.');
  let data=part.body?.data;
  if(!data&&part.body?.attachmentId){
    const result=await withGmailRetry('attachments.get',()=>gmail().users.messages.attachments.get({userId:'me',messageId,id:part.body!.attachmentId!}));
    data=result.data.data??undefined;
  }
  if(!data)throw Error('Attachment unavailable.');
  return {bytes:Buffer.from(data,'base64url'),name:part.filename||'attachment',type:part.mimeType||'application/octet-stream'};
}

/** Mailbox-scoped, cached single-thread read; no list or label quota. */
export async function fetchRawThread(id: string): Promise<RawGmailThread> {
  const [data, me] = await Promise.all([cachedThread(id), fetchProfileEmail()]);
  return rawThreadOf(id, data, me);
}

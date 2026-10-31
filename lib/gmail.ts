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
import { splitAddresses, resolveReplyTarget, validRecipient, isAutomatedSender, isNoReplyAddress } from "./inbox-rules";

export const GMAIL_SCOPES = [
  // modify = read + label/state changes (star, archive, mark read, important,
  // trash). Deliberately not the full mail scope and not permanent-delete.
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
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
// Gmail meters "Units per minute per user" (threads.get = 10 units, list = 10,
// send = 100). A burst of full-thread fetches from a timer can burn the whole
// minute, and any real send that lands in that window fails with
// "Quota exceeded … rateLimitExceeded". Every metered call below goes through
// withGmailRetry so a collision backs off and recovers instead of surfacing.

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

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1500;

/** Process-wide tally of metered Gmail calls (every call through
 *  withGmailRetry, including retries). Read it before/after a job to report
 *  how many API hits the job cost — see syncLeadThreads' `gmailCalls`. */
let gmailCallCount = 0;
export function gmailCallsSoFar(): number {
  return gmailCallCount;
}

/** Run one Gmail API call with exponential backoff on rate-limit responses:
 *  up to RETRY_ATTEMPTS tries (1.5s, 3s, 6s + jitter), then a typed
 *  GmailRateLimitError. Non-rate-limit errors propagate untouched on the
 *  first failure. */
export async function withGmailRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    gmailCallCount++;
    try {
      return await fn();
    } catch (err) {
      if (!isGmailRateLimit(err)) throw err;
      lastErr = err;
      if (attempt === RETRY_ATTEMPTS) break;
      const wait = RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
      console.warn(`[gmail] rate limited on ${label} (attempt ${attempt}/${RETRY_ATTEMPTS}); retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new GmailRateLimitError(label, RETRY_ATTEMPTS, lastErr);
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

  return text
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

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ");
}

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
  return sanitizeHtml(html, {
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
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
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

/** Full sanitized HTML body of a thread's latest message, with cid: inline
 *  images resolved to data URIs. Returns "" when there's no HTML part. Resolved
 *  lazily (on thread open) so the inbox list fetch stays cheap. */
// Short-lived payload + HTML caches, scoped to the actual mailbox credential.
// List loads already have full payloads: seed them instead of refetching on open.
const conversationCache = new Map<string, { at: number; data: Promise<gmail_v1.Schema$Thread> }>();
const messageHtmlCache = new Map<string, { at: number; data: Promise<string> }>();
function trimDetailCaches() {
  for (const cache of [conversationCache, messageHtmlCache]) {
    for (const [key, entry] of cache) if (Date.now()-entry.at >= 30_000) cache.delete(key);
    while (cache.size >= 200) cache.delete(cache.keys().next().value!);
  }
}
function detailKey(id: string): string { return JSON.stringify([activeRefreshToken(), id]); }
function seedConversation(id: string, data: gmail_v1.Schema$Thread) {
  trimDetailCaches();
  conversationCache.set(detailKey(id), { at: Date.now(), data: Promise.resolve(data) });
}
function cachedThread(id: string): Promise<gmail_v1.Schema$Thread> {
  const key = detailKey(id);
  const hit = conversationCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.data;
  trimDetailCaches();
  const data = withGmailRetry("threads.get", () => gmail().users.threads.get({ userId: "me", id, format: "full" })).then(r => r.data);
  conversationCache.set(key, { at: Date.now(), data });
  data.catch(() => { if (conversationCache.get(key)?.data === data) conversationCache.delete(key); });
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
      automated: isAutomatedSender(from.email, undefined, {
        headers: Object.fromEntries((m.payload?.headers ?? []).map(h => [h.name ?? '', h.value ?? ''])),
        labelIds: m.labelIds ?? [], body: extractBody(m.payload).join('\n') || m.snippet || '',
      }),
      replyTo: header(m,'Reply-To'), messageId: header(m,'Message-ID'), references: header(m,'References'),
      attachments: collectFileParts(m.payload).map(p => ({id:p.body?.attachmentId ?? p.partId ?? '', name:p.filename ?? '',size:p.body?.size ?? 0,type:p.mimeType ?? 'application/octet-stream'})),
    };
  });
  return { id, subject: header(sorted.at(-1),'Subject') || '(no subject)', messages, ownAddresses, category:deriveCategory(sorted.flatMap(m=>m.labelIds ?? [])) };
}
export async function fetchConversation(threadId: string): Promise<EmailConversation> {
  const [data, me] = await Promise.all([cachedThread(threadId), fetchProfileEmail()]);
  return conversationOf(threadId, data, me);
}
export async function fetchThreadHtml(threadId: string): Promise<string> {
  const data = await cachedThread(threadId);
  const message = [...(data.messages ?? [])].sort((a,b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0)).at(-1);
  return message?.id ? fetchMessageHtml(threadId, message.id) : '';
}
export async function fetchMessageHtml(threadId: string, messageId: string): Promise<string> {
  const key = detailKey(threadId) + ':' + messageId;
  const hit = messageHtmlCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.data;
  trimDetailCaches();
  const data = renderMessageHtml(threadId, messageId);
  messageHtmlCache.set(key, {at:Date.now(),data});
  data.catch(() => { if (messageHtmlCache.get(key)?.data === data) messageHtmlCache.delete(key); });
  return data;
}
async function renderMessageHtml(threadId: string, messageId: string): Promise<string> {
  const api = gmail();
  const data = await cachedThread(threadId);
  const message = data.messages?.find(m => m.id === messageId);
  if (!message?.payload) return '';
  const htmlData = findPart(message.payload, "text/html");
  if (!htmlData) return "";
  let html = Buffer.from(htmlData, "base64url").toString("utf-8");

  // Inline cid: images (signature logos etc.) → data URIs so they render.
  const inlines = collectInlineImages(message.payload);
  if (inlines.length && message.id) {
    await Promise.all(
      inlines.map(async (img) => {
        try {
          const att = await api.users.messages.attachments.get({
            userId: "me",
            messageId: message.id!,
            id: img.attachmentId,
          });
          const b64 = (att.data.data ?? "").replace(/-/g, "+").replace(/_/g, "/");
          if (!b64) return;
          const dataUri = `data:${img.mimeType};base64,${b64}`;
          const ref = img.cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          html = html.replace(new RegExp(`cid:${ref}`, "gi"), dataUri);
        } catch {
          /* leave the cid ref; it just won't render */
        }
      }),
    );
  }

  return sanitizeEmailHtml(html);
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
  const text = plain && looksLikeText(plain) ? plain : html ? stripHtml(html) : plain;

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
export async function fetchProfileEmail(): Promise<string> {
  const key = activeRefreshToken() ?? "";
  const hit = profileEmailCache.get(key);
  if (hit) return hit;
  const api = gmail();
  const { data } = await withGmailRetry("getProfile", () => api.users.getProfile({ userId: "me" }));
  const email = (data.emailAddress ?? "").toLowerCase();
  if (email) profileEmailCache.set(key, email);
  return email;
}

/** List the user's own (non-system) labels for resolving ids → display names. */
export async function fetchLabels(): Promise<GmailLabel[]> {
  const { data } = await gmail().users.labels.list({ userId: "me" });
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
 *  system-mailbox badges off (see the Mailboxes note in InboxClient). */
export async function fetchLabelCounts(): Promise<CountedGmailLabel[]> {
  const labels = await fetchLabels();
  const api = gmail();
  return Promise.all(
    labels.map(async (l) => {
      try {
        const { data } = await api.users.labels.get({ userId: "me", id: l.id });
        return { ...l, count: data.threadsTotal ?? 0 };
      } catch {
        return { ...l, count: null }; // hide the badge; label stays clickable
      }
    }),
  );
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
export async function fetchThreadPage(
  max = 50,
  pageToken?: string,
  labelId?: string,
  q = "-in:spam -in:trash",
): Promise<{ threads: RawGmailThread[]; nextPageToken?: string }> {
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
  const ids = (list.data.threads ?? []).map((t) => t.id!).filter(Boolean);

  const threads = await Promise.all(
    ids.map(async (id) => {
      const { data } = await withGmailRetry("threads.get", () =>
        api.users.threads.get({
          userId: "me",
          id,
          format: "full",
        }),
      );
      seedConversation(id, data);
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
    }),
  );
  return {
    threads: threads.sort((a, b) => b.date - a.date),
    nextPageToken: list.data.nextPageToken ?? undefined,
  };
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
  const me = await fetchProfileEmail();
  const baseQ = opts.q ?? "-in:spam -in:trash";
  const q = opts.since ? `${baseQ} after:${Math.floor(opts.since / 1000)}` : baseQ;
  const max = opts.max ?? 150;
  const ids: string[] = [];
  let pageToken: string | undefined;
  let capped = false;
  do {
    const list = await withGmailRetry("threads.list", () =>
      api.users.threads.list({ userId: "me", maxResults: Math.min(500, max - ids.length), q, pageToken }),
    );
    for (const t of list.data.threads ?? []) if (t.id) ids.push(t.id);
    pageToken = opts.allPages ? (list.data.nextPageToken ?? undefined) : undefined;
    if (pageToken && ids.length >= max) {
      capped = true;
      pageToken = undefined;
    }
  } while (pageToken);

  const threads = await mapLimit(ids, opts.concurrency ?? 5, async (id) => {
    const { data } = await withGmailRetry("threads.get(metadata)", () =>
      api.users.threads.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      }),
    );
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
  subject?: string;
  bodyText: string;
  replyAll?: boolean;
}): Promise<void> {
  const conversation = await fetchConversation(opts.threadId);
  const target = resolveReplyTarget(conversation.messages, conversation.ownAddresses);
  const incoming = [...conversation.messages].reverse().find(m => !m.outbound);
  if (!target) throw new Error("Automated message — no reply needed.");
  const to = opts.toEmail?.trim() || target.toEmail;
  if (isNoReplyAddress(to)) throw new Error("That address doesn't accept replies.");
  if (!validRecipient(to)) throw new Error("Enter a valid recipient email.");
  const subject = /^re:/i.test(conversation.subject) ? conversation.subject : `Re: ${conversation.subject}`;
  const extra = [
    ...(opts.replyAll && target.cc.length ? [`Cc: ${target.cc.join(', ')}`] : []),
    ...(target.inReplyTo ? [`In-Reply-To: ${target.inReplyTo}`] : []),
    ...(target.references ? [`References: ${target.references}`] : []),
  ];
  const mime = [...extra, buildMime(to, subject, opts.bodyText)].join('\r\n');
  await withGmailRetry("messages.send", () => gmail().users.messages.send({
    userId: "me", requestBody: { raw: Buffer.from(mime).toString('base64url'), threadId: opts.threadId },
  }));
  conversationCache.delete(detailKey(opts.threadId));
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
  subject: string;
  bodyText: string;
  attachments?: MailAttachment[];
  bodyHtml?: string;
}): Promise<void> {
  const mime = buildMime(opts.to, opts.subject || "(no subject)", opts.bodyText, opts.attachments, opts.bodyHtml);
  // The JSON endpoint rejects large payloads, so anything attachment-heavy
  // (e.g. a bid packet with a multi-MB plan set) goes through the media-upload
  // path instead — that one takes the raw RFC-2822 bytes, no base64 field.
  const api = gmail();
  if (Buffer.byteLength(mime) > 4 * 1024 * 1024) {
    await withGmailRetry("messages.send(media)", () =>
      api.users.messages.send({
        userId: "me",
        media: { mimeType: "message/rfc822", body: mime },
      }),
    );
  } else {
    await withGmailRetry("messages.send", () =>
      api.users.messages.send({
        userId: "me",
        requestBody: { raw: Buffer.from(mime).toString("base64url") },
      }),
    );
  }
}

// ─── Mutations (require the gmail.modify scope) ──────────────────────────────

/** Add/remove Gmail label ids across every message in a thread. */
export async function modifyThread(
  threadId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
): Promise<void> {
  await gmail().users.threads.modify({
    userId: "me",
    id: threadId,
    requestBody: {
      addLabelIds: changes.addLabelIds,
      removeLabelIds: changes.removeLabelIds,
    },
  });
}

/** Move a whole thread to Trash (recoverable; not a permanent delete). */
export async function trashThread(threadId: string): Promise<void> {
  await gmail().users.threads.trash({ userId: "me", id: threadId });
}

/** Unread thread count in the INBOX — a single cheap labels.get (no thread
 *  fetching), suitable for the nav badge. */
export async function gmailInboxUnread(): Promise<number> {
  const { data } = await gmail().users.labels.get({ userId: "me", id: "INBOX" });
  return data.threadsUnread ?? 0;
}

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

export const GMAIL_SCOPES = [
  // modify = read + label/state changes (star, archive, mark read, important,
  // trash). Deliberately not the full mail scope and not permanent-delete.
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
];

const REDIRECT_URI =
  process.env.GMAIL_REDIRECT_URI ??
  "http://localhost:3017/api/inbox/oauth/callback";

/** True once the OAuth app + a minted refresh token are configured. */
export function gmailConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN,
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
  if (process.env.GMAIL_REFRESH_TOKEN) {
    client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  }
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

// ─── Reading ─────────────────────────────────────────────────────────────────

/** Neutral, presentation-free view of a Gmail thread. lib/inbox.ts maps this
 *  onto the InboxThread / ThreadReader shapes the UI consumes. */
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
    .filter(Boolean)
    .slice(0, 14);
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
  if (tokens.length < 3) return false;
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

/** The account's own email address (Gmail "me"), cached per process. Used to
 *  tell inbound from outbound messages. */
let profileEmailCache: string | null = null;
export async function fetchProfileEmail(): Promise<string> {
  if (profileEmailCache) return profileEmailCache;
  const { data } = await gmail().users.getProfile({ userId: "me" });
  profileEmailCache = (data.emailAddress ?? "").toLowerCase();
  return profileEmailCache;
}

/** List the user's own (non-system) labels for resolving ids → display names. */
export async function fetchLabels(): Promise<GmailLabel[]> {
  const { data } = await gmail().users.labels.list({ userId: "me" });
  return (data.labels ?? [])
    .filter((l) => l.type === "user" && l.id && l.name)
    .map((l) => ({ id: l.id!, name: l.name! }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
 *  are no more). Drives the inbox's "Load more". */
export async function fetchThreadPage(
  max = 50,
  pageToken?: string,
): Promise<{ threads: RawGmailThread[]; nextPageToken?: string }> {
  const api = gmail();
  const me = await fetchProfileEmail();
  const list = await api.users.threads.list({
    userId: "me",
    maxResults: max,
    q: "-in:spam -in:trash",
    pageToken,
  });
  const ids = (list.data.threads ?? []).map((t) => t.id!).filter(Boolean);

  const threads = await Promise.all(
    ids.map(async (id) => {
      const { data } = await api.users.threads.get({
        userId: "me",
        id,
        format: "full",
      });
      const msgs = data.messages ?? [];
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
        outbound: email.toLowerCase() === me,
        category: deriveCategory(labelIds),
        labelIds,
        bodyParas: extractBody(latest?.payload),
      } satisfies RawGmailThread;
    }),
  );
  return {
    threads: threads.sort((a, b) => b.date - a.date),
    nextPageToken: list.data.nextPageToken ?? undefined,
  };
}

// ─── Sending ─────────────────────────────────────────────────────────────────

/** Build a base64url-encoded RFC-2822 plain-text message. */
function buildRaw(to: string, subject: string, bodyText: string): string {
  const mime = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    bodyText,
  ].join("\r\n");
  return Buffer.from(mime).toString("base64url");
}

/** Send a reply on an existing thread. Posts with the threadId so Gmail keeps
 *  it in the same conversation. */
export async function sendReply(opts: {
  threadId: string;
  toEmail: string;
  subject: string;
  bodyText: string;
}): Promise<void> {
  const subject = opts.subject.startsWith("Re:")
    ? opts.subject
    : `Re: ${opts.subject}`;
  await gmail().users.messages.send({
    userId: "me",
    requestBody: {
      raw: buildRaw(opts.toEmail, subject, opts.bodyText),
      threadId: opts.threadId,
    },
  });
}

/** Compose and send a brand-new email (not part of an existing thread). */
export async function sendNewEmail(opts: {
  to: string;
  subject: string;
  bodyText: string;
}): Promise<void> {
  await gmail().users.messages.send({
    userId: "me",
    requestBody: { raw: buildRaw(opts.to, opts.subject || "(no subject)", opts.bodyText) },
  });
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

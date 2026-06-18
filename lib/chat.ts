// Team-chat data builder. Mock / UI-only for now — there is no chat table in
// db/schema.sql yet (chat persistence is a later phase). Shape stays stable so
// the screen code won't change when it's backed for real.
//
// Follows the lib/inbox.ts pattern: a flat channel list drives the rail, a
// curated showcase channel (#field-daily) carries a full transcript, and other
// channels fall back to a generic "Claude is watching" view. Claude is modeled
// as an in-channel participant; when transcripts are backed for real, Claude's
// posts will be generated through the ai service abstraction — never a provider
// directly.

import { query } from "./db";

// ─── Left rail: channels, project rooms, DMs ────────────────────────────────

export interface ChatChannel {
  /** Slug, e.g. "field-daily". */
  key: string;
  /** Display name, e.g. "# field-daily". */
  name: string;
  /** Unread count; omitted/0 renders no badge. */
  unread?: number;
}

export const CHANNELS: ChatChannel[] = [
  { key: "field-daily", name: "# field-daily" },
  { key: "selections", name: "# selections", unread: 2 },
  { key: "bookkeeping", name: "# bookkeeping" },
  { key: "safety", name: "# safety" },
  { key: "marketing-queue", name: "# marketing-queue", unread: 3 },
];

export const ROOMS: ChatChannel[] = [
  { key: "henderson-kitchen", name: "# henderson-kitchen" },
  { key: "olson-porch", name: "# olson-porch" },
  { key: "reyes-bath", name: "# reyes-bath" },
  { key: "chen-lead", name: "# chen-lead" },
];

export interface DirectMessage {
  initials: string;
  /** Display name, e.g. "Marco · tile". */
  name: string;
  online: boolean;
}

export const DIRECTS: DirectMessage[] = [
  { initials: "MR", name: "Marco · tile", online: true },
  { initials: "TS", name: "Tomas · electric", online: false },
  { initials: "DH", name: "Dani · bookkeeping", online: true },
  { initials: "BP", name: "Brad · paint", online: false },
];

// ─── Messages ────────────────────────────────────────────────────────────────

/** owner = Joe (accent), ai = Claude (sage), user = everyone else (gray). */
export type MessageKind = "owner" | "ai" | "user";

export interface ChatMessage {
  initials: string;
  name: string;
  time: string;
  text: string;
  kind: MessageKind;
  /** Claude's posts carry an "AI · system" chip. */
  system?: boolean;
}

export interface ChannelView {
  key: string;
  /** Display name, e.g. "# field-daily". */
  name: string;
  description: string;
  /** Participant initials for the header avatar stack. */
  participants: string[];
  /** Day-separator chip, e.g. "Today · Mon May 25". */
  daySeparator: string;
  messages: ChatMessage[];
}

/** Per-channel one-liner shown under the channel name. */
const DESCRIPTIONS: Record<string, string> = {
  "field-daily": "Daily check-ins from active sites · Claude pins what's blocking",
  selections: "Client selections + approvals · Claude logs each decision",
  bookkeeping: "Receipts, invoices, and money questions",
  safety: "Site safety notes and incident reports",
  "marketing-queue": "AI-drafted posts waiting on your approval",
};

// ─── Builders ────────────────────────────────────────────────────────────────

export interface ChatData {
  channels: ChatChannel[];
  rooms: ChatChannel[];
  directs: DirectMessage[];
  /** All channel/room views, keyed by slug. */
  views: Record<string, ChannelView>;
  /** Channel selected on first paint. */
  selectedKey: string;
}

interface MessageRow {
  channel_key: string;
  author_kind: MessageKind;
  author_name: string;
  author_initials: string;
  body: string;
  created_at: Date;
}

/** "7:48am" in a deterministic format (computed server-side, sent as data). */
function clockTime(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m}${ap}`;
}

function rowToMessage(r: MessageRow): ChatMessage {
  return {
    initials: r.author_initials || (r.author_kind === "ai" ? "CL" : "?"),
    name: r.author_name,
    time: clockTime(new Date(r.created_at)),
    text: r.body,
    kind: r.author_kind,
    system: r.author_kind === "ai",
  };
}

function buildView(ch: ChatChannel, rows: MessageRow[]): ChannelView {
  const messages = rows.map(rowToMessage);
  const seen = new Set<string>();
  const participants: string[] = [];
  for (const m of messages) {
    if (m.initials && !seen.has(m.initials)) {
      seen.add(m.initials);
      participants.push(m.initials);
    }
  }
  if (!participants.includes("JS")) participants.unshift("JS");
  if (!participants.includes("CL")) participants.push("CL");

  return {
    key: ch.key,
    name: ch.name,
    description:
      DESCRIPTIONS[ch.key] ??
      "Claude is watching this channel and will flag anything that needs you.",
    participants: participants.slice(0, 5),
    daySeparator: `Today · ${new Date().toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })}`,
    messages,
  };
}

export async function getChatData(): Promise<ChatData> {
  const all = [...CHANNELS, ...ROOMS];
  const [msgRes, readRes] = await Promise.all([
    query<MessageRow>(
      `SELECT channel_key, author_kind, author_name, author_initials, body, created_at
       FROM chat_messages ORDER BY created_at ASC`,
    ),
    query<{ channel_key: string; last_read_at: Date }>(
      `SELECT channel_key, last_read_at FROM chat_reads`,
    ),
  ]);

  const byChannel = new Map<string, MessageRow[]>();
  for (const r of msgRes.rows) {
    const list = byChannel.get(r.channel_key) ?? [];
    list.push(r);
    byChannel.set(r.channel_key, list);
  }
  const lastRead = new Map(readRes.rows.map((r) => [r.channel_key, new Date(r.last_read_at)]));

  const unreadFor = (key: string): number => {
    const since = lastRead.get(key);
    return (byChannel.get(key) ?? []).filter(
      (r) => r.author_kind !== "owner" && (!since || new Date(r.created_at) > since),
    ).length;
  };

  const withUnread = (list: ChatChannel[]): ChatChannel[] =>
    list.map((c) => ({ ...c, unread: unreadFor(c.key) || undefined }));

  const viewEntries = all.map(
    (ch) => [ch.key, buildView(ch, byChannel.get(ch.key) ?? [])] as const,
  );

  return {
    channels: withUnread(CHANNELS),
    rooms: withUnread(ROOMS),
    directs: DIRECTS,
    views: Object.fromEntries(viewEntries),
    selectedKey: "field-daily",
  };
}

/** Total unread chat messages for the nav badge (messages from others after
 *  each channel's last-read marker). */
export async function getUnreadChatCount(): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `SELECT count(*) AS n
       FROM chat_messages m
       LEFT JOIN chat_reads r ON r.channel_key = m.channel_key
      WHERE m.author_kind <> 'owner'
        AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)`,
  );
  return Number(rows[0]?.n ?? 0);
}

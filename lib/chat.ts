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
  /** Optional per-channel description (project rooms set this). */
  description?: string;
}

export const CHANNELS: ChatChannel[] = [
  { key: "field-daily", name: "# field-daily" },
  { key: "selections", name: "# selections" },
  { key: "bookkeeping", name: "# bookkeeping" },
  { key: "safety", name: "# safety" },
  { key: "marketing-queue", name: "# marketing-queue" },
];

/** Project-room channel-key convention: one room per active project. */
export const roomKey = (slug: string) => `room:${slug}`;

export interface DirectMessage {
  /** Channel key for this conversation, e.g. "dm:marco". */
  key: string;
  initials: string;
  /** Rail label, e.g. "Marco · Tile". */
  name: string;
  /** Cosmetic presence dot (no real presence system; favourite subs show on). */
  online: boolean;
  /** Unread count from the other party since the owner's last read. */
  unread?: number;
}

/** DM channel-key convention: one conversation per sub, in the shared
 *  chat_messages/chat_reads tables (no separate DM table needed). */
export const dmKey = (subSlug: string) => `dm:${subSlug}`;

/** "Marco Rivas" → "MR". */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

// ─── Messages ────────────────────────────────────────────────────────────────

/** owner = Joe (accent), ai = the AI assistant (sage), user = everyone else (gray). */
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

/** A sub who can be a channel member (also the shape of the add-picker roster). */
export interface ChannelMember {
  slug: string;
  name: string;
  initials: string;
  trade: string;
}

export interface ChannelView {
  key: string;
  /** Display name, e.g. "# field-daily". */
  name: string;
  description: string;
  /** Participant initials for the header avatar stack. */
  participants: string[];
  /** Sub members (owner + AI are implicit, not listed here). Empty for DMs. */
  members: ChannelMember[];
  /** True for channels/rooms (editable membership); false for DMs. */
  canManageMembers: boolean;
  /** Day-separator chip, e.g. "Today · Mon May 25". */
  daySeparator: string;
  messages: ChatMessage[];
}

/** Per-channel one-liner shown under the channel name. */
const DESCRIPTIONS: Record<string, string> = {
  "field-daily": "Daily check-ins from active sites · AI pins what's blocking",
  selections: "Client selections + approvals · AI logs each decision",
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
  /** Every sub — the pool the add-member picker draws from. */
  roster: ChannelMember[];
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
    initials: r.author_initials || (r.author_kind === "ai" ? "AI" : "?"),
    name: r.author_name,
    time: clockTime(new Date(r.created_at)),
    text: r.body,
    kind: r.author_kind,
    system: r.author_kind === "ai",
  };
}

function buildView(
  ch: ChatChannel,
  rows: MessageRow[],
  members: ChannelMember[],
): ChannelView {
  // Avatar stack = owner (JS) + sub members + the AI, in that order.
  const participants = ["JS", ...members.map((m) => m.initials), "AI"];

  return {
    key: ch.key,
    name: ch.name,
    description:
      ch.description ??
      DESCRIPTIONS[ch.key] ??
      "AI is watching this channel and will flag anything that needs you.",
    participants: participants.slice(0, 6),
    members,
    canManageMembers: true,
    daySeparator: `Today · ${new Date().toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })}`,
    messages: rows.map(rowToMessage),
  };
}

/** A DM is a private one-to-one room. Unlike channels, the AI isn't a member,
 *  so the participant stack is just the owner + the sub. */
function buildDmView(
  d: { key: string; fullName: string; initials: string; trade: string },
  rows: MessageRow[],
): ChannelView {
  return {
    key: d.key,
    name: d.fullName,
    description: `Direct message · ${d.trade}`,
    participants: ["JS", d.initials],
    members: [],
    canManageMembers: false,
    daySeparator: `Today · ${new Date().toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })}`,
    messages: rows.map(rowToMessage),
  };
}

interface DmSubRow {
  slug: string;
  name: string;
  trade: string;
  fav: boolean;
}

export async function getChatData(): Promise<ChatData> {
  const [msgRes, readRes, subRes, memberRes, roomRes] = await Promise.all([
    query<MessageRow>(
      `SELECT channel_key, author_kind, author_name, author_initials, body, created_at
       FROM chat_messages ORDER BY created_at ASC`,
    ),
    query<{ channel_key: string; last_read_at: Date }>(
      `SELECT channel_key, last_read_at FROM chat_reads`,
    ),
    // The full sub roster (favourites + active jobs first). Drives both the DM
    // list (top few) and the add-member picker (all of them).
    query<DmSubRow>(
      `SELECT slug, name, trade, fav FROM subs
       ORDER BY fav DESC, open_jobs DESC, name ASC`,
    ),
    query<{ channel_key: string; sub_slug: string }>(
      `SELECT channel_key, sub_slug FROM chat_members`,
    ),
    // Project rooms = one per project with active site work (construction /
    // closeout), most-progressed first. Replaces the old hardcoded demo rooms.
    query<{ slug: string; name: string }>(
      `SELECT slug, name FROM projects
        WHERE status IN ('construction', 'closeout')
        ORDER BY progress DESC, name ASC
        LIMIT 12`,
    ),
  ]);

  const ROOMS: ChatChannel[] = roomRes.rows.map((p) => ({
    key: roomKey(p.slug),
    name: `# ${p.name}`,
    description: `Project room · ${p.name}`,
  }));
  const all = [...CHANNELS, ...ROOMS];

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

  // Sub roster, keyed by slug, as ChannelMember.
  const roster: ChannelMember[] = subRes.rows.map((s) => ({
    slug: s.slug,
    name: s.name,
    initials: initialsOf(s.name),
    trade: s.trade,
  }));
  const rosterBySlug = new Map(roster.map((m) => [m.slug, m]));

  // channel_key → its sub members (resolved against the roster).
  const membersByChannel = new Map<string, ChannelMember[]>();
  for (const r of memberRes.rows) {
    const m = rosterBySlug.get(r.sub_slug);
    if (!m) continue;
    const list = membersByChannel.get(r.channel_key) ?? [];
    list.push(m);
    membersByChannel.set(r.channel_key, list);
  }

  const viewEntries = all.map(
    (ch) =>
      [
        ch.key,
        buildView(ch, byChannel.get(ch.key) ?? [], membersByChannel.get(ch.key) ?? []),
      ] as const,
  );

  // Direct messages — one conversation per coordinating sub (top of the roster).
  const directs: DirectMessage[] = [];
  const dmViewEntries: (readonly [string, ChannelView])[] = [];
  for (const s of subRes.rows.slice(0, 6)) {
    const key = dmKey(s.slug);
    const firstName = s.name.split(/\s+/)[0];
    const initials = initialsOf(s.name);
    directs.push({
      key,
      initials,
      name: `${firstName} · ${s.trade}`,
      online: s.fav,
      unread: unreadFor(key) || undefined,
    });
    dmViewEntries.push([
      key,
      buildDmView(
        { key, fullName: s.name, initials, trade: s.trade },
        byChannel.get(key) ?? [],
      ),
    ]);
  }

  return {
    channels: withUnread(CHANNELS),
    rooms: withUnread(ROOMS),
    directs,
    views: Object.fromEntries([...viewEntries, ...dmViewEntries]),
    roster,
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

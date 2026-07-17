// Team-chat data builder. Fully DB-backed: bare channels are owner-managed rows
// in chat_channels (P1-D1 — create/remove at runtime, no more hardcoded list),
// project rooms derive from active projects, DMs from the sub roster. Sub
// membership lives in chat_members; AI membership is independent, per-channel,
// in chat_ai_members — an AI model only responds to an @model_name mention in a
// bare channel if it's a member there. AI posts are generated through the ai
// service abstraction (lib/actions/chat.ts) — never a provider directly.

import { query } from "./db";
import type { DevAgent } from "./dev-agents-meta";

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
  /** Sub members (owner is implicit, not listed here). Empty for DMs. */
  members: ChannelMember[];
  /** AI models that respond in this channel (via @model_name). Rooms/DMs keep
   *  all three implicitly; bare channels list only their members. */
  aiMembers: DevAgent[];
  /** True for channels/rooms (editable sub membership); false for DMs. */
  canManageMembers: boolean;
  /** True only for bare channels — AI membership is editable there. Rooms/DMs
   *  keep AI implicit, so their popover has no AI section. */
  canManageAi: boolean;
  /** Day-separator chip, e.g. "Today · Mon May 25". */
  daySeparator: string;
  messages: ChatMessage[];
}

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

/** Every AI model — the implicit set rooms and DMs use, and the add-picker's
 *  full option list for bare channels. */
const ALL_AGENTS: DevAgent[] = ["claude", "qwen", "hermes"];

function buildView(
  ch: ChatChannel,
  rows: MessageRow[],
  members: ChannelMember[],
  aiMembers: DevAgent[],
): ChannelView {
  // A bare channel (no `room:`/`dm:` prefix) has owner-editable AI membership;
  // project rooms keep all models implicitly.
  const isBare = !ch.key.includes(":");
  // Avatar stack = owner (JS) + sub members + one AI chip if any model is in.
  const participants = [
    "JS",
    ...members.map((m) => m.initials),
    ...(aiMembers.length ? ["AI"] : []),
  ];

  return {
    key: ch.key,
    name: ch.name,
    description: ch.description ?? "Team channel",
    participants: participants.slice(0, 6),
    members,
    aiMembers,
    canManageMembers: true,
    canManageAi: isBare,
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
    // DMs keep AI implicitly invocable (unchanged) but expose no membership UI.
    aiMembers: ALL_AGENTS,
    canManageMembers: false,
    canManageAi: false,
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
  const [msgRes, readRes, subRes, memberRes, aiMemberRes, channelRes, roomRes] =
    await Promise.all([
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
      query<{ channel_key: string; agent: DevAgent }>(
        `SELECT channel_key, agent FROM chat_ai_members`,
      ),
      // Owner-managed bare channels (P1-D1) — replaces the old hardcoded list.
      // Archived channels are hidden; their transcripts remain in chat_messages.
      query<{ key: string; name: string; description: string }>(
        `SELECT key, name, description FROM chat_channels
          WHERE archived_at IS NULL
          ORDER BY sort_order, created_at, key`,
      ),
      // Project rooms = one per project with active site work (construction /
      // closeout), most-progressed first.
      query<{ slug: string; name: string }>(
        `SELECT slug, name FROM projects
        WHERE status IN ('construction', 'closeout')
        ORDER BY progress DESC, name ASC
        LIMIT 12`,
      ),
    ]);

  const CHANNELS: ChatChannel[] = channelRes.rows.map((c) => ({
    key: c.key,
    name: `# ${c.name}`,
    description: c.description || undefined,
  }));

  const ROOMS: ChatChannel[] = roomRes.rows.map((p) => ({
    key: roomKey(p.slug),
    name: `# ${p.name}`,
    description: `Project room · ${p.name}`,
  }));
  const all = [...CHANNELS, ...ROOMS];

  // channel_key → its AI members (bare channels only carry rows here).
  const aiByChannel = new Map<string, DevAgent[]>();
  for (const r of aiMemberRes.rows) {
    const list = aiByChannel.get(r.channel_key) ?? [];
    list.push(r.agent);
    aiByChannel.set(r.channel_key, list);
  }
  // Rooms keep all models implicitly; bare channels use their stored set.
  const aiMembersFor = (ch: ChatChannel): DevAgent[] =>
    ch.key.includes(":") ? ALL_AGENTS : aiByChannel.get(ch.key) ?? [];

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
        buildView(
          ch,
          byChannel.get(ch.key) ?? [],
          membersByChannel.get(ch.key) ?? [],
          aiMembersFor(ch),
        ),
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
    selectedKey: CHANNELS[0]?.key ?? ROOMS[0]?.key ?? directs[0]?.key ?? "",
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
        AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
        AND NOT EXISTS (
          SELECT 1 FROM chat_channels c
           WHERE c.key = m.channel_key AND c.archived_at IS NOT NULL
        )`,
  );
  return Number(rows[0]?.n ?? 0);
}

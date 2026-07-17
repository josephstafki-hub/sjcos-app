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

/** Entity-room channel-key conventions (P1-D2). One room per open case; the
 *  stored set lives in chat_rooms. Project rooms keep the bare `room:<slug>`
 *  form so transcripts/membership from the old derived era stay addressable;
 *  leads and warranties get their own namespaces. All contain ":", so the AI
 *  gate treats every room as "all models implicit". */
export const roomKey = (slug: string) => `room:${slug}`;
export const leadRoomKey = (slug: string) => `room:lead:${slug}`;
export const warrantyRoomKey = (slug: string) => `room:wty:${slug}`;

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
export function initialsOf(name: string): string {
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

/** An internal SJC staff member who can be a channel member — the team roster,
 *  independent of subs (P1-D1). Display-only, no login (chat stays owner-run). */
export interface TeamMember {
  slug: string;
  name: string;
  initials: string;
  /** e.g. "Office manager" — the team analog of a sub's trade. */
  roleLabel: string;
}

/** A client manually added to an entity room (P1-D2). Create-only, room-scoped
 *  (no clients table / shared pool); display membership only — no delivery. */
export interface ClientMember {
  id: number;
  name: string;
  email: string;
  initials: string;
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
  /** Internal-team members (owner is implicit, not listed here). Empty for DMs. */
  teamMembers: TeamMember[];
  /** Manually-added client participants (entity rooms only). Empty elsewhere. */
  clientMembers: ClientMember[];
  /** AI models that respond in this channel (via @model_name). Rooms/DMs keep
   *  all three implicitly; bare channels list only their members. */
  aiMembers: DevAgent[];
  /** True for channels/rooms (editable sub membership); false for DMs. */
  canManageMembers: boolean;
  /** True only for bare channels — AI membership is editable there. Rooms/DMs
   *  keep AI implicit, so their popover has no AI section. */
  canManageAi: boolean;
  /** True only for entity rooms (`room:` keys) — where clients can be added. */
  canManageClients: boolean;
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
  /** Every active team member — the pool the add-teammate picker draws from. */
  teamRoster: TeamMember[];
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
  teamMembers: TeamMember[],
  clientMembers: ClientMember[],
  aiMembers: DevAgent[],
): ChannelView {
  // A bare channel (no `room:`/`dm:` prefix) has owner-editable AI membership;
  // project rooms keep all models implicitly. Clients can be added only in
  // entity rooms (`room:` keys), never bare channels or DMs.
  const isBare = !ch.key.includes(":");
  const isRoom = ch.key.startsWith("room:");
  // Avatar stack = owner (JS) + team members + sub members + client members +
  // one AI chip if any model is in. Team leads (internal staff) sit closest to
  // the owner, clients last before the AI chip.
  const participants = [
    "JS",
    ...teamMembers.map((m) => m.initials),
    ...members.map((m) => m.initials),
    ...clientMembers.map((m) => m.initials),
    ...(aiMembers.length ? ["AI"] : []),
  ];

  return {
    key: ch.key,
    name: ch.name,
    description: ch.description ?? "Team channel",
    participants: participants.slice(0, 6),
    members,
    teamMembers,
    clientMembers,
    aiMembers,
    canManageMembers: true,
    canManageAi: isBare,
    canManageClients: isRoom,
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
    teamMembers: [],
    clientMembers: [],
    // DMs keep AI implicitly invocable (unchanged) but expose no membership UI.
    aiMembers: ALL_AGENTS,
    canManageMembers: false,
    canManageAi: false,
    canManageClients: false,
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
  const [
    msgRes,
    readRes,
    subRes,
    memberRes,
    aiMemberRes,
    channelRes,
    roomRes,
    roomClientRes,
    teamRes,
    teamMemberRes,
  ] = await Promise.all([
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
      // Entity rooms (P1-D2) — persistent, one per open lead/project/warranty
      // case, newest first. Auto-opened on entity create, closed_at set on
      // lost/completed/closed (closed rooms drop out here, transcript kept).
      query<{ key: string; name: string; entity_type: "lead" | "project" | "warranty" }>(
        `SELECT key, name, entity_type FROM chat_rooms
          WHERE closed_at IS NULL
          ORDER BY opened_at DESC`,
      ),
      // Manually-added client participants per room (P1-D2).
      query<{ id: number; room_key: string; name: string; email: string }>(
        `SELECT id, room_key, name, email FROM chat_room_clients`,
      ),
      // The internal-team roster (active only) — drives the add-teammate picker.
      query<{ slug: string; name: string; role_label: string }>(
        `SELECT slug, name, role_label FROM team_members WHERE active ORDER BY name ASC`,
      ),
      query<{ channel_key: string; member_slug: string }>(
        `SELECT channel_key, member_slug FROM chat_team_members`,
      ),
    ]);

  const CHANNELS: ChatChannel[] = channelRes.rows.map((c) => ({
    key: c.key,
    name: `# ${c.name}`,
    description: c.description || undefined,
  }));

  const roomDescription = (entityType: "lead" | "project" | "warranty", name: string): string => {
    if (entityType === "lead") return `Lead room · ${name}`;
    if (entityType === "warranty") return `Warranty room · ${name}`;
    return `Project room · ${name}`;
  };
  const ROOMS: ChatChannel[] = roomRes.rows.map((r) => ({
    key: r.key,
    name: `# ${r.name}`,
    description: roomDescription(r.entity_type, r.name),
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

  // Team roster, keyed by slug (mirrors the sub roster).
  const teamRoster: TeamMember[] = teamRes.rows.map((t) => ({
    slug: t.slug,
    name: t.name,
    initials: initialsOf(t.name),
    roleLabel: t.role_label,
  }));
  const teamBySlug = new Map(teamRoster.map((m) => [m.slug, m]));

  // channel_key → its team members (resolved against the team roster). A
  // deactivated teammate drops out here because teamBySlug won't have them.
  const teamByChannel = new Map<string, TeamMember[]>();
  for (const r of teamMemberRes.rows) {
    const m = teamBySlug.get(r.member_slug);
    if (!m) continue;
    const list = teamByChannel.get(r.channel_key) ?? [];
    list.push(m);
    teamByChannel.set(r.channel_key, list);
  }

  // room_key → its manually-added client participants (P1-D2).
  const clientsByRoom = new Map<string, ClientMember[]>();
  for (const r of roomClientRes.rows) {
    const list = clientsByRoom.get(r.room_key) ?? [];
    list.push({ id: r.id, name: r.name, email: r.email, initials: initialsOf(r.name) });
    clientsByRoom.set(r.room_key, list);
  }

  const viewEntries = all.map(
    (ch) =>
      [
        ch.key,
        buildView(
          ch,
          byChannel.get(ch.key) ?? [],
          membersByChannel.get(ch.key) ?? [],
          teamByChannel.get(ch.key) ?? [],
          clientsByRoom.get(ch.key) ?? [],
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
    teamRoster,
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
        )
        AND NOT EXISTS (
          SELECT 1 FROM chat_rooms rm
           WHERE rm.key = m.channel_key AND rm.closed_at IS NOT NULL
        )`,
  );
  return Number(rows[0]?.n ?? 0);
}

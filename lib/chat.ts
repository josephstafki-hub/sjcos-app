// Team-chat data builder. Fully DB-backed: bare channels are owner-managed rows
// in chat_channels (P1-D1 — create/remove at runtime, no more hardcoded list),
// project rooms derive from active projects, DMs from the sub roster. Sub
// membership lives in chat_members; AI membership is independent, per-channel,
// in chat_ai_members — an AI model only responds to an @model_name mention in a
// bare channel if it's a member there. AI posts are generated through the ai
// service abstraction (lib/actions/chat.ts) — never a provider directly.
//
// ─── Who sees what (staff logins, 2026-09-27) ────────────────────────────────
//
// This was built when the owner was the only login, and it showed: one global
// read marker, a hardcoded "JS" in every avatar stack, and a team roster of
// display-only names with no accounts behind them. All three are now per-person.
//
//   channels  owner and staff both see every open bare channel — a team channel
//             is the company's noticeboard (Joe's call, 2026-09-27).
//   rooms     a lead/project/warranty room is per-job, so staff see only the
//             ones they've been added to (chat_team_members).
//   DMs       you see a DM you're a party to. Staff↔staff conversations are new
//             and use a sorted pair key; owner↔person keeps the original
//             single-slug form so every existing transcript stays addressable.
//   sub and client DMs are the owner's: a `dm:<sub>` IS that sub's live portal
//             thread, and client DMs deliver through the gated outbox. Neither
//             is internal chat, so neither appears on a staff rail.
//   managing  creating/archiving channels, adding subs or clients, moving AI
//             membership, and releasing portal deliveries stay owner-only.

import { query } from "./db";
import type { DevAgent } from "./dev-agents-meta";
import { listQueuedDeliveries, type PortalOutboxItem } from "./portal-delivery";

export type { PortalOutboxItem };

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

/** DM channel-key conventions (P1-D3). One conversation per person in the shared
 *  chat_messages/chat_reads_by_user tables. Subs keep the bare `dm:<slug>` form
 *  (backward-compatible with existing transcripts and the sub portal, which
 *  writes there); team members and clients get their own namespaces. Every DM
 *  key contains ":" (so the AI gate keeps all models implicit) and starts with
 *  "dm:" (so the membership UI stays off) — no gate changes needed. Slugs are
 *  `[a-z0-9-]` only, so `dm:team:` / `dm:client:` can never collide with a bare
 *  sub key. */
export {
  dmKey,
  dmTeamKey,
  dmClientKey,
  internalDmKey,
  teamDmParties,
  dmSlug,
} from "./dm-keys";
export type { ChatViewer } from "./dm-keys";
import { dmKey, dmSlug, dmTeamKey, teamDmParties, type ChatViewer } from "./dm-keys";

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
  /** True when the signed-in person wrote it. `kind` is about WHO (owner posts
   *  render in the accent colour whoever is reading), so it can't answer this —
   *  hence author_user_id on chat_messages. False for every pre-staff row and
   *  every portal/AI write, which is right: nobody wrote those as themselves. */
  mine?: boolean;
}

/** A sub who can be a channel member (also the shape of the add-picker roster). */
export interface ChannelMember {
  slug: string;
  name: string;
  initials: string;
  trade: string;
}

/** An internal SJC person who can be a channel member — the team roster,
 *  independent of subs (P1-D1). A row may or may not have a login behind it:
 *  `hasLogin` rows are real accounts (team_members.user_id), and only those can
 *  hold up their end of a DM or read a channel themselves. The rest are still
 *  display-only names, exactly as the roster started. */
export interface TeamMember {
  slug: string;
  name: string;
  initials: string;
  /** e.g. "Office manager" — the team analog of a sub's trade. */
  roleLabel: string;
  /** True when this roster entry is a signed-in-able account. */
  hasLogin?: boolean;
}

/** A client option for the DM person-lookup (P1-D3). There is no clients table,
 *  so this roster is derived from projects + open leads. Slug is a slugified
 *  name (the DM key is `dm:client:<slug>`); subtitle is a flat "Client". */
export interface DmClientOption {
  slug: string;
  name: string;
  initials: string;
  subtitle: string;
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
  /** True for channels/rooms the VIEWER may edit membership on. Owner-only:
   *  who is in a channel is a company decision. */
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
  /** Client options (derived from projects + open leads) for the DM
   *  person-lookup (P1-D3). Subs come from `roster`, team from `teamRoster`. */
  clientRoster: DmClientOption[];
  /** Queued portal deliveries awaiting the owner's Release/Skip (P1-D4). Every
   *  team-chat message bound for a sub/client portal is parked here first. */
  portalOutbox: PortalOutboxItem[];
  /** Channel selected on first paint. */
  selectedKey: string;
  /** The signed-in person, for the optimistic local echo when they post (the
   *  client used to hardcode Joe's name and initials there). */
  me: { name: string; initials: string; isOwner: boolean };
  /** Owner-only surfaces: the portal outbox, channel create/archive, the sub
   *  and client pickers. False for staff, who get channels, rooms and DMs. */
  canManage: boolean;
}

interface MessageRow {
  channel_key: string;
  author_kind: MessageKind;
  author_name: string;
  author_initials: string;
  author_user_id: string | null;
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

/** Did THIS viewer write this message?
 *
 *  author_user_id is the answer for anything written since staff logins. Every
 *  row that predates them has it NULL, and an `owner`-kind row among those was
 *  Joe's by definition — the migration backfills them, and this covers any that
 *  slip through (or any writer that forgets the column). Without it Joe's own
 *  history, including his replies in client portal threads, would come back as
 *  unread against him. */
function isMine(r: { author_user_id: string | null; author_kind: MessageKind }, viewer: ChatViewer): boolean {
  if (r.author_user_id) return r.author_user_id === viewer.id;
  return r.author_kind === "owner" && viewer.role === "owner";
}

function rowToMessage(r: MessageRow, viewer: ChatViewer): ChatMessage {
  return {
    initials: r.author_initials || (r.author_kind === "ai" ? "AI" : "?"),
    name: r.author_name,
    time: clockTime(new Date(r.created_at)),
    text: r.body,
    kind: r.author_kind,
    system: r.author_kind === "ai",
    mine: isMine(r, viewer),
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
  viewer: ChatViewer,
  ownerInitials: string,
): ChannelView {
  // A bare channel (no `room:`/`dm:` prefix) has owner-editable AI membership;
  // project rooms keep all models implicitly. Clients can be added only in
  // entity rooms (`room:` keys), never bare channels or DMs.
  const isBare = !ch.key.includes(":");
  const isRoom = ch.key.startsWith("room:");
  const canManage = viewer.role === "owner";
  // Avatar stack = the owner (his real initials, not a hardcoded "JS") + team
  // members + sub members + client members + one AI chip if any model is in.
  // Team leads (internal staff) sit closest to the owner, clients last before
  // the AI chip.
  const participants = [
    ownerInitials,
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
    canManageMembers: canManage,
    canManageAi: isBare && canManage,
    canManageClients: isRoom && canManage,
    daySeparator: `Today · ${new Date().toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })}`,
    messages: rows.map((r) => rowToMessage(r, viewer)),
  };
}

/** A DM is a private one-to-one room. Unlike channels, the AI isn't a member,
 *  so the participant stack is just the owner + the sub. */
function buildDmView(
  d: { key: string; fullName: string; initials: string; subtitle: string },
  rows: MessageRow[],
  viewer: ChatViewer,
): ChannelView {
  return {
    key: d.key,
    name: d.fullName,
    description: `Direct message · ${d.subtitle}`,
    // The stack is the two people in the conversation: whoever is reading, and
    // the other end. (Was a hardcoded "JS" — correct only for Joe.)
    participants: [viewer.initials || "?", d.initials],
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
    messages: rows.map((r) => rowToMessage(r, viewer)),
  };
}

interface DmSubRow {
  slug: string;
  name: string;
  trade: string;
  fav: boolean;
}

export async function getChatData(viewer: ChatViewer): Promise<ChatData> {
  const isOwner = viewer.role === "owner";
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
    dmRes,
    clientRosterRes,
  ] = await Promise.all([
      query<MessageRow>(
        `SELECT channel_key, author_kind, author_name, author_initials, author_user_id, body, created_at
       FROM chat_messages ORDER BY created_at ASC`,
      ),
      // This viewer's own read markers. Keyed on (channel_key, user_id) now, so
      // a staff member opening #safety no longer clears Joe's badge.
      query<{ channel_key: string; last_read_at: Date }>(
        `SELECT channel_key, last_read_at FROM chat_reads_by_user WHERE user_id = $1`,
        [viewer.id],
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
      // The internal-team roster (active only) — drives the add-teammate picker
      // and, for the rows linked to a login, the internal DM list.
      query<{ slug: string; name: string; role_label: string; user_id: string | null; user_role: string | null }>(
        `SELECT t.slug, t.name, t.role_label, t.user_id, u.role AS user_role
           FROM team_members t
           LEFT JOIN users u ON u.id = t.user_id AND u.active
          WHERE t.active ORDER BY t.name ASC`,
      ),
      query<{ channel_key: string; member_slug: string }>(
        `SELECT channel_key, member_slug FROM chat_team_members`,
      ),
      // Owner-opened DMs (P1-D3) — persistent so a DM to a non-top-6 person
      // survives reload before its first message. Newest first.
      query<{ key: string; party_type: "sub" | "team" | "client"; party_slug: string; name: string; subtitle: string }>(
        `SELECT key, party_type, party_slug, name, subtitle FROM chat_dms ORDER BY opened_at DESC`,
      ),
      // Client roster for the DM person-lookup (P1-D3). No clients table, so
      // derive from project homeowners + open, un-converted leads (mirrors the
      // room-backfill predicate). Deduped by slug below.
      query<{ name: string }>(
        `SELECT DISTINCT client_name AS name FROM projects WHERE client_name <> ''
          UNION
         SELECT l.name FROM leads l
          WHERE l.stage <> 'lost'
            AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = l.id)`,
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

  // Unread = messages in this channel, after MY last-read marker, that I didn't
  // write. The old rule was `author_kind !== 'owner'`, which only reads correctly
  // for Joe: it counted a staff member's own posts against them, and never
  // counted Joe's messages to them at all — so a DM from the owner arrived with
  // no badge.
  const unreadFor = (key: string): number => {
    const since = lastRead.get(key);
    return (byChannel.get(key) ?? []).filter(
      (r) => !isMine(r, viewer) && (!since || new Date(r.created_at) > since),
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
    // Requires the joined users row, which the query filters to active — a
    // disabled account drops back to a display-only roster name rather than
    // staying a DM target nobody can answer from.
    hasLogin: Boolean(t.user_id && t.user_role),
  }));
  const teamBySlug = new Map(teamRoster.map((m) => [m.slug, m]));
  // The owner's roster slug — needed to read a single-slug `dm:team:<x>` key,
  // which means "owner ↔ x".
  const ownerSlug = teamRes.rows.find((t) => t.user_role === "owner")?.slug ?? null;

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

  // Rooms a staff member may open: only the ones they've been added to. A
  // lead/project/warranty room carries one job's whole conversation, so it is
  // not company-wide the way a bare channel is (Joe, 2026-09-27).
  const myRoomKeys = new Set(
    viewer.teamSlug
      ? teamMemberRes.rows.filter((r) => r.member_slug === viewer.teamSlug).map((r) => r.channel_key)
      : [],
  );
  const visibleRooms = isOwner ? ROOMS : ROOMS.filter((r) => myRoomKeys.has(r.key));
  const visible = [...CHANNELS, ...visibleRooms];

  const ownerInitials =
    (isOwner ? viewer.initials : null) ||
    (ownerSlug ? teamBySlug.get(ownerSlug)?.initials : null) ||
    "JS";

  const viewEntries = visible.map(
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
          viewer,
          ownerInitials,
        ),
      ] as const,
  );

  // Direct messages — the top-of-roster subs (derived, always shown) plus every
  // owner-opened DM in chat_dms (P1-D3). A DM added to both is deduped by key.
  const directs: DirectMessage[] = [];
  const dmViewEntries: (readonly [string, ChannelView])[] = [];
  const seenDm = new Set<string>();
  const pushDm = (
    key: string,
    fullName: string,
    subtitle: string,
    online: boolean,
  ) => {
    if (seenDm.has(key)) return;
    seenDm.add(key);
    const firstName = fullName.split(/\s+/)[0];
    const initials = initialsOf(fullName);
    directs.push({
      key,
      initials,
      name: `${firstName} · ${subtitle}`,
      online,
      unread: unreadFor(key) || undefined,
    });
    dmViewEntries.push([
      key,
      buildDmView({ key, fullName, initials, subtitle }, byChannel.get(key) ?? [], viewer),
    ]);
  };

  /** Am I one of the two people in this `dm:team:…` conversation?
   *
   *  Applied to the OWNER too, on purpose. Two staff members' DM is not Joe's
   *  conversation: listing it on his rail would both intrude and mislabel
   *  itself (a pair key has no "the other person" from his side). He keeps every
   *  DM he is actually in. */
  const iAmPartyTo = (key: string): boolean => {
    const parties = teamDmParties(key, ownerSlug);
    if (viewer.teamSlug) return parties.includes(viewer.teamSlug);
    // Owner with no roster row yet (a DB the migration hasn't touched): the
    // single-slug form means "owner ↔ x", so it is his by definition.
    return isOwner && !key.slice("dm:team:".length).includes("+");
  };

  if (isOwner) {
    // Sub DMs stay the owner's: `dm:<slug>` IS that sub's live portal thread.
    for (const s of subRes.rows.slice(0, 6)) {
      pushDm(dmKey(s.slug), s.name, s.trade, s.fav);
    }
  } else {
    // A staff member always has a way to reach Joe, even before the DM exists —
    // otherwise their rail is empty until he messages them first.
    if (viewer.teamSlug && ownerSlug && viewer.teamSlug !== ownerSlug) {
      const owner = teamBySlug.get(ownerSlug);
      pushDm(dmTeamKey(viewer.teamSlug), owner?.name ?? "Joe", owner?.roleLabel || "Owner", false);
    }
  }
  // Persisted DMs. Subs/team resolve fresh display data from the roster when the
  // person still exists (a favourited sub shows online); otherwise fall back to
  // the denormalized columns so a deleted sub / deactivated teammate still lists.
  const subBySlug = new Map(subRes.rows.map((s) => [s.slug, s]));
  for (const d of dmRes.rows) {
    if (d.party_type === "sub") {
      // Sub and client DMs are outward-facing (portal thread / gated outbox), so
      // they are not part of internal chat and never list for staff.
      if (!isOwner) continue;
      const s = subBySlug.get(d.party_slug);
      pushDm(d.key, s?.name ?? d.name, s?.trade ?? d.subtitle, s?.fav ?? false);
    } else if (d.party_type === "team") {
      if (!iAmPartyTo(d.key)) continue;
      // Label a DM with the OTHER person, not with whoever the row was opened
      // against: `dm:team:marco` reads as "Marco" to Joe and as "Joe" to Marco.
      const otherSlug =
        teamDmParties(d.key, ownerSlug).find((x) => x !== viewer.teamSlug) ?? d.party_slug;
      const t = teamBySlug.get(otherSlug);
      pushDm(d.key, t?.name ?? d.name, t?.roleLabel || d.subtitle || "Team", false);
    } else {
      if (!isOwner) continue;
      pushDm(d.key, d.name, d.subtitle || "Client", false);
    }
  }

  // Safety net: any internal DM that has messages but no chat_dms row still
  // lists. A conversation that exists in the transcript and not on the rail is
  // the worst failure mode here — the message is delivered and invisible — so
  // don't let a missing bookkeeping row cause it.
  for (const key of byChannel.keys()) {
    if (!key.startsWith("dm:team:") || seenDm.has(key)) continue;
    if (!iAmPartyTo(key)) continue;
    const otherSlug = teamDmParties(key, ownerSlug).find((x) => x !== viewer.teamSlug);
    const t = otherSlug ? teamBySlug.get(otherSlug) : undefined;
    pushDm(key, t?.name ?? otherSlug ?? "Teammate", t?.roleLabel || "Team", false);
  }

  // Client roster for the person-lookup, deduped by slug.
  const clientRoster: DmClientOption[] = [];
  const seenClient = new Set<string>();
  for (const c of clientRosterRes.rows) {
    const name = c.name.trim();
    if (!name) continue;
    const slug = dmSlug(name);
    if (!slug || seenClient.has(slug)) continue;
    seenClient.add(slug);
    clientRoster.push({ slug, name, initials: initialsOf(name), subtitle: "Client" });
  }
  clientRoster.sort((a, b) => a.name.localeCompare(b.name));

  // The portal outbox is the gated outbound (P1-D4) — Release pushes a message
  // to a real client or sub. Owner's decision alone, so staff don't even receive
  // the queue.
  const portalOutbox = isOwner ? await listQueuedDeliveries() : [];

  return {
    channels: withUnread(CHANNELS),
    rooms: withUnread(visibleRooms),
    directs,
    views: Object.fromEntries([...viewEntries, ...dmViewEntries]),
    // The sub roster and the client lookup drive owner-only pickers.
    roster: isOwner ? roster : [],
    // Staff pick from people who can actually sign in — a display-only roster
    // name has no inbox to DM.
    teamRoster: isOwner ? teamRoster : teamRoster.filter((m) => m.hasLogin && m.slug !== viewer.teamSlug),
    clientRoster: isOwner ? clientRoster : [],
    portalOutbox,
    selectedKey: CHANNELS[0]?.key ?? visibleRooms[0]?.key ?? directs[0]?.key ?? "",
    me: { name: viewer.name, initials: viewer.initials || "?", isOwner },
    canManage: isOwner,
  };
}

/** Total unread chat messages for THIS user's nav badge: messages someone else
 *  wrote, after their own last-read marker, in a channel they can open.
 *
 *  Both halves used to be global — one read marker for everyone, and "from
 *  others" meant "not from the owner" — so the badge was Joe's number shown to
 *  whoever was looking. */
export async function getUnreadChatCount(userId: string): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `SELECT count(*) AS n
       FROM chat_messages m
       LEFT JOIN chat_reads_by_user r ON r.channel_key = m.channel_key AND r.user_id = $1
      -- "Not mine" — see isMine() above. The second arm keeps Joe's pre-staff
      -- history (his portal replies especially) from counting against him.
      --
      -- IS NOT DISTINCT FROM rather than plain equality: author_user_id is NULL
      -- on every message written before the column existed, and on every
      -- client/sub portal post. Comparing NULL with = yields NULL, so a plain
      -- NOT(...) around it evaluates to NULL and the row is dropped — which
      -- silently emptied the badge of exactly the client messages it exists to
      -- surface (21 to 0 on Joe's real data).
      WHERE NOT (
              m.author_user_id IS NOT DISTINCT FROM $1::uuid
              OR (m.author_user_id IS NULL AND m.author_kind = 'owner'
                  AND EXISTS (SELECT 1 FROM users o WHERE o.id = $1 AND o.role = 'owner'))
            )
        AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
        AND NOT EXISTS (
          SELECT 1 FROM chat_channels c
           WHERE c.key = m.channel_key AND c.archived_at IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM chat_rooms rm
           WHERE rm.key = m.channel_key AND rm.closed_at IS NOT NULL
        )
        -- Only channels this person actually sees, or the badge promises unread
        -- behind a door that won't open: bare channels are everyone's, rooms
        -- need membership, and a DM needs them to be a party to it.
        AND (
          position(':' in m.channel_key) = 0
          OR EXISTS (SELECT 1 FROM users u WHERE u.id = $1 AND u.role = 'owner')
          OR EXISTS (
            SELECT 1 FROM chat_team_members tm
              JOIN team_members t ON t.slug = tm.member_slug
             WHERE tm.channel_key = m.channel_key AND t.user_id = $1
          )
          OR EXISTS (
            -- Their DMs: 'dm:team:<them>' is the owner↔them conversation, and
            -- 'dm:team:<a>+<b>' is a staff pair. Anchored on both sides so a
            -- slug that merely CONTAINS theirs can't match.
            SELECT 1 FROM team_members t
             WHERE t.user_id = $1
               AND (m.channel_key = 'dm:team:' || t.slug
                    OR m.channel_key LIKE 'dm:team:' || t.slug || '+%'
                    OR m.channel_key LIKE 'dm:team:%+' || t.slug)
          )
        )`,
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Resolve the signed-in account into a ChatViewer, looking up their roster slug
 *  (the DM identity). A login with no team_members row gets channels only. */
export async function chatViewerFor(user: {
  id: string;
  name: string;
  role: string;
  initials: string;
}): Promise<ChatViewer> {
  const { rows } = await query<{ slug: string }>(
    `SELECT slug FROM team_members WHERE user_id = $1 AND active`,
    [user.id],
  );
  return { ...user, teamSlug: rows[0]?.slug ?? null };
}

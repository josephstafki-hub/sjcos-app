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

/** Curated transcript for the showcase channel. */
const FIELD_DAILY: ChannelView = {
  key: "field-daily",
  name: "# field-daily",
  description: "Daily check-ins from active sites · Claude pins what's blocking",
  participants: ["JS", "MR", "TS", "BP"],
  daySeparator: "Today · Mon May 25",
  messages: [
    {
      initials: "MR",
      name: "Marco",
      time: "7:48am",
      kind: "user",
      text: "On Henderson at 12:30 — bringing the 1/4 trowel for the mosaic strip. Need the access code again?",
    },
    {
      initials: "JS",
      name: "Joe",
      time: "7:51am",
      kind: "owner",
      text: "Code is 4429. I'll be on site at noon for the QC walk.",
    },
    {
      initials: "CL",
      name: "Claude",
      time: "8:02am",
      kind: "ai",
      system: true,
      text: "Pinned to #henderson-kitchen: tile pre-install QC checklist + Friday flatness photo. Marco — that soft spot at the pantry threshold is your watch-out.",
    },
    {
      initials: "TS",
      name: "Tomas",
      time: "8:14am",
      kind: "user",
      text: "Pham bid sent. Let me know if you want me to walk Joe through the load calc.",
    },
    {
      initials: "JS",
      name: "Joe",
      time: "8:32am",
      kind: "owner",
      text: "@claude what's outstanding on Olson for the Tues walk?",
    },
    {
      initials: "CL",
      name: "Claude",
      time: "8:32am",
      kind: "ai",
      system: true,
      text: "4 punch items remain — all minor. Paint touch-up by Brad (Mon EOD), trim caulk SW corner, replace one cabinet pull (back-ordered, ETA Tues AM), check vent dampener. I can confirm the dampener now if you want.",
    },
  ],
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

/** Generic fallback view for channels without a curated transcript. */
function buildGenericView(ch: ChatChannel): ChannelView {
  return {
    key: ch.key,
    name: ch.name,
    description: "Claude is watching this channel and will flag anything that needs you.",
    participants: ["JS", "CL"],
    daySeparator: "Today · Mon May 25",
    messages: [
      {
        initials: "CL",
        name: "Claude",
        time: "8:00am",
        kind: "ai",
        system: true,
        text: `Watching ${ch.name} — I'll surface anything that needs a decision, money items, or a mention here.`,
      },
    ],
  };
}

export async function getChatData(): Promise<ChatData> {
  const all = [...CHANNELS, ...ROOMS];
  const viewEntries = all.map(
    (ch) => [ch.key, ch.key === "field-daily" ? FIELD_DAILY : buildGenericView(ch)] as const,
  );

  return {
    channels: CHANNELS,
    rooms: ROOMS,
    directs: DIRECTS,
    views: Object.fromEntries(viewEntries),
    selectedKey: "field-daily",
  };
}

/** Total unread chat messages for the nav badge. Chat is UI-only today (no
 *  table), so this is 0; it returns a real DB count once chat is persisted. */
export async function getUnreadChatCount(): Promise<number> {
  return 0;
}

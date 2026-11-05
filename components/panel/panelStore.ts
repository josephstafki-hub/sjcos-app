import { CLAUDE_DEFAULTS, type ClaudeOptions, type PanelAgent } from "@/lib/dev-agents-meta";
import { postPanelMessage, subscribePanelBus } from "./panelBus";

/**
 * The universal panel's persisted state — successor to both
 * components/ai/threadMemory.ts and components/cmdk/commandBarStore.ts.
 *
 * Those were module-scope Maps: they survived soft navigation but died on hard
 * refresh and, crucially, were invisible to a second real browser window —
 * which the panel's popout mode requires. Web storage fixes both, and every
 * shared write is echoed on the panel bus so an open popout updates
 * immediately instead of waiting for a storage event.
 *
 * Only pointers live here (which conversation, which agent, layout prefs).
 * Transcripts and in-flight runs are DB-backed (ai_conversations,
 * dev_agent_runs) and reload via loadConversationAction — a reply that landed
 * while the panel was closed is simply there, and `pendingRunId` resumes the
 * poll. Never store message bodies here.
 *
 * ── Two scopes, on purpose ──────────────────────────────────────────────────
 * LAYOUT (width/collapsed/where) is shared across every tab and window in
 * localStorage: that's what makes every app window drop its dock when the
 * panel moves to the second monitor.
 *
 * SESSION (conversationId/agent/claude) is PER TAB, in sessionStorage. It used
 * to be shared, which meant a second tab adopted whatever thread the first tab
 * was on — and if that thread had a run in flight, the second tab resumed the
 * poll, went `pending`, and disabled its own composer, agent rail and model
 * picker. Runs are per-conversation rows server-side with no global lock, so
 * the only thing stopping Joe from putting Claude on one page and Hermes on
 * another was this record. Each tab now keeps its own pointer; a brand-new tab
 * (or the popout) seeds from the shared mirror below so "reopen the app and my
 * thread is there" still holds. The mirror only takes the keys a write
 * actually changed, so it holds the last agent/model Joe explicitly picked —
 * which is what a restart (fresh tab) comes back on.
 *
 * Same render-phase rule as the old stores: client components still
 * server-render, so reads/writes happen in effects and event handlers ONLY —
 * readPanelState() during render would touch window on the server and desync
 * hydration on the client.
 */

export interface PanelState {
  /** The open thread; null = fresh chat. Per tab. */
  conversationId: string | null;
  /** Per tab — so one page can be on Claude while another runs Hermes. */
  agent: PanelAgent;
  /** Per tab: model/mode/effort apply to the turns this tab sends. */
  claude: ClaudeOptions;
  /** Per tab: the thread rail is scoped to one folder (job); null = all.
   *  New chats started while scoped file under it. */
  folderId: string | null;
  /** Dock width in px (splitter). Shared. */
  width: number;
  /** Shared. */
  collapsed: boolean;
  /** "window" while the panel lives in a popped-out /panel window. Shared
   *  across tabs on purpose — that's what makes every app window drop its
   *  dock when the panel moves to the second monitor. */
  where: "docked" | "window";
  /** Let a live run steer the app view to what it's working on
   *  (LiveActionNav). Shared. Desktop only regardless — small screens never follow. */
  follow: boolean;
}

/** The per-tab slice of PanelState. */
export type PanelSession = Pick<PanelState, "conversationId" | "agent" | "claude" | "folderId">;

const SESSION_KEYS = ["conversationId", "agent", "claude", "folderId"] as const;
const LAYOUT_KEYS = ["width", "collapsed", "where", "follow"] as const;

export const PANEL_MIN_WIDTH = 320;
export const PANEL_MAX_WIDTH = 1000;
export const PANEL_DEFAULT_WIDTH = 420;

export const PANEL_DEFAULTS: PanelState = {
  conversationId: null,
  agent: "claude",
  claude: CLAUDE_DEFAULTS,
  folderId: null,
  width: PANEL_DEFAULT_WIDTH,
  collapsed: false,
  where: "docked",
  follow: true,
};

/** Shared: layout for every window, plus a mirror of the last session used —
 *  the seed a tab that has none of its own adopts on first mount. */
const KEY = "sjcos:panel:state:v1";
/** Per tab (sessionStorage): this tab's session. Survives reload, which is why
 *  a refresh mid-run still resumes the poll; dies with the tab. */
const SESSION_KEY = "sjcos:panel:session:v1";
/** Per tab (sessionStorage): stable id used to own conversation claims. */
const TAB_KEY = "sjcos:panel:tab:v1";
/** Shared: conversationId → which tab has it open, heartbeated. */
const CLAIMS_KEY = "sjcos:panel:claims:v1";
/** A claim older than this is from a tab that closed or slept — ignore it. The
 *  holder re-stamps every 5s (useAgentChat), so this is a generous 3 beats. */
const CLAIM_TTL_MS = 15_000;

/** "auto" is no longer offered for a fresh chat (Joe, 2026-11-05): a stored
 *  "auto" pick from before then falls to Claude. An older Auto *thread* still
 *  opens as Auto — openConversation takes the agent from the thread row. */
function pickAgent(a: unknown): PanelAgent {
  return a === "claude" || a === "qwen" || a === "hermes" ? a : PANEL_DEFAULTS.agent;
}

function readShared(): PanelState {
  if (typeof window === "undefined") return PANEL_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return PANEL_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    return {
      ...PANEL_DEFAULTS,
      ...parsed,
      agent: pickAgent(parsed.agent),
      claude: { ...CLAUDE_DEFAULTS, ...(parsed.claude ?? {}) },
    };
  } catch {
    return PANEL_DEFAULTS;
  }
}

function readTabSession(): PanelSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PanelSession>;
    return {
      conversationId: parsed.conversationId ?? null,
      // A tab sitting on an older Auto thread keeps "auto" until it reloads
      // that thread (which sets the agent from the row anyway).
      agent: parsed.agent === "auto" && parsed.conversationId ? "auto" : pickAgent(parsed.agent),
      claude: { ...CLAUDE_DEFAULTS, ...(parsed.claude ?? {}) },
      folderId: parsed.folderId ?? null,
    };
  } catch {
    return null;
  }
}

function writeTabSession(session: PanelSession): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Quota/private-mode failures degrade to in-memory-only for this tab.
  }
}

/** Merged view: shared layout + this tab's session (falling back to the shared
 *  mirror before the tab has adopted one). */
export function readPanelState(): PanelState {
  const shared = readShared();
  const session = readTabSession();
  return session ? { ...shared, ...session } : shared;
}

/** Merge-write. Safe to call from an async closure whose component has already
 *  unmounted — that's the point: a conversation created after the user
 *  navigated away still lands here (see the old commandBarStore
 *  setConversationRef comment for the fork this prevents).
 *
 *  Session keys go to this tab only (plus the shared mirror, as a seed for the
 *  next new tab); layout keys go to every window and are announced on the bus. */
export function writePanelState(patch: Partial<PanelState>): PanelState {
  const next = { ...readPanelState(), ...patch };
  if (typeof window === "undefined") return next;
  const touchesSession = SESSION_KEYS.some((k) => k in patch);
  const touchesLayout = LAYOUT_KEYS.some((k) => k in patch);
  if (touchesSession) {
    writeTabSession({
      conversationId: next.conversationId,
      agent: next.agent,
      claude: next.claude,
      folderId: next.folderId,
    });
    if ("conversationId" in patch) claimConversation(next.conversationId);
  }
  // The shared record takes ONLY the keys this write changed. It used to take
  // the whole merged state, so a tab that merely resized the dock (or opened a
  // thread) stamped its own model/mode/effort over the last one Joe actually
  // picked — and a restart, which seeds a fresh tab from this record, came
  // back on the wrong model. Now the seed is the last explicit choice.
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readShared(), ...patch }));
  } catch {
    // Quota/private-mode failures degrade to in-memory-only for this window.
  }
  // Only layout is other windows' business. Broadcasting session writes would
  // undo the whole point of the per-tab split.
  if (touchesLayout) postPanelMessage({ type: "state", state: next });
  return next;
}

/** Change notifications from other windows (bus) with a storage-event fallback
 *  for browsers without BroadcastChannel. Layout only — see writePanelState.
 *  Not fired for this window's own writes — callers already know their own
 *  state. */
export function subscribePanelState(cb: (state: PanelState) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const unBus = subscribePanelBus((m) => {
    if (m.type === "state") cb(m.state);
  });
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb(readPanelState());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    unBus();
    window.removeEventListener("storage", onStorage);
  };
}

// ─── Conversation claims ─────────────────────────────────────────────────────
// A thread should be live in one tab at a time. Nothing enforces that — opening
// the same thread twice just means two pollers and two copies of the same
// answer — but the *seed* respects it: a new tab must not silently land on the
// thread another tab is mid-run on, which is exactly the hijack this whole
// per-tab split exists to prevent.

type ClaimMap = Record<string, { tab: string; at: number }>;

function panelTabId(): string {
  try {
    const existing = window.sessionStorage.getItem(TAB_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID?.() ?? `tab-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    window.sessionStorage.setItem(TAB_KEY, id);
    return id;
  } catch {
    return "tab";
  }
}

function readClaims(): ClaimMap {
  try {
    const raw = window.localStorage.getItem(CLAIMS_KEY);
    return raw ? (JSON.parse(raw) as ClaimMap) : {};
  } catch {
    return {};
  }
}

/** Stamp this tab as the holder of `id` (null = holding nothing), dropping our
 *  previous claim and anyone's expired one. Called on every thread change and
 *  on a 5s heartbeat while a thread is open. */
export function claimConversation(id: string | null): void {
  if (typeof window === "undefined") return;
  const tab = panelTabId();
  const now = Date.now();
  const next: ClaimMap = {};
  for (const [cid, c] of Object.entries(readClaims())) {
    if (c.tab === tab) continue; // ours — only the current one is re-added
    if (now - c.at < CLAIM_TTL_MS) next[cid] = c;
  }
  if (id) next[id] = { tab, at: now };
  try {
    window.localStorage.setItem(CLAIMS_KEY, JSON.stringify(next));
  } catch {
    // Without the registry a new tab may seed onto a busy thread — the old
    // behaviour, not a crash.
  }
}

function isClaimedElsewhere(id: string): boolean {
  const c = readClaims()[id];
  return !!c && c.tab !== panelTabId() && Date.now() - c.at < CLAIM_TTL_MS;
}

/**
 * This tab's session, adopting one on first mount. A tab that already has one
 * (soft nav, reload) keeps it — including resuming its own in-flight run. A
 * fresh tab inherits the last-used agent and Claude options, and the last
 * thread UNLESS another live tab is holding it, in which case this tab starts a
 * new chat rather than hijacking a running one.
 *
 * Effects and handlers only (touches window) — see the file header.
 */
export function adoptPanelSession(): PanelSession {
  if (typeof window === "undefined") {
    const { conversationId, agent, claude, folderId } = PANEL_DEFAULTS;
    return { conversationId, agent, claude, folderId };
  }
  const existing = readTabSession();
  if (existing) {
    claimConversation(existing.conversationId);
    return existing;
  }
  const seed = readShared();
  const session: PanelSession = {
    conversationId:
      seed.conversationId && !isClaimedElsewhere(seed.conversationId) ? seed.conversationId : null,
    agent: seed.agent,
    claude: seed.claude,
    // Folder scope is a per-tab working context, never inherited.
    folderId: null,
  };
  writeTabSession(session);
  claimConversation(session.conversationId);
  return session;
}

// ─── Run-seen registry ───────────────────────────────────────────────────────
// The thread rail shows an unseen completion ("Done — unread" / "Failed") on a
// thread whose last run finished and hasn't been opened since, T3-style.
//
// Both halves live in localStorage — durable and shared by every tab/window of
// this browser. They used to be per tab (sessionStorage), which broke on a
// restart: a restored tab could come back with its old start time but none of
// the threads Joe had read in other tabs or the popout, so every recent chat
// lit up as unread. Opening a thread anywhere here now marks it read
// everywhere, and that survives a reload, a server restart and a browser
// restart. (The iPhone app keeps its own list — not synced to the browser.)

const SEEN_KEY = "sjcos:panel:seen:v2";
/** Per-tab list from before v2 — folded in once so nothing already read
 *  re-lights on the first load after the change. */
const SEEN_KEY_V1 = "sjcos:panel:seen:v1";
/** Every run id the panel has ever made is ~1k (2026-11); this keeps months. */
const SEEN_MAX = 2000;
/** Runs that finished before this browser first used the v2 registry are
 *  history, not news. Set once, never moved. */
const SINCE_KEY = "sjcos:panel:since:v2";

export function panelUnreadSince(): number {
  if (typeof window === "undefined") return Date.now();
  try {
    const raw = window.localStorage.getItem(SINCE_KEY);
    if (raw && Number.isFinite(Number(raw))) return Number(raw);
    const now = Date.now();
    window.localStorage.setItem(SINCE_KEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

function parseList(raw: string | null): string[] {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Parsed once per change: the rail asks isRunSeen() for every row on every
 *  render, so re-parsing a 2k-entry list each time would add up. */
let seenCache: { raw: string | null; list: string[]; set: Set<string> } | null = null;

function readSeen(): { list: string[]; set: Set<string> } {
  try {
    const legacy = parseList(window.sessionStorage.getItem(SEEN_KEY_V1));
    if (legacy.length) {
      const shared = parseList(window.localStorage.getItem(SEEN_KEY));
      const merged = [...legacy.filter((id) => !shared.includes(id)), ...shared].slice(-SEEN_MAX);
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(merged));
      window.sessionStorage.removeItem(SEEN_KEY_V1);
    }
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (seenCache?.raw !== raw) {
      const list = parseList(raw);
      seenCache = { raw, list, set: new Set(list) };
    }
    return seenCache;
  } catch {
    return { list: [], set: new Set() };
  }
}

export function isRunSeen(runId: string): boolean {
  if (typeof window === "undefined") return true;
  return readSeen().set.has(runId);
}

export function markRunSeen(runId: string | null | undefined): void {
  if (typeof window === "undefined" || !runId) return;
  const all = readSeen().list;
  if (all[all.length - 1] === runId) return;
  const cur = all.filter((id) => id !== runId);
  cur.push(runId);
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(cur.slice(-SEEN_MAX)));
  } catch {
    // Without the registry every completion shows as unread — harmless.
  }
}

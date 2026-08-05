import { CLAUDE_DEFAULTS, type ClaudeOptions, type PanelAgent } from "@/lib/dev-agents-meta";
import { postPanelMessage, subscribePanelBus } from "./panelBus";

/**
 * The universal panel's persisted state — successor to both
 * components/ai/threadMemory.ts and components/cmdk/commandBarStore.ts.
 *
 * Those were module-scope Maps: they survived soft navigation but died on hard
 * refresh and, crucially, were invisible to a second real browser window —
 * which the panel's popout mode requires. localStorage fixes both, and every
 * write is echoed on the panel bus so an open popout updates immediately
 * instead of waiting for a storage event.
 *
 * Only pointers live here (which conversation, which agent, layout prefs).
 * Transcripts and in-flight runs are DB-backed (ai_conversations,
 * dev_agent_runs) and reload via loadConversationAction — a reply that landed
 * while the panel was closed is simply there, and `pendingRunId` resumes the
 * poll. Never store message bodies here.
 *
 * Same render-phase rule as the old stores: client components still
 * server-render, so reads/writes happen in effects and event handlers ONLY —
 * readPanelState() during render would touch window on the server and desync
 * hydration on the client.
 */

export interface PanelState {
  /** The open thread; null = fresh chat. */
  conversationId: string | null;
  agent: PanelAgent;
  claude: ClaudeOptions;
  /** Dock width in px (splitter). */
  width: number;
  collapsed: boolean;
  /** "window" while the panel lives in a popped-out /panel window. Global
   *  across tabs on purpose — that's what makes every app window drop its
   *  dock when the panel moves to the second monitor. */
  where: "docked" | "window";
}

export const PANEL_MIN_WIDTH = 320;
export const PANEL_MAX_WIDTH = 720;
export const PANEL_DEFAULT_WIDTH = 640;

export const PANEL_DEFAULTS: PanelState = {
  conversationId: null,
  agent: "auto",
  claude: CLAUDE_DEFAULTS,
  width: PANEL_DEFAULT_WIDTH,
  collapsed: false,
  where: "docked",
};

const KEY = "sjcos:panel:state:v1";

export function readPanelState(): PanelState {
  if (typeof window === "undefined") return PANEL_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return PANEL_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    return {
      ...PANEL_DEFAULTS,
      ...parsed,
      claude: { ...CLAUDE_DEFAULTS, ...(parsed.claude ?? {}) },
    };
  } catch {
    return PANEL_DEFAULTS;
  }
}

/** Merge-write. Safe to call from an async closure whose component has already
 *  unmounted — that's the point: a conversation created after the user
 *  navigated away still lands here (see the old commandBarStore
 *  setConversationRef comment for the fork this prevents). */
export function writePanelState(patch: Partial<PanelState>): PanelState {
  const next = { ...readPanelState(), ...patch };
  if (typeof window === "undefined") return next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota/private-mode failures degrade to in-memory-only for this window.
  }
  postPanelMessage({ type: "state", state: next });
  return next;
}

/** Change notifications from other windows (bus) with a storage-event fallback
 *  for browsers without BroadcastChannel. Not fired for this window's own
 *  writes — callers already know their own state. */
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

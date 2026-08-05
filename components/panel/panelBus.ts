import type { DevAgent } from "@/lib/dev-agents-meta";
import type { TodayPriority } from "@/lib/today";
import type { PanelState } from "./panelStore";

/**
 * Cross-window signalling for the universal panel. The panel dock and the app
 * view may live in the same window or in two real browser windows (two-monitor
 * mode), so module-scope refs can't carry state between them — this typed
 * BroadcastChannel does. Same-origin only, same browser only, which is exactly
 * the popout case.
 *
 * This is a latency optimization, not the source of truth. Threads, runs and
 * page data are all DB-backed and polled (pollAgentRun, LiveUpdates); if the
 * channel is unavailable everything still converges within a poll interval.
 * House rule note: this is not SSE — no server connection is held open.
 */

export type PanelBusMessage =
  /** The persisted panel state changed (panelStore.writePanelState). */
  | { type: "state"; state: PanelState }
  /** Panel-driven navigation: the app view should router.push(href). */
  | { type: "nav"; href: string; id: string }
  /** An app window took the nav — the panel doesn't need to open a window. */
  | { type: "nav-ack"; id: string }
  /** A run started/ended somewhere; other windows update chips/highlights. */
  | { type: "run"; phase: "start" | "end"; runId: string; agent: DevAgent; subjectId: string | null }
  /** A queue card hand-off raised outside the dock (e.g. /today cards). */
  | { type: "handoff"; priority: TodayPriority; kind: "do" | "prep" }
  /** The app view's page grounding changed (PageAiContext) — lets a detached
   *  panel window ground its turns in what the other window is showing. */
  | { type: "page"; pathname: string; context?: string }
  /** Liveness of a detached /panel window (popout close detection). */
  | { type: "heartbeat"; role: "panel" }
  | { type: "panel-closed" };

const CHANNEL_NAME = "sjcos:panel:v1";

let channel: BroadcastChannel | null = null;
const localListeners = new Set<(msg: PanelBusMessage) => void>();

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

/** Fire-and-forget; drops silently where BroadcastChannel is unavailable.
 *  BroadcastChannel never delivers to the posting window, so senders that live
 *  in the SAME window as their consumer (e.g. a /today card handing off to the
 *  docked panel) pass `local: true` to also dispatch in-window. */
export function postPanelMessage(msg: PanelBusMessage, opts?: { local?: boolean }): void {
  try {
    getChannel()?.postMessage(msg);
  } catch {
    // A closed channel or non-cloneable payload must never break the sender.
  }
  if (opts?.local) for (const l of [...localListeners]) l(msg);
}

/** Subscribe to bus messages — from other windows/tabs, plus this window's own
 *  `local: true` posts. Returns an unsubscribe. */
export function subscribePanelBus(cb: (msg: PanelBusMessage) => void): () => void {
  localListeners.add(cb);
  const ch = getChannel();
  const onMessage = (e: MessageEvent) => {
    const msg = e.data as PanelBusMessage | undefined;
    if (msg && typeof msg === "object" && typeof msg.type === "string") cb(msg);
  };
  ch?.addEventListener("message", onMessage);
  return () => {
    localListeners.delete(cb);
    ch?.removeEventListener("message", onMessage);
  };
}

// ─── Hand-off relay ──────────────────────────────────────────────────────────
// A card's "Have Hermes do it" can fire while the panel chat isn't mounted
// (mobile sheet closed, panel window still opening). The last hand-off is
// stashed so the chat can consume it on mount instead of losing it.

let pendingHandoff: { priority: TodayPriority; kind: "do" | "prep" } | null = null;

/** Raise a hand-off toward the panel chat, wherever it lives. */
export function raiseHandOff(priority: TodayPriority, kind: "do" | "prep"): void {
  pendingHandoff = { priority, kind };
  postPanelMessage({ type: "handoff", priority, kind }, { local: true });
}

/** Claim the stashed hand-off (clears it). The mounted chat calls this both on
 *  mount and when a bus handoff message arrives. */
export function consumeHandOff(): { priority: TodayPriority; kind: "do" | "prep" } | null {
  const h = pendingHandoff;
  pendingHandoff = null;
  return h;
}

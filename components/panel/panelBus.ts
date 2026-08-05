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
  /** Liveness of a detached /panel window (popout close detection). */
  | { type: "heartbeat"; role: "panel" }
  | { type: "panel-closed" };

const CHANNEL_NAME = "sjcos:panel:v1";

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

/** Fire-and-forget; drops silently where BroadcastChannel is unavailable. */
export function postPanelMessage(msg: PanelBusMessage): void {
  try {
    getChannel()?.postMessage(msg);
  } catch {
    // A closed channel or non-cloneable payload must never break the sender.
  }
}

/** Subscribe to bus messages from *other* windows/tabs (BroadcastChannel never
 *  echoes to the poster). Returns an unsubscribe. */
export function subscribePanelBus(cb: (msg: PanelBusMessage) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const onMessage = (e: MessageEvent) => {
    const msg = e.data as PanelBusMessage | undefined;
    if (msg && typeof msg === "object" && typeof msg.type === "string") cb(msg);
  };
  ch.addEventListener("message", onMessage);
  return () => ch.removeEventListener("message", onMessage);
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, PanelLeft } from "lucide-react";
import {
  postPanelMessage,
  requestAppNav,
  resolveNavAck,
  subscribePanelBus,
} from "./panelBus";
import { subscribePanelState, writePanelState } from "./panelStore";
import { LiveUpdates } from "@/components/shell/LiveUpdates";
import { PanelQueueProvider } from "./PanelQueueProvider";
import { PanelDock } from "./PanelDock";

/**
 * The operator panel as its own browser window (/panel) — the two-monitor
 * mode. Claims the panel role on mount (app windows hide their docks), then:
 *  - heartbeats every 2s so app windows know the popout is alive;
 *  - turns every in-window link click and Inspect into a bus nav request, so
 *    the APP window navigates instead of this one (with a window.open fallback
 *    when no app window answers);
 *  - answers app-window pings, so liveness doesn't depend on our own timers
 *    (browsers throttle them to ~1/min when this window is hidden/occluded);
 *  - closes itself only on a deliberate re-dock (pill / Dock back), announcing
 *    panel-closed on the way out so docks come home immediately. A bare
 *    `where: "docked"` flip with no redock message means an app window's
 *    watchdog gave up on us — we're clearly alive, so we take the role back.
 * Chat state needs no hand-over in either direction — threads and runs are
 * DB-backed and the dock resumes them via the panel store + pendingRunId.
 */
export function PanelWindow() {
  const [width, setWidth] = useState(720);
  // Set once a deliberate re-dock is underway, so the matching state flip
  // isn't mistaken for a watchdog false alarm and re-claimed.
  const closingRef = useRef(false);

  // Claim + heartbeat + closure signalling.
  useEffect(() => {
    writePanelState({ where: "window" });
    const beatNow = () => postPanelMessage({ type: "heartbeat", role: "panel" });
    const beat = setInterval(beatNow, 2000);
    const onHide = () => postPanelMessage({ type: "panel-closed" });
    window.addEventListener("pagehide", onHide);
    // Coming back from a throttled/frozen stretch: beat right away so any
    // app window that was counting unanswered pings resets before it acts.
    const onVisible = () => {
      if (document.visibilityState === "visible") beatNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", beatNow);
    const unBus = subscribePanelBus((m) => {
      if (m.type === "nav-ack") resolveNavAck(m.id);
      else if (m.type === "ping") beatNow();
      else if (m.type === "redock") {
        closingRef.current = true;
        window.close();
      }
    });
    let reclaim: number | null = null;
    const unState = subscribePanelState((s) => {
      if (s.where !== "docked" || closingRef.current || reclaim != null) return;
      // Nobody asked us to dock (no redock message) — an app window's watchdog
      // mis-read a throttled heartbeat as a dead popout. Take the role back.
      // Deferred: the storage-event echo of a deliberate re-dock can land
      // before its `redock` bus message, so give that message a beat to arrive.
      reclaim = window.setTimeout(() => {
        reclaim = null;
        if (closingRef.current) return;
        writePanelState({ where: "window" });
        beatNow();
      }, 400);
    });
    return () => {
      clearInterval(beat);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", beatNow);
      if (reclaim != null) clearTimeout(reclaim);
      unState();
      unBus();
    };
  }, []);

  // Track our own width for the dock's one/two-column decision.
  useEffect(() => {
    const measure = () => setWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Any same-origin link inside the panel (priority cards, waiting items…)
  // belongs to the app view — intercept in capture phase, before next/link.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element).closest?.("a[href]");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/")) return;
      e.preventDefault();
      e.stopPropagation();
      requestAppNav(href);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper-2">
      <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
        <Sparkles className="size-3.5 text-ai" strokeWidth={1.5} />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          Operator · window
        </span>
        <div className="flex-1" />
        <button
          onClick={() => {
            // Flipping the store re-docks every app window. Mark ourselves
            // closing first so the state flip isn't re-claimed.
            closingRef.current = true;
            writePanelState({ where: "docked" });
            postPanelMessage({ type: "panel-closed" });
            window.close();
          }}
          title="Return the panel to the app window"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-3 transition-colors hover:bg-paper"
        >
          <PanelLeft className="size-3.5" strokeWidth={1.75} /> Dock back
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <PanelQueueProvider>
          <PanelDock width={width} navigate={requestAppNav} />
        </PanelQueueProvider>
        {/* The popout has no (os) layout, so it polls the change log itself —
            that's what keeps its queue cards live while agents write. */}
        <LiveUpdates />
      </div>
    </div>
  );
}

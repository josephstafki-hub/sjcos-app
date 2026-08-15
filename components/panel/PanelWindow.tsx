"use client";

import { useEffect, useState } from "react";
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
 *  - closes itself when any window re-docks the panel, and announces
 *    panel-closed on the way out so docks come home immediately.
 * Chat state needs no hand-over in either direction — threads and runs are
 * DB-backed and the dock resumes them via the panel store + pendingRunId.
 */
export function PanelWindow() {
  const [width, setWidth] = useState(720);

  // Claim + heartbeat + closure signalling.
  useEffect(() => {
    writePanelState({ where: "window" });
    const beat = setInterval(() => postPanelMessage({ type: "heartbeat", role: "panel" }), 2000);
    const onHide = () => postPanelMessage({ type: "panel-closed" });
    window.addEventListener("pagehide", onHide);
    const unState = subscribePanelState((s) => {
      // Someone re-docked (an app window's pill) — this window is done.
      if (s.where === "docked") window.close();
    });
    const unBus = subscribePanelBus((m) => {
      if (m.type === "nav-ack") resolveNavAck(m.id);
    });
    return () => {
      clearInterval(beat);
      window.removeEventListener("pagehide", onHide);
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
            // Flipping the store re-docks every app window; our own state
            // subscription then closes this window.
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

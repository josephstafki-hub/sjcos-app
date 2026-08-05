"use client";

import type { ReactNode } from "react";
import { PanelLeftClose, Sparkles } from "lucide-react";
import { usePanel } from "./PanelProvider";
import { PanelDock } from "./PanelDock";
import { Splitter } from "./Splitter";

/** Read the app view's current route for page grounding. RouteTracker (mounted
 *  in the (os) layout) keeps this current; the dock reads it at send time so a
 *  turn is grounded in whatever page is on screen *now*. */
function lastRouteContext(): string | undefined {
  try {
    const route = sessionStorage.getItem("sjcos:lastRoute");
    return route ? `The owner is currently viewing the app page ${route}.` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The one-monitor split: operator dock left, the real app right. The dock is
 * layout-persistent (chat state, poll loops and splitter width survive
 * navigation); the right side is ordinary app pages with their own Shell.
 * Below lg the dock hides entirely for now (the mobile sheet comes with
 * capability parity).
 */
export function PanelHost({ children }: { children: ReactNode }) {
  const { layout, setWidth, commitWidth, toggleCollapsed } = usePanel();
  // Render the dock only after the persisted layout is adopted (layout.ready
  // flips in PanelProvider's mount effect) — the server render can't know
  // width/collapsed, and a wrong-width flash is worse than the dock appearing
  // a frame late.
  const showDock = layout.ready && layout.where === "docked";

  return (
    <div className="flex h-dvh overflow-hidden bg-paper">
      {showDock &&
        (layout.collapsed ? (
          <div className="hidden w-11 flex-none flex-col items-center border-r border-rule bg-paper-2 pt-3 lg:flex">
            <button
              onClick={toggleCollapsed}
              aria-label="Expand operator panel"
              title="Expand operator panel"
              className="rounded-md p-1.5 text-ai transition-colors hover:bg-paper"
            >
              <Sparkles className="size-[18px]" strokeWidth={1.5} />
            </button>
          </div>
        ) : (
          <>
            <aside
              style={{ width: layout.width }}
              className="hidden flex-none flex-col overflow-hidden border-r border-rule bg-paper-2 lg:flex"
            >
              <div className="flex items-center gap-2 px-3 pt-2">
                <Sparkles className="size-3.5 text-ai" strokeWidth={1.5} />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                  Operator
                </span>
                <div className="flex-1" />
                <button
                  onClick={toggleCollapsed}
                  aria-label="Collapse operator panel"
                  title="Collapse operator panel"
                  className="rounded-md p-1 text-ink-3 transition-colors hover:bg-paper hover:text-ink-2"
                >
                  <PanelLeftClose className="size-3.5" strokeWidth={1.75} />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <PanelDock width={layout.width} getPageContext={lastRouteContext} />
              </div>
            </aside>
            <Splitter width={layout.width} onResize={setWidth} onCommit={commitWidth} />
          </>
        ))}
      <div className="h-full min-w-0 flex-1">{children}</div>
    </div>
  );
}

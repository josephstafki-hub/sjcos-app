"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PanelLeftClose, Sparkles, X } from "lucide-react";
import { subscribePanelBus } from "./panelBus";
import { usePanel } from "./PanelProvider";
import { PanelDock } from "./PanelDock";
import { Splitter } from "./Splitter";

/**
 * The one-monitor split: operator dock left, the real app right. The dock is
 * layout-persistent (chat state, poll loops and splitter width survive
 * navigation); the right side is ordinary app pages with their own Shell.
 * Below lg the dock becomes a floating pill that opens a full-screen sheet.
 */
export function PanelHost({ children }: { children: ReactNode }) {
  const { layout, setWidth, commitWidth, toggleCollapsed } = usePanel();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Render the dock only after the persisted layout is adopted (layout.ready
  // flips in PanelProvider's mount effect) — the server render can't know
  // width/collapsed, and a wrong-width flash is worse than the dock appearing
  // a frame late.
  const showDock = layout.ready && layout.where === "docked";

  // A hand-off raised while the dock is hidden below lg (mobile) needs the
  // sheet open so the chat can consume the stashed message.
  useEffect(
    () =>
      subscribePanelBus((m) => {
        if (m.type === "handoff") setSheetOpen(true);
      }),
    [],
  );

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
                <PanelDock width={layout.width} />
              </div>
            </aside>
            <Splitter width={layout.width} onResize={setWidth} onCommit={commitWidth} />
          </>
        ))}

      <div className="h-full min-w-0 flex-1">{children}</div>

      {/* Small screens: the dock as a full-screen sheet behind a floating pill. */}
      {showDock && !sheetOpen && (
        <button
          onClick={() => setSheetOpen(true)}
          aria-label="Open operator panel"
          className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full border border-ai bg-paper px-3 py-2 text-[12px] font-medium text-ai-2 shadow-card lg:hidden"
        >
          <Sparkles className="size-4 text-ai" strokeWidth={1.5} /> Operator
        </button>
      )}
      {showDock && sheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-paper lg:hidden">
          <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
            <Sparkles className="size-3.5 text-ai" strokeWidth={1.5} />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
              Operator
            </span>
            <div className="flex-1" />
            <button
              onClick={() => setSheetOpen(false)}
              aria-label="Close operator panel"
              className="rounded-md p-1 text-ink-3 hover:bg-paper-2"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {/* Narrow width forces the single-column dock (inline queue cards). */}
            <PanelDock width={400} />
          </div>
        </div>
      )}
    </div>
  );
}

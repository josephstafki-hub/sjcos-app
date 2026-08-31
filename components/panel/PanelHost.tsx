"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, ExternalLink, Eye, EyeOff, Mic, PanelLeftClose, Sparkles, X } from "lucide-react";
import { ackAppNav, subscribePanelBus } from "./panelBus";
import { usePanel } from "./PanelProvider";
import { readPanelState } from "./panelStore";
import { PanelDock } from "./PanelDock";
import { Splitter } from "./Splitter";

/**
 * The one-monitor split: operator dock left, the real app right. The dock is
 * layout-persistent (chat state, poll loops and splitter width survive
 * navigation); the right side is ordinary app pages with their own Shell.
 * Below lg the dock becomes a floating pill that opens a full-screen sheet.
 */
export function PanelHost({ children }: { children: ReactNode }) {
  const { layout, setWidth, commitWidth, toggleCollapsed, setWhere, setFollow } = usePanel();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Mobile: on the home page the operator is the whole screen (queue cards
  // and all); on any other page it's a bottom drawer so most of the page Joe
  // was on stays visible and usable — expandable to full when he wants it.
  const [sheetFull, setSheetFull] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const onHome = pathname === "/today" || pathname === "/";
  const drawer = !onHome && !sheetFull;
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

  // App-window duties toward a detached panel: take its navigation requests,
  // and watch its heartbeat — when the popout dies (closed, crashed, or was
  // already gone when this window loaded) the dock comes home. The bus posts
  // don't echo to their sender, so this never reacts to this window's own
  // writes.
  useEffect(() => {
    let lastBeat = Date.now();
    const un = subscribePanelBus((m) => {
      if (m.type === "nav") {
        ackAppNav(m.id);
        router.push(m.href);
      } else if (m.type === "heartbeat" && m.role === "panel") {
        lastBeat = Date.now();
      } else if (m.type === "panel-closed") {
        setWhere("docked");
      }
    });
    const watchdog = setInterval(() => {
      if (layout.ready && layout.where === "window" && Date.now() - lastBeat > 6500) {
        setWhere("docked");
      }
    }, 2000);
    return () => {
      un();
      clearInterval(watchdog);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.ready, layout.where]);

  // Popping out is a real second window, so it gets its own per-tab session
  // (panelStore). Hand the open thread over explicitly on the URL — the panel's
  // ?c= deep link — or the popout would open a fresh chat instead of the one
  // Joe was just in. Re-docking is the reverse: each app tab goes back to its
  // OWN thread, and anything the popout worked on is in the thread list (with
  // its live dot while the run is still going).
  const detach = () => {
    const { conversationId } = readPanelState();
    const href = conversationId ? `/panel?c=${encodeURIComponent(conversationId)}` : "/panel";
    // Wide enough for the popout's three columns (threads · queue · chat).
    const w = window.open(href, "sjcos-panel", "width=1100,height=1000");
    if (w) setWhere("window");
  };

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
              className="hidden flex-none flex-col overflow-hidden bg-paper-2 lg:flex"
            >
              <div className="flex items-center gap-2 px-3 pt-2">
                <Sparkles className="size-3.5 text-ai" strokeWidth={1.5} />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                  Operator
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => setFollow(!layout.follow)}
                  aria-pressed={layout.follow}
                  aria-label={layout.follow ? "Stop following agent actions" : "Follow agent actions"}
                  title={
                    layout.follow
                      ? "Following: a run you start opens what it's working on in the app view. Click to stop."
                      : "Not following: runs only offer a chip. Click to follow again."
                  }
                  className={`rounded-md p-1 transition-colors hover:bg-paper ${layout.follow ? "text-ai" : "text-ink-4"}`}
                >
                  {layout.follow ? <Eye className="size-3.5" strokeWidth={1.75} /> : <EyeOff className="size-3.5" strokeWidth={1.75} />}
                </button>
                <button
                  onClick={detach}
                  aria-label="Pop out to its own window"
                  title="Pop out to its own window (second monitor)"
                  className="rounded-md p-1 text-ink-3 transition-colors hover:bg-paper hover:text-ink-2"
                >
                  <ExternalLink className="size-3.5" strokeWidth={1.75} />
                </button>
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

      {/* data-app-view: LiveActionNav counts only interaction inside the app
          view as "Joe is busy here" — typing in the dock must not block it. */}
      <div className="h-full min-w-0 flex-1" data-app-view>
        {children}
      </div>

      {/* Detached: a slim pill to bring the dock home (the popout closes
          itself when it sees the state flip). */}
      {layout.ready && layout.where === "window" && (
        <button
          onClick={() => setWhere("docked")}
          title="Bring the operator panel back into this window"
          className="fixed bottom-4 left-4 z-40 hidden items-center gap-1.5 rounded-full border border-rule bg-paper px-3 py-1.5 text-[11.5px] font-medium text-ink-2 shadow-card hover:bg-paper-2 lg:flex"
        >
          <Sparkles className="size-3.5 text-ai" strokeWidth={1.5} /> Re-dock panel
        </button>
      )}

      {/* Small screens: the dock as a full-screen sheet behind a floating pill. */}
      {showDock && !sheetOpen && (
        <button
          onClick={() => setSheetOpen(true)}
          aria-label="Open operator panel"
          className="fixed bottom-5 right-4 z-40 flex items-center gap-2 rounded-full border border-ai bg-paper py-2 pl-3 pr-2 text-[13px] font-medium text-ai-2 shadow-card lg:hidden"
        >
          <Sparkles className="size-4 text-ai" strokeWidth={1.5} /> Operator
          <span className="flex size-8 items-center justify-center rounded-full bg-ink text-paper">
            <Mic className="size-4" strokeWidth={1.75} />
          </span>
        </button>
      )}
      {showDock && sheetOpen && (
        <div
          className={`fixed inset-x-0 bottom-0 z-50 flex flex-col bg-paper lg:hidden ${
            drawer
              ? "h-[46dvh] rounded-t-2xl border-t border-rule shadow-[0_-8px_24px_rgba(0,0,0,0.12)]"
              : "top-0"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
            <Sparkles className="size-3.5 text-ai" strokeWidth={1.5} />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
              Operator
            </span>
            <div className="flex-1" />
            {!onHome && (
              <button
                onClick={() => setSheetFull((f) => !f)}
                aria-label={sheetFull ? "Shrink to a drawer" : "Expand to full screen"}
                title={sheetFull ? "Shrink to a drawer" : "Expand to full screen"}
                className="rounded-md p-1 text-ink-3 hover:bg-paper-2"
              >
                {sheetFull ? <ChevronDown className="size-4" strokeWidth={1.75} /> : <ChevronUp className="size-4" strokeWidth={1.75} />}
              </button>
            )}
            <button
              onClick={() => setSheetOpen(false)}
              aria-label="Close operator panel"
              className="rounded-md p-1 text-ink-3 hover:bg-paper-2"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {/* Narrow width forces the single-column dock; the drawer is
                compact (conversation + composer only). */}
            <PanelDock width={400} compact={drawer} />
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { hrefForScope } from "@/lib/entity-href";
import type { PanelAgent } from "@/lib/dev-agents-meta";
import { subscribePanelBus, type PanelBusOrigin } from "./panelBus";
import { usePanel } from "./PanelProvider";

/** No pointer/keys/scroll INSIDE THE APP VIEW for this long = Joe isn't in
 *  the middle of something there, so a run he started may move it. Typing in
 *  the dock doesn't count (see data-app-view in PanelHost). */
const IDLE_MS = 10_000;
/** Tailwind `lg` — below it the dock is a phone sheet over the page and there
 *  is no "app view beside the chat" to steer. Never navigate there. */
const DESKTOP_MQ = "(min-width: 64rem)";

function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_MQ).matches,
    () => false,
  );
}

/** Is `href` (path + optional query) what the app view shows right now? Every
 *  query param the target names must match (?tab=Documents, ?s=<subject>). */
function onScreen(href: string): boolean {
  const [path, qs = ""] = href.split("?");
  if (window.location.pathname !== path) return false;
  const want = new URLSearchParams(qs);
  const have = new URLSearchParams(window.location.search);
  for (const [k, v] of want) if (have.get(k) !== v) return false;
  return true;
}

function agentName(agent: PanelAgent): string {
  return agent === "auto" ? "The agent" : agent.charAt(0).toUpperCase() + agent.slice(1);
}

interface Chip {
  href: string;
  text: string;
}

interface ActiveRun {
  runId: string;
  agent: PanelAgent;
  focus: { href: string; label: string } | null;
}

/**
 * The "watch the agents work" half of the split view. Mounted once in the (os)
 * layout — the app-view side only; a detached /panel window has no app view.
 *
 * Only a run Joe started from THIS window's panel (or, when the panel is popped
 * out, from that popout) may move the app view — and only on a desktop-width
 * screen, and only while he isn't busy in the app view himself. Everything
 * else (another tab's run, Hermes over MCP from Telegram, cron timers) is at
 * most a chip. The earlier version navigated on ANY app_change_log write once
 * Joe had been idle 30s, which is what made the app jump pages by itself.
 *
 * During a run:
 *  - run start with a subject (a queue-card hand-off): open /workbench on it
 *    right away — Joe just clicked that;
 *  - focus updates (lib/run-focus.ts: the entity the agent's last sjcos tool
 *    call named) open that exact page — project tab, lead, draft… — when the
 *    app view is idle, else offer a chip;
 *  - run end: refresh the page so the finished product is on screen, and if
 *    the run's last focus isn't what's showing, open it (same idle rule).
 * Table-level change signals only ever produce a chip.
 */
export function LiveActionNav() {
  const router = useRouter();
  const pathname = usePathname();
  const desktop = useIsDesktop();
  const { layout } = usePanel();
  const [chip, setChip] = useState<Chip | null>(null);
  const lastInteraction = useRef(0);
  const run = useRef<ActiveRun | null>(null);
  // Latest values for the long-lived bus subscription (assigned in effects).
  const env = useRef({ desktop, follow: layout.follow, where: layout.where });
  useEffect(() => {
    env.current = { desktop, follow: layout.follow, where: layout.where };
  }, [desktop, layout.follow, layout.where]);

  // Reaching the chip's target by any means dismisses it — render-phase
  // adjustment, not an effect (react.dev/learn/you-might-not-need-an-effect).
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    if (chip && pathname === chip.href.split("?")[0]) setChip(null);
  }

  useEffect(() => {
    lastInteraction.current = 0;
    const inAppView = (e: Event) =>
      e.target instanceof Element && e.target.closest("[data-app-view]") != null;
    const touch = (e: Event) => {
      if (inAppView(e)) lastInteraction.current = Date.now();
    };
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    window.addEventListener("wheel", touch, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      window.removeEventListener("wheel", touch);
    };
  }, []);

  useEffect(
    () =>
      subscribePanelBus((m, origin: PanelBusOrigin) => {
        const { desktop: isDesktop, follow, where } = env.current;
        // Phones: never move the page, never chip over the sheet.
        if (!isDesktop) return;
        // Run lifecycle is trusted from this window's own panel, or from the
        // popout when the panel lives there. Another tab's run is not ours.
        const mine = origin === "local" || where === "window";
        const appIdle = () => Date.now() - lastInteraction.current >= IDLE_MS;
        /** Open `href`, or offer it, per the follow pref and app-view idleness. */
        const show = (href: string, text: string, opts?: { force?: boolean }) => {
          if (onScreen(href)) return;
          if (follow && (opts?.force || appIdle())) {
            setChip(null);
            router.push(href);
          } else {
            setChip({ href, text });
          }
        };

        if (m.type === "run") {
          if (!mine) return;
          if (m.phase === "start") {
            run.current = { runId: m.runId, agent: m.agent, focus: null };
            if (m.subjectId) show(`/workbench?s=${encodeURIComponent(m.subjectId)}`, "View the workbench", { force: true });
            return;
          }
          const r = run.current;
          if (!r || r.runId !== m.runId) return;
          run.current = null;
          // The finished product: re-render what's on screen now…
          router.refresh();
          // …and if the run ended somewhere else, take Joe there.
          if (r.focus) show(r.focus.href, `${agentName(r.agent)} finished — ${r.focus.label}`);
          return;
        }

        if (m.type === "focus") {
          if (!mine) return;
          const r = run.current;
          if (!r || r.runId !== m.runId) return;
          r.focus = { href: m.href, label: m.label };
          show(m.href, `${agentName(r.agent)} is working in ${m.label}`);
          return;
        }

        if (m.type === "changes") {
          // Each window polls its own LiveUpdates; only local signals count.
          if (origin !== "local") return;
          // A run that has told us exactly where it is needs no table-level hint.
          if (run.current?.focus) return;
          // First mapped agent scope that isn't on screen wins (latest-wins on
          // the chip, so a burst of writes shows the most recent target).
          for (const scope of m.agentScopes ?? []) {
            const href = hrefForScope(scope);
            if (!href || onScreen(href)) continue;
            const label = scope.replace(/_/g, " ");
            setChip({
              href,
              text: run.current
                ? `${agentName(run.current.agent)} is updating ${label}`
                : `An agent updated ${label}`,
            });
            return;
          }
        }
      }),
    [router],
  );

  if (!chip || !desktop) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-1 rounded-full border border-ai bg-paper py-1 pl-3 pr-1 shadow-card">
      <span className="text-[12px] text-ink-2">{chip.text}</span>
      <button
        onClick={() => {
          const href = chip.href;
          setChip(null);
          router.push(href);
        }}
        className="flex items-center gap-1 rounded-full bg-ai-soft px-2 py-0.5 text-[12px] font-medium text-ai-2 transition-colors hover:bg-paper-2"
      >
        View <ArrowRight className="size-3" strokeWidth={2} />
      </button>
      <button
        onClick={() => setChip(null)}
        aria-label="Dismiss"
        className="rounded-full p-1 text-ink-4 transition-colors hover:bg-paper-2"
      >
        <X className="size-3" strokeWidth={2} />
      </button>
    </div>
  );
}

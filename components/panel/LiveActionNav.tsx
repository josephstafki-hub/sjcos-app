"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { hrefForScope } from "@/lib/entity-href";
import { subscribePanelBus } from "./panelBus";

/** How long without pointer/keys/scroll before the app view is "idle" and may
 *  be navigated out from under Joe (interview decision: jump only when idle,
 *  chip otherwise). */
const IDLE_MS = 30_000;

/**
 * The "watch the agents work" half of the split view. Mounted once in the (os)
 * layout — the app-view side only; a detached /panel window has no app view to
 * steer. Listens on the panel bus for:
 *  - run start with a subject (a hand-off): open /workbench on that entity
 *    immediately — Joe just asked for it, that's feedback, not interruption;
 *  - change-log scopes (any agent writing anywhere, incl. Hermes over MCP):
 *    when the affected section isn't on screen, auto-open it if Joe has been
 *    idle ≥30s, otherwise offer a "view change" chip. Changes to the current
 *    page need nothing here — LiveUpdates already refreshed it in place.
 */
export function LiveActionNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [chip, setChip] = useState<{ href: string; label: string } | null>(null);
  const lastInteraction = useRef(0);
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  // Reaching the chip's target by any means dismisses it — render-phase
  // adjustment, not an effect (react.dev/learn/you-might-not-need-an-effect).
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    if (chip && pathname.startsWith(chip.href)) setChip(null);
  }

  useEffect(() => {
    lastInteraction.current = Date.now();
    const touch = () => {
      lastInteraction.current = Date.now();
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
      subscribePanelBus((m) => {
        if (m.type === "run" && m.phase === "start" && m.subjectId) {
          router.push(`/workbench?s=${encodeURIComponent(m.subjectId)}`);
          return;
        }
        if (m.type !== "changes") return;
        // First mapped scope that isn't already on screen wins (latest-wins on
        // the chip, so a burst of writes shows the most recent target).
        for (const scope of m.scopes) {
          const href = hrefForScope(scope);
          if (!href || pathRef.current.startsWith(href)) continue;
          if (Date.now() - lastInteraction.current >= IDLE_MS) {
            router.push(href);
          } else {
            setChip({ href, label: scope.replace(/_/g, " ") });
          }
          return;
        }
      }),
    [router],
  );

  if (!chip) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-1 rounded-full border border-ai bg-paper py-1 pl-3 pr-1 shadow-card">
      <span className="text-[12px] text-ink-2">
        An agent updated <span className="font-medium">{chip.label}</span>
      </span>
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

"use client";

import { useRouter } from "next/navigation";
import { Sparkles, Check, Clock, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui";
import { useTodayQueue } from "./TodayQueueContext";
import type { TodayPriority } from "@/lib/today";

const DOT: Record<string, string> = {
  flag: "bg-flag",
  accent: "bg-accent",
  ai: "bg-ai",
  money: "bg-money",
  ghost: "bg-ink-4",
};

/** Friendly name for the deep-lane "Open <page>" chip, from the card's href. */
function pageLabel(href?: string): string {
  if (!href) return "Open";
  if (href.startsWith("/leads/")) return "Open lead";
  if (href.startsWith("/projects/")) return "Open project";
  if (href.startsWith("/warranty")) return "Open warranty";
  if (href.startsWith("/compliance")) return "Open compliance";
  if (href.startsWith("/schedule")) return "Open schedule";
  return "Open";
}

/** One Today-feed priority card: the existing card look (dot, mono tag, rank,
 *  serif title, sub) plus a lane-specific chip row. Chips are deterministic
 *  React elements keyed to the work_item id and verified server-side on click
 *  (see lib/actions/today.ts) — never model output. */
export function PriorityCard({
  p,
  onHandOff,
}: {
  p: TodayPriority;
  onHandOff: (p: TodayPriority, kind: "do" | "prep") => void;
}) {
  const { busyId, checkingId, complete, snooze, handleCardClick } = useTodayQueue();
  const router = useRouter();

  const busy = busyId === p.id || checkingId === p.id;
  const isAllClear = p.id === "all-clear";

  // Which chips show, by lane (§3.2). Signal cards (checkable: false) are
  // always deep and only get Open + Prep me.
  const showHermes = p.checkable && p.lane === "chat";
  const showDone = p.checkable && (p.lane === "chat" || p.lane === "quick");
  const showSnooze = p.checkable && (p.lane === "quick" || p.lane === "deep");
  const showPrep = p.lane === "deep" && !isAllClear;
  const showOpen = Boolean(p.href) && !isAllClear;

  const open = async () => {
    if (!p.href) return;
    if (p.checkable) {
      const handled = await handleCardClick(p); // stale-check: swaps if already done
      if (handled) return;
    }
    router.push(p.href);
  };

  return (
    <Card className={`p-3 transition-all ${busy ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${DOT[p.dot]}`} />
        <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-ink-3">
          {p.tag}
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[10px] text-ink-4">{p.rank}</span>
      </div>
      <div className="mt-1 font-serif text-[16px] font-semibold text-ink">{p.title}</div>
      <div className="mt-0.5 text-[12px] text-ink-3">{p.sub}</div>

      {!isAllClear && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {showHermes && (
            <button
              onClick={() => onHandOff(p, "do")}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-ai/40 bg-ai-soft px-2 py-0.5 text-[11px] font-semibold text-ai-2 transition-colors hover:bg-ai/15 disabled:opacity-50"
            >
              <Sparkles className="size-3" strokeWidth={1.5} /> Have AI do it
            </button>
          )}
          {showPrep && (
            <button
              onClick={() => onHandOff(p, "prep")}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-ai/40 bg-ai-soft px-2 py-0.5 text-[11px] font-semibold text-ai-2 transition-colors hover:bg-ai/15 disabled:opacity-50"
            >
              <Sparkles className="size-3" strokeWidth={1.5} /> Prep me a summary
            </button>
          )}
          {showOpen && (
            <button
              onClick={open}
              disabled={busy}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                p.lane === "deep"
                  ? "border-ink/25 bg-paper-2 text-ink hover:bg-paper"
                  : "border-rule bg-paper-2 text-ink-2 hover:bg-paper"
              }`}
            >
              {pageLabel(p.href)} <ArrowUpRight className="size-3" strokeWidth={2} />
            </button>
          )}
          {showDone && (
            <button
              onClick={() => complete(p.id)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-rule bg-paper-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2 transition-colors hover:bg-paper disabled:opacity-50"
            >
              <Check className="size-3" strokeWidth={2} /> Mark done
            </button>
          )}
          {showSnooze && (
            <button
              onClick={() => snooze(p.id)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-rule bg-paper-2 px-2 py-0.5 text-[11px] font-medium text-ink-3 transition-colors hover:bg-paper disabled:opacity-50"
            >
              <Clock className="size-3" strokeWidth={1.5} /> Snooze 3d
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

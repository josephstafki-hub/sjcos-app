"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui";
import { reprioritizeToday } from "@/lib/actions/today";
import type { TodayPriority } from "@/lib/today";

const DOT: Record<string, string> = {
  flag: "bg-flag",
  accent: "bg-accent",
  ai: "bg-ai",
  money: "bg-money",
  ghost: "bg-ink-4",
};

/** Priorities list with a working Re-prioritize button: it asks the AI to
 *  re-rank the current items and reorders them in place. */
export function TodayPriorities({ initial }: { initial: TodayPriority[] }) {
  const [items, setItems] = useState(initial);
  const [pending, startTransition] = useTransition();

  const reprioritize = () =>
    startTransition(async () => {
      const order = await reprioritizeToday(items.map((i) => i.title));
      // Reorder by the returned title order, then renumber the ranks.
      const byTitle = new Map(items.map((i) => [i.title, i]));
      const next = order
        .map((t) => byTitle.get(t))
        .filter((x): x is TodayPriority => Boolean(x))
        .map((it, i) => ({ ...it, rank: `#${i + 1}` }));
      if (next.length) setItems(next);
    });

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-serif text-[16px] font-semibold text-ink">Priorities</h2>
        <span className="text-[11px] text-ink-3">· what moves the week</span>
        <div className="flex-1" />
        <button
          onClick={reprioritize}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-ai/40 bg-ai-soft px-2 py-0.5 text-[11px] font-semibold text-ai-2 transition-colors hover:bg-ai/15 disabled:opacity-60"
        >
          <Sparkles className="size-3" strokeWidth={1.5} />
          {pending ? "Re-ranking…" : "Re-prioritize"}
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {items.map((p) => (
          <Card key={p.title} className="p-3">
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
          </Card>
        ))}
      </div>
    </section>
  );
}

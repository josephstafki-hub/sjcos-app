"use client";

import { useRouter } from "next/navigation";
import { Check, Clock, ArrowUpRight } from "lucide-react";
import { useTodayQueue } from "./TodayQueueContext";
import type { ModelAction } from "@/lib/today-actions";

/** Phase 7 (stretch): chips a model proposed via a `sjcos-actions` block
 *  (parsed in lib/today-actions.ts). A chip renders ONLY when its work_item_id
 *  matches a card in the CURRENT queue snapshot — and, for done/snooze, that
 *  card is checkable. The model names an item; it can never invent one or
 *  widen what's allowed. Handlers hit the same owner-verified server actions
 *  (complete / snooze) as the app-rendered PriorityCard chips; "open" is plain
 *  navigation to that card's href. */
export function ModelActionChips({ actions }: { actions: ModelAction[] }) {
  const { priorities, busyId, complete, snooze } = useTodayQueue();
  const router = useRouter();

  const renderable = actions
    .map((a) => ({ a, p: priorities.find((p) => p.id === a.workItemId) }))
    .filter(
      (x): x is { a: ModelAction; p: NonNullable<typeof x.p> } => {
        if (!x.p) return false;
        if (x.a.kind === "open") return Boolean(x.p.href);
        return x.p.checkable; // mark_done / snooze need a real work_item row
      },
    );

  if (renderable.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {renderable.map(({ a, p }) => {
        const busy = busyId === p.id;
        if (a.kind === "mark_done") {
          return (
            <button
              key={`done-${p.id}`}
              onClick={() => complete(p.id)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-rule bg-paper-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2 transition-colors hover:bg-paper disabled:opacity-50"
            >
              <Check className="size-3" strokeWidth={2} /> {a.label}
            </button>
          );
        }
        if (a.kind === "snooze") {
          return (
            <button
              key={`snooze-${p.id}`}
              onClick={() => snooze(p.id)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-rule bg-paper-2 px-2 py-0.5 text-[11px] font-medium text-ink-3 transition-colors hover:bg-paper disabled:opacity-50"
            >
              <Clock className="size-3" strokeWidth={1.5} /> {a.label}
            </button>
          );
        }
        // open — navigate to the card's existing href.
        return (
          <button
            key={`open-${p.id}`}
            onClick={() => router.push(p.href!)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-ink/25 bg-paper-2 px-2 py-0.5 text-[11px] font-semibold text-ink transition-colors hover:bg-paper disabled:opacity-50"
          >
            {a.label} <ArrowUpRight className="size-3" strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}

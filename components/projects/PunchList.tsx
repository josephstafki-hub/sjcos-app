"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { setPunchDone } from "@/lib/actions/projects";

interface PunchItem {
  id: number;
  item: string;
  owner: string;
  done: boolean;
}

/** Interactive project punch list. Checkboxes toggle `done` (optimistic, then
 *  persisted via setPunchDone). Owner-only — the action re-checks the role. */
export function PunchList({ slug, items }: { slug: string; items: PunchItem[] }) {
  const [rows, setRows] = useState(items);
  const [, startTransition] = useTransition();

  function toggle(id: number, next: boolean) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, done: next } : r)));
    startTransition(async () => {
      try {
        await setPunchDone(id, next, slug);
      } catch {
        // Revert on failure.
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, done: !next } : r)));
      }
    });
  }

  const open = rows.filter((r) => !r.done).length;
  const done = rows.filter((r) => r.done).length;

  return (
    <Card className="max-w-[680px] overflow-hidden p-0">
      <div className="border-b border-rule bg-paper-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        {open} open · {done} done
      </div>
      {rows.map((p, i) => (
        <button
          key={p.id}
          type="button"
          onClick={() => toggle(p.id, !p.done)}
          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-2 ${i ? "border-t border-rule-soft" : ""}`}
        >
          <span
            className={[
              "flex size-4 flex-none items-center justify-center rounded-[4px] border",
              p.done ? "border-money bg-money" : "border-ink-4",
            ].join(" ")}
          >
            {p.done && <Check className="size-3 text-paper" strokeWidth={2.5} />}
          </span>
          <span className={`flex-1 text-[13px] ${p.done ? "text-ink-3 line-through" : "text-ink"}`}>
            {p.item}
          </span>
          <Chip kind="ghost">{p.owner}</Chip>
        </button>
      ))}
    </Card>
  );
}

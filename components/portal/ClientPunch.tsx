"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Card } from "@/components/ui";
import { confirmPunchItem } from "@/lib/actions/projects";

interface PunchItem {
  id: number;
  item: string;
  done: boolean;
  clientConfirmed: boolean;
}

/** Client-portal punch confirmation. Shows the items the PM has marked done and
 *  lets the client confirm each one is actually resolved (optimistic, then
 *  persisted). Only done items are shown — nothing to confirm until the PM
 *  finishes the work. */
export function ClientPunch({ items }: { items: PunchItem[] }) {
  const [rows, setRows] = useState(() => items.filter((p) => p.done));
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (rows.length === 0) return null;

  const open = rows.filter((r) => !r.clientConfirmed).length;

  function toggle(id: number, next: boolean) {
    setError(null);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, clientConfirmed: next } : r)));
    startTransition(async () => {
      const res = await confirmPunchItem(id, next);
      if (!res.ok) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, clientConfirmed: !next } : r)));
        setError(res.error);
      }
    });
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-rule bg-paper-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
        {open > 0 ? `${open} to confirm` : "All confirmed — thank you"}
      </div>
      {rows.map((p, i) => (
        <button
          key={p.id}
          type="button"
          onClick={() => toggle(p.id, !p.clientConfirmed)}
          className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left ${i ? "border-t border-rule-soft" : ""}`}
        >
          <span
            className={[
              "flex size-4 flex-none items-center justify-center rounded-[4px] border",
              p.clientConfirmed ? "border-money bg-money" : "border-ink-4",
            ].join(" ")}
          >
            {p.clientConfirmed && <Check className="size-3 text-paper" strokeWidth={2.5} />}
          </span>
          <span className={`flex-1 text-[12.5px] ${p.clientConfirmed ? "text-ink-3" : "text-ink"}`}>{p.item}</span>
          <span className="font-mono text-[10px] text-ink-3">{p.clientConfirmed ? "confirmed" : "confirm"}</span>
        </button>
      ))}
      {error && <div className="border-t border-rule-soft px-3 py-2 text-[11px] text-flag">{error}</div>}
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { ChipKind } from "@/components/ui/Chip";
import type { Selection, SelectionStatus, SelectionsView, SelectionGroup } from "@/lib/selections";
import { decideSelection } from "@/lib/actions/selections";

const STATUS_CHIP: Record<SelectionStatus, ChipKind> = {
  draft: "ghost",
  pending: "info",
  approved: "money",
  declined: "flag",
};

const STATUS_LABEL: Record<SelectionStatus, string> = {
  draft: "draft",
  pending: "needs your decision",
  approved: "approved",
  declined: "declined",
};

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Client-portal selections section. Picks are grouped by room with a budget
 *  that rolls up a running total + remaining as choices are approved. Pending
 *  ones get Approve / Decline (routes through the owner-or-scoped-client
 *  decideSelection action). */
export function ClientSelections({ view }: { view: SelectionsView }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function decide(id: number, approve: boolean) {
    setError("");
    startTransition(async () => {
      const r = await decideSelection(id, approve);
      if (!r.ok) setError(r.error ?? "Something went wrong.");
    });
  }

  if (view.groups.length === 0) {
    return <div className="mt-2 text-[12px] text-ink-3">Nothing to review right now.</div>;
  }

  const over = view.totalBudget > 0 && view.totalBudget - view.totalSpent < 0;

  return (
    <div className="mt-2 flex flex-col gap-3">
      {error && <div className="text-[11px] text-flag">{error}</div>}

      {view.totalBudget > 0 && (
        <Card kind="accent" className="p-2.5">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Budget so far</span>
            <span className="text-[12px] font-semibold text-ink">
              {fmt(view.totalSpent)} <span className="font-normal text-ink-3">of {fmt(view.totalBudget)}</span>
            </span>
          </div>
          <p className="mt-1 text-[11px]">
            <span className={over ? "text-flag" : "text-money"}>
              {over ? `${fmt(view.totalSpent - view.totalBudget)} over budget` : `${fmt(view.totalBudget - view.totalSpent)} remaining`}
            </span>
            {view.totalProposed > 0 && (
              <span className="text-ink-3"> · {fmt(view.totalProposed)} awaiting your decision</span>
            )}
          </p>
        </Card>
      )}

      {view.groups.map((g) => (
        <ClientSection key={g.id ?? "ungrouped"} group={g} pending={pending} onDecide={decide} />
      ))}
    </div>
  );
}

function ClientSection({
  group: g,
  pending,
  onDecide,
}: {
  group: SelectionGroup;
  pending: boolean;
  onDecide: (id: number, approve: boolean) => void;
}) {
  const over = g.remaining < 0;
  const showBudget = g.budget > 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-2">{g.name}</span>
        {showBudget && (
          <span className="text-[11px] text-ink-3">
            {fmt(g.spent)} / {fmt(g.budget)} ·{" "}
            <span className={over ? "text-flag" : "text-money"}>
              {over ? `${fmt(-g.remaining)} over` : `${fmt(g.remaining)} left`}
            </span>
          </span>
        )}
      </div>
      {g.selections.map((s) => (
        <ClientSelectionCard key={s.id} s={s} pending={pending} onDecide={onDecide} />
      ))}
    </div>
  );
}

function ClientSelectionCard({
  s,
  pending,
  onDecide,
}: {
  s: Selection;
  pending: boolean;
  onDecide: (id: number, approve: boolean) => void;
}) {
  return (
    <Card className="overflow-hidden p-0">
      {s.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.imageUrl} alt={s.choice} className="aspect-[4/3] w-full border-b border-rule object-cover" />
      ) : null}
      <div className="flex flex-col gap-1.5 p-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">{s.area}</span>
          {s.price > 0 && <span className="text-[11px] font-semibold text-ink-2">{fmt(s.price)}</span>}
        </div>
        <span className="text-[12px] leading-snug text-ink">{s.choice}</span>
        <div className="flex items-center gap-2">
          <Chip kind={STATUS_CHIP[s.status]} dot>
            {STATUS_LABEL[s.status]}
          </Chip>
          {s.status === "pending" && (
            <div className="ml-auto flex items-center gap-1.5">
              <button
                disabled={pending}
                onClick={() => onDecide(s.id, true)}
                className="inline-flex items-center gap-1 rounded-md border border-money/40 bg-money/10 px-2 py-1 text-[11px] font-semibold text-money hover:bg-money/20 disabled:opacity-50"
              >
                <Check className="size-3" strokeWidth={1.75} />
                Approve
              </button>
              <button
                disabled={pending}
                onClick={() => onDecide(s.id, false)}
                className="inline-flex items-center gap-1 rounded-md border border-rule px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-paper-2 hover:text-flag disabled:opacity-50"
              >
                <X className="size-3" strokeWidth={1.75} />
                Decline
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

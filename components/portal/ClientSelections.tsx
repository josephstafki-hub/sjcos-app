"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { ChipKind } from "@/components/ui/Chip";
import type {
  Selection, SelectionOption, SelectionStatus, SelectionsView, SelectionGroup,
} from "@/lib/selections";
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
  approved: "decided",
  declined: "you asked for other options",
};

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Client-portal selections. Each decision shows its options side by side with
 *  the price and how it sits against the allowance; the client picks one. Both
 *  numbers are deliberately visible — seeing "$200 over allowance" at decision
 *  time is what stops the surprise at invoice time. */
export function ClientSelections({ view }: { view: SelectionsView }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function choose(id: number, optionId: number) {
    setError("");
    startTransition(async () => {
      const r = await decideSelection(id, true, optionId);
      if (!r.ok) setError(r.error ?? "Something went wrong.");
    });
  }

  function declineAll(id: number) {
    setError("");
    startTransition(async () => {
      const r = await decideSelection(id, false);
      if (!r.ok) setError(r.error ?? "Something went wrong.");
    });
  }

  if (view.groups.length === 0) {
    return <div className="mt-2 text-[12px] text-ink-3">Nothing to review right now.</div>;
  }

  const over = view.totalBudget > 0 && view.totalBudget - view.totalSpent < 0;
  const pct =
    view.totalBudget > 0 ? Math.min(100, Math.round((view.totalSpent / view.totalBudget) * 100)) : 0;

  return (
    <div className="mt-2 flex flex-col gap-3">
      {error && <div className="text-[11px] text-flag">{error}</div>}

      {view.totalOpen > 0 && (
        <div className="text-[12px] font-semibold text-ink-2">
          {view.totalOpen} decision{view.totalOpen === 1 ? "" : "s"} waiting on you
        </div>
      )}

      {view.totalBudget > 0 ? (
        <Card kind="accent" className="p-2.5">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">
              Your selections vs. budget
            </span>
            <span className="text-[12px] font-semibold text-ink">
              {fmt(view.totalSpent)} <span className="font-normal text-ink-3">of {fmt(view.totalBudget)}</span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-paper-3">
            <div
              className={`h-full rounded-full ${over ? "bg-flag" : "bg-money"}`}
              style={{ width: `${over ? 100 : pct}%` }}
            />
          </div>
          <p className="mt-1 text-[11px]">
            <span className={over ? "text-flag" : "text-money"}>
              {over
                ? `${fmt(view.totalSpent - view.totalBudget)} over budget`
                : `${fmt(view.totalBudget - view.totalSpent)} remaining`}
            </span>
            {view.totalProposed > 0 && (
              <span className="text-ink-3"> · {fmt(view.totalProposed)} still to decide</span>
            )}
          </p>
        </Card>
      ) : (
        // No budget set yet — still keep the running total in front of the
        // client so a pick never disappears into the page.
        <Card kind="accent" className="p-2.5">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">
              Your selections so far
            </span>
            <span className="text-[12px] font-semibold text-ink">{fmt(view.totalSpent)}</span>
          </div>
          {view.totalProposed > 0 && (
            <p className="mt-1 text-[11px] text-ink-3">{fmt(view.totalProposed)} still to decide</p>
          )}
        </Card>
      )}

      {view.groups.map((g) => (
        <ClientSection
          key={g.id ?? "ungrouped"}
          group={g}
          depth={0}
          pending={pending}
          onChoose={choose}
          onDeclineAll={declineAll}
        />
      ))}
    </div>
  );
}

function ClientSection({
  group: g,
  depth,
  pending,
  onChoose,
  onDeclineAll,
}: {
  group: SelectionGroup;
  depth: number;
  pending: boolean;
  onChoose: (id: number, optionId: number) => void;
  onDeclineAll: (id: number) => void;
}) {
  const over = g.remaining < 0;
  const showBudget = g.budget > 0;
  return (
    <div className={`flex flex-col gap-2 ${depth ? "border-l border-rule-soft pl-3" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`font-mono uppercase tracking-[0.1em] ${
            depth ? "text-[9px] text-ink-3" : "text-[10px] text-ink-2"
          }`}
        >
          {g.name}
        </span>
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
        <ClientDecision
          key={s.id}
          s={s}
          pending={pending}
          onChoose={onChoose}
          onDeclineAll={onDeclineAll}
        />
      ))}
      {g.children.map((c) => (
        <ClientSection
          key={c.id}
          group={c}
          depth={depth + 1}
          pending={pending}
          onChoose={onChoose}
          onDeclineAll={onDeclineAll}
        />
      ))}
    </div>
  );
}

function ClientDecision({
  s,
  pending,
  onChoose,
  onDeclineAll,
}: {
  s: Selection;
  pending: boolean;
  onChoose: (id: number, optionId: number) => void;
  onDeclineAll: (id: number) => void;
}) {
  const open = s.status === "pending";
  return (
    <Card className="flex flex-col gap-2 p-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[12px] font-semibold text-ink">{s.area}</span>
        {s.allowance > 0 && (
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">
            allowance {fmt(s.allowance)}
          </span>
        )}
        <Chip kind={STATUS_CHIP[s.status]} dot>
          {STATUS_LABEL[s.status]}
        </Chip>
      </div>
      {s.choice && <p className="text-[11px] leading-snug text-ink-3">{s.choice}</p>}

      <div className="grid grid-cols-2 gap-2">
        {s.options.map((o) => (
          <ClientOption
            key={o.id}
            o={o}
            allowance={s.allowance}
            isChosen={o.id === s.chosenOptionId}
            selectable={open}
            pending={pending}
            onChoose={() => onChoose(s.id, o.id)}
          />
        ))}
      </div>

      {open && (
        <button
          disabled={pending}
          onClick={() => onDeclineAll(s.id)}
          className="inline-flex items-center gap-1 self-start rounded-md border border-rule px-2 py-1 text-[11px] font-semibold text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-50"
        >
          <X className="size-3" strokeWidth={1.75} />
          None of these — show me others
        </button>
      )}
    </Card>
  );
}

function ClientOption({
  o,
  allowance,
  isChosen,
  selectable,
  pending,
  onChoose,
}: {
  o: SelectionOption;
  allowance: number;
  isChosen: boolean;
  selectable: boolean;
  pending: boolean;
  onChoose: () => void;
}) {
  const delta = allowance > 0 && o.price > 0 ? o.price - allowance : 0;
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-md border ${
        isChosen ? "border-money ring-1 ring-money/30" : "border-rule"
      }`}
    >
      {o.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={o.imageUrl} alt={o.name} className="aspect-[4/3] w-full border-b border-rule object-cover" />
      ) : (
        <div className="aspect-[4/3] border-b border-rule bg-paper-3" />
      )}
      <div className="flex flex-1 flex-col gap-0.5 p-2">
        {o.brand && (
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">{o.brand}</span>
        )}
        <span className="text-[11px] leading-snug text-ink">{o.name}</span>
        {o.price > 0 && (
          <span className="text-[11px] font-semibold text-ink-2">
            {fmt(o.price)}
            {delta !== 0 && (
              <span className={`ml-1 font-normal ${delta > 0 ? "text-flag" : "text-money"}`}>
                {delta > 0 ? `${fmt(delta)} over` : `${fmt(-delta)} under`}
              </span>
            )}
          </span>
        )}
        {o.note && <span className="text-[10px] leading-snug text-ink-3">{o.note}</span>}
        <div className="mt-auto pt-1.5">
          {isChosen ? (
            <Chip kind="money" dot>your pick</Chip>
          ) : (
            selectable && (
              <button
                disabled={pending}
                onClick={onChoose}
                className="inline-flex w-full items-center justify-center gap-1 rounded border border-money/40 bg-money/10 px-2 py-1 text-[11px] font-semibold text-money hover:bg-money/20 disabled:opacity-50"
              >
                <Check className="size-3" strokeWidth={1.75} />
                Choose this
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

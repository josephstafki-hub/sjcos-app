"use client";
import { Check, ChevronDown, Clock, ArrowUpRight } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { useTodayQueue } from "./TodayQueueContext";
import { AssignmentLine, QueueActions } from "./QueueActions";
import type { TodayPriority } from "@/lib/today";

export function TodayPriorityRow({
  p,
  open,
  onToggle,
  onHandOff,
}: {
  p: TodayPriority;
  open: boolean;
  onToggle: () => void;
  onHandOff: (p: TodayPriority, kind: "do" | "prep") => void;
}) {
  const { busyId, checkingId, complete, snooze } = useTodayQueue();
  const busy = busyId === p.id || checkingId === p.id;
  if (p.id === "all-clear")
    return (
      <EmptyState
        icon={Check}
        title="Your list is clear"
        description="New to-dos and project follow-ups will appear here. Use Done or Snoozed to bring work back."
        compact
      />
    );
  return (
    <div data-today-item className={`group rounded-md ${busy ? "opacity-60" : ""}`}>
      <div
        className={`flex items-start gap-2 px-2 py-3 hover:bg-hover ${open ? "bg-hover" : ""}`}
      >
        {p.checkable ? (
          <Button
            icon={Check}
            iconOnly
            aria-label={`Mark ${p.title} done`}
            title="Mark done"
            size="sm"
            onClick={() => void complete(p.id)}
            disabled={busy}
            className="mt-0.5 text-ink-3 max-sm:size-11"
          />
        ) : (
          <span className="mt-3 size-2 shrink-0 rounded-full bg-accent" />
        )}
        <button
          type="button"
          data-today-row={p.id}
          data-checkable={p.checkable}
          aria-expanded={open}
          onClick={onToggle}
          className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-focus"
        >
          <span className="block text-subheading font-semibold text-ink">
            {p.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-3">
            <span className="font-mono">{p.rank}</span>
            <span>{p.group?.name ?? p.tag}</span>
            {p.due && <span aria-hidden className={`size-1.5 rounded-full ${p.overdue ? "bg-flag" : "bg-warn"}`} />}
            {p.due && <DueLabel due={p.due} overdue={p.overdue} />}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {p.href && <Button href={p.href} icon={ArrowUpRight} iconOnly aria-label={`Open ${p.title}`} title="Open" size="sm" className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100" />}
          {p.checkable && (
            <Button
              icon={Clock}
              iconOnly
              aria-label={`Snooze ${p.title} for 3 days`}
              title="Snooze 3 days"
              size="sm"
              disabled={busy}
              onClick={() => void snooze(p.id)}
              className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
            />
          )}
          <Button
            icon={ChevronDown}
            iconOnly
            aria-label={`${open ? "Collapse" : "Expand"} ${p.title}`}
            title={open ? "Collapse" : "Expand"}
            size="sm"
            aria-expanded={open}
            onClick={onToggle}
            className={open ? "rotate-180" : ""}
          />
        </div>
      </div>
      {open && (
        <div className="space-y-3 px-3 pb-4 pt-1">
          <p className="whitespace-pre-line text-body text-ink-2">{p.sub}</p>
          {p.assignment && <AssignmentLine assignment={p.assignment} />}
          <QueueActions p={p} place="card" onHandOff={onHandOff} />
        </div>
      )}
    </div>
  );
}
export function DueLabel({ due, overdue }: { due: string; overdue?: boolean }) {
  return (
    <span
      className={`shrink-0 text-meta ${overdue ? "text-flag" : "text-ink-3"}`}
    >
      Due {due}
    </span>
  );
}

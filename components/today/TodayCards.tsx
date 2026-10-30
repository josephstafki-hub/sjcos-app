"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { todayShortcut } from "@/lib/today-keyboard";
import { raiseHandOff } from "@/components/panel/panelBus";
import type { TodayPriority } from "@/lib/today";
import { useTodayQueue } from "./TodayQueueContext";
import { TodayPriorityRow } from "./TodayPriorityRow";
import { Segmented } from "@/components/ui";
import { TodayRecovery } from "./TodayRecovery";
import { QueueList } from "./QueueList";

/** The Today main column: the pinned AI brief, then ONE list — its top five as
 *  expandable rows under "Up next", the rest continuing below (QueueList).
 *  Cards and rows move between the two with "↓ Back to list" / "↑ Up next".
 *  "Have AI do it" / "Prep me" raise the hand-off to the operator panel
 *  (docked beside this page, or a popped-out panel window). */
export function TodayCards({ brief }: { brief: ReactNode }) {
  const [view, setView] = useState("active");
  const { priorities, waiting, complete, snooze, busyId } = useTodayQueue();
  const listRef = useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (view !== "active" || busyId || !target ||
          (target !== document.body && !listRef.current?.contains(target)) ||
          target.closest('[role="dialog"], [role="menu"], details[open]')) return;
      const action = todayShortcut({ key: event.key, tagName: target.tagName,
        isContentEditable: target.isContentEditable, metaKey: event.metaKey, ctrlKey: event.ctrlKey,
        altKey: event.altKey, shiftKey: event.shiftKey, isComposing: event.isComposing, repeat: event.repeat });
      if (!action) return;
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-today-row]') ?? []);
      const current = rows.findIndex(row => row.closest('[data-today-item]')?.contains(target));
      if (action === "next" || action === "previous") {
        const next = current < 0 ? (action === "next" ? 0 : rows.length - 1) :
          Math.min(rows.length - 1, Math.max(0, current + (action === "next" ? 1 : -1)));
        if (rows[next]) { event.preventDefault(); rows[next].focus(); }
      } else if (current >= 0 && rows[current].dataset.checkable === "true") {
        event.preventDefault();
        const id = rows[current].dataset.todayRow!;
        if (action === "done") void complete(id);
        else void snooze(id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, busyId, complete, snooze]);

  const handOff = (p: TodayPriority, kind: "do" | "prep") =>
    raiseHandOff(p, kind);
  const shown = priorities.filter((p) => p.id !== "all-clear").length;
  const onYou = shown + waiting.filter((w) => !w.waitingOnSub).length;

  return (
    <section className="flex min-w-0 flex-col gap-6">
      {brief}
      <Segmented
        aria-label="Today work views"
        className="max-sm:h-12 [&_button]:max-sm:h-11"
        value={view}
        onChange={setView}
        options={[
          { value: "active", label: "Work list", count: onYou },
          { value: "done", label: "Done" },
          { value: "snoozed", label: "Snoozed" },
        ]}
      />
      {view !== "active" ? (
        <TodayRecovery key={view} view={view as "done" | "snoozed"} />
      ) : (
        <div ref={listRef} className="flex min-w-0 flex-col gap-6">
          <div>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="font-serif text-heading text-ink">Up next</span>
              {shown > 0 && (
                <span className="text-meta text-ink-3">
                  {shown} of {onYou}
                </span>
              )}
            </div>
            <div className="divide-y divide-rule-soft rounded-lg border border-rule-soft bg-card shadow-card">
              {priorities.map((p) => (
                <TodayPriorityRow key={p.id} p={p} open={openId === p.id} onToggle={() => setOpenId(id => id === p.id ? null : p.id)} onHandOff={handOff} />
              ))}
            </div>
          </div>
          <QueueList onHandOff={handOff} />
          <p className="text-meta text-ink-3 max-sm:hidden"><kbd>j</kbd> / <kbd>k</kbd> move · <kbd>e</kbd> mark done · <kbd>s</kbd> snooze 3 days</p>
        </div>
      )}
    </section>
  );
}

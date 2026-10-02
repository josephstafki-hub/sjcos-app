"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { AssignedTo } from "@/lib/queue-scope";

/** Who's on a to-do, as a checklist — Joe, Abigail, both, or anyone on the team
 *  (Joe, 2026-09-30: "assignable to both me and abigail … instead of either
 *  or"). Shared by the Today card and the /engine board.
 *
 *  What's ticked is exactly who's on it. Nobody stored means the owner's own, so
 *  that shows as the owner ticked — and the last ticked person can't be
 *  unticked, because "nobody" isn't a state a to-do can be in. Each tick saves
 *  straight away (the server drops "just the owner" back to nobody, so there's
 *  one spelling of his own), and the list stays open so several people can be
 *  ticked in a row. Owner-only: callers render it only for him. */
export function AssigneePicker({
  roster,
  assigned,
  onChange,
  disabled,
  trigger,
  triggerClassName,
  align = "left",
}: {
  /** Owner first, then active staff (lib/today.ts / lib/engine.ts order it). */
  roster: AssignedTo[];
  /** Everyone on it now. Empty = the owner's own. */
  assigned: AssignedTo[];
  onChange: (userIds: string[]) => void | Promise<void>;
  disabled?: boolean;
  trigger: ReactNode;
  triggerClassName: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on a click anywhere else, or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const owner = roster[0];
  const ticked = new Set(
    assigned.length ? assigned.map((a) => a.userId) : owner ? [owner.userId] : [],
  );

  const toggle = (userId: string) => {
    const next = new Set(ticked);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    if (!next.size) return;
    void onChange([...next]);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          className={`absolute top-full z-20 mt-1 w-[210px] overflow-hidden rounded-md border border-rule bg-paper shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="border-b border-rule px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-4">
            Who&apos;s on it
          </div>
          {roster.map((person) => {
            const on = ticked.has(person.userId);
            const onlyOne = on && ticked.size === 1;
            return (
              <button
                key={person.userId}
                type="button"
                onClick={() => toggle(person.userId)}
                disabled={disabled || onlyOne}
                title={onlyOne ? "Someone has to be on it — tick another person first" : undefined}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-paper-2 disabled:cursor-default disabled:hover:bg-transparent ${
                  on ? "font-semibold text-accent-2" : "text-ink-2"
                }`}
              >
                <span
                  className={`grid size-[14px] flex-none place-items-center rounded-[3px] border ${
                    on ? "border-accent bg-accent text-white" : "border-ink-4"
                  }`}
                >
                  {on && <Check className="size-2.5" strokeWidth={3} />}
                </span>
                <span className="grid size-[18px] flex-none place-items-center rounded-full bg-paper-3 font-mono text-[9px] text-ink-3">
                  {person.initials}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {person === owner ? `Me (${firstName(person.name)})` : person.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "Joe + Abigail" — everyone on a to-do by first name; the owner's own when
 *  nobody is. For tight spots like the /engine card's control. */
export function assigneeSummary(assigned: AssignedTo[], roster: AssignedTo[]): string {
  if (!assigned.length) return `On me (${firstName(roster[0]?.name ?? "Joe")})`;
  return assigned.map((a) => firstName(a.name)).join(" + ");
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

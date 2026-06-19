"use client";

import { useState } from "react";
import type { TodayCalDay } from "@/lib/today";

const DOT: Record<string, string> = {
  flag: "bg-flag",
  accent: "bg-accent",
  ai: "bg-ai",
  money: "bg-money",
  ghost: "bg-ink-4",
};

/** Week strip whose day cells expand an inline summary of that day's schedule
 *  blocks (instead of navigating away to /schedule). */
export function WeekStrip({ week }: { week: TodayCalDay[] }) {
  // Default the open day to today.
  const todayIso = week.find((d) => d.today)?.iso ?? null;
  const [openIso, setOpenIso] = useState<string | null>(todayIso);

  const open = week.find((d) => d.iso === openIso) ?? null;

  return (
    <div>
      <div className="flex gap-1.5">
        {week.map((d) => {
          const selected = d.iso === openIso;
          return (
            <button
              key={d.iso}
              onClick={() => setOpenIso((cur) => (cur === d.iso ? null : d.iso))}
              className={[
                "flex-1 rounded border py-1.5 text-center transition-colors",
                selected ? "border-ink ring-1 ring-ink" : "border-rule",
                d.today
                  ? "bg-ink text-paper hover:bg-ink-2"
                  : "bg-paper text-ink-2 hover:bg-paper-2",
              ].join(" ")}
            >
              <div className="font-mono text-[9px] opacity-70">{d.dow}</div>
              <div className="font-mono text-[16px] font-semibold leading-tight tabular-nums">
                {d.day}
              </div>
              {d.blocks.length > 0 && (
                <div
                  className={[
                    "mx-auto mt-0.5 size-1 rounded-full",
                    d.today ? "bg-paper/70" : "bg-accent",
                  ].join(" ")}
                />
              )}
            </button>
          );
        })}
      </div>

      {open && (
        <div className="mt-2 rounded-md border border-rule bg-paper-2 p-2.5">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
            {dayHeading(open)}
          </div>
          {open.blocks.length === 0 ? (
            <div className="text-[12px] text-ink-3">Nothing scheduled.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {open.blocks.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-12 font-mono text-[11px] tabular-nums text-ink-3">
                    {b.time}
                  </span>
                  <span className={`size-1.5 rounded-full ${DOT[b.dot]}`} />
                  <span className="text-[12.5px] text-ink">{b.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** "MON JUN 16 · TODAY" heading for the open day, parsed from its ISO date
 *  (constructed in local time to avoid a UTC day-shift). */
function dayHeading(d: TodayCalDay): string {
  const [y, m, day] = d.iso.split("-").map(Number);
  const date = new Date(y, m - 1, day);
  const label = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${label}${d.today ? " · today" : ""}`;
}

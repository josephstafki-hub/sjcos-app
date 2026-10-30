"use client";

import Link from "next/link";
import { formatScheduleTime } from "@/lib/schedule-time";
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
  const [showAll, setShowAll] = useState(false);

  const open = week.find((d) => d.iso === openIso) ?? null;

  return (
    <div>
      <div className="flex gap-1.5">
        {week.map((d) => {
          const selected = d.iso === openIso;
          return (
            <button
              key={d.iso}
              aria-label={`${d.dow} ${d.day}`}
              aria-pressed={selected}
              onClick={() => { setOpenIso((cur) => (cur === d.iso ? null : d.iso)); setShowAll(false); }}
              className={[
                "min-h-11 min-w-0 flex-1 rounded-md border py-2 text-center transition-colors focus-visible:outline-2 focus-visible:outline-focus",
                selected ? "border-accent bg-selected" : "border-rule",
                d.today
                  ? "bg-selected text-ink hover:bg-accent-soft"
                  : "bg-paper text-ink-2 hover:bg-paper-2",
              ].join(" ")}
            >
              <div className="text-meta opacity-70">{d.dow}</div>
              <div className="text-subheading font-semibold leading-tight tabular-nums">
                {d.day}
              </div>
              {d.blocks.length > 0 && (
                <div
                  className={[
                    "mx-auto mt-0.5 size-1 rounded-full",
                    "bg-accent",
                  ].join(" ")}
                />
              )}
            </button>
          );
        })}
      </div>

      <Link href="/schedule" className="mt-2 block text-meta text-accent-2 underline">Open schedule</Link>
      {open && (
        <div className="mt-2 rounded-md border border-rule bg-paper-2 p-2.5">
          <div className="mb-1.5 text-meta text-ink-3">
            {dayHeading(open)}
          </div>
          {open.blocks.length === 0 ? (
            <div className="text-meta text-ink-3">Nothing scheduled.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {open.blocks.slice(0, showAll ? undefined : 2).map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-meta tabular-nums text-ink-2">
                    {formatScheduleTime(b.time)}
                  </span>
                  <span className={`size-1.5 rounded-full ${DOT[b.dot]}`} />
                  <span className="min-w-0 text-body text-ink">{b.label}{formatScheduleTime(b.time) === "Time needs review" && <Link href={`/schedule?day=${open.iso}`} className="ml-2 text-accent-2 underline">Edit time</Link>}</span>
                </div>
              ))}
              {open.blocks.length > 2 && <button type="button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)} className="min-h-11 rounded text-left text-meta text-accent-2 underline focus-visible:outline-2 focus-visible:outline-focus">{showAll ? "Show fewer events" : `Show ${open.blocks.length - 2} more events`}</button>}
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

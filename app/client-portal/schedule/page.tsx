import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, Eyebrow } from "@/components/ui";
import { portalSlug } from "@/lib/client-portal";
import { getProjectScheduleBlocks, type ProjectScheduleBlock } from "@/lib/schedule";

// Client-portal schedule: a month calendar of the project's blocks (prev/next
// month via ?m=YYYY-MM) with the near-term list underneath. Read-only — the
// schedule is Joe's to move; the client's job is to know who's showing up and
// when.

const pad = (n: number) => String(n).padStart(2, "0");
const monthKey = (y: number, m: number) => `${y}-${pad(m)}`; // m is 1-based
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function PortalSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const slug = await portalSlug();
  const blocks = slug ? await getProjectScheduleBlocks(slug) : [];

  // Server-local date is fine — schedule granularity is a day.
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const { m } = await searchParams;
  const parsed = /^(\d{4})-(\d{2})$/.exec(m ?? "");
  const year = parsed ? Number(parsed[1]) : now.getFullYear();
  const month = parsed ? Number(parsed[2]) : now.getMonth() + 1; // 1-based

  const byDay = new Map<string, ProjectScheduleBlock[]>();
  for (const b of blocks) {
    const list = byDay.get(b.iso);
    if (list) list.push(b);
    else byDay.set(b.iso, [b]);
  }

  // Calendar cells: leading blanks to align day 1 under its weekday, then the
  // month's days. (No trailing-month spillover — blank cells read cleaner.)
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const prev = month === 1 ? monthKey(year - 1, 12) : monthKey(year, month - 1);
  const next = month === 12 ? monthKey(year + 1, 1) : monthKey(year, month + 1);

  const upcoming = blocks.filter((b) => b.iso >= todayIso).slice(0, 10);

  return (
    <main className="mx-auto w-full max-w-4xl px-9 py-7">
      <Eyebrow>Schedule</Eyebrow>
      <h1 className="mt-1 font-serif text-[26px] font-medium leading-tight text-accent-2">
        Who&apos;s coming, and when.
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
        The working schedule for your project. Dates can shift with weather and
        inspections — anything that moves shows up here first.
      </p>
      <div className="my-5 border-t border-rule" />

      {blocks.length === 0 ? (
        <p className="text-[13.5px] leading-relaxed text-ink-3">
          No schedule posted yet. Once the work is sequenced, the plan will appear here.
        </p>
      ) : (
        <>
          {/* month header */}
          <div className="flex items-center gap-2">
            <h2 className="flex-1 font-serif text-[17px] font-semibold text-ink">{monthLabel}</h2>
            <Link
              href={`/client-portal/schedule?m=${prev}`}
              aria-label="Previous month"
              className="rounded-md border border-rule p-1.5 text-ink-2 hover:bg-paper-2"
            >
              <ChevronLeft className="size-3.5" strokeWidth={1.75} />
            </Link>
            <Link
              href="/client-portal/schedule"
              className="rounded-md border border-rule px-2 py-1 text-[11px] font-medium text-ink-2 hover:bg-paper-2"
            >
              Today
            </Link>
            <Link
              href={`/client-portal/schedule?m=${next}`}
              aria-label="Next month"
              className="rounded-md border border-rule p-1.5 text-ink-2 hover:bg-paper-2"
            >
              <ChevronRight className="size-3.5" strokeWidth={1.75} />
            </Link>
          </div>

          {/* calendar grid */}
          <div className="mt-3 overflow-hidden rounded-lg border border-rule">
            <div className="grid grid-cols-7 border-b border-rule bg-paper-2">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="px-2 py-1.5 text-center font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3"
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((day, i) => {
                const iso = day ? `${year}-${pad(month)}-${pad(day)}` : "";
                const dayBlocks = day ? (byDay.get(iso) ?? []) : [];
                const isToday = iso === todayIso;
                const isPast = !!iso && iso < todayIso;
                return (
                  <div
                    key={i}
                    className={`min-h-[86px] border-b border-r border-rule-soft p-1.5 [&:nth-child(7n)]:border-r-0 ${
                      day ? (isPast ? "bg-paper opacity-60" : "bg-card") : "bg-paper-2"
                    }`}
                  >
                    {day && (
                      <>
                        <span
                          className={`inline-flex size-5 items-center justify-center rounded-full font-mono text-[10px] ${
                            isToday ? "bg-accent font-semibold text-white" : "text-ink-3"
                          }`}
                        >
                          {day}
                        </span>
                        <div className="mt-0.5 flex flex-col gap-0.5">
                          {dayBlocks.slice(0, 3).map((b) => (
                            <div key={b.id} className="flex items-center gap-1">
                              <span
                                className={`size-1.5 flex-none rounded-full ${
                                  b.tone === "accent"
                                    ? "bg-accent"
                                    : b.tone === "ai"
                                      ? "bg-ai"
                                      : "bg-ink-4"
                                }`}
                              />
                              <span className="min-w-0 truncate text-[10.5px] leading-tight text-ink-2">
                                {b.label}
                              </span>
                            </div>
                          ))}
                          {dayBlocks.length > 3 && (
                            <span className="font-mono text-[9px] text-ink-3">
                              +{dayBlocks.length - 3} more
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* near-term detail */}
          {upcoming.length > 0 && (
            <>
              <div className="my-5 border-t border-rule" />
              <Eyebrow muted>Coming up</Eyebrow>
              <div className="mt-2 flex flex-col gap-2">
                {groupDays(upcoming).map((day) => (
                  <Card key={day.iso} className="p-2.5">
                    <div className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
                      {day.dateLabel}
                    </div>
                    <div className="mt-1.5 flex flex-col gap-1.5">
                      {day.items.map((b) => (
                        <div key={b.id} className="flex items-center gap-2">
                          <span
                            className={`size-1.5 flex-none rounded-full ${
                              b.tone === "accent" ? "bg-accent" : b.tone === "ai" ? "bg-ai" : "bg-ink-4"
                            }`}
                          />
                          <span className="min-w-0 flex-1 text-[12.5px] text-ink">{b.label}</span>
                          <span className="font-mono text-[10px] text-ink-3">{b.time}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}

function groupDays(blocks: ProjectScheduleBlock[]) {
  const days: { iso: string; dateLabel: string; items: ProjectScheduleBlock[] }[] = [];
  for (const b of blocks) {
    const last = days[days.length - 1];
    if (last && last.iso === b.iso) last.items.push(b);
    else days.push({ iso: b.iso, dateLabel: b.dateLabel, items: [b] });
  }
  return days;
}

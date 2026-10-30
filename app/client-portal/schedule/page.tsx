import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, Eyebrow } from "@/components/ui";
import { schedulePresentation } from "@/lib/portal-presentation";
import { getPortalProjectUpdate } from "@/lib/client-portal";
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
  const [blocks, update] = slug ? await Promise.all([getProjectScheduleBlocks(slug), getPortalProjectUpdate(slug)]) : [[], null];

  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const { m } = await searchParams;
  const view = schedulePresentation(blocks, todayIso, m);
  const [year, month] = view.month.split("-").map(Number);

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

  const nextEvent = view.upcoming[0];
  const upcoming = view.upcoming.filter((b) => b.iso.startsWith(view.month));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-7 @3xl/page:px-8 [&>*]:max-w-4xl">
      <Eyebrow>Schedule</Eyebrow>
      <h1 className="mt-1 font-serif text-title font-medium leading-tight text-accent-2">
        Who&apos;s coming, and when.
      </h1>
      <p className="mt-1.5 text-body leading-relaxed text-ink-2">
        The working schedule for your project. Dates can shift with weather and
        inspections — anything that moves shows up here first.
      </p>
      <div className="my-5 border-t border-rule" />

      {nextEvent && <Card className="mb-4 p-3"><p className="text-meta text-ink-3">Next posted work · {nextEvent.dateLabel} · {nextEvent.time}</p><p className="mt-1 text-subheading font-semibold text-ink">{nextEvent.label}</p><Link href={`/client-portal/schedule?m=${nextEvent.iso.slice(0, 7)}#month-agenda`} className="mt-2 inline-flex min-h-11 items-center text-body font-semibold text-accent-2 underline">Jump to this event’s month</Link></Card>}

      {!nextEvent && <Card className="mb-4 p-4"><h2 className="font-serif text-heading font-semibold">No upcoming work posted yet</h2><p className="mt-2 text-body text-ink-3">Joe will post dates here once work is scheduled.</p><Link href="/client-portal/messages" className="mt-2 inline-flex min-h-11 items-center text-body font-semibold text-accent-2 underline">Message Joe</Link></Card>}
      {update?.body && <details className="mb-4 text-body text-ink-2"><summary className="cursor-pointer font-semibold">Dates mentioned in Joe’s update</summary><p className="mt-2">Expected — not yet scheduled unless also posted in the schedule below.</p><p className="mt-2 whitespace-pre-wrap">{update.body}</p></details>}
      {blocks.length > 0 && (
        <>
          {/* month header */}
          <div className="flex items-center gap-2">
            <h2 className="flex-1 font-serif text-heading font-semibold text-ink">{monthLabel}</h2>
            <Link
              href={`/client-portal/schedule?m=${prev}`}
              aria-label="Previous month"
              className="inline-flex size-11 items-center justify-center rounded-md border border-rule text-ink-2 hover:bg-paper-2"
            >
              <ChevronLeft className="size-3.5" strokeWidth={1.75} />
            </Link>
            <Link
              href={`/client-portal/schedule?m=${todayIso.slice(0, 7)}`}
              className="inline-flex min-h-11 items-center rounded-md border border-rule px-3 text-meta font-medium text-ink-2 hover:bg-paper-2"
            >
              Today
            </Link>
            <Link
              href={`/client-portal/schedule?m=${next}`}
              aria-label="Next month"
              className="inline-flex size-11 items-center justify-center rounded-md border border-rule text-ink-2 hover:bg-paper-2"
            >
              <ChevronRight className="size-3.5" strokeWidth={1.75} />
            </Link>
          </div>

          {/* calendar grid */}
          <div className="mt-3 hidden @2xl/page:block overflow-hidden rounded-lg border border-rule">
            <div className="grid grid-cols-7 border-b border-rule bg-paper-2">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="px-2 py-1.5 text-center font-sans text-meta text-ink-3"
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
                          className={`inline-flex size-5 items-center justify-center rounded-full font-sans text-meta ${
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
                              <span className="min-w-0 truncate text-meta leading-tight text-ink-2">
                                {b.label}
                              </span>
                            </div>
                          ))}
                          {dayBlocks.length > 3 && (
                            <span className="font-sans text-meta text-ink-3">
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

          {upcoming.length === 0 && <p className="mt-4 text-body text-ink-3">No work scheduled in {monthLabel}. {nextEvent ? "The next posted event is shown above." : "Message Joe to ask about upcoming dates."}</p>}
          {/* Upcoming agenda for the chosen month; past work lives in History. */}
          {upcoming.length > 0 && (
            <>
              <div className="my-5 border-t border-rule" />
              <Eyebrow muted>Upcoming work this month</Eyebrow>
              <div id="month-agenda" className="mt-2 flex scroll-mt-4 flex-col gap-2">
                {groupDays(upcoming).map((day) => (
                  <Card key={day.iso} className="p-2.5">
                    <div className="font-sans text-meta font-medium text-ink-3">
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
                          <span className="min-w-0 flex-1 text-body text-ink">{b.label}</span>
                          <span className="font-sans text-meta text-ink-3">{b.time}</span>
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
      {view.past.length > 0 && <section className="mt-8"><h2 className="font-serif text-heading font-semibold">History</h2><p className="mt-1 text-meta text-ink-3">Past posted work · most recent first</p><div className="mt-3 divide-y divide-rule-soft">{groupDays(view.past).map(day => <div key={day.iso} className="py-3"><p className="text-meta text-ink-3">{day.dateLabel}</p>{day.items.map(b => <div key={b.id} className="mt-1 flex flex-wrap justify-between gap-2 text-body"><span>{b.label}</span><span className="text-ink-3">{b.time}</span></div>)}</div>)}</div></section>}
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

import Link from "next/link";
import { Suspense } from "react";
import { AiBubble, Card, Chip } from "@/components/ui";
import { CommandBar } from "@/components/cmdk/CommandBar";
import { TodayPriorities } from "./TodayPriorities";
import { WeekStrip } from "./WeekStrip";
import { WaitingList, WaitingCount } from "./WaitingList";
import { TodayQueueProvider } from "./TodayQueueContext";
import { getTodayBrief, type BriefInput, type TodayData } from "@/lib/today";
import { todayContext } from "@/lib/page-context";

const DOT: Record<string, string> = {
  flag: "bg-flag",
  accent: "bg-accent",
  ai: "bg-ai",
  money: "bg-money",
  ghost: "bg-ink-4",
};

/** Inner content of the Today dashboard. Shared by /today (embeds the Ask
 *  bar inline) and the /cmdk deep-link (renders Today behind the open
 *  command-bar popup instead). */
export function TodayBody({ data, embedAsk }: { data: TodayData; embedAsk?: boolean }) {
  return (
    <div className="mx-auto max-w-[1100px] px-7 py-6">
      {/* Header strip */}
      <div className="mb-3.5 flex items-end gap-4">
        <div className="flex-1">
          <h1 className="font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
            {data.greeting}
          </h1>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            {data.weekLabel}
          </div>
          <div className="flex gap-1.5">
            {data.headerChips.map((c) => (
              <Chip key={c.label} kind={c.kind} dot>
                {c.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      {embedAsk && (
        <div className="mb-3.5">
          <CommandBar embedded aiContext={todayContext(data)} />
        </div>
      )}

      {/* AI brief */}
      <AiBubble
        actions={
          <Link
            href="/schedule"
            className="rounded-md bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2"
          >
            Open agenda
          </Link>
        }
      >
        <div className="mb-1 font-serif text-[13.5px] font-semibold text-ai-2">
          {data.briefHeadline}
        </div>
        <Suspense fallback={<BriefSkeleton />}>
          <BriefText inputs={data.briefInputs} />
        </Suspense>
      </AiBubble>

      {/* Two-column body. Priorities + Waiting on me share click-to-check
          state via TodayQueueProvider (a context, not a wrapping element)
          so they stay siblings for the grid — see TodayQueueContext.tsx. */}
      <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-[1.4fr_1fr]">
        <TodayQueueProvider initialPriorities={data.priorities} initialWaiting={data.waiting}>
          {/* Priorities (client — has a working Re-prioritize button) */}
          <TodayPriorities />

          {/* Right rail */}
          <aside className="flex flex-col gap-3">
            <div>
              <h2 className="mb-1.5 font-serif text-[16px] font-semibold text-ink">This week</h2>
              <WeekStrip week={data.week} />
            </div>

            <Card className="p-3">
              <h3 className="font-serif text-[13.5px] font-semibold text-ink">Today&apos;s schedule</h3>
              <div className="mt-2 flex flex-col gap-1.5">
                {data.schedule.map((s, i) => {
                  const row = (
                    <>
                      <span className="w-9 font-mono text-[11px] tabular-nums text-ink-3">{s.time}</span>
                      <span className={`size-1.5 rounded-full ${DOT[s.dot]}`} />
                      <span className="text-[13px] text-ink">{s.label}</span>
                    </>
                  );
                  return s.href ? (
                    <Link
                      key={i}
                      href={s.href}
                      className="-mx-1 flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-paper-2"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div key={i} className="flex items-center gap-2">
                      {row}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card kind="tan" className="p-3">
              <div className="flex items-center">
                <h3 className="flex-1 font-serif text-[13.5px] font-semibold text-ink">
                  Waiting on me
                </h3>
                <WaitingCount />
              </div>
              <WaitingList />
            </Card>
          </aside>
        </TodayQueueProvider>
      </div>
    </div>
  );
}

/** Async server component: awaits the AI brief inside the Suspense boundary so
 *  the rest of the page can stream immediately. */
async function BriefText({ inputs }: { inputs: BriefInput }) {
  const text = await getTodayBrief(inputs);
  return <div>{text}</div>;
}

/** Shimmer shown while the brief is being composed. */
function BriefSkeleton() {
  return (
    <div className="space-y-1.5" aria-hidden>
      <div className="h-3 w-[92%] animate-pulse rounded bg-ai/15" />
      <div className="h-3 w-[78%] animate-pulse rounded bg-ai/15" />
      <div className="h-3 w-[40%] animate-pulse rounded bg-ai/15" />
    </div>
  );
}

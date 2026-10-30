import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui";
import { TodayCards } from "./TodayCards";
import { WeekStrip } from "./WeekStrip";
import { TodayQueueProvider } from "./TodayQueueContext";
import { getTodayBrief, type BriefInput, type TodayData } from "@/lib/today";

const DOT: Record<string, string> = {
  flag: "bg-flag",
  accent: "bg-accent",
  ai: "bg-ai",
  money: "bg-money",
  ghost: "bg-ink-4",
};

/** The full work list stays on Today, alongside the compact dock queue. */
export function TodayBody({ data }: { data: TodayData }) {
  const brief = !data.canAssign ? null : (
    <div className="rounded-lg border border-ai/20 bg-card p-4 shadow-card">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-subheading text-ai-2">
          <Sparkles className="size-4" />
          {data.briefHeadline}
        </h2>
        <Button href="/schedule" variant="ghost" size="sm">
          Open agenda
        </Button>
      </div>
      <div className="text-body text-ink-2">
        <Suspense fallback={<BriefSkeleton />}>
          <BriefText inputs={data.briefInputs} />
        </Suspense>
      </div>
    </div>
  );
  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6 @2xl/page:px-5 @5xl/page:px-8">
      <PageHeader
        title={data.greeting}
        meta={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <span>{data.weekLabel.toLowerCase()}</span>
            {data.headerChips.map((c) => (
              <span key={c.label}>{c.label}</span>
            ))}
          </span>
        }
      />
      <TodayQueueProvider
        initialPriorities={data.priorities}
        initialWaiting={data.waiting}
        canAssign={data.canAssign}
        assignees={data.assignees}
        canPromote={data.canAssign}
      >
        <div className="mt-6 grid min-w-0 grid-cols-1 gap-6 @4xl/page:grid-cols-[minmax(0,1fr)_300px]">
          <TodayCards brief={brief} />
          <aside className="flex min-w-0 flex-col gap-6">
            <section>
              <h2 className="mb-3 font-serif text-heading text-ink">
                This week
              </h2>
              <WeekStrip week={data.week} />
            </section>
            <Card className="p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-serif text-heading text-ink">
                  Today&apos;s schedule
                </h2>
                <Button href="/schedule" variant="ghost" size="sm">
                  View
                </Button>
              </div>
              <div className="mt-3 divide-y divide-rule-soft">
                {data.schedule.length === 0 && (
                  <p className="py-3 text-body text-ink-3">
                    No events scheduled for today. Add time on the schedule.
                  </p>
                )}
                {data.schedule.map((s, i) => {
                  const row = (
                    <>
                      <span className="w-12 shrink-0 text-meta tabular-nums text-ink-3">
                        {s.time}
                      </span>
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${DOT[s.dot]}`}
                      />
                      <span className="min-w-0 text-body text-ink">
                        {s.label}
                      </span>
                    </>
                  );
                  return s.href ? (
                    <Button
                      key={i}
                      href={s.href}
                      variant="ghost"
                      className="h-auto w-full justify-start whitespace-normal px-0 py-3 text-left font-normal"
                    >
                      {row}
                    </Button>
                  ) : (
                    <div key={i} className="flex items-center gap-2 py-3">
                      {row}
                    </div>
                  );
                })}
              </div>
            </Card>
          </aside>
        </div>
      </TodayQueueProvider>
    </div>
  );
}
async function BriefText({ inputs }: { inputs: BriefInput }) {
  const text = await getTodayBrief(inputs);
  return (
    <details className="group">
      <summary className="cursor-pointer list-none">
        <span className="line-clamp-3 group-open:line-clamp-none">{text}</span>
        <span className="mt-1 block text-meta text-ai-2 group-open:hidden">
          Read brief
        </span>
      </summary>
    </details>
  );
}
function BriefSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading today's brief">
      <div className="h-4 w-full animate-pulse rounded bg-paper-3" />
      <div className="h-4 w-4/5 animate-pulse rounded bg-paper-3" />
    </div>
  );
}

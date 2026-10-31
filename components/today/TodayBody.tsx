import { Suspense } from "react";
import Link from "next/link";
import { TodayWaitingSummary } from "./TodayWaitingSummary";
import { Sparkles } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui";
import { TodayCards } from "./TodayCards";
import { formatScheduleTime } from "@/lib/schedule-time";
import { WeekStrip } from "./WeekStrip";
import { TodayQueueProvider } from "./TodayQueueContext";
import { getTodayBrief, type BriefInput, type TodayData } from "@/lib/today";

/** The full work list stays on Today, alongside the compact dock queue. */
export function TodayBody({ data }: { data: TodayData }) {
  const brief = !data.canAssign ? null : (
    <div className="rounded-lg border border-ai/20 bg-card px-3 py-2 shadow-card">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-subheading text-ai-2">
          <Sparkles className="size-4" />
          {data.briefHeadline}
        </h2>
        <Button href="/schedule" variant="ai" size="sm">
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
  const today = data.week.find(day => day.today);
  const nextDay = data.week.find(day => day.iso >= (today?.iso ?? "") && day.blocks.length > 0);
  const nextBlock = nextDay?.blocks[0];
  return (
    <div className="mx-auto max-w-[1240px] px-4 py-3 @xl/page:py-6 @2xl/page:px-5 @5xl/page:px-8">
      <PageHeader
        title={data.greeting}
        meta={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="capitalize">{data.dateLabel.toLowerCase()}</span>
            {data.canAssign ? <Link href="/projects" className="rounded hover:underline focus-visible:outline-2 focus-visible:outline-focus">{data.weekLabel.toLowerCase()}</Link> : <span>{data.weekLabel.toLowerCase()}</span>}
            {data.headerChips.map((c, i) => (
              <Link key={c.label} href={i === 0 ? "/money" : "/leads"} className="rounded hover:underline focus-visible:outline-2 focus-visible:outline-focus">{c.label}</Link>
            ))}
          </span>
        }
      />
      <Link href="/schedule" className="mt-3 hidden min-h-11 @xl/page:block line-clamp-1 rounded border border-rule-soft px-3 py-2 text-meta text-ink-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
        {nextBlock ? `${nextDay?.today ? "Today" : `${nextDay?.dow} ${nextDay?.day}`} · ${formatScheduleTime(nextBlock.time)} · ${nextBlock.label}` : "Nothing else posted this week · Open schedule"}
      </Link>
      <TodayQueueProvider
        initialPriorities={data.priorities}
        initialWaiting={data.waiting}
        canAssign={data.canAssign}
        assignees={data.assignees}
        canPromote={data.canAssign}
      >
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-6 @6xl/page:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 @6xl/page:col-start-1 @6xl/page:row-start-1"><TodayCards brief={brief} /></div>
          <aside className="flex min-w-0 flex-col gap-6 @6xl/page:order-none @6xl/page:col-start-2 @6xl/page:row-start-1">
            <Card className="p-4">
              <details>
                <summary className="cursor-pointer text-subheading font-semibold text-ink">This week's schedule</summary>
                <div className="mt-3"><WeekStrip week={data.week} /></div>
              </details>
            </Card>
            <div className="hidden @6xl/page:block"><TodayWaitingSummary /></div>
          </aside>
        </div>
        <div className="mt-6 @6xl/page:hidden"><TodayWaitingSummary /></div>
      </TodayQueueProvider>
    </div>
  );
}
async function BriefText({ inputs }: { inputs: BriefInput }) {
  const text = await getTodayBrief(inputs);
  return (
    <details className="group">
      <summary className="cursor-pointer list-none rounded focus-visible:outline-2 focus-visible:outline-focus">
        <span className="line-clamp-1 @3xl/page:line-clamp-2 group-open:line-clamp-none">{text}</span>
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

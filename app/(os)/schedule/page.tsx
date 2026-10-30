import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Chip, PageHeader } from "@/components/ui";
import { AutoLogButton } from "@/components/schedule/AutoLogButton";
import { ScheduleBlockModal } from "@/components/schedule/ScheduleBlockModal";
import { LogCard } from "@/components/schedule/LogCard";
import { ConflictBubble } from "@/components/schedule/ConflictBubble";
import {
  getScheduleData,
  getScheduleConflict,
  getScheduleProjects,
} from "@/lib/schedule";
import { ScheduleBoard } from "@/components/schedule/ScheduleBoard";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string; day?: string }>;
}) {
  const { w, day } = await searchParams;
  const offset = Math.trunc(Number(w)) || 0;
  const [data, projects, conflictNote] = await Promise.all([
    getScheduleData(offset),
    getScheduleProjects(),
    // Deterministic (one SQL pass, no model call) — cheap to await here, and it
    // lets the bubble show its Flag button only on an actual clash.
    getScheduleConflict(offset),
  ]);
  const hrefFor = (o: number) => (o === 0 ? "/schedule" : `/schedule?w=${o}`);

  return (
    <Shell breadcrumb="SCHEDULE">
      <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-6 @3xl/page:px-5 @5xl/page:px-8">
        <PageHeader
          title={offset === 0 ? "This week on site" : "Week on site"}
          meta={`${data.weekLabel} · ${data.rangeLabel} · Central time`}
          actions={
            <>
              <ScheduleBlockModal
                meeting
                projects={projects}
                triggerClassName="inline-flex h-8 items-center gap-1.5 rounded-md border border-rule bg-card px-3 text-body font-semibold hover:bg-hover max-sm:h-11"
                triggerContent="New meeting"
              />
              <ScheduleBlockModal
                projects={projects}
                triggerClassName="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-body font-semibold text-paper hover:bg-ink-hover max-sm:h-11"
                triggerContent={
                  <>
                    <Plus className="size-3.5" />
                    Block
                  </>
                }
              />
            </>
          }
        />
        <div className="mb-4 mt-6 flex flex-wrap items-center gap-2">
          <Button
            href={hrefFor(offset - 1)}
            variant="secondary"
            icon={ChevronLeft}
            iconOnly
            aria-label="Previous week"
            title="Previous week"
          />
          <Button href="/schedule" variant="secondary">
            This week
          </Button>
          <Button
            href={hrefFor(offset + 1)}
            variant="secondary"
            icon={ChevronRight}
            iconOnly
            aria-label="Next week"
            title="Next week"
          />
          <span className="ml-auto text-meta text-ink-3">
            {data.rangeLabel}
          </span>
        </div>
        <details className="group mb-3" open={conflictNote.startsWith("Double-booked") ? true : undefined}>
          <summary className="cursor-pointer rounded py-2 text-meta text-ink-2 focus-visible:outline-2 focus-visible:outline-focus">{conflictNote.startsWith("Double-booked") ? "Matching start times found · review overlap check" : "Overlap check · durations missing; overlaps still need review"}</summary>
        {/* Conflict note */}
        <ConflictBubble
          weekOffset={offset}
          conflict={conflictNote.startsWith("Double-booked")}
        >
          {conflictNote}
        </ConflictBubble>
        </details>

        <ScheduleBoard key={offset} days={data.days} projects={projects} initialDay={data.days.find(d => d.iso === day)?.iso} />

        {/* Daily log lane */}
        <Card className="mt-6 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex-1 font-serif text-heading font-semibold text-ink">
              Daily logs · this week
            </h2>
            <Chip kind="ghost">
              {data.logs.loggedCount} of {data.logs.total} logged
            </Chip>
            <AutoLogButton />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 @2xl/page:grid-cols-5">
            {data.logs.entries.map((log) =>
              log.body ? (
                <LogCard
                  key={log.dow[0] + log.dow.slice(1).toLowerCase()}
                  log={log}
                />
              ) : (
                <Card
                  key={log.dow[0] + log.dow.slice(1).toLowerCase()}
                  kind="soft"
                  className="flex flex-col gap-1 p-3"
                >
                  <div className="text-label font-semibold text-ink-2">
                    {log.dow[0] + log.dow.slice(1).toLowerCase()}
                  </div>
                  <span className="text-meta text-ink-3">Not yet logged</span>
                </Card>
              ),
            )}
          </div>
        </Card>
      </div>
    </Shell>
  );
}

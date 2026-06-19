import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Sparkles } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { AckButton, AiStream, Card, Chip, Eyebrow } from "@/components/ui";
import { ScheduleBlockModal } from "@/components/schedule/ScheduleBlockModal";
import { LogCard } from "@/components/schedule/LogCard";
import { ConflictBubble } from "@/components/schedule/ConflictBubble";
import { getScheduleData, getScheduleConflict, getScheduleProjects } from "@/lib/schedule";
import type { BlockTone } from "@/lib/schedule";

// Pill treatment per timeblock tone. Card kind sets fill+border; the text
// classes tint the time + label to match (accent = job, ai = AI-scheduled).
const TONE: Record<BlockTone, { card: "accent" | "ai" | "soft"; time: string; label: string }> = {
  accent: { card: "accent", time: "text-accent-2", label: "text-accent-2" },
  ai: { card: "ai", time: "text-ai-2", label: "text-ai-2" },
  ghost: { card: "soft", time: "text-ink-3", label: "text-ink-2" },
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  const { w } = await searchParams;
  const offset = Math.trunc(Number(w)) || 0;
  const [data, projects] = await Promise.all([
    getScheduleData(offset),
    getScheduleProjects(),
  ]);
  const hrefFor = (o: number) => (o === 0 ? "/schedule" : `/schedule?w=${o}`);

  return (
    <Shell breadcrumb="SCHEDULE" hideCmd>
      <div className="h-full overflow-y-auto px-7 pb-16 pt-6">
        {/* Header */}
        <div className="mb-3.5 flex items-end gap-4">
          <div className="flex-1">
            <Eyebrow>
              {data.weekLabel} · {data.rangeLabel}
            </Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
              {offset === 0 ? "This week on site" : "Week on site"}
            </h1>
            <p className="mt-1 text-[12px] text-ink-3">
              Every project calendar and standalone meeting, in one week view.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href={hrefFor(offset - 1)}
              aria-label="Previous week"
              className="rounded-md border border-ink-4 p-1.5 text-ink-2 transition-colors hover:bg-paper-2"
            >
              <ChevronLeft className="size-3.5" strokeWidth={1.5} />
            </Link>
            <Link href="/schedule">
              <Chip kind={offset === 0 ? "solid" : "ghost"}>This wk</Chip>
            </Link>
            <Link
              href={hrefFor(offset + 1)}
              aria-label="Next week"
              className="rounded-md border border-ink-4 p-1.5 text-ink-2 transition-colors hover:bg-paper-2"
            >
              <ChevronRight className="size-3.5" strokeWidth={1.5} />
            </Link>
            <ScheduleBlockModal
              meeting
              projects={projects}
              triggerClassName="flex items-center gap-1 rounded-md border border-ink-4 px-2.5 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-paper-2"
              triggerContent={
                <>
                  <Plus className="size-3.5" strokeWidth={1.75} />
                  New meeting
                </>
              }
            />
            <ScheduleBlockModal
              projects={projects}
              triggerClassName="flex items-center gap-1 rounded-md bg-ink px-2.5 py-1.5 text-[12px] font-medium text-paper transition-colors hover:bg-ink-2"
              triggerContent={
                <>
                  <Plus className="size-3.5" strokeWidth={1.75} />
                  Block
                </>
              }
            />
          </div>
        </div>

        {/* AI conflict note */}
        <ConflictBubble>
          <AiStream load={() => getScheduleConflict()} />
        </ConflictBubble>

        {/* 5-day strip */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {data.days.map((day) => (
            <Card
              key={day.dow}
              kind={day.today ? "default" : "soft"}
              className={[
                "flex min-h-[220px] flex-col p-2.5",
                day.today ? "border-accent" : "",
              ].join(" ")}
            >
              <div className="flex items-start">
                <div className="flex-1">
                  <div
                    className={[
                      "font-mono text-[9px] font-semibold uppercase tracking-[0.12em]",
                      day.today ? "text-accent-2" : "text-ink-3",
                    ].join(" ")}
                  >
                    {day.dow}
                    {day.today ? " · TODAY" : ""}
                  </div>
                  <div className="font-serif text-[17px] font-semibold leading-tight text-ink">
                    {day.date}
                  </div>
                </div>
                <ScheduleBlockModal
                  initialDate={day.iso}
                  projects={projects}
                  triggerAriaLabel={`Add a block on ${day.dow}`}
                  triggerClassName="rounded p-0.5 text-ink-4 transition-colors hover:bg-paper-3 hover:text-ink-2"
                  triggerContent={<Plus className="size-3" strokeWidth={1.5} />}
                />
              </div>

              <div className="mt-2 flex flex-col gap-1">
                {day.blocks.map((b, i) => {
                  const t = TONE[b.tone];
                  return (
                    <Card key={i} kind={t.card} className="px-1.5 py-1">
                      <div className={`font-mono text-[9px] ${t.time}`}>{b.time}</div>
                      <div className={`mt-0.5 text-[11px] leading-snug ${t.label}`}>{b.label}</div>
                      {b.projectSlug ? (
                        <Link
                          href={`/projects/${b.projectSlug}`}
                          className="mt-1 inline-block font-mono text-[8.5px] uppercase tracking-[0.1em] text-ink-3 underline-offset-2 hover:underline"
                        >
                          {b.projectName}
                        </Link>
                      ) : (
                        <div className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.1em] text-ink-4">
                          Standalone
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>

        {/* Daily log lane */}
        <Card kind="tan" className="mt-3.5 p-3.5">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 font-serif text-[16px] font-semibold text-ink">
              Daily logs · this week
            </h2>
            <Chip kind="ghost">
              {data.logs.loggedCount} of {data.logs.total} logged
            </Chip>
            <AckButton icon={<Sparkles className="size-3" strokeWidth={1.75} />} label="Auto-log from photos" ackLabel="Drafting logs…" />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
            {data.logs.entries.map((log) =>
              log.body ? (
                <LogCard key={log.dow} log={log} />
              ) : (
                <Card
                  key={log.dow}
                  kind="dashed"
                  className="flex min-h-[110px] flex-col items-center justify-center p-3 text-center"
                >
                  <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-4">
                    {log.dow}
                  </div>
                  <span className="mt-1 text-[11px] text-ink-4">Not yet logged</span>
                </Card>
              ),
            )}
          </div>
        </Card>
      </div>
    </Shell>
  );
}

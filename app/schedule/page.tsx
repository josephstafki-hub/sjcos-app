import Link from "next/link";
import { Camera, ChevronLeft, ChevronRight, Plus, Sparkles } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { AckButton, Card, Chip, Eyebrow } from "@/components/ui";
import { BlockButton } from "@/components/schedule/BlockButton";
import { ConflictBubble } from "@/components/schedule/ConflictBubble";
import { getScheduleData } from "@/lib/schedule";
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
  const data = await getScheduleData(offset);
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
            <BlockButton />
          </div>
        </div>

        {/* AI conflict note */}
        <ConflictBubble note={data.conflictNote} />

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
                <Plus className="size-3 text-ink-4" strokeWidth={1.5} />
              </div>

              <div className="mt-2 flex flex-col gap-1">
                {day.blocks.map((b, i) => {
                  const t = TONE[b.tone];
                  return (
                    <Card key={i} kind={t.card} className="px-1.5 py-1">
                      <div className={`font-mono text-[9px] ${t.time}`}>{b.time}</div>
                      <div className={`mt-0.5 text-[11px] leading-snug ${t.label}`}>{b.label}</div>
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
                <Card key={log.dow} className="flex min-h-[110px] flex-col p-2.5">
                  <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-accent-2">
                    {log.dow}
                    {log.today ? " · TODAY" : ""}
                  </div>
                  <p className="mt-1.5 flex-1 text-[11px] leading-snug text-ink-2">{log.body}</p>
                  {log.photos > 0 && (
                    <div className="mt-2 flex items-center gap-1 text-ink-3">
                      <Camera className="size-3" strokeWidth={1.5} />
                      <span className="font-mono text-[10px]">{log.photos}</span>
                    </div>
                  )}
                </Card>
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

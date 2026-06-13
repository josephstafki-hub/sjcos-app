import { Shell } from "@/components/shell/Shell";
import { AiBubble, Card, Chip, Eyebrow } from "@/components/ui";

export default function TodayPage() {
  return (
    <Shell breadcrumb="TODAY · FRI JUN 13">
      <div className="mx-auto max-w-[1100px] px-7 py-6">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <Eyebrow>Friday, June 13</Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
              Good morning, Joe.
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Chip kind="money" dot>
              $48.2k this week
            </Chip>
            <Chip kind="accent" dot>
              4 active leads
            </Chip>
          </div>
        </div>

        <AiBubble
          actions={
            <>
              <Chip kind="ai">Open agenda</Chip>
              <Chip kind="ghost">Re-prioritize</Chip>
            </>
          }
        >
          <span className="font-semibold">Here&apos;s your day.</span> Henderson tile
          starts today — Marco confirmed. Maria Chen is waiting on your reply about the
          rough estimate. Reyes is on Day 15 of closeout. Three Olson social posts are
          queued for review.
        </AiBubble>

        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
          <section>
            <Eyebrow muted className="mb-2">
              Priorities
            </Eyebrow>
            <div className="flex flex-col gap-2.5">
              {[
                ["flag", "Reply to Maria Chen", "Rough estimate sent 2 days ago — SLA breach soon"],
                ["accent", "Confirm Henderson tile delivery", "Marco starts today; verify materials on site"],
                ["info", "Review Olson social posts", "3 AI-drafted posts ready to publish"],
              ].map(([kind, title, reason]) => (
                <Card key={title} className="flex items-start gap-3 p-3">
                  <Chip kind={kind as "flag" | "accent" | "info"} dot>
                    {kind === "flag" ? "Urgent" : kind === "accent" ? "Job" : "Marketing"}
                  </Chip>
                  <div>
                    <div className="font-serif text-[16px] font-semibold text-ink">{title}</div>
                    <div className="text-[13px] text-ink-2">{reason}</div>
                  </div>
                </Card>
              ))}
            </div>
          </section>

          <aside>
            <Eyebrow muted className="mb-2">
              Today&apos;s schedule
            </Eyebrow>
            <Card className="flex flex-col gap-2.5 p-3.5">
              {[
                ["7:30", "Henderson — tile start"],
                ["10:00", "Maria Chen — call back"],
                ["1:00", "Reyes closeout walk"],
              ].map(([time, label]) => (
                <div key={time} className="flex items-center gap-3">
                  <span className="font-mono text-[11px] tabular-nums text-ink-3">{time}</span>
                  <span className="text-[13px] text-ink">{label}</span>
                </div>
              ))}
            </Card>
          </aside>
        </div>

        <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
          Phase 0 foundation · placeholder content · real Today screen lands in Phase 1.1
        </p>
      </div>
    </Shell>
  );
}

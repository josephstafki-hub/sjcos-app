import Link from "next/link";
import { Shell } from "@/components/shell/Shell";
import { AiBubble, Card, Chip, Eyebrow } from "@/components/ui";
import { getTodayData } from "@/lib/today";

const DOT: Record<string, string> = {
  flag: "bg-flag",
  accent: "bg-accent",
  ai: "bg-ai",
  money: "bg-money",
  ghost: "bg-ink-4",
};

export default async function TodayPage() {
  const data = await getTodayData();

  return (
    <Shell breadcrumb={data.dateLabel}>
      <div className="mx-auto max-w-[1100px] px-7 py-6">
        {/* Header strip */}
        <div className="mb-3.5 flex items-end gap-4">
          <div className="flex-1">
            <Eyebrow>{data.dateLabel}</Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
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

        {/* AI brief */}
        <AiBubble
          actions={
            <>
              <Link
                href="/schedule"
                className="rounded-md bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2"
              >
                Open agenda
              </Link>
              <Link
                href="/ai"
                className="rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink-2"
              >
                Re-prioritize
              </Link>
            </>
          }
        >
          <div className="mb-1 font-serif text-[13.5px] font-semibold text-ai-2">
            {data.briefHeadline}
          </div>
          <div>{data.briefBody}</div>
        </AiBubble>

        {/* Two-column body */}
        <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-[1.4fr_1fr]">
          {/* Priorities */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="font-serif text-[16px] font-semibold text-ink">Priorities</h2>
              <span className="text-[11px] text-ink-3">· what moves the week</span>
              <div className="flex-1" />
              <Chip kind="ghost">AI-ranked</Chip>
            </div>
            <div className="flex flex-col gap-3">
              {data.priorities.map((p) => (
                <Card key={p.rank} className="p-3">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${DOT[p.dot]}`} />
                    <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-ink-3">
                      {p.tag}
                    </span>
                    <div className="flex-1" />
                    <span className="font-mono text-[10px] text-ink-4">{p.rank}</span>
                  </div>
                  <div className="mt-1 font-serif text-[16px] font-semibold text-ink">{p.title}</div>
                  <div className="mt-0.5 text-[12px] text-ink-3">{p.sub}</div>
                </Card>
              ))}
            </div>
          </section>

          {/* Right rail */}
          <aside className="flex flex-col gap-3">
            <div>
              <h2 className="mb-1.5 font-serif text-[16px] font-semibold text-ink">This week</h2>
              <div className="flex gap-1.5">
                {data.week.map((d, i) => (
                  <div
                    key={i}
                    className={[
                      "flex-1 rounded border border-rule py-1.5 text-center",
                      d.today ? "bg-ink text-paper" : "bg-paper text-ink-2",
                    ].join(" ")}
                  >
                    <div className="font-mono text-[9px] opacity-70">{d.dow}</div>
                    <div className="font-mono text-[16px] font-semibold leading-tight tabular-nums">
                      {d.day}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Card className="p-3">
              <h3 className="font-serif text-[13.5px] font-semibold text-ink">Today&apos;s schedule</h3>
              <div className="mt-2 flex flex-col gap-1.5">
                {data.schedule.map((s) => (
                  <div key={s.time} className="flex items-center gap-2">
                    <span className="w-9 font-mono text-[11px] tabular-nums text-ink-3">{s.time}</span>
                    <span className={`size-1.5 rounded-full ${DOT[s.dot]}`} />
                    <span className="text-[13px] text-ink">{s.label}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card kind="tan" className="p-3">
              <div className="flex items-center">
                <h3 className="flex-1 font-serif text-[13.5px] font-semibold text-ink">
                  Waiting on me
                </h3>
                <span className="text-[11px] text-ink-3">{data.waiting.total} items</span>
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {data.waiting.items.map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <span className="size-3.5 flex-none rounded-[3px] border border-ink-4" />
                    <span className="text-[12px] text-ink-2">{item}</span>
                  </div>
                ))}
                {data.waiting.total > data.waiting.items.length && (
                  <div className="mt-1 text-[11px] text-ink-3">
                    +{data.waiting.total - data.waiting.items.length} more…
                  </div>
                )}
              </div>
            </Card>
          </aside>
        </div>
      </div>
    </Shell>
  );
}

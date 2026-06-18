import { Sparkles } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { AiBubble, AiStream, AckButton, Card, Chip, Eyebrow } from "@/components/ui";
import { getComplianceData, getComplianceSummary } from "@/lib/compliance";
import type { ComplianceDot } from "@/lib/compliance";
import { resolveComplianceItem } from "@/lib/actions/compliance";

const DOT: Record<ComplianceDot, string> = {
  flag: "bg-flag",
  accent: "bg-accent",
  ghost: "bg-ink-4",
};

export default async function CompliancePage() {
  const data = await getComplianceData();

  return (
    <Shell breadcrumb="COMPLIANCE · CALENDAR">
      <div className="mx-auto max-w-[1100px] px-7 pb-16 pt-6">
        {/* Header */}
        <div className="mb-3.5 flex items-end gap-4">
          <div className="flex-1">
            <Eyebrow>{data.eyebrow}</Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
              Compliance
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {data.filters.map((f, i) => (
              <Chip key={f} kind={i === 0 ? "solid" : "ghost"}>
                {f}
              </Chip>
            ))}
            <AckButton icon={<Sparkles className="size-3" strokeWidth={1.75} />} label="Auto-collect docs" ackLabel="Requesting renewals…" />
          </div>
        </div>

        {/* AI outlook */}
        <AiBubble
          className="mb-3.5"
          actions={<AckButton label="Open both" ackLabel="Flagged for review" />}
        >
          <AiStream load={() => getComplianceSummary(data.summaryInput)} />
        </AiBubble>

        {/* Window cards */}
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {data.windows.map((w) => (
            <Card key={w.label} kind={w.urgent ? "flag" : "default"} className="p-3.5">
              <div
                className={[
                  "font-mono text-[9px] font-semibold uppercase tracking-[0.14em]",
                  w.urgent ? "text-flag" : "text-ink-3",
                ].join(" ")}
              >
                {w.label}
              </div>
              <div className="mt-1 font-serif text-[22px] font-semibold text-ink">
                {w.items.length} item{w.items.length === 1 ? "" : "s"}
              </div>
              <div className="mt-2.5 flex flex-col gap-1.5">
                {w.items.map((it) => (
                  <div key={it.title} className="flex items-center gap-2">
                    <span className="flex-1 text-[12px] text-ink-2">{it.title}</span>
                    <span className="font-mono text-[11px] text-ink-3">{it.due}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>

        {/* Year-ahead timeline */}
        <Card className="overflow-hidden p-0">
          <div className="border-b border-rule bg-paper-2 px-4 py-2.5">
            <h2 className="font-serif text-[14px] font-semibold text-ink">Year ahead · timeline</h2>
          </div>
          {data.timeline.map((r) => {
            const resolve = async () => {
              "use server";
              await resolveComplianceItem(r.id);
            };
            return (
              <div
                key={r.id}
                className="flex items-center gap-3 border-b border-rule-soft px-4 py-2.5 last:border-b-0"
              >
                <span className={`size-2 flex-none rounded-full ${DOT[r.dot]}`} />
                <span className="w-[64px] flex-none font-mono text-[11px] text-ink-2">{r.date}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-serif text-[13.5px] font-semibold text-ink">
                    {r.what}
                  </div>
                  <div className="text-[11px] text-ink-3">{r.who}</div>
                </div>
                <span className="hidden max-w-[32%] text-right text-[11px] text-ink-3 sm:block">
                  {r.step}
                </span>
                <form action={resolve} className="flex-none">
                  <button
                    type="submit"
                    className="rounded-md border border-rule px-2 py-1 text-[11px] font-semibold text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
                  >
                    Resolve
                  </button>
                </form>
              </div>
            );
          })}
        </Card>
      </div>
    </Shell>
  );
}

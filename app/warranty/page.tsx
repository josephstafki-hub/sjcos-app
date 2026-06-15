import { Sparkles } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { AiBubble, Card, Chip, Eyebrow } from "@/components/ui";
import { getWarrantyData } from "@/lib/warranty";
import type { ClaimDot } from "@/lib/warranty";

const DOT: Record<ClaimDot, string> = {
  accent: "bg-accent",
  flag: "bg-flag",
  ghost: "bg-ink-4",
};

export default async function WarrantyPage() {
  const data = await getWarrantyData();

  return (
    <Shell breadcrumb="WARRANTY · CLOSED PROJECTS">
      <div className="mx-auto max-w-[1100px] px-7 pb-16 pt-6">
        {/* Header */}
        <div className="mb-3.5 flex items-end gap-4">
          <div className="flex-1">
            <Eyebrow>{data.eyebrow}</Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
              Warranty
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {data.filters.map((f, i) => (
              <Chip key={f} kind={i === 0 ? "solid" : "ghost"}>
                {f}
              </Chip>
            ))}
          </div>
        </div>

        {/* AI claim summary */}
        <AiBubble
          className="mb-3.5"
          actions={
            <button className="rounded-md bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2">
              Open claim
            </button>
          }
        >
          {data.summary}
        </AiBubble>

        {/* Active claims */}
        <Card className="mb-5 overflow-hidden p-0">
          <div className="border-b border-rule bg-paper-2 px-4 py-2.5">
            <h2 className="font-serif text-[14px] font-semibold text-ink">
              Active claims · {data.claims.length}
            </h2>
          </div>
          {data.claims.map((c) => (
            <div
              key={c.project}
              className="flex flex-col gap-3 border-b border-rule-soft px-4 py-3.5 last:border-b-0 sm:flex-row sm:items-start"
            >
              <span className={`mt-1.5 size-2 flex-none rounded-full ${DOT[c.dot]}`} />
              <div className="min-w-0 flex-1">
                <h3 className="font-serif text-[15px] font-semibold text-ink">{c.project}</h3>
                <div className="mt-0.5 text-[11px] text-ink-3">
                  {c.client} · opened {c.age} ago via portal
                </div>
                <p className="mt-1.5 text-[13px] text-ink-2">{c.issue}</p>
              </div>
              <div className="flex flex-col items-start gap-1.5 sm:items-end">
                <Chip kind="flag" dot>
                  {c.deadline}
                </Chip>
                <span className="text-[11px] text-ink-3">{c.step}</span>
                <button className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-ai bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2">
                  <Sparkles className="size-3" strokeWidth={1.5} />
                  Open
                </button>
              </div>
            </div>
          ))}
        </Card>

        {/* Under-warranty grid */}
        <h2 className="mb-2.5 font-serif text-[15px] font-semibold text-ink">
          Under warranty · {data.underWarrantyTotal} projects
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.projects.map((p) => (
            <Card
              key={p.project}
              className={["p-3", p.flag ? "border-flag" : ""].join(" ")}
            >
              <h3 className="font-serif text-[13.5px] font-semibold text-ink">{p.project}</h3>
              <div className="mt-0.5 text-[11px] text-ink-3">{p.client}</div>
              <div className="my-2.5 border-t border-dashed border-rule" />
              <div className="flex items-center">
                <span className="flex-1 text-[12px] text-ink-2">Closed</span>
                <span className="font-mono text-[11px] text-ink-3">{p.closed}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-ink-3">{p.warranty}</div>
              {p.flag && (
                <Chip kind="flag" dot className="mt-2">
                  {p.flag}
                </Chip>
              )}
            </Card>
          ))}
        </div>
      </div>
    </Shell>
  );
}

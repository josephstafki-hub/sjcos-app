import { Shell } from "@/components/shell/Shell";
import { AiBubble, AiStream, Card, Chip, Eyebrow } from "@/components/ui";
import { getWarrantyData, getWarrantySummary, getWarrantyProjectOptions } from "@/lib/warranty";
import { warrantyContext } from "@/lib/page-context";
import { WarrantyClaims } from "@/components/warranty/WarrantyClaims";
import { AddClaimButton } from "@/components/warranty/AddClaimButton";
import { FocusScroll } from "@/components/shell/FocusScroll";
import { Suspense } from "react";

export default async function WarrantyPage() {
  const [data, projectOptions] = await Promise.all([getWarrantyData(), getWarrantyProjectOptions()]);
  const aiContext = warrantyContext(data);

  return (
    <Shell breadcrumb="WARRANTY · CLOSED PROJECTS" aiContext={aiContext}>
      <Suspense fallback={null}>
        <FocusScroll />
      </Suspense>
      <div className="mx-auto max-w-[1100px] px-7 pb-16 pt-6">
        {/* Header */}
        {/* flex-wrap (not a fixed two-column row): in a narrow content column
            the chip group drops below the title instead of overlapping it. */}
        <div className="mb-3.5 flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <Eyebrow>{data.eyebrow}</Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
              Warranty
            </h1>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {data.filters.map((f, i) => (
              <Chip key={f} kind={i === 0 ? "solid" : "ghost"}>
                {f}
              </Chip>
            ))}
            <AddClaimButton projects={projectOptions} />
          </div>
        </div>

        {/* AI claim summary */}
        <AiBubble
          className="mb-3.5"
          actions={
            <a
              href="#claims"
              className="rounded-md bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2"
            >
              View claims
            </a>
          }
        >
          <AiStream load={() => getWarrantySummary(data.summaryInput)} />
        </AiBubble>

        {/* Active claims */}
        <div id="claims" className="scroll-mt-4">
          <WarrantyClaims claims={data.claims} />
        </div>

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
              {p.items && p.items.length > 0 && (
                <div className="mt-2 space-y-1">
                  {p.items.map((it) => (
                    <div key={it.key} className="flex items-center justify-between gap-2" title={it.detail}>
                      <Chip kind="ghost">{it.label}</Chip>
                      <span className="font-mono text-[10px] text-ink-3">{it.expires}</span>
                    </div>
                  ))}
                </div>
              )}
              {p.coverageNote && (
                <div className="mt-1.5 text-[10px] leading-snug text-ink-3">{p.coverageNote}</div>
              )}
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

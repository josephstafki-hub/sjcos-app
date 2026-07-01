import { Shell } from "@/components/shell/Shell";
import { AiBubble, AiStream, AckButton, Card, Chip, Eyebrow } from "@/components/ui";
import { getWarrantyData, getWarrantySummary, getWarrantyProjectOptions } from "@/lib/warranty";
import { WarrantyClaims } from "@/components/warranty/WarrantyClaims";
import { AddClaimButton } from "@/components/warranty/AddClaimButton";

export default async function WarrantyPage() {
  const [data, projectOptions] = await Promise.all([getWarrantyData(), getWarrantyProjectOptions()]);

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
            <AddClaimButton projects={projectOptions} />
          </div>
        </div>

        {/* AI claim summary */}
        <AiBubble
          className="mb-3.5"
          actions={<AckButton label="Open claim" ackLabel="Flagged for review" />}
        >
          <AiStream load={() => getWarrantySummary(data.summaryInput)} />
        </AiBubble>

        {/* Active claims */}
        <WarrantyClaims claims={data.claims} />

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

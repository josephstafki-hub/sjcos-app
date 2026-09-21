import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { Card, Chip, Eyebrow } from "@/components/ui";
import { requireAccess } from "@/lib/dal";
import { listPlanDesigns } from "@/lib/plan-designs";

// Floor-plan designer index: every live design across projects and leads,
// newest first, plus saved templates. Designs are created from a project's
// Floor tab or a lead's Floor plan tab (they need a job to belong to).
export default async function FloorIndexPage() {
  await requireAccess("projects");
  const [designs, templates] = await Promise.all([listPlanDesigns({ all: true }), listPlanDesigns({ templates: true })]);
  const live = designs.filter((d) => !d.isTemplate);

  return (
    <Shell breadcrumb="FLOOR PLAN · DESIGNS">
      <div className="mx-auto max-w-[1100px] px-7 pb-16 pt-6">
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <div className="flex-1">
            <Eyebrow>
              {live.length} design{live.length === 1 ? "" : "s"} · 2D draft, 3D view, print, estimate
            </Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">Floor plans</h1>
          </div>
          <p className="max-w-[360px] text-[12px] leading-relaxed text-ink-3">
            Start a design from a project&apos;s <strong>Floor</strong> tab or a lead&apos;s <strong>Floor plan</strong> tab.
          </p>
        </div>

        {live.length === 0 ? (
          <Card kind="dashed" className="p-10 text-center">
            <div className="text-[13px] text-ink-3">No designs yet.</div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((d) => (
              <Card key={d.id} className="p-3">
                <div className="flex items-start gap-2.5">
                  <Link
                    href={`/floor/${d.id}`}
                    className="flex size-10 flex-none items-center justify-center rounded-md border border-rule bg-paper-2 text-ink-2 hover:bg-paper-3"
                  >
                    <LayoutGrid className="size-4" strokeWidth={1.5} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={`/floor/${d.id}`} className="block truncate text-[14px] font-semibold text-ink hover:underline">
                      {d.name}
                    </Link>
                    <div className="truncate text-[11px] text-ink-3">
                      {d.projectSlug ? (
                        <Link href={`/projects/${d.projectSlug}`} className="hover:underline">
                          {d.projectName}
                        </Link>
                      ) : d.leadSlug ? (
                        <Link href={`/leads/${d.leadSlug}`} className="hover:underline">
                          Lead · {d.leadName}
                        </Link>
                      ) : (
                        "Unattached"
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Chip kind="ghost">rev {d.rev}</Chip>
                  <Chip kind="ghost">{d.counts.rooms} rooms · {d.counts.areaSf} sf</Chip>
                  <Chip kind="ghost">{d.counts.cabinets} cabinets</Chip>
                  {d.latestVersion && <Chip kind="accent">v{d.latestVersion.number}</Chip>}
                </div>
                <div className="mt-1.5 text-[10px] text-ink-4">Updated {d.updatedLabel}</div>
              </Card>
            ))}
          </div>
        )}

        {templates.length > 0 && (
          <>
            <div className="mb-2 mt-8 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">Saved templates</div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((t) => (
                <Card key={t.id} kind="soft" className="p-3">
                  <Link href={`/floor/${t.id}`} className="text-[13px] font-semibold text-ink hover:underline">
                    {t.name}
                  </Link>
                  <div className="mt-1 text-[11px] text-ink-3">
                    {t.counts.rooms} rooms · {t.counts.areaSf} sf · {t.counts.cabinets} cabinets
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

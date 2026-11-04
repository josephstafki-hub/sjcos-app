import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { Card, Chip, PageHeader, EmptyState, TableWrapper, Table, TableHead, TableBody, TableHeader, TableRow, TablePrimaryCell, TableCell } from "@/components/ui";
import { requireAccess } from "@/lib/dal";
import { query } from "@/lib/db";
import { PlanOutline } from "@/components/floor/PlanOutline";
import { NewPlanButton } from "@/components/floor/NewPlanButton";
import { listPlanDesigns } from "@/lib/plan-designs";

// Floor-plan designer index: every live design across projects and leads,
// newest first, plus saved templates. New designs need a project or lead.
export default async function FloorIndexPage() {
  await requireAccess("projects");
  const [designs, templates, choices] = await Promise.all([listPlanDesigns({ all: true }), listPlanDesigns({ templates: true }), query<{slug:string;name:string;kind:"project"|"lead"}>(`SELECT slug, name, 'project' AS kind FROM projects UNION ALL SELECT slug, name, 'lead' AS kind FROM leads ORDER BY name`)]);
  const live = designs.filter((d) => !d.isTemplate);

  return (
    <Shell breadcrumb="FLOOR PLAN · DESIGNS">
      <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-6 @3xl/page:px-7">
        <PageHeader title="Floor plans" meta={`${live.length} designs · 2D draft, 3D view, print, estimate`} className="mb-5" />
        <NewPlanButton choices={choices.rows} />

        {live.length === 0 ? (
          <EmptyState icon={LayoutGrid} title="No designs yet" description="Choose a project or lead above to create a design, draft rooms and publish a plan for approval." />
        ) : (
          <TableWrapper><Table>
            <TableHead><TableRow><TableHeader>Design</TableHeader><TableHeader className="@max-3xl/page:hidden">Rooms / area</TableHeader><TableHeader className="@max-4xl/page:hidden">Updated</TableHeader><TableHeader>Version</TableHeader></TableRow></TableHead>
            <TableBody>{live.map(d => <TableRow key={d.id}>
              <TablePrimaryCell meta={<>{d.projectSlug ? <Link href={`/projects/${d.projectSlug}?tab=Floor`} className="hover:underline">{d.projectName}</Link> : d.leadSlug ? <Link href={`/leads/${d.leadSlug}`} className="hover:underline">Lead · {d.leadName}</Link> : "Unattached"}</>}><div className="flex items-center gap-3"><Link href={`/floor/${d.id}`} aria-label={`Open ${d.name}`}><PlanOutline design={d} /></Link><Link href={`/floor/${d.id}`} className="min-w-0 break-words hover:underline">{d.name}</Link></div><div className="mt-1 text-meta font-normal text-ink-3">Design #{d.id} · {d.counts.rooms} rooms · {d.counts.areaSf} sf · updated {d.updatedLabel}</div></TablePrimaryCell>
              <TableCell className="@max-3xl/page:hidden">{d.counts.rooms} rooms · {d.counts.areaSf} sf<div className="text-meta text-ink-3">{d.counts.cabinets} cabinets</div></TableCell>
              <TableCell className="@max-4xl/page:hidden text-ink-3">{d.updatedLabel}</TableCell>
              <TableCell><Chip kind={d.latestVersion ? "ok" : "neutral"}>{d.latestVersion ? `v${d.latestVersion.number}` : "No version"}</Chip><div className="mt-1 text-meta text-ink-3">Revision {d.rev}</div></TableCell>
            </TableRow>)}</TableBody>
          </Table></TableWrapper>
        )}

        {templates.length > 0 && (
          <>
            <div className="mb-2 mt-8 text-label font-medium text-ink-3">Saved templates</div>
            <div className="grid grid-cols-1 gap-2.5 @xl/page:grid-cols-2 @4xl/page:grid-cols-3">
              {templates.map((t) => (
                <Card key={t.id} kind="soft" className="p-3">
                  <Link href={`/floor/${t.id}`} aria-label={`Open ${t.name}`} className="mb-2 block"><PlanOutline design={t} /></Link>
                  <Link href={`/floor/${t.id}`} className="text-body font-semibold text-ink hover:underline">
                    {t.name}
                  </Link>
                  <div className="mt-1 text-meta text-ink-3">
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

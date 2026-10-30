import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { Card, Chip, PageHeader, EmptyState, TableWrapper, Table, TableHead, TableBody, TableHeader, TableRow, TablePrimaryCell, TableCell } from "@/components/ui";
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
      <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-6 @3xl/page:px-7">
        <PageHeader title="Floor plans" meta={`${live.length} designs · 2D draft, 3D view, print, estimate`} className="mb-5" />
        <p className="mb-5 text-body text-ink-3">Start a design from a project’s <strong>Floor</strong> tab or a lead’s <strong>Floor plan</strong> tab.</p>

        {live.length === 0 ? (
          <EmptyState icon={LayoutGrid} title="No designs yet" description="Start a design from a project's Floor tab to draft a room and publish a plan for approval." />
        ) : (
          <TableWrapper><Table>
            <TableHead><TableRow><TableHeader>Design</TableHeader><TableHeader className="@max-3xl/page:hidden">Rooms / area</TableHeader><TableHeader className="@max-4xl/page:hidden">Updated</TableHeader><TableHeader>Version</TableHeader></TableRow></TableHead>
            <TableBody>{live.map(d => <TableRow key={d.id}>
              <TablePrimaryCell meta={<>{d.projectSlug ? <Link href={`/projects/${d.projectSlug}?tab=Floor`} className="hover:underline">{d.projectName}</Link> : d.leadSlug ? <Link href={`/leads/${d.leadSlug}`} className="hover:underline">Lead · {d.leadName}</Link> : "Unattached"}<span className="block @3xl/page:hidden">{d.counts.rooms} rooms · {d.counts.areaSf} sf</span></>}><Link href={`/floor/${d.id}`} className="hover:underline">{d.name}</Link></TablePrimaryCell>
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

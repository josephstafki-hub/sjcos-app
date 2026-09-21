import { notFound } from "next/navigation";
import { Shell } from "@/components/shell/Shell";
import { Designer } from "@/components/floor/Designer";
import { requireAccess } from "@/lib/dal";
import {
  getPlaceableCatalog,
  getPlanCostRules,
  getPlanDesign,
  listPlanDesignComments,
  listPlanDesignFiles,
  listPlanDesignVersions,
} from "@/lib/plan-designs";
import { listEstimateTargets } from "@/lib/actions/plan-estimate";

// The floor-plan designer (docs/floor-plan-designer-plan.md §2). Server page
// loads the live design + everything the inspector needs; the Designer is a
// client component (the 3D scene inside it is loaded client-only).
export default async function FloorDesignerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ comments?: string; panel?: string }>;
}) {
  const user = await requireAccess("projects");
  const { id } = await params;
  const sp = await searchParams;
  const designId = Number(id);
  if (!Number.isFinite(designId)) notFound();

  const design = await getPlanDesign(designId);
  if (!design) notFound();

  const [catalog, rules, comments, files, versions, estimateTargets] = await Promise.all([
    getPlaceableCatalog(),
    getPlanCostRules(),
    listPlanDesignComments(designId),
    listPlanDesignFiles(designId),
    listPlanDesignVersions(designId),
    user.role === "owner" || user.permissions.includes("estimates") ? listEstimateTargets(designId) : Promise.resolve([]),
  ]);

  const crumb = design.projectName
    ? `FLOOR PLAN › ${design.projectName.toUpperCase()} › ${design.name.toUpperCase()}`
    : design.leadName
      ? `FLOOR PLAN › LEAD · ${design.leadName.toUpperCase()} › ${design.name.toUpperCase()}`
      : `FLOOR PLAN › ${design.name.toUpperCase()}`;

  return (
    <Shell breadcrumb={crumb}>
      <Designer
        design={design}
        catalog={catalog}
        costRuleKeys={rules.filter((r) => r.enabled).map((r) => r.measure)}
        comments={comments}
        files={files}
        versions={versions}
        estimateTargets={estimateTargets}
        readOnly={false}
        isOwner={user.role === "owner"}
        initialPanel={sp.comments ? "comments" : (sp.panel as "properties" | undefined) ?? undefined}
      />
    </Shell>
  );
}

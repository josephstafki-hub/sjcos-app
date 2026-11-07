import { notFound } from "next/navigation";
import { Shell } from "@/components/shell/Shell";
import { Designer } from "@/components/floor/Designer";
import { requireAccess } from "@/lib/dal";
import {loadPlanDesigner} from '@/lib/plan-designer-loader';
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

  const loaded = await loadPlanDesigner(user,designId).catch(()=>null);
  if(!loaded)notFound();
  const {design}=loaded;

  const crumb = design.projectName
    ? `FLOOR PLAN › ${design.projectName.toUpperCase()} › ${design.name.toUpperCase()}`
    : design.leadName
      ? `FLOOR PLAN › LEAD · ${design.leadName.toUpperCase()} › ${design.name.toUpperCase()}`
      : `FLOOR PLAN › ${design.name.toUpperCase()}`;

  return (
    <Shell breadcrumb={crumb}>
      <Designer
        {...loaded}
        initialPanel={sp.comments ? "comments" : (sp.panel as "properties" | undefined) ?? undefined}
      />
    </Shell>
  );
}

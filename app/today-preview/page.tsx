import { Shell } from "@/components/shell/Shell";
import { OperatorBody } from "@/components/operator/OperatorBody";
import { getTodayData } from "@/lib/today";
import { operatorContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

// Preview of the Operator Console — the three-panel redesign of working the
// daily queue (Queue rail · agent chat · live Workbench). Built here at
// /today-preview so Joe can trial it before it replaces /today. Spec:
// docs/operator-console-plan.md. To promote: point /today at this body and
// remove this route + its nav entry.
export default async function TodayPreviewPage() {
  const data = await getTodayData();

  return (
    <Shell breadcrumb={`${data.dateLabel} · Operator preview`} aiContext={operatorContext(data)}>
      <OperatorBody data={data} />
    </Shell>
  );
}

import { Shell } from "@/components/shell/Shell";
import { PageHeader } from "@/components/ui";
import { CostBookClient } from "@/components/cost-book/CostBookClient";
import { AddCostItemButton } from "@/components/cost-book/AddCostItemButton";
import { getCostBook } from "@/lib/cost-book";
import { PlanRulesPanel } from "@/components/cost-book/PlanRulesPanel";
import { getPlanCostRules } from "@/lib/plan-designs";

export default async function CostBookPage() {
  const [data, planRules] = await Promise.all([
    getCostBook(),
    getPlanCostRules(),
  ]);
  const active = data.items.filter((i) => !i.archived).length;

  return (
    <Shell breadcrumb="COST BOOK · UNIT COSTS">
      <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-6 @2xl/page:px-7">
        <PageHeader
          title="Cost book"
          meta={`${active} reusable unit costs · labor and material assemblies`}
          actions={<AddCostItemButton />}
          className="mb-5"
        />

        <PlanRulesPanel
          rules={planRules}
          costItems={data.items
            .filter((i) => !i.archived)
            .map((i) => ({
              id: i.id,
              name: i.name,
              unit: i.unit,
              category: i.category,
            }))}
        />
        <CostBookClient data={data} />
      </div>
    </Shell>
  );
}

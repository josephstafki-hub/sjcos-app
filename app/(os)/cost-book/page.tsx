import { Shell } from "@/components/shell/Shell";
import { Eyebrow } from "@/components/ui";
import { CostBookClient } from "@/components/cost-book/CostBookClient";
import { AddCostItemButton } from "@/components/cost-book/AddCostItemButton";
import { getCostBook } from "@/lib/cost-book";
import { PlanRulesPanel } from "@/components/cost-book/PlanRulesPanel";
import { getPlanCostRules } from "@/lib/plan-designs";

export default async function CostBookPage() {
  const [data, planRules] = await Promise.all([getCostBook(), getPlanCostRules()]);
  const active = data.items.filter((i) => !i.archived).length;

  return (
    <Shell breadcrumb="COST BOOK · UNIT COSTS">
      <div className="mx-auto max-w-[1100px] px-7 pb-16 pt-6">
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <div className="flex-1">
            <Eyebrow>{active} item{active === 1 ? "" : "s"} · the reusable unit costs estimates pull from</Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
              Cost book
            </h1>
          </div>
          <AddCostItemButton />
        </div>

        <CostBookClient data={data} />
        <PlanRulesPanel
          rules={planRules}
          costItems={data.items.filter((i) => !i.archived).map((i) => ({ id: i.id, name: i.name, unit: i.unit, category: i.category }))}
        />
      </div>
    </Shell>
  );
}

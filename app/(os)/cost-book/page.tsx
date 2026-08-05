import { Shell } from "@/components/shell/Shell";
import { Eyebrow } from "@/components/ui";
import { CostBookClient } from "@/components/cost-book/CostBookClient";
import { AddCostItemButton } from "@/components/cost-book/AddCostItemButton";
import { getCostBook } from "@/lib/cost-book";

export default async function CostBookPage() {
  const data = await getCostBook();
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
      </div>
    </Shell>
  );
}

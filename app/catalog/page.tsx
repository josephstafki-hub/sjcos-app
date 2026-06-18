import { Search, Sparkles } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { Card, Eyebrow, AckButton } from "@/components/ui";
import { CatalogClient } from "@/components/catalog/CatalogClient";
import { AddMaterialButton } from "@/components/catalog/AddMaterialButton";
import { getCatalogData } from "@/lib/catalog";

export default async function CatalogPage() {
  const data = await getCatalogData();

  return (
    <Shell breadcrumb="CATALOG · MATERIAL LIBRARY">
      <div className="mx-auto max-w-[1200px] px-7 pb-16 pt-6">
        {/* Header */}
        <div className="mb-3.5 flex flex-wrap items-end gap-4">
          <div className="flex-1">
            <Eyebrow>{data.eyebrow}</Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
              Catalog
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Card kind="soft" className="flex w-[240px] items-center gap-1.5 px-2.5 py-1.5">
              <Search className="size-3 text-ink-4" strokeWidth={1.5} />
              <span className="text-[11px] text-ink-4">Search by SKU, supplier, color…</span>
            </Card>
            <AckButton
              variant="ai"
              icon={<Sparkles className="size-3" strokeWidth={1.5} />}
              label="Browser capture"
              ackLabel="Capturing…"
            />
            <AddMaterialButton />
          </div>
        </div>

        <CatalogClient data={data} />
      </div>
    </Shell>
  );
}

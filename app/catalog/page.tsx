import { Search, Sparkles, Plus } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { Card, Eyebrow } from "@/components/ui";
import { CatalogClient } from "@/components/catalog/CatalogClient";
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
            <button className="inline-flex items-center gap-1 rounded-md border border-ai bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2">
              <Sparkles className="size-3" strokeWidth={1.5} />
              Browser capture
            </button>
            <button className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e]">
              <Plus className="size-3" strokeWidth={1.5} />
              Add material
            </button>
          </div>
        </div>

        <CatalogClient data={data} />
      </div>
    </Shell>
  );
}

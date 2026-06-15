"use client";

import { useState } from "react";
import { Card, Chip } from "@/components/ui";
import type { CatalogCategory, CatalogData } from "@/lib/catalog";

export function CatalogClient({ data }: { data: CatalogData }) {
  const [category, setCategory] = useState<CatalogCategory>("All");

  const visible =
    category === "All"
      ? data.materials
      : data.materials.filter((m) => m.category === category);

  return (
    <>
      {/* Category filter chips */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {data.categories.map((c) => (
          <button key={c} onClick={() => setCategory(c)}>
            <Chip kind={category === c ? "solid" : "ghost"}>{c}</Chip>
          </button>
        ))}
      </div>

      {/* Material grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((m) => (
          <Card key={m.sku} className="overflow-hidden p-0">
            <div className="aspect-[4/3] border-b border-rule bg-paper-3" />
            <div className="p-2.5">
              <div className="font-serif text-[13px] font-semibold leading-tight text-ink">
                {m.name}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-3">{m.supplier}</div>
              <div className="mt-2 flex items-center gap-2">
                <span className="flex-1 truncate font-mono text-[9px] text-ink-3">{m.sku}</span>
                <span className="font-mono text-[11px] font-semibold text-accent-2">{m.price}</span>
              </div>
              <div className="mt-1 text-[11px] text-money">{m.use}</div>
            </div>
          </Card>
        ))}
        {visible.length === 0 && (
          <Card kind="dashed" className="col-span-full p-8 text-center">
            <div className="text-[13px] text-ink-3">No materials in this category yet.</div>
          </Card>
        )}
      </div>
    </>
  );
}

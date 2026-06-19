"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { deleteMaterial } from "@/lib/actions/catalog";
import type { CatalogCategory, CatalogData } from "@/lib/catalog";

export function CatalogClient({ data }: { data: CatalogData }) {
  const [category, setCategory] = useState<CatalogCategory>("All");
  const [removing, startRemove] = useTransition();
  const [pendingId, setPendingId] = useState<number | null>(null);

  function remove(id: number) {
    setPendingId(id);
    startRemove(async () => {
      await deleteMaterial(id);
      setPendingId(null);
    });
  }

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
          <Card
            key={m.id}
            className={`group relative overflow-hidden p-0 ${pendingId === m.id ? "opacity-40" : ""}`}
          >
            {m.imageId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/files/${m.imageId}`}
                alt={m.name}
                className="aspect-[4/3] w-full border-b border-rule object-cover"
              />
            ) : (
              <div className="aspect-[4/3] border-b border-rule bg-paper-3" />
            )}
            <button
              type="button"
              onClick={() => remove(m.id)}
              disabled={removing}
              aria-label={`Remove ${m.name}`}
              className="absolute right-1.5 top-1.5 rounded-md border border-rule bg-card/90 p-1 text-ink-3 opacity-0 transition hover:text-flag group-hover:opacity-100 disabled:opacity-40"
            >
              <Trash2 className="size-3.5" strokeWidth={1.5} />
            </button>
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

"use client";
import { useState, useTransition } from "react";
import {
  MoreHorizontal,
  Search,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";
import { Button, Card, Chip, Segmented, EmptyState } from "@/components/ui";
import { archiveDirectoryRecord } from "@/lib/actions/directory-maintenance";
import { runAction } from "@/lib/run-action";
import { AddMaterialButton } from "./AddMaterialButton";
import type { CatalogData } from "@/lib/catalog";
export function CatalogClient({ data }: { data: CatalogData }) {
  const [category, setCategory] = useState("All"),
    [series, setSeries] = useState("All"),
    [view, setView] = useState("active"),
    [q, setQ] = useState(""),
    [pending, start] = useTransition(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const inCategory = data.materials.filter(
    (m) =>
      m.archived === (view === "archived") &&
      (category === "All" || m.category === category),
  );
  const seriesList = [
    ...new Set(inCategory.map((m) => m.series).filter(Boolean)),
  ].sort();
  const visible = inCategory.filter(
    (m) =>
      (series === "All" || m.series === series) &&
      `${m.name} ${m.supplier} ${m.sku} ${m.series} ${m.description}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          aria-label="Material status"
          value={view}
          onChange={(v) => {
            setView(v);
            setSeries("All");
          }}
          options={[
            { value: "active", label: "Active" },
            {
              value: "archived",
              label: "Archived",
              count: data.materials.filter((m) => m.archived).length,
            },
          ]}
        />
        <label className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-rule bg-card px-3 @xl/page:ml-auto @xl/page:w-72">
          <Search className="size-4 shrink-0 text-ink-3" />
          <input
            type="search"
            aria-label="Search materials"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search SKU, supplier, color…"
            className="w-full min-w-0 bg-transparent text-body outline-none"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-label text-ink-3">
          Category
          <select
            aria-label="Material category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setSeries("All");
            }}
            className="h-9 rounded-md border border-rule bg-card px-2 text-body text-ink"
          >
            {data.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {seriesList.length > 1 && (
          <label className="flex items-center gap-2 text-label text-ink-3">
            Series
            <select
              aria-label="Product series"
              value={series}
              onChange={(e) => setSeries(e.target.value)}
              className="h-9 max-w-56 rounded-md border border-rule bg-card px-2 text-body text-ink"
            >
              {["All", ...seriesList].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        <span className="text-meta text-ink-3">{visible.length} materials</span>
      </div>
      {error && (
        <p role="alert" className="text-body text-flag">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-body text-ok">
          {notice}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 @3xl/page:gap-4 @lg/page:grid-cols-2 @3xl/page:grid-cols-3 @5xl/page:grid-cols-4">
        {visible.map((m) => (
          <Card key={m.id} className="relative overflow-visible p-0">
            <div className="overflow-hidden rounded-t-lg">
              {m.imageId ? (
                /* eslint-disable-next-line @next/next/no-img-element */ <img
                  loading="lazy"
                  src={`/api/files/${m.imageId}?w=320`}
                  alt={/touch.?up|finish reference/i.test(`${m.name} ${m.description}`) ? `Finish reference for ${m.name}` : m.name}
                  className="aspect-[4/3] w-full bg-paper-2 object-cover"
                />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-paper-2">
                  <ImageIcon className="size-8 text-ink-4" strokeWidth={1.25} />
                  <span className="sr-only">No product image</span>
                </div>
              )}
              {m.imageId && /touch.?up|finish reference/i.test(`${m.name} ${m.description}`) && <p className="bg-paper-2 px-3 py-1 text-meta text-ink-2">Finish reference · shown on cabinetry</p>}
            </div>
            <div className="absolute right-2 top-2">
              <details className="relative">
                <summary
                  aria-label={`Actions for ${m.name}`}
                  className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md border border-rule-soft bg-card shadow-card max-sm:size-11"
                >
                  <MoreHorizontal className="size-4" />
                </summary>
                <div className="absolute right-0 z-20 mt-1 flex w-44 flex-col rounded-lg border border-rule-soft bg-card p-1 shadow-pop">
                  <AddMaterialButton material={m} />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start text-flag"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await runAction(() =>
                          archiveDirectoryRecord(
                            "catalog_items",
                            m.id,
                            !m.archived,
                          ),
                        );
                        if (r.ok)
                          setNotice(
                            m.archived
                              ? "Material restored."
                              : "Material archived. Find it in Archived to restore it.",
                          );
                        else
                          setError(r.error ?? "Couldn't update this material.");
                      })
                    }
                  >
                    {m.archived ? "Restore" : "Archive"}
                  </Button>
                </div>
              </details>
            </div>
            <div className="space-y-2 p-3">
              <div className="text-subheading font-semibold text-ink">
                {m.name}
              </div>
              <div className="text-meta text-ink-3">
                {m.supplier || "Supplier not recorded"}
              </div>
              {m.description && (
                <p className="line-clamp-2 text-body text-ink-2">
                  {m.description}
                </p>
              )}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="break-all text-meta text-ink-3">{m.sku}</span>
                <span className="text-body font-semibold tabular-nums text-ink">
                  {m.price || "Price not recorded"}
                </span>
              </div>
              {m.series && <Chip>{m.series}</Chip>}
              {m.use && <p className="text-meta text-ink-3">{m.use}</p>}
              {m.sourceUrl && /^https?:\/\//.test(m.sourceUrl) && (
                <a
                  href={m.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-label text-accent-2 hover:underline"
                >
                  <ExternalLink className="size-3.5" />
                  Product page
                </a>
              )}
            </div>
          </Card>
        ))}
      </div>
      {!visible.length && (
        <EmptyState
          title="No matching materials"
          description="Adjust your search and filters, add a material, or open Archived to restore one."
        />
      )}
    </div>
  );
}

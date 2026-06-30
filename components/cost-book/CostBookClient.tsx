"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { unitLabel, fmtUsd } from "@/lib/cost-book-units";
import type { CostBookData, CostItem } from "@/lib/cost-book";
import { setCostItemArchived, deleteCostItem, setDefaultMarkup } from "@/lib/actions/cost-book";
import { CostItemModal } from "./CostItemModal";

export function CostBookClient({ data }: { data: CostBookData }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [cat, setCat] = useState<string>("All");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<CostItem | null>(null);
  const [markup, setMarkup] = useState(String(data.defaultMarkup));

  // Category chips: only categories that actually have items, plus "All".
  const cats = useMemo(() => {
    const present = Array.from(new Set(data.items.map((i) => i.category))).sort();
    return ["All", ...present];
  }, [data.items]);

  const visible = data.items.filter(
    (i) => (showArchived ? i.archived : !i.archived) && (cat === "All" || i.category === cat),
  );

  function archive(id: number, next: boolean) {
    startTransition(async () => {
      await setCostItemArchived(id, next);
      router.refresh();
    });
  }
  function remove(id: number) {
    if (!confirm("Delete this cost item? This can't be undone.")) return;
    startTransition(async () => {
      await deleteCostItem(id);
      router.refresh();
    });
  }
  function saveMarkup() {
    const v = Number(markup);
    if (!Number.isFinite(v)) return;
    startTransition(async () => {
      await setDefaultMarkup(v);
      router.refresh();
    });
  }

  return (
    <>
      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Card kind="soft" className="flex items-center gap-2 px-3 py-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Default markup</span>
          <input
            value={markup}
            onChange={(e) => setMarkup(e.target.value)}
            onBlur={saveMarkup}
            onKeyDown={(e) => e.key === "Enter" && saveMarkup()}
            inputMode="decimal"
            className="w-14 rounded border border-rule bg-paper px-1.5 py-0.5 text-right text-[13px] text-ink outline-none focus:border-accent"
          />
          <span className="text-[12px] text-ink-2">%</span>
        </Card>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {/* Category filter */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
              cat === c ? "border-accent bg-accent-soft text-accent-2" : "border-rule bg-card text-ink-3 hover:bg-paper-2"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Card kind="dashed" className="p-10 text-center">
          <div className="font-serif text-[16px] font-semibold text-ink-2">
            {data.items.length === 0 ? "Your cost book is empty" : "Nothing in this view"}
          </div>
          <div className="mt-1 text-[12px] text-ink-3">
            {data.items.length === 0
              ? "Add your reusable unit costs (labor + material assemblies). Estimates pull from these."
              : "Try another category or toggle archived."}
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-rule bg-paper-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 text-right font-medium">Unit cost</th>
                <th className="px-3 py-2 text-right font-medium">Markup</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((i, k) => (
                <tr key={i.id} className={`group text-[13px] ${k ? "border-t border-rule-soft" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-ink">{i.name}</div>
                    {i.notes && <div className="text-[11px] text-ink-3">{i.notes}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{i.category}</td>
                  <td className="px-3 py-2.5 text-ink-3">{unitLabel(i.unit)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-ink">{fmtUsd(i.unitCost)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2">
                    {i.markup != null ? (
                      <Chip kind="accent">{i.markup}%</Chip>
                    ) : (
                      <span className="text-[11px] text-ink-3">default ({data.defaultMarkup}%)</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => setEditing(i)} title="Edit" className="rounded p-1 text-ink-3 hover:bg-paper-2 hover:text-ink">
                        <Pencil className="size-3.5" strokeWidth={1.75} />
                      </button>
                      <button
                        onClick={() => archive(i.id, !i.archived)}
                        title={i.archived ? "Restore" : "Archive"}
                        className="rounded p-1 text-ink-3 hover:bg-paper-2 hover:text-ink"
                      >
                        {i.archived ? <ArchiveRestore className="size-3.5" strokeWidth={1.75} /> : <Archive className="size-3.5" strokeWidth={1.75} />}
                      </button>
                      <button onClick={() => remove(i.id)} title="Delete" className="rounded p-1 text-ink-3 hover:bg-paper-2 hover:text-flag">
                        <Trash2 className="size-3.5" strokeWidth={1.75} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editing && <CostItemModal mode="edit" item={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

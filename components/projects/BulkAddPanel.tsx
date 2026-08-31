"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, ListPlus } from "lucide-react";
import { Card } from "@/components/ui";
import { fmtUsd, unitLabel } from "@/lib/cost-book-units";
import type { CostItem } from "@/lib/cost-book";
import type { FloorplanVersion } from "@/lib/floorplans";
import { addTakeoffLines } from "@/lib/actions/estimates";

/** Bulk add: enter quantities against many cost-book items at once, with the
 *  uploaded plan(s) shown for reference. Adds all entered rows as estimate lines
 *  in one pass. On-PDF click-to-measure is deferred — this is manual entry. */
export function BulkAddPanel({
  estimateId,
  slug,
  costItems,
  floorplans,
  onDone,
}: {
  estimateId: number;
  slug: string;
  costItems: CostItem[];
  floorplans: FloorplanVersion[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [section, setSection] = useState("General");
  const [cat, setCat] = useState("All");
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cats = useMemo(() => ["All", ...Array.from(new Set(costItems.map((c) => c.category))).sort()], [costItems]);
  const visible = costItems.filter((c) => cat === "All" || c.category === cat);
  const entered = Object.entries(qtys).filter(([, v]) => Number(v) > 0).length;

  function add() {
    const entries = Object.entries(qtys)
      .map(([id, v]) => ({ costItemId: Number(id), qty: Number(v) }))
      .filter((e) => e.qty > 0);
    if (entries.length === 0) {
      setError("Enter a quantity for at least one item.");
      return;
    }
    setError(null);
    setSaving(true);
    startTransition(async () => {
      const res = await addTakeoffLines(estimateId, slug, section, entries);
      setSaving(false);
      if (res.ok) {
        setQtys({});
        onDone();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  const field = "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
        <ListPlus className="size-3.5" strokeWidth={1.75} /> Bulk add from cost book
      </div>

      {/* Plan reference */}
      {floorplans.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {floorplans.map((fp) => (
            <a
              key={fp.id}
              href={fp.fileUrl}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-paper-2 px-2.5 py-1.5 text-[12px] text-ink-2 hover:bg-paper-3"
            >
              <FileText className="size-3.5 text-ink-3" strokeWidth={1.5} />
              Plan v{fp.version} {fp.isPdf ? "(PDF)" : ""} · {fp.uploaded}
            </a>
          ))}
        </div>
      ) : (
        <div className="mb-3 text-[11px] text-ink-3">
          No plan uploaded — add one in the Floor tab to reference it here.
        </div>
      )}

      {/* Target section + category filter */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Add into section</span>
          <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="Kitchen" className={`${field} w-[180px]`} />
        </label>
        <div className="flex flex-wrap gap-1.5">
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
      </div>

      {/* Cost-item quantity grid */}
      {costItems.length === 0 ? (
        <div className="rounded-md border border-dashed border-rule p-6 text-center text-[12px] text-ink-3">
          Your cost book is empty — add unit costs in the Cost book first.
        </div>
      ) : (
        <div className="max-h-[340px] divide-y divide-rule-soft overflow-y-auto rounded-md border border-rule">
          {visible.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink">{c.name}</div>
                <div className="font-mono text-[11px] text-ink-3">
                  {fmtUsd(c.unitCost)} {unitLabel(c.unit)}
                </div>
              </div>
              <input
                inputMode="decimal"
                value={qtys[c.id] ?? ""}
                onChange={(e) => setQtys((p) => ({ ...p, [c.id]: e.target.value }))}
                placeholder="qty"
                className="w-20 rounded border border-rule bg-paper px-2 py-1 text-right text-[13px] text-ink outline-none focus:border-accent"
              />
              <span className="w-8 text-[11px] text-ink-3">{c.unit}</span>
            </div>
          ))}
        </div>
      )}

      {error && <div className="mt-2 text-[12px] text-flag">{error}</div>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={add}
          disabled={saving || entered === 0}
          className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
        >
          {saving ? "Adding…" : `Add ${entered} item${entered === 1 ? "" : "s"}`}
        </button>
        <button onClick={onDone} className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2">
          Done
        </button>
      </div>
    </Card>
  );
}

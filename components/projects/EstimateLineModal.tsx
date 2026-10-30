"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { X } from "lucide-react";
import { COST_UNITS, centsToInput } from "@/lib/cost-book-units";
import type { CostItem } from "@/lib/cost-book";
import type { EstimateLineView } from "@/lib/estimates";
import { addEstimateLine, updateEstimateLine } from "@/lib/actions/estimates";
import { runAction } from "@/lib/run-action";

export function EstimateLineModal({
  estimateId,
  slug,
  mode,
  line,
  costItems,
  defaultMarkup,
  onClose,
}: {
  estimateId: number;
  slug: string;
  mode: "add" | "edit";
  line?: EstimateLineView;
  costItems: CostItem[];
  defaultMarkup: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [costItemId, setCostItemId] = useState<string>(line?.costItemId ? String(line.costItemId) : "");
  const [description, setDescription] = useState(line?.description ?? "");
  const [section, setSection] = useState(line?.section ?? "General");
  const [unit, setUnit] = useState(line?.unit ?? "ea");
  const [qty, setQty] = useState(line ? String(line.qty) : "1");
  const [unitCost, setUnitCost] = useState(line ? centsToInput(line.unitCost) : "");
  const [markup, setMarkup] = useState(line ? String(line.markup) : String(defaultMarkup));

  // Picking a cost item snapshots its fields into the editable line.
  function pickCostItem(id: string) {
    setCostItemId(id);
    const item = costItems.find((c) => String(c.id) === id);
    if (item) {
      setDescription(item.name);
      setUnit(item.unit);
      setUnitCost(centsToInput(item.unitCost));
      setMarkup(String(item.markup ?? defaultMarkup));
    }
  }

  const extended =
    (Number(qty) || 0) * (Number(unitCost) || 0) * (1 + (Number(markup) || 0) / 100);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await runAction(
        () => (mode === "edit" && line ? updateEstimateLine(line.id, slug, fd) : addEstimateLine(estimateId, slug, fd)),
        { fallback: "Couldn't save the line." },
      );
      if (res.ok) {
        onClose();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  const field = "min-w-0 w-full rounded-md border border-rule bg-card px-3 py-2 text-body text-ink outline-none focus:border-accent";
  const lab = "text-label font-medium text-ink-3";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[10vh]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={mode === "edit" ? "Edit line" : "Add line"} className="max-h-[85dvh] overflow-y-auto w-full max-w-[500px] rounded-lg border border-rule bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-heading font-semibold text-ink">
            {mode === "edit" ? "Edit line" : "Add line"}
          </h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3 p-4">
          {/* hidden cost_item link */}
          <input type="hidden" name="costItemId" value={costItemId} />

          <label className="flex flex-col gap-1">
            <span className={lab}>From cost book (optional)</span>
            <select value={costItemId} onChange={(e) => pickCostItem(e.target.value)} className={field}>
              <option value="">— Free-form line —</option>
              {costItems.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.category})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={lab}>Description</span>
            <input name="description" required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Frame interior walls" className={field} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={lab}>Section</span>
              <input name="section" value={section} onChange={(e) => setSection(e.target.value)} placeholder="Kitchen" className={field} />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className={lab}>Unit</span>
              <select name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={field}>
                {COST_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>{u.value}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={lab}>Qty</span>
              <input name="qty" type="number" min="0" step="any" required inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className={field} />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={lab}>Unit cost ($)</span>
              <input name="unitCost" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="12.50" className={field} />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className={lab}>Markup %</span>
              <input name="markup" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} className={field} />
            </label>
          </div>

          <div className="flex items-center justify-between rounded-md bg-paper-2 px-3 py-2">
            <span className="text-label text-ink-3">Line total</span>
            <span className="tabular-nums text-subheading font-semibold text-ink">
              {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(extended)}
            </span>
          </div>

          {error && <div className="text-label text-flag">{error}</div>}

          <div className="flex items-center justify-end gap-2 border-t border-rule-soft pt-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : mode === "edit" ? "Save line" : "Add line"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

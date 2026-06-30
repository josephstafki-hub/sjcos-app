"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { COST_UNITS, COST_CATEGORIES, centsToInput } from "@/lib/cost-book-units";
import { createCostItem, updateCostItem } from "@/lib/actions/cost-book";
import type { CostItem } from "@/lib/cost-book";

/** Shared add/edit modal for a cost-book item. */
export function CostItemModal({
  mode,
  item,
  onClose,
}: {
  mode: "add" | "edit";
  item?: CostItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res =
        mode === "edit" && item ? await updateCostItem(item.id, fd) : await createCostItem(fd);
      if (res.ok) {
        onClose();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  const field = "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";
  const lab = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]"
      onClick={onClose}
    >
      <div className="w-full max-w-[460px] rounded-lg border border-rule bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-[17px] font-semibold text-ink">
            {mode === "edit" ? "Edit cost item" : "Add cost item"}
          </h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1">
            <span className={lab}>Name</span>
            <input name="name" required autoFocus defaultValue={item?.name ?? ""} placeholder="Frame interior wall" className={field} />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className={lab}>Category</span>
              <select name="category" defaultValue={item?.category ?? "General"} className={field}>
                {COST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="flex w-[140px] flex-col gap-1">
              <span className={lab}>Unit</span>
              <select name="unit" defaultValue={item?.unit ?? "ea"} className={field}>
                {COST_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>{u.value} · {u.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className={lab}>Unit cost ($)</span>
              <input
                name="unitCost"
                inputMode="decimal"
                defaultValue={item ? centsToInput(item.unitCost) : ""}
                placeholder="12.50"
                className={field}
              />
            </label>
            <label className="flex w-[140px] flex-col gap-1">
              <span className={lab}>Markup % (optional)</span>
              <input
                name="markup"
                inputMode="decimal"
                defaultValue={item?.markup != null ? String(item.markup) : ""}
                placeholder="default"
                className={field}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={lab}>Notes</span>
            <input name="notes" defaultValue={item?.notes ?? ""} placeholder="optional" className={field} />
          </label>

          {error && <div className="text-[12px] text-flag">{error}</div>}

          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2">
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
            >
              {pending ? "Saving…" : mode === "edit" ? "Save changes" : "Add cost item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

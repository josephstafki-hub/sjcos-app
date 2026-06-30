"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { CostItemModal } from "./CostItemModal";

/** Header "Add cost item" button → shared modal in add mode. */
export function AddCostItemButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e]"
      >
        <Plus className="size-3" strokeWidth={1.5} />
        Add cost item
      </button>
      {open && <CostItemModal mode="add" onClose={() => setOpen(false)} />}
    </>
  );
}

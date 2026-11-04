"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { CostItemModal } from "./CostItemModal";

/** Header "Add cost item" button → shared modal in add mode. */
export function AddCostItemButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={Plus} onClick={() => setOpen(true)}>
        Add cost item
      </Button>
      {open && <CostItemModal mode="add" onClose={() => setOpen(false)} />}
    </>
  );
}

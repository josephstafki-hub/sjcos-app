"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { createVendor } from "@/lib/actions/vendors";
import { SubmitButton } from "@/components/ui";

/** "Add vendor" button + modal. Submits the createVendor Server Action, which
 *  inserts the vendor and redirects to their detail page. Mirrors
 *  OnboardSubButton. */
export function OnboardVendorButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e]"
      >
        <Plus className="size-3" strokeWidth={1.5} />
        Add vendor
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[440px] rounded-lg border border-rule bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <h2 className="font-serif text-[17px] font-semibold text-ink">Add a vendor</h2>
              <button onClick={() => setOpen(false)} className="text-ink-3 hover:text-ink" aria-label="Close">
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>

            <form action={createVendor} className="flex flex-col gap-3 p-4">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Name</span>
                <input
                  name="name"
                  required
                  autoFocus
                  placeholder="Riverside Lumber"
                  className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Trade / category</span>
                <input
                  name="trade"
                  placeholder="Lumber, Cabinets, Hardware…"
                  className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Email</span>
                  <input
                    name="email"
                    type="email"
                    placeholder="orders@…"
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Phone</span>
                  <input
                    name="phone"
                    placeholder="612-…"
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                  />
                </label>
              </div>

              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2"
                >
                  Cancel
                </button>
                <SubmitButton
                  pendingLabel="Adding…"
                  className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
                >
                  Add vendor
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

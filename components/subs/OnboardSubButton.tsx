"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { createSub } from "@/lib/actions/subs";
import { SubmitButton } from "@/components/ui";

// Inlined (not imported from lib/subs): that module pulls in lib/db → pg, which
// must never enter a client bundle. Keep in sync with TRADES there.
const TRADE_OPTIONS = ["Tile", "Electric", "Plumbing", "Paint", "Framing", "HVAC", "Flooring"];

/** "Onboard a sub" button + modal. Submits the createSub Server Action, which
 *  inserts the sub and redirects to their detail page. */
export function OnboardSubButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e]"
      >
        <Plus className="size-3" strokeWidth={1.5} />
        Onboard a sub
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
              <h2 className="font-serif text-[17px] font-semibold text-ink">Onboard a sub</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-ink-3 hover:text-ink"
                aria-label="Close"
              >
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>

            <form action={createSub} className="flex flex-col gap-3 p-4">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                  Name
                </span>
                <input
                  name="name"
                  required
                  autoFocus
                  placeholder="Marco Rivas"
                  className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                    Trade
                  </span>
                  <select
                    name="trade"
                    defaultValue={TRADE_OPTIONS[0]}
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                  >
                    {TRADE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                    Rate
                  </span>
                  <input
                    name="rate"
                    placeholder="$60/hr"
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                  />
                </label>
              </div>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                    Email
                  </span>
                  <input
                    name="email"
                    type="email"
                    placeholder="marco@…"
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                    Phone
                  </span>
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
                  pendingLabel="Onboarding…"
                  className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
                >
                  Onboard
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

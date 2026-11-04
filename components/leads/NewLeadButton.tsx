"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { createLead } from "@/lib/actions/leads";
import { Button, SubmitButton } from "@/components/ui";

/** "New lead" button + modal form. Submits the createLead Server Action, which
 *  inserts the lead and redirects to its detail page. */
export function NewLeadButton() {
  const [open, setOpen] = useState(false);

  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
      if (event.key === "Tab") {
        const controls = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button, [role="dialog"] input'));
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); trigger.current?.focus(); };
  }, [open]);

  return (
    <>
      <span ref={node => { trigger.current = node?.querySelector("button") ?? null; }}><Button icon={Plus} onClick={() => setOpen(true)}>New lead</Button></span>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog" aria-modal="true" aria-label="New lead" className="w-full max-w-[440px] rounded-lg border border-rule bg-card shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <h2 className="font-serif text-heading font-semibold text-ink">New lead</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-ink-3 hover:text-ink"
                aria-label="Close"
              >
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>

            <form action={createLead} className="flex flex-col gap-3 p-4">
              <label className="flex flex-col gap-1">
                <span className="text-meta text-ink-3">
                  Name
                </span>
                <input
                  name="name"
                  required
                  autoFocus
                  placeholder="Maria & David Chen"
                  className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-meta text-ink-3">
                  Scope
                </span>
                <input
                  name="scope"
                  placeholder="Full kitchen reno"
                  className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-meta text-ink-3">
                    Est. value
                  </span>
                  <input
                    name="value"
                    placeholder="$45–55k"
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-meta text-ink-3">
                    Source
                  </span>
                  <input
                    name="source"
                    placeholder="Referral / Site form"
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                  />
                </label>
              </div>

              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-meta text-ink-3">
                    Referred by
                  </span>
                  <input
                    name="referrer_name"
                    placeholder="Referrer name"
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-meta text-ink-3">
                    Referrer email
                  </span>
                  <input
                    name="referrer_email"
                    type="email"
                    placeholder="thanks auto-sent"
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                  />
                </label>
              </div>

              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-rule px-3 py-1.5 text-label font-semibold text-ink-3 hover:bg-paper-2"
                >
                  Cancel
                </button>
                <SubmitButton
                  pendingLabel="Creating…"
                  className="rounded-md border border-ink bg-ink px-3 py-1.5 text-label font-semibold text-paper hover:bg-ink-hover"
                >
                  Create lead
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

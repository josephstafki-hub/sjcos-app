"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { createWarrantyClaim } from "@/lib/actions/warranty";
import { useDialogDismiss } from "@/lib/use-dialog-dismiss";
import { runAction } from "@/lib/run-action";

/** Owner "Log a claim" button + modal for the /warranty page (phone/email/
 *  walk-through intake). Submits createWarrantyClaim. */
export function AddClaimButton({
  projects,
}: {
  projects: { slug: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useDialogDismiss(open, () => setOpen(false), trigger);
  const router = useRouter();

  const inputCls =
    "w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent";

  return (
    <>
      <button
        ref={trigger}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-label font-semibold text-paper hover:bg-ink-hover max-sm:h-11"
      >
        <Plus className="size-3" strokeWidth={2} />
        Log a claim
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Log a warranty claim"
            className="w-full max-w-lg rounded-xl border border-rule-soft bg-card shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <h2 className="font-serif text-title font-semibold text-ink">
                Log a warranty claim
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-ink-3 hover:text-ink"
                aria-label="Close"
              >
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>
            <form
              ref={formRef}
              className="flex flex-col gap-3 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                startTransition(async () => {
                  setError("");
                  const r = await runAction(() => createWarrantyClaim(fd), {
                    fallback: "Couldn't log the claim.",
                  });
                  if (r.ok) {
                    setOpen(false);
                    router.refresh();
                  } else {
                    setError(r.error ?? "Couldn't log the claim.");
                  }
                });
              }}
            >
              <label className="flex flex-col gap-1">
                <span className="text-label font-medium text-ink-3">
                  Project
                </span>
                <select autoFocus name="slug" required className={inputCls}>
                  <option value="">Select a project…</option>
                  {projects.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-label font-medium text-ink-3">
                  Source
                </span>
                <select name="source" defaultValue="phone" className={inputCls}>
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                  <option value="manual">In person / other</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-label font-medium text-ink-3">Issue</span>
                <textarea
                  name="issue"
                  required
                  rows={3}
                  placeholder="What's the client reporting?"
                  className={`${inputCls} resize-y`}
                />
              </label>
              {error && <div className="text-label text-flag">{error}</div>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-rule px-3 py-1.5 text-label font-semibold text-ink-3 hover:bg-paper-2 max-sm:h-11"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md border border-ink bg-ink px-3 py-1.5 text-label font-semibold text-paper hover:bg-ink-hover max-sm:h-11 disabled:opacity-60"
                >
                  {pending ? "Logging…" : "Log claim"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

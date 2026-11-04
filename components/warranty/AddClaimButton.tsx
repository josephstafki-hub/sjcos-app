"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui";
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
    "w-full min-w-0 rounded-md border border-rule bg-card px-3 py-2 text-body text-ink focus-visible:outline-2 focus-visible:outline-focus";

  return (
    <>
      <button
        ref={trigger}
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-body font-semibold text-paper hover:bg-ink-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus max-sm:h-11"
      >
        <Plus className="size-3" strokeWidth={2} />
        Log a claim
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Log a warranty claim"
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-rule-soft bg-card shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <h2 className="font-serif text-title font-semibold text-ink">
                Log a warranty claim
              </h2>
              <Button
                onClick={() => setOpen(false)}
                icon={X}
                iconOnly
                aria-label="Close"
                title="Close"
              />
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
              <label className="flex min-w-0 flex-col gap-1.5">
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
              {error && (
                <div role="alert" className="text-meta text-flag">{error}</div>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={pending}
                >
                  {pending ? "Logging…" : "Log claim"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

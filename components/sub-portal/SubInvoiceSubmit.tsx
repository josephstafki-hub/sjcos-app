"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, Send, X } from "lucide-react";
import { submitSubInvoice } from "@/lib/actions/sub-portal";

/** Real "Submit final invoice" control for the sub portal — an amount + note
 *  that persists to sub_invoices and notifies Joe. Replaces the showcase
 *  AckButton; on success the page revalidates so the list below updates. */
export function SubInvoiceSubmit({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
      >
        <Plus className="size-3" strokeWidth={1.75} />
        Submit final invoice
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          setError("");
          const r = await submitSubInvoice(slug, fd);
          if (r.ok) {
            setOpen(false);
            formRef.current?.reset();
          } else {
            setError(r.error ?? "Could not submit the invoice.");
          }
        });
      }}
      className="mt-3 flex flex-col gap-2 rounded-md border border-rule bg-paper-2 p-2.5"
    >
      <div className="flex items-center">
        <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          Final invoice
        </span>
        <button type="button" onClick={() => setOpen(false)} className="text-ink-3 hover:text-ink" aria-label="Cancel">
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <input
        name="amount"
        inputMode="numeric"
        required
        autoFocus
        placeholder="$ amount"
        className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
      />
      <input
        name="note"
        placeholder="Note (optional)"
        className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center gap-1 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
      >
        <Send className="size-3" strokeWidth={1.75} />
        {pending ? "Submitting…" : "Submit invoice"}
      </button>
      {error && <div className="text-[11px] text-flag">{error}</div>}
    </form>
  );
}

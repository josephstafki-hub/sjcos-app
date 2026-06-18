"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteLead } from "@/lib/actions/leads";

/** Delete-lead button with a confirm guard. Calls the owner-gated deleteLead
 *  action, which removes the lead and redirects back to the list. */
export function DeleteLeadButton({ slug, name }: { slug: string; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => {
        if (confirm(`Delete lead "${name}"? This can't be undone.`)) {
          startTransition(() => deleteLead(slug));
        }
      }}
      disabled={pending}
      aria-label="Delete lead"
      className="inline-flex items-center gap-1 rounded-md border border-flag/40 bg-flag-soft px-2.5 py-1 text-[12px] font-semibold text-flag transition-colors hover:bg-flag/15 disabled:opacity-60"
    >
      <Trash2 className="size-3" strokeWidth={1.5} />
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}

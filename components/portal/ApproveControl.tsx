"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";

type Result = { ok: boolean; error?: string };

/** Typed-name approval control for portal surfaces (mood boards; floor plans
 *  have their own inline variant). The bound server action receives a FormData
 *  carrying `approvedName`; revalidation swaps this for the approved chip. */
export function ApproveControl({
  label,
  signerName,
  action,
}: {
  label: string;
  signerName: string;
  action: (formData: FormData) => Promise<Result>;
}) {
  const [name, setName] = useState(signerName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function approve() {
    setError(null);
    if (!name.trim()) return setError("Type your name to approve.");
    const fd = new FormData();
    fd.set("approvedName", name.trim());
    startTransition(async () => {
      const res = await action(fd);
      if (!res.ok) setError(res.error ?? "Something went wrong.");
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your full name"
        className="w-full max-w-[220px] rounded-md border border-rule bg-card px-2.5 py-1.5 font-serif text-[14px] italic text-ink focus:border-accent focus:outline-none"
      />
      <button
        type="button"
        onClick={approve}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-money bg-money px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
      >
        <Check className="size-3" strokeWidth={2.5} />
        {pending ? "Approving…" : label}
      </button>
      {error && <span className="w-full text-[11px] text-flag">{error}</span>}
    </div>
  );
}

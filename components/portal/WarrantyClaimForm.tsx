"use client";

import { useRef, useState, useTransition } from "react";
import { ShieldCheck, Send } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { submitWarrantyClaim } from "@/lib/actions/warranty";
import { runAction } from "@/lib/run-action";
import type { ClientWarranty } from "@/lib/warranty";

const STATUS_CHIP: Record<string, "money" | "accent" | "ghost"> = {
  Resolved: "money",
  "In progress": "accent",
  Received: "ghost",
};

/** Client-portal warranty panel — coverage summary, submit-a-claim form, and the
 *  client's own claims. Shown when their project is in the warranty stage. */
export function WarrantyClaimForm({ slug, data }: { slug: string; data: ClientWarranty }) {
  const [pending, startTransition] = useTransition();
  const [claims, setClaims] = useState(data.claims);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="size-3.5 text-accent" strokeWidth={1.75} />
        <span className="font-sans text-meta text-ink-3">Warranty</span>
      </div>
      <p className="mt-1.5 text-label leading-snug text-ink-2">{data.coverage}</p>

      <form
        ref={formRef}
        className="mt-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(async () => {
            setError("");
            const r = await runAction(() => submitWarrantyClaim(slug, fd), { fallback: "Couldn't submit the claim." });
            if (r.ok) {
              formRef.current?.reset();
              setSent(true);
              setClaims((c) => [{ id: `tmp-${Date.now()}`, issue: String(fd.get("issue") || ""), status: "Received", when: "just now" }, ...c]);
            } else {
              setError(r.error ?? "Couldn't submit the claim.");
            }
          });
        }}
      >
        <textarea
          name="issue"
          rows={2}
          required
          placeholder="Something not right? Describe the issue…"
          className="w-full rounded-md border border-rule bg-paper px-2.5 py-2 text-body text-ink outline-none focus:border-accent"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-label font-semibold text-paper hover:bg-ink-hover disabled:opacity-50"
          >
            <Send className="size-3" strokeWidth={1.75} />
            {pending ? "Submitting…" : "Submit a claim"}
          </button>
          {sent && <span className="text-meta text-money">Received — we&apos;ll be in touch.</span>}
        </div>
        {error && <div className="mt-1 text-meta text-flag">{error}</div>}
      </form>

      {claims.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-rule pt-2.5">
          {claims.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-label text-ink-2">{c.issue}</span>
              <Chip kind={STATUS_CHIP[c.status] ?? "ghost"} dot>
                {c.status}
              </Chip>
              <span className="font-sans text-meta text-ink-3">{c.when}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

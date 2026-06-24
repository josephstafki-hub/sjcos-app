"use client";

import { useRef, useState, useTransition } from "react";
import { ImagePlus, Send } from "lucide-react";
import { submitSubLog } from "@/lib/actions/sub-portal";

/** Real "Log your day" composer for the sub portal — a note + optional photo
 *  that persists to sub_logs and notifies Joe. Replaces the showcase AckButtons.
 *  On success the page revalidates so the log history below updates. */
export function SubLogComposer({ slug }: { slug: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          setError("");
          const r = await submitSubLog(slug, fd);
          if (r.ok) {
            formRef.current?.reset();
            setFileName("");
          } else {
            setError(r.error ?? "Could not log your day.");
          }
        });
      }}
    >
      <textarea
        name="body"
        rows={3}
        placeholder="What did you get done? Anything to flag?"
        className="w-full rounded-md border border-rule bg-paper px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent"
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-paper-2">
          <ImagePlus className="size-3" strokeWidth={1.75} />
          {fileName || "Add photo"}
          <input
            name="photo"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
          />
        </label>
        <div className="flex-1" />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-3 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
        >
          <Send className="size-3" strokeWidth={1.75} />
          {pending ? "Logging…" : "Log day"}
        </button>
      </div>
      {error && <div className="mt-1 text-[11px] text-flag">{error}</div>}
    </form>
  );
}

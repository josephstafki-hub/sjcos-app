"use client";

import { useState, useTransition } from "react";
import { Sparkles, Check } from "lucide-react";
import { autoLogTodayFromPhotos } from "@/lib/actions/schedule";

/** Header action on /schedule: drafts today's daily-log entries from today's
 *  uploaded site photos (one per project that has photos but no log yet). */
export function AutoLogButton() {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  function run() {
    setNote(null);
    startTransition(async () => {
      const res = await autoLogTodayFromPhotos();
      if (!res.ok) setNote(res.error);
      else if (res.drafted === 0) setNote("No new photos today");
      else setNote(`Drafted ${res.drafted} log${res.drafted === 1 ? "" : "s"}: ${res.projects.join(", ")}`);
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-ai bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2 disabled:opacity-60"
      >
        <Sparkles className="size-3" strokeWidth={1.75} />
        {pending ? "Drafting logs…" : "Auto-log from photos"}
      </button>
      {note && (
        <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
          <Check className="size-3 text-money" strokeWidth={2} />
          {note}
        </span>
      )}
    </span>
  );
}

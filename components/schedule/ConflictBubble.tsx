"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Check } from "lucide-react";
import { AiBubble } from "@/components/ui";
import { flagScheduleConflict } from "@/lib/actions/schedule";

/** The scheduling-conflict note. "Flag for follow-up" (only shown when the
 *  week actually has a clash) rechecks server-side and parks a real work item
 *  in Open Engine (deduped), so the flag survives the page; Dismiss hides the
 *  note for this visit — it comes back while the conflict still exists, which
 *  is the point. `conflict` mirrors the server's own "is this a clash" test. */
export function ConflictBubble({ conflict, children }: { conflict: boolean; children: ReactNode }) {
  const [state, setState] = useState<"open" | "flagged" | "dismissed">("open");
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (state === "dismissed") return null;

  if (state === "flagged") {
    return (
      <AiBubble className="mb-3.5">
        <span className="inline-flex items-center gap-1.5">
          <Check className="size-4 flex-none text-ai-2" strokeWidth={2} />
          {note}
        </span>
      </AiBubble>
    );
  }

  function flag() {
    startTransition(async () => {
      const res = await flagScheduleConflict();
      if (res.ok) {
        setNote(
          res.queued
            ? "Flagged — a work item is in your Engine queue to resolve it."
            : "Already flagged — the open work item was updated with this week's clash.",
        );
        setState("flagged");
      } else {
        setNote(res.error);
        setState("flagged");
      }
    });
  }

  return (
    <AiBubble
      className="mb-3.5"
      actions={
        <>
          {conflict && (
            <button
              onClick={flag}
              disabled={pending}
              className="rounded-md bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2 disabled:opacity-60"
            >
              {pending ? "Flagging…" : "Flag for follow-up"}
            </button>
          )}
          <button
            onClick={() => setState("dismissed")}
            className="rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink-2"
          >
            Dismiss
          </button>
        </>
      }
    >
      {children}
    </AiBubble>
  );
}

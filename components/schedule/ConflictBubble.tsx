"use client";

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { AiBubble } from "@/components/ui";

/** The AI scheduling-conflict note with working Apply / Ignore controls. There's
 *  no structured reschedule to commit yet, so Apply acknowledges (the owner will
 *  action it) and Ignore dismisses — both resolve the note out of the way rather
 *  than sitting inert. The note is passed as children so it can be a streamed
 *  (Suspense) server slot — see AiStream. */
export function ConflictBubble({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"open" | "applied" | "ignored">("open");

  if (state === "ignored") return null;

  if (state === "applied") {
    return (
      <AiBubble className="mb-3.5">
        <span className="inline-flex items-center gap-1.5">
          <Check className="size-4 flex-none text-ai-2" strokeWidth={2} />
          Noted — flagged for rescheduling. The conflicting blocks are marked for follow-up.
        </span>
      </AiBubble>
    );
  }

  return (
    <AiBubble
      className="mb-3.5"
      actions={
        <>
          <button
            onClick={() => setState("applied")}
            className="rounded-md bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2"
          >
            Apply
          </button>
          <button
            onClick={() => setState("ignored")}
            className="rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink-2"
          >
            Ignore
          </button>
        </>
      }
    >
      {children}
    </AiBubble>
  );
}

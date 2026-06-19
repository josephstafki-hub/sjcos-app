"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { suggestProjectStage } from "@/lib/actions/projects";
import { AI_NAME } from "@/lib/ai-name";

/**
 * "Stage check with {AI}" — asks Qwen whether the project looks ready to advance
 * to its next lifecycle stage. Read-only advice; the owner still confirms the
 * move with the adjacent "Move to …" button. Pops a small card with the answer.
 */
export function StageSuggest({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && text === null) {
      startTransition(async () => {
        const res = await suggestProjectStage(slug);
        setText(res || "No recommendation available.");
      });
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1 rounded-md border border-ai bg-ai-soft px-2.5 py-1 text-[12px] font-semibold text-ai-2 hover:bg-ai-soft/70"
      >
        <Sparkles className="size-3" strokeWidth={1.5} />
        Stage check
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1.5 w-[320px] rounded-lg border border-ai/40 bg-paper-2 p-3 text-[12.5px] text-ai-2 shadow-lg">
            <div className="mb-1 font-serif text-[12px] font-semibold text-ai-2">
              {AI_NAME} · stage check
            </div>
            {pending || text === null ? (
              <div className="animate-pulse text-ink-3">{AI_NAME} is reviewing the project…</div>
            ) : (
              <p className="text-ink-2">{text}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

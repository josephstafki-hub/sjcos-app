"use client";

import { AI_NAME } from "@/lib/ai-name";

/**
 * Persistent bottom-center pill — the always-available front door to Qwen.
 * Dispatches the same keydown CommandBar listens for on Ctrl/⌘+K, so it opens
 * the popup in place instead of navigating to /cmdk and losing this page's
 * aiContext (leads/projects/warranty each pass their own record brief).
 */
export function CmdKPill() {
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }));
      }}
      className="absolute bottom-3.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper shadow-pill"
    >
      <span className="size-3.5 rounded-full border-[1.5px] border-ai bg-ai-soft" />
      <span>Ask {AI_NAME}</span>
      <span className="rounded bg-white/15 px-1.5 py-px font-mono text-[10px]">⌘K</span>
    </button>
  );
}

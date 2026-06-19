import Link from "next/link";
import { AI_NAME } from "@/lib/ai-name";

/** Persistent bottom-center pill — the always-available front door to Qwen. */
export function CmdKPill() {
  return (
    <Link
      href="/cmdk"
      className="absolute bottom-3.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper shadow-pill"
    >
      <span className="size-3.5 rounded-full border-[1.5px] border-ai bg-ai-soft" />
      <span>Ask {AI_NAME}</span>
      <span className="rounded bg-white/15 px-1.5 py-px font-mono text-[10px]">⌘K</span>
    </Link>
  );
}

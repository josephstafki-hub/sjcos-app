"use client";

// Shared body for app/error.tsx and app/global-error.tsx: the crash message
// in the same flag styling the toasts use, plus a "Try again" that calls
// Next's unstable_retry (re-fetch + re-render the failed segment).

import Link from "next/link";
import { RotateCcw } from "lucide-react";

export function ErrorPanel({
  error,
  onRetry,
}: {
  error: Error & { digest?: string };
  onRetry: () => void;
}) {
  const message = (error?.message ?? "").trim() || "The page hit an error while rendering.";
  return (
    <div
      role="alert"
      className="w-full max-w-[520px] rounded-md border border-flag/40 bg-flag-soft px-4 py-3.5 text-flag shadow-card"
    >
      <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] opacity-80">Something went wrong</div>
      <div className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-snug text-ink">{message}</div>
      {error?.digest && (
        <div className="mt-1.5 font-mono text-[10px] text-ink-3">
          ref {error.digest} — matches the entry in the server log
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md border border-flag/40 bg-paper px-3 py-1.5 text-[12px] font-semibold text-flag hover:bg-paper-2"
        >
          <RotateCcw className="size-3.5" strokeWidth={2} />
          Try again
        </button>
        <Link href="/" className="text-[12px] text-ink-3 underline-offset-2 hover:underline">
          Back to Today
        </Link>
      </div>
    </div>
  );
}

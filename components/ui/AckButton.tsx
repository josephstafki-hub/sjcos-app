"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

// A button for showcase/AI actions that have no real backend yet (voice notes,
// invoicing, Drive auto-collect, AI skill re-runs — Stripe/QuickBooks/Drive are
// deferred this round). On click it captures the intent and flips to a brief
// acknowledgement state, then reverts — honest demo feedback, no fake success
// claim about a system that doesn't exist. For actions that DO have a backend,
// use a Server Action; for navigation, use a Link.

type AckButtonProps = {
  /** Resting label. */
  label: string;
  /** Confirmation label shown after click (e.g. "Queued for Joe"). */
  ackLabel: string;
  /** Rendered icon element, e.g. <Sparkles className="size-3" />. A ReactNode
   *  (not a component) so it can cross the server→client boundary. */
  icon?: ReactNode;
  /** Visual variant — mirrors the existing button styles across the app. */
  variant?: "ai" | "ink" | "outline" | "subtle";
  className?: string;
  /** ms before reverting to the resting label. */
  revertAfter?: number;
};

const VARIANTS: Record<NonNullable<AckButtonProps["variant"]>, string> = {
  ai: "border border-ai bg-ai text-white hover:bg-ai-2",
  ink: "border border-ink bg-ink text-paper hover:bg-[#232a1e]",
  outline: "border border-rule bg-card text-ink hover:bg-paper-2",
  subtle: "border border-ink-4 text-ink-2 hover:bg-paper-2",
};

export function AckButton({
  label,
  ackLabel,
  icon,
  variant = "ai",
  className = "",
  revertAfter = 2200,
}: AckButtonProps) {
  const [acked, setAcked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function onClick() {
    setAcked(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAcked(false), revertAfter);
  }

  return (
    <button
      onClick={onClick}
      aria-live="polite"
      className={[
        "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors",
        VARIANTS[variant],
        className,
      ].join(" ")}
    >
      {acked ? <Check className="size-3" strokeWidth={1.75} /> : icon}
      {acked ? ackLabel : label}
    </button>
  );
}

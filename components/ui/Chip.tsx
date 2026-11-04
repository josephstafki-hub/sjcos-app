import type { ReactNode } from "react";

export type ChipKind =
  | "default"
  | "accent"
  | "ai"
  | "flag"
  | "money"
  | "ok"
  | "warn"
  | "neutral"
  | "info"
  | "ghost"
  | "solid";

const KIND_CLASSES: Record<ChipKind, string> = {
  default: "bg-neutral-soft text-ink-2",
  neutral: "bg-neutral-soft text-ink-2",
  accent: "bg-accent-soft text-accent-2",
  ai: "bg-ai-soft text-ai-2",
  flag: "bg-flag-soft text-flag",
  money: "bg-money-soft text-money",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  info: "bg-info-soft text-info",
  ghost: "border border-rule text-ink-3",
  solid: "bg-ink text-paper",
};

type ChipProps = {
  children: ReactNode;
  kind?: ChipKind;
  dot?: boolean;
  /** IDs only (INV-0007, PO-001); status labels stay sentence-case sans. */
  mono?: boolean;
  className?: string;
};

/** Badge: 1–3 words. Render sentences as plain text, never as a Chip. */
export function Chip({ children, kind = "default", dot, mono, className = "" }: ChipProps) {
  return (
    <span
      // Full text on hover when a label is long enough to get truncated below.
      title={typeof children === "string" ? children : undefined}
      className={[
        "inline-flex h-5 min-w-0 max-w-full items-center gap-1 whitespace-nowrap rounded px-1.5 font-medium leading-none",
        mono ? "font-mono text-[11px] tracking-normal" : "font-sans text-[11.5px]",
        KIND_CLASSES[kind],
        className,
      ].join(" ")}
    >
      {dot && <span aria-hidden className="size-1.5 flex-none rounded-full bg-current" />}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

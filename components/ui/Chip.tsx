import type { ReactNode } from "react";

export type ChipKind =
  | "default"
  | "accent"
  | "ai"
  | "flag"
  | "money"
  | "info"
  | "ghost"
  | "solid";

const KIND_CLASSES: Record<ChipKind, string> = {
  default: "border-rule bg-card text-ink-2",
  accent: "border-transparent bg-accent-soft text-accent-2",
  ai: "border-ai bg-ai-soft text-ai-2",
  flag: "border-transparent bg-flag-soft text-flag",
  money: "border-transparent bg-money-soft text-money",
  info: "border-transparent bg-info-soft text-info",
  ghost: "border-ink-4 bg-transparent text-ink-3",
  solid: "border-ink bg-ink text-paper",
};

const DOT_CLASSES: Record<ChipKind, string> = {
  default: "bg-ink",
  accent: "bg-accent",
  ai: "bg-ai",
  flag: "bg-flag",
  money: "bg-money",
  info: "bg-info",
  ghost: "bg-ink-4",
  solid: "bg-paper",
};

type ChipProps = {
  children: ReactNode;
  kind?: ChipKind;
  dot?: boolean;
  className?: string;
};

/** Tag / badge — mono uppercase pill, optional leading status dot. */
export function Chip({ children, kind = "default", dot, className = "" }: ChipProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border",
        "px-2 py-px font-mono text-[9.5px] font-medium uppercase tracking-[0.08em]",
        KIND_CLASSES[kind],
        className,
      ].join(" ")}
    >
      {dot && <span className={`size-1.5 flex-none rounded-full ${DOT_CLASSES[kind]}`} />}
      {children}
    </span>
  );
}

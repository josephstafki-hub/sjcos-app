import type { ComponentPropsWithoutRef } from "react";

export type CardKind =
  | "default"
  | "soft"
  | "filled"
  | "tan"
  | "ai"
  | "accent"
  | "flag"
  | "money"
  | "ink"
  | "dashed";

const KIND_CLASSES: Record<CardKind, string> = {
  default: "border border-rule bg-card shadow-card",
  soft: "border border-rule-soft bg-paper",
  filled: "border border-rule bg-paper-2",
  tan: "border border-rule bg-paper-3",
  ai: "border border-ai bg-ai-soft",
  accent: "border border-accent bg-accent-soft",
  flag: "border border-flag bg-flag-soft",
  money: "border border-money bg-money-soft",
  ink: "border border-ink bg-ink text-paper",
  dashed: "border border-dashed border-ink-4 bg-transparent",
};

type CardProps = ComponentPropsWithoutRef<"div"> & {
  kind?: CardKind;
};

/** Box / surface primitive. 8px radius, optional semantic fill. */
export function Card({ kind = "default", className = "", children, ...rest }: CardProps) {
  return (
    <div
      className={`relative rounded-lg ${KIND_CLASSES[kind]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

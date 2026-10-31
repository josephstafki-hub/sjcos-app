import type { ReactNode } from "react";

type EyebrowProps = {
  children: ReactNode;
  /** Sentence-case sans section label for rails, cards and fields. */
  muted?: boolean;
  className?: string;
};

/**
 * Mono is reserved for the single page eyebrow; muted labels use sans.
 */
export function Eyebrow({ children, muted, className = "" }: EyebrowProps) {
  return (
    <div
      className={[
        "font-semibold",
        muted
          ? "font-sans text-label text-ink-2"
          : "font-mono text-micro uppercase text-accent",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

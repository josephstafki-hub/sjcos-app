import type { ReactNode } from "react";

type EyebrowProps = {
  children: ReactNode;
  /** Muted variant — the ink-3 section label used in rails (was `<L>` in the prototype). */
  muted?: boolean;
  className?: string;
};

/**
 * Small-caps mono section label. Default is the accent-green eyebrow;
 * `muted` renders the quieter ink-3 form list/rail label.
 */
export function Eyebrow({ children, muted, className = "" }: EyebrowProps) {
  return (
    <div
      className={[
        "font-mono uppercase font-semibold",
        muted
          ? "text-[9.5px] tracking-[0.16em] text-ink-3"
          : "text-[10px] tracking-[0.14em] text-accent",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

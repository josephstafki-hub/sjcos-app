"use client";

import Link from "next/link";

type TabsProps = {
  tabs: string[];
  /** Index of the active tab. */
  active?: number;
  /** Controlled mode — called with the clicked tab index. */
  onSelect?: (index: number) => void;
  /** Navigation mode — one href per tab; renders Next.js links instead of buttons. */
  routes?: string[];
  className?: string;
};

/** Tab bar with an active underline. Works as buttons (onSelect) or links (routes). */
export function Tabs({ tabs, active = 0, onSelect, routes, className = "" }: TabsProps) {
  return (
    <div
      className={`-mb-px flex overflow-x-auto border-b border-rule [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {tabs.map((tab, i) => {
        const isActive = i === active;
        const inner = (
          <span
            className={[
              "block cursor-pointer whitespace-nowrap px-3.5 py-2 text-[13px] transition-colors",
              "border-b-2",
              isActive
                ? "border-accent font-bold text-ink"
                : "border-transparent text-ink-3 hover:text-ink-2",
            ].join(" ")}
          >
            {tab}
          </span>
        );

        if (routes?.[i]) {
          return (
            <Link key={tab} href={routes[i]} className="block shrink-0">
              {inner}
            </Link>
          );
        }
        return (
          <button key={tab} type="button" onClick={() => onSelect?.(i)} className="block shrink-0">
            {inner}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

type TabsProps = {
  tabs: string[];
  /** Index of the active tab. */
  active?: number;
  /** Controlled mode — called with the clicked tab index. */
  onSelect?: (index: number) => void;
  /** Navigation mode — one href per tab; renders Next.js links instead of buttons. */
  routes?: string[];
  counts?: ReactNode[];
  "aria-label"?: string;
  className?: string;
};

/** Underline tabs with a scrollable overflow and keyboard navigation. */
export function Tabs({ tabs, active = 0, onSelect, routes, counts, className = "", "aria-label": label = "Views" }: TabsProps) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = container.current;
    const tab = el?.children[active] as HTMLElement | undefined;
    if (!el || !tab) return;
    if (tab.offsetLeft < el.scrollLeft) el.scrollLeft = tab.offsetLeft;
    else if (tab.offsetLeft + tab.offsetWidth > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = tab.offsetLeft + tab.offsetWidth - el.clientWidth;
    }
  }, [active]);

  const handleKey = (event: KeyboardEvent, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next == null) return;
    event.preventDefault();
    (container.current?.children[next] as HTMLElement | undefined)?.focus();
    if (!routes) onSelect?.(next);
  };

  return (
    <div ref={container} role={routes ? "navigation" : "tablist"} aria-label={label}
      className={`relative -mb-px flex overflow-x-auto border-b border-rule [mask-image:linear-gradient(to_right,black_90%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>
      {tabs.map((tab, i) => {
        const isActive = i === active;
        const classes = `inline-flex h-10 shrink-0 items-center whitespace-nowrap border-b-2 px-3 font-sans text-body font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${isActive ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink"}`;
        const content = <>{tab}{counts?.[i] != null && <span className="ml-1.5 text-meta font-normal text-ink-3">{counts[i]}</span>}</>;
        if (routes?.[i]) return (
          <Link key={tab} href={routes[i]} aria-current={isActive ? "page" : undefined} className={classes} onKeyDown={(event) => handleKey(event, i)}>{content}</Link>
        );
        return (
          <button key={tab} type="button" role="tab" aria-selected={isActive} tabIndex={isActive ? 0 : -1} onClick={() => onSelect?.(i)} onKeyDown={(event) => handleKey(event, i)} className={classes}>{content}</button>
        );
      })}
    </div>
  );
}

"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

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
  // Fade the right edge only while more tabs sit past it.
  const [moreRight, setMoreRight] = useState(false);
  const [moreLeft, setMoreLeft] = useState(false);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const check = () => {
      setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
      setMoreLeft(el.scrollLeft > 1);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, [tabs.length]);
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

  const nudge = (dir: 1 | -1) => container.current?.scrollBy({ left: dir * Math.max(160, (container.current?.clientWidth ?? 0) * 0.6), behavior: "smooth" });
  const arrow = "absolute top-0 z-10 flex h-10 w-8 items-center justify-center bg-paper text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus";

  return (
    <div className={`relative min-w-0 ${className}`}>
    {moreLeft && <button type="button" tabIndex={-1} aria-label="Show earlier tabs" title="Earlier tabs" onClick={() => nudge(-1)} className={`${arrow} left-0 border-r border-rule-soft`}><ChevronLeft className="size-4" /></button>}
    {moreRight && <button type="button" tabIndex={-1} aria-label="Show more tabs" title="More tabs" onClick={() => nudge(1)} className={`${arrow} right-0 border-l border-rule-soft`}><ChevronRight className="size-4" /></button>}
    <div ref={container} role={routes ? "navigation" : "tablist"} aria-label={label}
      className={`relative -mb-px flex overflow-x-auto border-b border-rule ${moreRight ? "pr-8" : ""} ${moreLeft ? "pl-8" : ""} [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}>
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
    </div>
  );
}

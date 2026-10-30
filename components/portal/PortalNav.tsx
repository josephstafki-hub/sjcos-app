"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Tabs } from "@/components/ui";

export interface PortalNavItem { href: string; label: string; badge?: number }

export function PortalNav({ items }: { items: PortalNavItem[] }) {
  const pathname = usePathname();
  const nav = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = nav.current;
    const selected = root?.querySelector<HTMLElement>('[aria-current="page"]');
    const scroller = selected?.parentElement;
    if (!root || !selected || !scroller) return;
    const reveal = () => {
      const left = selected.offsetLeft - scroller.offsetLeft;
      const padding = 40; // leave the overflow arrows clear of the selected label
      if (left < scroller.scrollLeft + padding) scroller.scrollLeft = Math.max(0, left - padding);
      else if (left + selected.offsetWidth > scroller.scrollLeft + scroller.clientWidth - padding) {
        scroller.scrollLeft = left + selected.offsetWidth - scroller.clientWidth + padding;
      }
    };
    const frame = requestAnimationFrame(reveal);
    const observer = new ResizeObserver(reveal);
    observer.observe(scroller);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [pathname]);
  const active = items.findIndex((item) => item.href === "/client-portal"
    ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/"));
  return <div ref={nav} className="flex-none bg-card px-1 sm:px-5">
    <Tabs tabs={items.map((i) => i.label)} routes={items.map((i) => i.href)}
      counts={items.map((i) => i.badge ? i.badge : null)} active={Math.max(0, active)}
      aria-label="Client portal sections" className="[&_a]:h-11" />
  </div>;
}

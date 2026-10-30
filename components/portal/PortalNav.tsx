"use client";

import { usePathname } from "next/navigation";
import { Tabs } from "@/components/ui";

export interface PortalNavItem { href: string; label: string; badge?: number }

export function PortalNav({ items }: { items: PortalNavItem[] }) {
  const pathname = usePathname();
  const active = items.findIndex((item) => item.href === "/client-portal"
    ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/"));
  return <div className="flex-none bg-card px-1 sm:px-5">
    <Tabs tabs={items.map((i) => i.label)} routes={items.map((i) => i.href)}
      counts={items.map((i) => i.badge ? i.badge : null)} active={Math.max(0, active)}
      aria-label="Client portal sections" className="[&_a]:h-11" />
  </div>;
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface PortalNavItem {
  href: string;
  label: string;
  /** Attention count rendered as a small badge; 0 hides it. */
  badge?: number;
}

/** Horizontal section nav for the client portal, under the header. Active
 *  state comes from the pathname; the Home item only matches exactly so it
 *  doesn't light up for every sub-route. */
export function PortalNav({ items }: { items: PortalNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-none items-center gap-1 overflow-x-auto border-b border-rule bg-paper-2 px-5">
      {items.map((item) => {
        const active =
          item.href === "/client-portal"
            ? pathname === "/client-portal"
            : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              "flex flex-none items-center gap-1.5 border-b-2 px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
              active
                ? "border-accent text-accent-2"
                : "border-transparent text-ink-3 hover:text-ink-2",
            ].join(" ")}
          >
            {item.label}
            {(item.badge ?? 0) > 0 && (
              <span className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] font-semibold text-white">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

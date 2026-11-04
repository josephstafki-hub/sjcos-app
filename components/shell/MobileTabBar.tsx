"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FolderKanban, Sprout, Inbox, Sparkles } from "lucide-react";
import { staffMayOpen } from "@/lib/permissions";
import type { SidebarUser } from "./Sidebar";

export const OPEN_MOBILE_OPERATOR = "sjcos:open-mobile-operator";
const tabs = [
  { label: "Today", href: "/today", icon: Home },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Leads", href: "/leads", icon: Sprout },
  { label: "Inbox", href: "/inbox", icon: Inbox },
];

/** Reserved space beside Shell’s scrolling content keeps this bar clear of page composers. */
export function MobileTabBar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();
  const allowed = (href: string) => user.staffPerms == null || staffMayOpen(user.staffPerms, href);
  return <nav aria-label="Main mobile navigation" className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-bottom))] items-start border-t border-white/10 bg-sidebar pb-[env(safe-area-inset-bottom)] text-paper sm:hidden">
    {tabs.filter((t) => allowed(t.href)).map(({ label, href, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href || pathname.startsWith(href + "/") ? "page" : undefined}
      className={`flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-label focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-paper ${pathname === href || pathname.startsWith(href + "/") ? "bg-white/10 text-white" : "text-paper/80 hover:bg-white/5"}`}>
      <Icon className="size-5" strokeWidth={1.75} />{label}
    </Link>)}
    {allowed("/panel") && <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_MOBILE_OPERATOR))} aria-controls="mobile-operator-sheet"
      className="flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-label text-paper/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-paper">
      <Sparkles className="size-5" strokeWidth={1.75} />Operator
    </button>}
  </nav>;
}

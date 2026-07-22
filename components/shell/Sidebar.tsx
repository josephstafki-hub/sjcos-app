"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Home,
  Inbox,
  MessageSquare,
  MessagesSquare,
  Sprout,
  FolderKanban,
  Calendar,
  HardHat,
  Truck,
  FolderOpen,
  Globe,
  Mail,
  LayoutGrid,
  Calculator,
  Cpu,
  ShieldCheck,
  Star,
  Zap,
  Megaphone,
  BookOpen,
  UserRound,
  UserCheck,
  Sparkles,
  LogOut,
} from "lucide-react";
import { Logo } from "./Logo";
import { logout } from "@/lib/actions/auth";
import { getNavCounts, type NavCounts } from "@/lib/actions/nav";
import { AI_NAME } from "@/lib/ai-name";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  tag?: string;
  disabled?: boolean;
};

const WORK: NavItem[] = [
  { label: "Today", href: "/today", icon: Home },
  // Temporary: Operator Console preview (three-panel redesign of /today).
  // Remove when it replaces /today. Spec: docs/operator-console-plan.md.
  { label: "Operator", href: "/today-preview", icon: Sparkles, tag: "preview" },
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Messages", href: "/messages", icon: MessagesSquare },
  { label: "Team Chat", href: "/chat", icon: MessageSquare },
  { label: "Leads", href: "/leads", icon: Sprout },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Schedule", href: "/schedule", icon: Calendar },
  { label: "Subs", href: "/subs", icon: HardHat },
  { label: "Vendors", href: "/vendors", icon: Truck },
  { label: "Files", href: "/files", icon: FolderOpen },
];

const TOOLS: NavItem[] = [
  { label: "Website", href: "/site", icon: Globe },
  { label: "Newsletter", href: "/newsletter", icon: Mail },
  { label: "Catalog", href: "/catalog", icon: LayoutGrid },
  { label: "Cost book", href: "/cost-book", icon: Calculator },
  { label: "Compliance", href: "/compliance", icon: ShieldCheck },
  { label: "Warranty", href: "/warranty", icon: Star },
  { label: "Marketing", href: "/marketing", icon: Megaphone },
  { label: "Automate", href: "/automate", icon: Zap },
  { label: "Engine", href: "/engine", icon: Cpu },
  { label: "Books", href: "/books", icon: BookOpen, tag: "soon", disabled: true },
];

const EXTERNAL: NavItem[] = [
  { label: "Client Portal · demo", href: "/client-portal", icon: UserRound },
  { label: "Sub Portal · demo", href: "/sub-portal", icon: UserCheck },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function RailLabel({ children }: { children: string }) {
  return (
    <div className="flex-none px-2 pb-1 pt-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-[rgba(241,236,225,0.42)]">
      {children}
    </div>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;

  // Disabled ("soon") items render as a non-clickable row instead of a dead link.
  if (item.disabled) {
    return (
      <div
        className="flex flex-none cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[rgba(241,236,225,0.4)]"
        aria-disabled
      >
        <Icon className="size-3.5 flex-none text-[rgba(241,236,225,0.4)]" strokeWidth={1.5} />
        <span className="flex-1 truncate">{item.label}</span>
        {item.tag && (
          <span className="font-mono text-[9px] text-[rgba(241,236,225,0.32)]">{item.tag}</span>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      className={[
        "flex flex-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "bg-[rgba(191,208,166,0.18)] font-semibold text-[#FBFAF4]"
          : "text-[rgba(241,236,225,0.82)] hover:bg-[rgba(255,255,255,0.07)] hover:text-[#FBFAF4]",
      ].join(" ")}
    >
      <Icon
        className={active ? "size-3.5 flex-none text-[#BFD0A6]" : "size-3.5 flex-none text-[rgba(241,236,225,0.78)]"}
        strokeWidth={1.5}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge && (
        <span className="rounded-full bg-[rgba(191,208,166,0.22)] px-1.5 font-mono text-[9px] font-semibold text-[#E7EFD6]">
          {item.badge}
        </span>
      )}
      {item.tag && (
        <span className="font-mono text-[9px] text-[rgba(241,236,225,0.38)]">{item.tag}</span>
      )}
    </Link>
  );
}

type SidebarUser = { name: string; initials: string; roleLabel: string };

/** Forest-green primary navigation panel. */
export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();
  const [counts, setCounts] = useState<NavCounts | null>(null);

  // Live nav badges, fetched after mount so they never delay a navigation.
  useEffect(() => {
    let alive = true;
    getNavCounts()
      .then((c) => alive && setCounts(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname]);

  const badgeFor = (href: string): string | undefined => {
    if (!counts) return undefined;
    const n =
      href === "/inbox"
        ? counts.inbox
        : href === "/messages"
          ? counts.messages
          : href === "/chat"
            ? counts.chat
            : href === "/leads"
              ? counts.leads
              : 0;
    return n > 0 ? String(n) : undefined;
  };

  return (
    <nav className="flex h-full w-[232px] flex-none flex-col bg-sidebar px-3 py-3.5">
      <div className="flex-none px-1.5 pb-3.5 pt-0.5">
        <Link href="/today">
          <Logo onDark />
        </Link>
      </div>

      {/* Link list scrolls inside the green panel so the rows can never spill
          past it (which would paint them on the cream body) and so the account
          row below stays pinned and visible at any viewport height. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto [scrollbar-color:rgba(241,236,225,0.25)_transparent] [scrollbar-width:thin]">
        <div className="flex-none pt-1.5" />

        <RailLabel>Work</RailLabel>
        {WORK.map((item) => (
          <NavLink
            key={item.href}
            item={{ ...item, badge: badgeFor(item.href) }}
            pathname={pathname}
          />
        ))}

        <div className="my-2 h-px flex-none bg-[rgba(255,255,255,0.09)]" />

        <RailLabel>Tools</RailLabel>
        {TOOLS.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}

        <div className="my-2 h-px flex-none bg-[rgba(255,255,255,0.09)]" />

        <RailLabel>External</RailLabel>
        {EXTERNAL.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </div>

      <Link
        href="/ai"
        className={[
          "mt-1 flex flex-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
          isActive(pathname, "/ai")
            ? "bg-[rgba(191,208,166,0.18)]"
            : "hover:bg-[rgba(255,255,255,0.07)]",
        ].join(" ")}
      >
        <Sparkles className="size-3.5 flex-none text-[#BFD0A6]" strokeWidth={1.5} />
        <span className="flex-1 text-[#BFD0A6]">Ask {AI_NAME}</span>
        <span className="font-mono text-[9px] text-[rgba(241,236,225,0.38)]">⌘J</span>
      </Link>

      <div className="mt-2.5 flex flex-none items-center gap-2 border-t border-[rgba(255,255,255,0.1)] px-1.5 pb-[max(0.125rem,env(safe-area-inset-bottom))] pt-2">
        <Link href="/settings" className="flex min-w-0 flex-1 items-center gap-2">
          <span className="inline-flex size-[26px] flex-none items-center justify-center rounded-full border border-[rgba(191,208,166,0.5)] bg-[rgba(191,208,166,0.18)] font-mono text-[10px] font-semibold text-[#E7EFD6]">
            {user.initials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-serif text-[13.5px] font-semibold text-paper">{user.name}</div>
            <div className="truncate text-[11px] text-[rgba(241,236,225,0.5)]">{user.roleLabel}</div>
          </div>
        </Link>
        <form action={logout} className="flex-none">
          <button type="submit" aria-label="Log out" className="block p-1">
            <LogOut className="size-3.5 text-[rgba(241,236,225,0.55)] hover:text-paper" strokeWidth={1.5} />
          </button>
        </form>
      </div>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Home,
  Inbox,
  MessageSquare,
  Sprout,
  FolderKanban,
  Calendar,
  HardHat,
  FolderOpen,
  Globe,
  Mail,
  LayoutGrid,
  ShieldCheck,
  Star,
  BookOpen,
  UserRound,
  UserCheck,
  Sparkles,
  Search,
  Settings,
} from "lucide-react";
import { Logo } from "./Logo";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  tag?: string;
};

const WORK: NavItem[] = [
  { label: "Today", href: "/today", icon: Home },
  { label: "Inbox", href: "/inbox", icon: Inbox, badge: "12" },
  { label: "Team Chat", href: "/chat", icon: MessageSquare, badge: "3" },
  { label: "Leads", href: "/leads", icon: Sprout, badge: "4" },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Schedule", href: "/schedule", icon: Calendar },
  { label: "Subs", href: "/subs", icon: HardHat },
  { label: "Files", href: "/files", icon: FolderOpen },
];

const TOOLS: NavItem[] = [
  { label: "Site", href: "/site", icon: Globe },
  { label: "Newsletter", href: "/newsletter", icon: Mail },
  { label: "Catalog", href: "/catalog", icon: LayoutGrid },
  { label: "Compliance", href: "/compliance", icon: ShieldCheck },
  { label: "Warranty", href: "/warranty", icon: Star },
  { label: "Books", href: "/books", icon: BookOpen, tag: "soon" },
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
    <div className="px-2 pb-1 pt-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-[rgba(241,236,225,0.42)]">
      {children}
    </div>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={[
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
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

/** Forest-green primary navigation panel. */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex w-[232px] flex-none flex-col gap-1 bg-sidebar px-3 py-3.5">
      <div className="px-1.5 pb-3.5 pt-0.5">
        <Link href="/today">
          <Logo onDark />
        </Link>
      </div>

      <Link
        href="/search"
        className="mb-2.5 flex items-center gap-1.5 rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] px-2 py-1.5"
      >
        <Search className="size-3 text-[rgba(241,236,225,0.6)]" strokeWidth={1.5} />
        <span className="flex-1 text-[12px] text-[rgba(241,236,225,0.6)]">Search anything</span>
        <span className="font-mono text-[9px] text-[rgba(241,236,225,0.45)]">⌘K</span>
      </Link>

      <RailLabel>Work</RailLabel>
      {WORK.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} />
      ))}

      <div className="my-2 h-px bg-[rgba(255,255,255,0.09)]" />

      <RailLabel>Tools</RailLabel>
      {TOOLS.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} />
      ))}

      <div className="my-2 h-px bg-[rgba(255,255,255,0.09)]" />

      <RailLabel>External</RailLabel>
      {EXTERNAL.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} />
      ))}

      <div className="flex-1" />

      <Link
        href="/ai"
        className={[
          "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
          isActive(pathname, "/ai")
            ? "bg-[rgba(191,208,166,0.18)]"
            : "hover:bg-[rgba(255,255,255,0.07)]",
        ].join(" ")}
      >
        <Sparkles className="size-3.5 flex-none text-[#BFD0A6]" strokeWidth={1.5} />
        <span className="flex-1 text-[#BFD0A6]">Ask Claude</span>
        <span className="font-mono text-[9px] text-[rgba(241,236,225,0.38)]">⌘J</span>
      </Link>

      <Link
        href="/settings"
        className="mt-1.5 flex items-center gap-2 border-t border-[rgba(255,255,255,0.1)] px-1.5 pb-0.5 pt-2"
      >
        <span className="inline-flex size-[26px] flex-none items-center justify-center rounded-full border border-[rgba(191,208,166,0.5)] bg-[rgba(191,208,166,0.18)] font-mono text-[10px] font-semibold text-[#E7EFD6]">
          JS
        </span>
        <div className="flex-1">
          <div className="font-serif text-[13.5px] font-semibold text-paper">Joe Schroeder</div>
          <div className="text-[11px] text-[rgba(241,236,225,0.5)]">Owner · all roles</div>
        </div>
        <Settings className="size-3.5 text-[rgba(241,236,225,0.55)]" strokeWidth={1.5} />
      </Link>
    </nav>
  );
}

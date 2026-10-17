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
  PhoneCall,
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
  Megaphone,
  BookOpen,
  Wallet,
  ReceiptText,
  UserRound,
  UserCheck,
  LogOut,
} from "lucide-react";
import { Logo } from "./Logo";
import { logout } from "@/lib/actions/auth";
import { getNavCounts, type NavCounts } from "@/lib/actions/nav";
import { staffMayOpen } from "@/lib/permissions";
import { subscribePanelBus } from "@/components/panel/panelBus";

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
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Messages", href: "/messages", icon: MessagesSquare },
  { label: "Calls", href: "/calls", icon: PhoneCall },
  { label: "Team Chat", href: "/chat", icon: MessageSquare },
  { label: "Leads", href: "/leads", icon: Sprout },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Money", href: "/money", icon: Wallet },
  { label: "Unsorted", href: "/unsorted", icon: ReceiptText },
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
  { label: "Engine", href: "/engine", icon: Cpu },
  { label: "Books", href: "/books", icon: BookOpen, tag: "soon", disabled: true },
];

const EXTERNAL: NavItem[] = [
  { label: "Client Portal · demo", href: "/client-portal", icon: UserRound },
  { label: "Sub Portal · demo", href: "/sub-portal", icon: UserCheck },
];

/** Gmail unread has no write on our side to watch, so the badges also re-read
 *  on this slow timer. */
const NAV_POLL_MS = 60_000;

/** Tables behind a badge (lib/actions/nav.ts), plus every chat_* table. ""
 *  is a write LiveUpdates couldn't name (hidden behind a CTE) — it might be
 *  one of them. */
const NAV_COUNT_TABLES = new Set([
  "",
  "leads",
  "projects", // a lead with a project stops counting
  "sms_threads",
  "sms_messages",
  "unsorted_docs",
  "team_members",
]);

function affectsNavCounts(scope: string): boolean {
  return NAV_COUNT_TABLES.has(scope) || scope.startsWith("chat_");
}

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

export type SidebarUser = {
  name: string;
  initials: string;
  roleLabel: string;
  /** Staff: the areas they hold — rail items outside them are hidden. Null for
   *  the owner (everything shows). */
  staffPerms: string[] | null;
};

/** Forest-green primary navigation panel. */
export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();
  const perms = user.staffPerms;
  const visible = (items: NavItem[]) => (perms ? items.filter((i) => staffMayOpen(perms, i.href)) : items);
  const work = visible(WORK);
  const tools = visible(TOOLS);
  const external = perms ? [] : EXTERNAL;
  const [counts, setCounts] = useState<NavCounts | null>(null);

  // Live nav badges, fetched after mount so they never delay a navigation.
  // Re-fetched when:
  //  • LiveUpdates sees a table behind a badge change — an agent, a timer or
  //    another tab answered a lead, filed a doc, got a text. router.refresh()
  //    alone never reaches this client state;
  //  • a page fires "sjc:nav-counts" after changing a count in place (e.g.
  //    replying in /chat answers a conversation — no navigation);
  //  • every NAV_POLL_MS while the tab is visible, for Gmail's unread, which
  //    changes without any write on our side.
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    let again = false;
    const load = () => {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      getNavCounts()
        .then((c) => alive && setCounts(c))
        .catch(() => {})
        .finally(() => {
          inFlight = false;
          if (again && alive) {
            again = false;
            load();
          }
        });
    };
    load();
    window.addEventListener("sjc:nav-counts", load);
    // Local only: every tab runs its own LiveUpdates, so a remote copy of the
    // same "changes" would just double the fetch.
    const unsubscribe = subscribePanelBus((msg, origin) => {
      if (origin === "local" && msg.type === "changes" && msg.scopes.some(affectsNavCounts)) load();
    });
    const timer = window.setInterval(() => {
      if (!document.hidden) load();
    }, NAV_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.removeEventListener("sjc:nav-counts", load);
      unsubscribe();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
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
              : href === "/unsorted"
                ? counts.unsorted
                : 0;
    return n > 0 ? String(n) : undefined;
  };

  const accountRow = (
    <>
      <span className="inline-flex size-[26px] flex-none items-center justify-center rounded-full border border-[rgba(191,208,166,0.5)] bg-[rgba(191,208,166,0.18)] font-mono text-[10px] font-semibold text-[#E7EFD6]">
        {user.initials}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-serif text-[13.5px] font-semibold text-paper">{user.name}</div>
        <div className="truncate text-[11px] text-[rgba(241,236,225,0.5)]">{user.roleLabel}</div>
      </div>
    </>
  );

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
        {work.map((item) => (
          <NavLink
            key={item.href}
            item={{ ...item, badge: badgeFor(item.href) }}
            pathname={pathname}
          />
        ))}

        {tools.length > 0 && (
          <>
            <div className="my-2 h-px flex-none bg-[rgba(255,255,255,0.09)]" />
            <RailLabel>Tools</RailLabel>
            {tools.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </>
        )}

        {external.length > 0 && (
          <>
            <div className="my-2 h-px flex-none bg-[rgba(255,255,255,0.09)]" />
            <RailLabel>External</RailLabel>
            {external.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </>
        )}
      </div>

      <div className="mt-2.5 flex flex-none items-center gap-2 border-t border-[rgba(255,255,255,0.1)] px-1.5 pb-[max(0.125rem,env(safe-area-inset-bottom))] pt-2">
        {/* Settings is owner-only; a staff member's account row is plain text. */}
        {perms ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">{accountRow}</div>
        ) : (
          <Link href="/settings" className="flex min-w-0 flex-1 items-center gap-2">
            {accountRow}
          </Link>
        )}
        <form action={logout} className="flex-none">
          <button type="submit" aria-label="Log out" className="block p-1">
            <LogOut className="size-3.5 text-[rgba(241,236,225,0.55)] hover:text-paper" strokeWidth={1.5} />
          </button>
        </form>
      </div>
    </nav>
  );
}

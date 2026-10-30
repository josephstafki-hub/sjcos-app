"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
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
  Clock,
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
  Camera,
  UserRound,
  UserCheck,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
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
  { label: "Scan receipt", href: "/scan", icon: Camera },
  { label: "Schedule", href: "/schedule", icon: Calendar },
  { label: "Job time", href: "/time", icon: Clock },
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

const COLLAPSE_KEY = "sjcos:sidebar:collapsed";
const COLLAPSE_EVENT = "sjcos:sidebar-change";
let fallbackCollapsed = false;
function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === "true"; } catch { return fallbackCollapsed; }
}
function subscribeCollapsed(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(COLLAPSE_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(COLLAPSE_EVENT, notify);
  };
}
function toggleCollapsed() {
  fallbackCollapsed = !readCollapsed();
  try { localStorage.setItem(COLLAPSE_KEY, String(fallbackCollapsed)); } catch {}
  window.dispatchEvent(new Event(COLLAPSE_EVENT));
}
const expandedOnServer = () => false;

function RailLabel({ children, collapsed }: { children: string; collapsed: boolean }) {
  return (
    <div className={collapsed ? "sr-only" : "flex-none px-2 py-1 font-sans text-label font-semibold text-sidebar-text-dim"}>
      {children}
    </div>
  );
}

function NavLink({ item, pathname, collapsed }: { item: NavItem; pathname: string; collapsed: boolean }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  const classes = `flex h-8 flex-none items-center rounded-md font-sans text-body font-medium transition-colors ${collapsed ? "justify-center" : "gap-2 px-2.5"}`;
  const title = `${item.label}${item.badge ? ` · ${item.badge} unread` : ""}${item.tag ? ` · ${item.tag}` : ""}`;

  if (item.disabled) return (
    <div title={title} aria-label={title} aria-disabled="true" className={`${classes} cursor-default text-sidebar-text-dim`}>
      <Icon aria-hidden className="size-4 flex-none" strokeWidth={1.5} />
      {!collapsed && <><span className="flex-1 truncate">{item.label}</span>{item.tag && <span className="text-meta">{item.tag}</span>}</>}
    </div>
  );

  return (
    <Link href={item.href} title={title} aria-label={collapsed ? title : undefined} aria-current={active ? "page" : undefined}
      className={`${classes} focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sidebar-sage ${active ? "bg-sidebar-active font-semibold text-card" : "text-sidebar-text hover:bg-sidebar-active hover:text-card"}`}>
      <Icon aria-hidden className={`size-4 flex-none ${active ? "text-sidebar-sage" : ""}`} strokeWidth={1.5} />
      {!collapsed && <>
        <span className="flex-1 truncate">{item.label}</span>
        {item.badge && <span className="rounded bg-sidebar-active px-1.5 text-meta font-semibold text-sidebar-sage">{item.badge}</span>}
        {item.tag && <span className="text-meta text-sidebar-text-dim">{item.tag}</span>}
      </>}
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
export function Sidebar({ user, collapsible = false }: { user: SidebarUser; collapsible?: boolean }) {
  const storedCollapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, expandedOnServer);
  const collapsed = collapsible && storedCollapsed;

  useEffect(() => {
    if (!collapsible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "[" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.defaultPrevented) return;
      if (!window.matchMedia("(min-width: 1024px)").matches) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
      event.preventDefault();
      toggleCollapsed();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsible]);
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
      <span className="inline-flex size-6 flex-none items-center justify-center rounded-full border border-sidebar-sage/50 bg-sidebar-active text-label font-semibold text-sidebar-sage">
        {user.initials}
      </span>
      {!collapsed && <div className="min-w-0 flex-1">
        <div className="truncate text-body font-semibold text-paper">{user.name}</div>
        <div className="truncate text-meta text-sidebar-text-dim">{user.roleLabel}</div>
      </div>}
    </>
  );

  return (
    <nav aria-label="Main navigation" data-collapsed={collapsed} className={`flex h-full flex-none flex-col bg-sidebar py-3 ${collapsed ? "w-14 px-2" : "w-[216px] px-3"}`}>
      <div className={`flex flex-none items-center pb-3 ${collapsed ? "flex-col gap-2" : "justify-between gap-1 px-1"}`}>
        <Link href="/today" title="SJC OS · Today" aria-label="SJC OS · Today" className="rounded focus-visible:outline-2 focus-visible:outline-sidebar-sage">
          <Logo onDark compact={collapsed} />
        </Link>
        {collapsible && <button type="button" onClick={toggleCollapsed} aria-expanded={!collapsed}
          title={collapsed ? "Expand navigation ([)" : "Collapse navigation ([)"}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className="inline-flex size-7 flex-none items-center justify-center rounded-md text-sidebar-text-dim hover:bg-sidebar-active hover:text-paper focus-visible:outline-2 focus-visible:outline-sidebar-sage">
          {collapsed ? <PanelLeftOpen aria-hidden className="size-4" strokeWidth={1.5} /> : <PanelLeftClose aria-hidden className="size-4" strokeWidth={1.5} />}
        </button>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto [scrollbar-color:var(--sidebar-text-dim)_transparent] [scrollbar-width:thin]">
        <RailLabel collapsed={collapsed}>Work</RailLabel>
        {work.map((item) => <NavLink key={item.href} item={{ ...item, badge: badgeFor(item.href) }} pathname={pathname} collapsed={collapsed} />)}
        {tools.length > 0 && <>
          <div className="my-2 h-px flex-none bg-sidebar-text-dim/20" />
          <RailLabel collapsed={collapsed}>Tools</RailLabel>
          {tools.map((item) => <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />)}
        </>}
        {external.length > 0 && <>
          <div className="my-2 h-px flex-none bg-sidebar-text-dim/20" />
          <RailLabel collapsed={collapsed}>External</RailLabel>
          {external.map((item) => <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />)}
        </>}
      </div>

      <div className={`mt-3 flex flex-none items-center gap-2 border-t border-sidebar-text-dim/20 pb-[max(0.125rem,env(safe-area-inset-bottom))] pt-2 ${collapsed ? "flex-col" : "px-1"}`}>
        {perms ? (
          <div title={`${user.name} · ${user.roleLabel}`} className="flex min-w-0 flex-1 items-center gap-2">{accountRow}</div>
        ) : (
          <Link href="/settings" title={`${user.name} · Settings`} aria-label={collapsed ? `${user.name} · Settings` : undefined} className="flex min-w-0 flex-1 items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-sidebar-sage">{accountRow}</Link>
        )}
        <form action={logout} className="flex-none">
          <button type="submit" aria-label="Log out" title="Log out" className="block rounded p-1 text-sidebar-text-dim hover:text-paper focus-visible:outline-2 focus-visible:outline-sidebar-sage">
            <LogOut aria-hidden className="size-4" strokeWidth={1.5} />
          </button>
        </form>
      </div>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CommandPalette, PALETTE_EVENT } from "@/components/panel/CommandPalette";
import { NotificationBell } from "./NotificationBell";

type TopbarProps = {
  /** Legacy string breadcrumbs remain supported, separated by ·, › or /. */
  breadcrumb?: string;
  unread?: number;
  leading?: ReactNode;
};

const BREADCRUMB_ROUTES: Record<string, string> = {
  today: "/today", projects: "/projects", leads: "/leads", money: "/money",
  inbox: "/inbox", messages: "/messages", calls: "/calls", "team chat": "/chat",
  schedule: "/schedule", subs: "/subs", vendors: "/vendors", files: "/files",
  website: "/site", newsletter: "/newsletter", catalog: "/catalog", "cost book": "/cost-book",
  compliance: "/compliance", warranty: "/warranty", marketing: "/marketing",
  "operations engine": "/engine", engine: "/engine", settings: "/settings",
  "floor plan": "/floor", notifications: "/notifications", unsorted: "/unsorted",
  "scan receipt": "/scan", workbench: "/workbench", time: "/time",
};

export function Topbar({ breadcrumb = "TODAY", unread = 0, leading }: TopbarProps) {
  const pathname = usePathname();
  const segments = breadcrumb.split(/\s*[·›/]\s*/).filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);

  return (
    <div className="flex h-[calc(3rem_+_env(safe-area-inset-top))] flex-none items-center gap-3 border-b border-rule bg-paper pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)]">
      {leading}
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
        <ol className="flex items-center gap-2 whitespace-nowrap font-mono text-micro uppercase text-ink-3">
          {segments.map((segment, index) => {
            // The last crumb is this page; middle crumbs follow the path.
            const href = BREADCRUMB_ROUTES[segment.toLowerCase()]
              ?? (index < segments.length - 1 && index < pathParts.length ? `/${pathParts.slice(0, index + 1).join("/")}` : pathname);
            return <li key={`${index}-${segment}`} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden className="text-ink-4">/</span>}
              <Link href={href} aria-current={index === segments.length - 1 && href === pathname ? "page" : undefined}
                className="rounded hover:text-ink focus-visible:outline-2 focus-visible:outline-focus">{segment}</Link>
            </li>;
          })}
        </ol>
      </nav>
      <CommandPalette />
      <Button onClick={() => window.dispatchEvent(new Event(PALETTE_EVENT))} variant="ghost" size="sm" icon={Search} aria-label="Search" title="Search (⌘K)">
        <span className="max-sm:hidden">Search… <kbd className="ml-3 font-mono text-meta text-ink-3">⌘K</kbd></span>
      </Button>
      <NotificationBell initial={unread} />
    </div>
  );
}

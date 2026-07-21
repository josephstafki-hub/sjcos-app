import Link from "next/link";
import type { ReactNode } from "react";
import { Bell } from "lucide-react";

type TopbarProps = {
  /** Small-caps mono breadcrumb, e.g. "PROJECTS › HENDERSON KITCHEN". */
  breadcrumb?: string;
  /** Unread notification count — drives the bell's red dot. */
  unread?: number;
  /** Leading slot (mobile hamburger menu), shown before the breadcrumb. */
  leading?: ReactNode;
};

export function Topbar({ breadcrumb = "TODAY", unread = 0, leading }: TopbarProps) {
  // The bar grows by the status-bar inset when installed to the home screen
  // (viewportFit: "cover"); env() resolves to 0 in a normal browser tab,
  // leaving the usual 50px bar.
  return (
    <div className="flex h-[calc(50px_+_env(safe-area-inset-top))] flex-none items-center gap-3 border-b border-rule bg-paper pl-[max(18px,env(safe-area-inset-left))] pr-[max(18px,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)]">
      {leading}
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
        {breadcrumb}
      </div>

      <div className="flex-1" />

      <Link
        href="/notifications"
        className="relative"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell className="size-4 text-ink-2" strokeWidth={1.5} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-flag" />
        )}
      </Link>
    </div>
  );
}

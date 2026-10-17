import type { ReactNode } from "react";
import { NotificationBell } from "./NotificationBell";

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

      <NotificationBell initial={unread} />
    </div>
  );
}

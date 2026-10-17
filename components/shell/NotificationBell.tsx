"use client";

// The topbar bell. Server-rendered count to start; after that it follows the
// count NotificationCenter broadcasts on every poll, so a new notification
// lights the bell without a page reload.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

const UNREAD_EVENT = "sjc:unread";

export function NotificationBell({ initial }: { initial: number }) {
  // The live count wins until the server renders a different one (a
  // refresh after marking read), which then takes over again.
  const [live, setLive] = useState<{ n: number; base: number } | null>(null);
  const unread = live && live.base === initial ? live.n : initial;
  useEffect(() => {
    const on = (e: Event) => {
      const n = Number((e as CustomEvent<number>).detail);
      if (Number.isFinite(n)) setLive({ n, base: initial });
    };
    window.addEventListener(UNREAD_EVENT, on);
    return () => window.removeEventListener(UNREAD_EVENT, on);
  }, [initial]);
  return (
    <Link
      href="/notifications"
      className="relative flex items-center"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
    >
      <Bell className="size-4 text-ink-2" strokeWidth={1.5} />
      {unread > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-flag px-[3px] font-mono text-[9px] font-semibold leading-none text-paper">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

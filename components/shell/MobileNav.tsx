"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Sidebar } from "./Sidebar";

type SidebarUser = { name: string; initials: string; roleLabel: string };

/**
 * Mobile navigation: a hamburger button (shown below `lg`) that opens the
 * full forest-green Sidebar as a slide-in drawer. The desktop rail in Shell
 * is hidden below `lg`, so this is the nav on phones/tablets.
 */
export function MobileNav({ user }: { user: SidebarUser }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);

  // Close the drawer whenever the route changes (tapping a nav link). Handled by
  // comparing during render — React's recommended "reset state on prop change"
  // pattern — rather than a synchronous setState inside an effect.
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        className="-ml-1 inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-black/5 lg:hidden"
      >
        <Menu className="size-5" strokeWidth={1.5} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-[232px] overflow-y-auto bg-sidebar shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation menu"
              className="absolute right-2 top-3 z-10 inline-flex size-7 items-center justify-center rounded-md text-[rgba(241,236,225,0.7)] hover:bg-white/10"
            >
              <X className="size-4" strokeWidth={1.5} />
            </button>
            <Sidebar user={user} />
          </div>
        </div>
      )}
    </>
  );
}

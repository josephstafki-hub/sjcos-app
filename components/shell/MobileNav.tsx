"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { MobileTabBar } from "./MobileTabBar";
import { Sidebar, type SidebarUser } from "./Sidebar";

/**
 * Mobile navigation: a hamburger button (shown below `lg`) that opens the
 * full forest-green Sidebar as a slide-in drawer. The desktop rail in Shell
 * is hidden below `lg`, so this is the nav on phones/tablets.
 */
export function MobileNav({ user }: { user: SidebarUser }) {
  const dialogRef = useRef<HTMLDivElement>(null);
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
    const trigger = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>("button, a[href]");
    first?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;
      const targets = dialogRef.current?.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex="0"]');
      if (!targets?.length) return;
      const first = targets[0], last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", escape);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", escape);
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="More navigation"
        data-mobile-more
        aria-expanded={open}
        className="-ml-1 inline-flex h-11 items-center gap-1 px-2 justify-center rounded-md text-ink-2 hover:bg-black/5 lg:hidden"
      >
        <Menu className="size-5" strokeWidth={1.5} /><span className="text-label">More</span>
      </button>

      <MobileTabBar user={user} />
      {/* Topbar’s next sibling is Shell’s scroll container. Reserve space for
          every account, including staff without the operator panel. */}
      <style>{`@media (max-width: 639px) {
        div:has(> [data-mobile-more]) + [class~="@container/page"] {
          margin-bottom: calc(3.5rem + env(safe-area-inset-bottom));
        }
      }`}</style>

      {open && (
        <div ref={dialogRef} onClickCapture={(event) => { if ((event.target as HTMLElement).closest("a[href]")) setOpen(false); }} role="dialog" aria-label="More navigation" aria-modal="true" className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 flex w-[216px] bg-sidebar shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation menu" title="Close navigation menu"
              className="absolute right-2 top-3 z-10 inline-flex size-11 items-center justify-center rounded-md text-paper/80 hover:bg-white/10"
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

"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Records the last app route the owner viewed into sessionStorage so the Ask
// window's Claude agent can pass it as page context ("point you at things to
// fix"). We skip the Ask page itself (/ai) — Joe is asking ABOUT another page,
// not this one. Renders nothing.
export function RouteTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname && pathname !== "/ai") {
      try {
        sessionStorage.setItem("sjcos:lastRoute", pathname);
      } catch {
        /* storage disabled — page context just falls back to none */
      }
    }
  }, [pathname]);
  return null;
}

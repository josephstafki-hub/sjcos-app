"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Deep-link landing helper. When the URL carries `?focus=<key>`, find the
 * element marked `data-focus="<key>"` (the tab that owns it should already be
 * open — see ProjectTabs / LeadTabs `initialTab`), scroll it into view and
 * flash it. Retries briefly because panels can hydrate a beat after mount.
 * Renders nothing. Mount once per detail page.
 */
export function FocusScroll({ focus }: { focus?: string | null }) {
  const params = useSearchParams();
  const key = focus ?? params.get("focus");

  useEffect(() => {
    if (!key) return;
    let tries = 0;
    let timer: number | undefined;
    const attempt = () => {
      const el = document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("focus-flash");
        // Restart the animation even if the same key is focused twice.
        void el.offsetWidth;
        el.classList.add("focus-flash");
        window.setTimeout(() => el.classList.remove("focus-flash"), 3000);
        return;
      }
      if (++tries < 20) timer = window.setTimeout(attempt, 150);
    };
    attempt();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [key]);

  return null;
}

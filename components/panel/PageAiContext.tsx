"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { postPanelMessage } from "./panelBus";

/**
 * Publishes the app view's current page grounding to the operator panel.
 * Shell renders this with the page's serialized aiContext (lib/page-context.ts)
 * — the same strings the per-page Ask surfaces used to pass straight into
 * their own chat. The dock reads the module ref at send time; a detached
 * panel window hears about it over the bus instead (module scope doesn't
 * cross real windows). Renders nothing.
 */

interface PageGrounding {
  pathname: string;
  context?: string;
}

let current: PageGrounding | null = null;

/** The grounding string a panel turn should send, from wherever the app view
 *  is right now. Falls back to RouteTracker's last route when the current page
 *  has no serialized context. */
export function getPanelPageContext(): string | undefined {
  if (current?.context) return current.context;
  const route = current?.pathname ?? lastTrackedRoute();
  return route ? `The owner is currently viewing the app page ${route}.` : undefined;
}

/** The route the app view is showing (for the panel's "viewing" chip). */
export function getPanelPageRoute(): string | null {
  return current?.pathname ?? lastTrackedRoute();
}

function lastTrackedRoute(): string | null {
  try {
    return sessionStorage.getItem("sjcos:lastRoute");
  } catch {
    return null;
  }
}

export function PageAiContext({ context }: { context?: string }) {
  const pathname = usePathname();
  useEffect(() => {
    current = { pathname, context };
    postPanelMessage({ type: "page", pathname, context });
  }, [pathname, context]);
  return null;
}

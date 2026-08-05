import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/dal";
import { RouteTracker } from "@/components/shell/RouteTracker";
import { LiveUpdates } from "@/components/shell/LiveUpdates";
import { PanelProvider } from "@/components/panel/PanelProvider";
import { PanelHost } from "@/components/panel/PanelHost";

/**
 * The internal app's layout: owns the h-dvh frame and, for the owner, the
 * persistent operator dock beside the page content. A layout is the one
 * Next-native boundary that does NOT re-render on soft navigation, which is
 * what lets the dock's chat state, poll loops and splitter width survive page
 * changes — and router.refresh() re-renders only its server parts, leaving the
 * client dock untouched.
 *
 * RouteTracker/LiveUpdates moved here from Shell: one persistent instance for
 * the whole session instead of one per page mount.
 */
export default async function OsLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const isOwner = user?.role === "owner";

  return (
    <>
      {isOwner ? (
        <PanelProvider>
          <PanelHost>{children}</PanelHost>
        </PanelProvider>
      ) : (
        <div className="h-dvh overflow-hidden bg-paper">{children}</div>
      )}
      <RouteTracker />
      <LiveUpdates />
    </>
  );
}

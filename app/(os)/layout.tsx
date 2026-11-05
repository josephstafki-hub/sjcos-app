import type { ReactNode } from "react";
import { can, getCurrentUser } from "@/lib/dal";
import { RouteTracker } from "@/components/shell/RouteTracker";
import { LiveUpdates } from "@/components/shell/LiveUpdates";
import { NotificationCenter } from "@/components/shell/NotificationCenter";
import { PanelProvider } from "@/components/panel/PanelProvider";
import { PanelHost } from "@/components/panel/PanelHost";
import { LiveActionNav } from "@/components/panel/LiveActionNav";
import { BrowserPhoneProvider } from "@/components/calls/BrowserPhone";
import { voiceConfigured } from "@/lib/voice";
import { browserCallingConfigured } from "@/lib/voice-browser";

/**
 * The internal app's layout: owns the h-dvh frame and, for the owner, the
 * persistent operator dock beside the page content. A layout is the one
 * Next-native boundary that does NOT re-render on soft navigation, which is
 * what lets the dock's chat state, poll loops and splitter width survive page
 * changes — and router.refresh() re-renders only its server parts, leaving the
 * client dock untouched.
 *
 * BrowserPhoneProvider wraps everything for the same reason: a browser call
 * must not drop when the page changes.
 *
 * RouteTracker/LiveUpdates moved here from Shell: one persistent instance for
 * the whole session instead of one per page mount.
 */
export default async function OsLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  // The operator dock mounts for the owner and for staff who hold the "ai"
  // area (lib/permissions.ts) — agents in it act with owner-level tools.
  const withPanel = can(user, "ai");
  // The browser phone lives here (not on /calls) so a call survives page
  // changes. Off unless VOICE_WEBRTC_CONNECTION_ID is set.
  const phoneEnabled = can(user, "comms") && voiceConfigured() && browserCallingConfigured();

  return (
    <BrowserPhoneProvider enabled={phoneEnabled}>
      {withPanel ? (
        <PanelProvider>
          <PanelHost>{children}</PanelHost>
          <LiveActionNav />
        </PanelProvider>
      ) : (
        <div className="h-dvh overflow-hidden bg-paper">{children}</div>
      )}
      <RouteTracker />
      <LiveUpdates />
      {/* Corner approvals (owner) + live toasts and bell count (everyone). */}
      {user && (user.role === "owner" || user.role === "staff") && <NotificationCenter />}
    </BrowserPhoneProvider>
  );
}

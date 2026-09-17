import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { Topbar } from "./Topbar";
import { PageAiContext } from "@/components/panel/PageAiContext";
import { canOpen, getCurrentUser, homeFor } from "@/lib/dal";
import { getUnreadCount } from "@/lib/notifications";
import { PATH_HEADER } from "@/lib/session-window";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner · all roles",
  staff: "Team member",
  sub: "Subcontractor",
  client: "Client",
};

type ShellProps = {
  children: ReactNode;
  /** Small-caps mono breadcrumb shown in the topbar. */
  breadcrumb?: string;
  /** Structured text brief of this page's records — published to the operator
   *  panel so its turns answer from what's in view (see lib/page-context.ts). */
  aiContext?: string;
};

/**
 * Global frame for every internal page: forest-green sidebar + topbar + main
 * content slot. Ask/AI chrome no longer lives here — the universal operator
 * panel (components/panel, mounted by the (os) layout) is the one Ask surface;
 * Shell just publishes the page's grounding to it. Standalone surfaces
 * (Client / Sub portal) use their own chrome and do not wrap in Shell.
 */
export async function Shell({ children, breadcrumb, aiContext }: ShellProps) {
  const [user, unread, hdrs] = await Promise.all([getCurrentUser(), getUnreadCount(), headers()]);

  // Staff area enforcement, against the DB row (not the cookie): proxy.ts
  // already filtered on the token's copy, but a revoked area must bite on the
  // very next render — and Shell is rendered for every internal page,
  // including soft navigations that never re-run the (os) layout.
  if (user?.role === "staff") {
    const path = hdrs.get(PATH_HEADER);
    if (path && !canOpen(user, path)) redirect(homeFor(user));
  }

  const sidebarUser = {
    name: user?.name ?? "—",
    initials: user?.initials || "?",
    roleLabel: user ? (ROLE_LABEL[user.role] ?? user.role) : "",
    // Owner sees every rail item (null = no filter); staff only the areas
    // they hold — Sidebar filters with lib/permissions, which is client-safe.
    staffPerms: user?.role === "staff" ? user.permissions : null,
  };

  return (
    // h-full, not h-dvh: the (os) layout owns the viewport frame now (it needs
    // to, to fit the operator dock beside this Shell).
    <div className="flex h-full overflow-hidden bg-paper">
      {/* Desktop rail — collapses into the Topbar hamburger drawer below lg. */}
      <div className="hidden flex-none lg:flex">
        <Sidebar user={sidebarUser} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          breadcrumb={breadcrumb}
          unread={unread}
          leading={<MobileNav user={sidebarUser} />}
        />
        {/* overflow-x-hidden: one over-wide element (a long status chip, a
            toolbar that didn't wrap) must never make the whole page pan
            sideways on a phone. Anything genuinely wide (tables) scrolls
            inside its own overflow-x-auto wrapper. */}
        <div className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</div>
      </div>
      <PageAiContext context={aiContext} />
    </div>
  );
}

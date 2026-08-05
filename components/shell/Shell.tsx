import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { Topbar } from "./Topbar";
import { PageAiContext } from "@/components/panel/PageAiContext";
import { getCurrentUser } from "@/lib/dal";
import { getUnreadCount } from "@/lib/notifications";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner · all roles",
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
  const [user, unread] = await Promise.all([getCurrentUser(), getUnreadCount()]);
  const sidebarUser = {
    name: user?.name ?? "—",
    initials: user?.initials || "?",
    roleLabel: user ? (ROLE_LABEL[user.role] ?? user.role) : "",
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
        <div className="relative min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
      <PageAiContext context={aiContext} />
    </div>
  );
}

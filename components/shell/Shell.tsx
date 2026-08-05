import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { Topbar } from "./Topbar";
import { CmdKPill } from "./CmdKPill";
import { CommandBar } from "@/components/cmdk/CommandBar";
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
  /** Hide the ⌘K pill where it would conflict (Schedule, Files, Floor, CMS). */
  hideCmd?: boolean;
  /** Open the command bar on mount (the /cmdk deep-link). */
  cmdkOpen?: boolean;
  /** Structured text brief of this page's records — makes the Ask-Qwen bar
   *  answer from what's in view (see lib/page-context.ts). */
  aiContext?: string;
  /** Page renders its own inline `<CommandBar embedded />` — suppress the
   *  floating ⌘K pill and popup so there's exactly one Ask surface on screen. */
  embeddedAsk?: boolean;
};

/**
 * Global frame for every internal page: forest-green sidebar + topbar + main
 * content slot, with the persistent ⌘K pill and the global command bar
 * (Ctrl/⌘+K from anywhere). Standalone surfaces (Client / Sub portal) use
 * their own chrome and do not wrap in Shell.
 */
export async function Shell({
  children,
  breadcrumb,
  hideCmd,
  cmdkOpen,
  aiContext,
  embeddedAsk,
}: ShellProps) {
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
        {!hideCmd && !embeddedAsk && <CmdKPill />}
      </div>
      {!embeddedAsk && <CommandBar defaultOpen={cmdkOpen} aiContext={aiContext} />}
    </div>
  );
}

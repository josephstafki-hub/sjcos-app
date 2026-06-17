import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
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
};

/**
 * Global frame for every internal page: forest-green sidebar + topbar + main
 * content slot, with the persistent ⌘K pill and the global command bar
 * (Ctrl/⌘+K from anywhere). Standalone surfaces (Client / Sub portal) use
 * their own chrome and do not wrap in Shell.
 */
export async function Shell({ children, breadcrumb, hideCmd, cmdkOpen }: ShellProps) {
  const [user, unread] = await Promise.all([getCurrentUser(), getUnreadCount()]);
  const sidebarUser = {
    name: user?.name ?? "—",
    initials: user?.initials || "?",
    roleLabel: user ? (ROLE_LABEL[user.role] ?? user.role) : "",
  };

  return (
    <div className="flex h-screen bg-paper">
      <Sidebar user={sidebarUser} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar breadcrumb={breadcrumb} unread={unread} />
        <div className="relative min-h-0 flex-1 overflow-auto">{children}</div>
        {!hideCmd && <CmdKPill />}
      </div>
      <CommandBar defaultOpen={cmdkOpen} />
    </div>
  );
}

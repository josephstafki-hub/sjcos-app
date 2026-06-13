import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CmdKPill } from "./CmdKPill";

type ShellProps = {
  children: ReactNode;
  /** Small-caps mono breadcrumb shown in the topbar. */
  breadcrumb?: string;
  /** Hide the ⌘K pill where it would conflict (Schedule, Files, Floor, CMS). */
  hideCmd?: boolean;
};

/**
 * Global frame for every internal page: forest-green sidebar + topbar + main
 * content slot, with the persistent ⌘K pill. Standalone surfaces (Client /
 * Sub portal) use their own chrome and do not wrap in Shell.
 */
export function Shell({ children, breadcrumb, hideCmd }: ShellProps) {
  return (
    <div className="flex h-screen bg-paper">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar breadcrumb={breadcrumb} />
        <div className="relative min-h-0 flex-1 overflow-auto">{children}</div>
        {!hideCmd && <CmdKPill />}
      </div>
    </div>
  );
}

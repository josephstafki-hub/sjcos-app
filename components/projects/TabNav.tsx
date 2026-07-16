"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ProjectTab } from "@/lib/project-tabs";

/** Switches the project-detail view to another tab by label, optionally opening
 *  one of that tab's sections. Provided by ProjectTabs so Overview cards
 *  (server-rendered, passed in as nodes) can "click through" to their tab
 *  without a server round-trip. */
export const TabNavContext = createContext<(label: ProjectTab, section?: string) => void>(
  () => {},
);

/** Which section is open in each grouped tab. Held by ProjectTabs rather than by
 *  PanelSections itself so a TabLink on another tab can deep-link a section
 *  ("Send invoice" → Money · Invoices). */
export const SectionNavContext = createContext<{
  sections: Record<string, string>;
  setSection: (tab: string, section: string) => void;
}>({ sections: {}, setSection: () => {} });

/** A control that jumps to another project tab. `className` styles it (defaults
 *  to a small uppercase "view" link); `children` is the label/icon content. */
export function TabLink({
  tab,
  section,
  children,
  className,
  title,
}: {
  tab: ProjectTab;
  /** Open this section of `tab` — only for the grouped tabs (Money, Closeout). */
  section?: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const go = useContext(TabNavContext);
  return (
    <button
      type="button"
      onClick={() => go(tab, section)}
      title={title}
      className={
        className ??
        "inline-flex items-center gap-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-accent-2 hover:text-accent"
      }
    >
      {children}
    </button>
  );
}

"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Switches the project-detail view to another tab by label. Provided by
 *  ProjectTabs so Overview cards (server-rendered, passed in as nodes) can
 *  "click through" to their tab without a server round-trip. */
export const TabNavContext = createContext<(label: string) => void>(() => {});

/** A control that jumps to another project tab. `className` styles it (defaults
 *  to a small uppercase "view" link); `children` is the label/icon content. */
export function TabLink({
  tab,
  children,
  className,
  title,
}: {
  tab: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const go = useContext(TabNavContext);
  return (
    <button
      type="button"
      onClick={() => go(tab)}
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

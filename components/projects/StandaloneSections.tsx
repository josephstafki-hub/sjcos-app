"use client";

import { useState, type ReactNode } from "react";
import { PanelSections } from "./PanelSections";
import { SectionNavContext } from "./TabNav";

/** PanelSections for a page that doesn't sit inside ProjectTabs (e.g. the lead
 *  detail page): owns the open-section state itself and provides the same
 *  context PanelSections reads. */
export function StandaloneSections({
  tab,
  sections,
  focusSections,
}: {
  tab: string;
  sections: { label: string; node: ReactNode }[];
  focusSections?: Record<string, string>;
}) {
  const [open, setOpen] = useState<Record<string, string>>({});
  return (
    <SectionNavContext.Provider
      value={{
        sections: open,
        setSection: (t, s) => setOpen((prev) => (prev[t] === s ? prev : { ...prev, [t]: s })),
      }}
    >
      <PanelSections tab={tab} sections={sections} focusSections={focusSections} />
    </SectionNavContext.Provider>
  );
}

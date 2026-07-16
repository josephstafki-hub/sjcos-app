"use client";

import { useState, type ReactNode } from "react";
import { Tabs, Card } from "@/components/ui";
import { PROJECT_TABS, type ProjectTab } from "@/lib/project-tabs";
import { TabNavContext, SectionNavContext } from "./TabNav";

/**
 * Project-detail tab bar. Each panel is server-rendered and passed in via
 * `panels` keyed by tab label; tabs without a panel show a placeholder.
 * `stageTab` (the current lifecycle stage's tool tab) opens first so the
 * project lands on the tool it's gated to.
 */
export function ProjectTabs({
  panels,
  stageTab,
  header,
}: {
  panels: Partial<Record<ProjectTab, ReactNode>>;
  stageTab?: ProjectTab;
  /** Server-rendered header band, rendered inside the tab-nav provider so its
   *  controls (Log update / Send invoice) can jump to a tab. */
  header?: ReactNode;
}) {
  const initial = stageTab ? Math.max(0, PROJECT_TABS.indexOf(stageTab)) : 0;
  const [active, setActive] = useState(initial);
  // Which section is open in each grouped tab (Money, Closeout); a tab absent
  // here shows its first section.
  const [sections, setSections] = useState<Record<string, string>>({});

  function setSection(tab: string, section: string) {
    setSections((prev) => (prev[tab] === section ? prev : { ...prev, [tab]: section }));
  }

  function goToTab(target: ProjectTab, section?: string) {
    const i = PROJECT_TABS.indexOf(target);
    if (i < 0) return;
    setActive(i);
    if (section) setSection(target, section);
  }

  // Every panel stays mounted (hidden when inactive) rather than swapping the
  // subtree on tab change — remounting made the first click after a switch land
  // on a node React was replacing, so it was silently lost.
  return (
    <TabNavContext.Provider value={goToTab}>
      <SectionNavContext.Provider value={{ sections, setSection }}>
        {header}
        <div className="border-b border-rule bg-paper-2 px-7">
          <Tabs tabs={[...PROJECT_TABS]} active={active} onSelect={setActive} />
        </div>
        <div className="mx-auto max-w-[1200px] px-7 py-5">
          {PROJECT_TABS.map((label, i) => (
            <div key={label} hidden={i !== active}>
              {panels[label] ??
                (i === active ? (
                  <Card kind="dashed" className="p-8 text-center">
                    <div className="font-serif text-[16px] font-semibold text-ink-2">{label}</div>
                    <div className="mt-1 text-[12px] text-ink-3">
                      This tab arrives in a later phase.
                    </div>
                  </Card>
                ) : null)}
            </div>
          ))}
        </div>
      </SectionNavContext.Provider>
    </TabNavContext.Provider>
  );
}

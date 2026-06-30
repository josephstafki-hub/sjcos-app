"use client";

import { useState, type ReactNode } from "react";
import { Tabs, Card } from "@/components/ui";
import { TabNavContext } from "./TabNav";

const TAB_LABELS = [
  "Overview",
  "Floor",
  "Mood",
  "Selections",
  "Estimate",
  "Schedule",
  "Subs",
  "Files",
  "Money",
  "Daily log",
  "Comms",
  "Punch",
  "Sign-offs",
];

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
  panels: Record<string, ReactNode>;
  stageTab?: string;
  /** Server-rendered header band, rendered inside the tab-nav provider so its
   *  controls (Log update / Send invoice) can jump to a tab. */
  header?: ReactNode;
}) {
  const initial = stageTab ? Math.max(0, TAB_LABELS.indexOf(stageTab)) : 0;
  const [active, setActive] = useState(initial);
  const label = TAB_LABELS[active];
  const content = panels[label];

  function goToTab(target: string) {
    const i = TAB_LABELS.indexOf(target);
    if (i >= 0) setActive(i);
  }

  return (
    <TabNavContext.Provider value={goToTab}>
      {header}
      <div className="border-b border-rule bg-paper-2 px-7">
        <Tabs tabs={TAB_LABELS} active={active} onSelect={setActive} />
      </div>
      <div className="mx-auto max-w-[1200px] px-7 py-5">
        {content ?? (
          <Card kind="dashed" className="p-8 text-center">
            <div className="font-serif text-[16px] font-semibold text-ink-2">{label}</div>
            <div className="mt-1 text-[12px] text-ink-3">This tab arrives in a later phase.</div>
          </Card>
        )}
      </div>
    </TabNavContext.Provider>
  );
}

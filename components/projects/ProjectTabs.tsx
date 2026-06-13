"use client";

import { useState, type ReactNode } from "react";
import { Tabs, Card } from "@/components/ui";

const TAB_LABELS = [
  "Overview",
  "Schedule",
  "Selections",
  "Subs",
  "Files",
  "Money",
  "Daily log",
  "Comms",
  "Punch",
];

/** Project-detail tab bar. Overview is built; the rest are placeholders. */
export function ProjectTabs({ overview }: { overview: ReactNode }) {
  const [active, setActive] = useState(0);

  return (
    <>
      <div className="border-b border-rule bg-paper-2 px-7">
        <Tabs tabs={TAB_LABELS} active={active} onSelect={setActive} />
      </div>
      <div className="mx-auto max-w-[1200px] px-7 py-5">
        {active === 0 ? (
          overview
        ) : (
          <Card kind="dashed" className="p-8 text-center">
            <div className="font-serif text-[16px] font-semibold text-ink-2">
              {TAB_LABELS[active]}
            </div>
            <div className="mt-1 text-[12px] text-ink-3">This tab arrives in a later phase.</div>
          </Card>
        )}
      </div>
    </>
  );
}

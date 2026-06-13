"use client";

import { useState, type ReactNode } from "react";
import { Tabs, Card } from "@/components/ui";

const TAB_LABELS = ["Overview", "Conversation", "Rough estimate", "Selections", "Files", "Activity"];

/**
 * Lead-detail tab bar. Overview is fully built (passed in as server-rendered
 * content); the other tabs are placeholders until their phases land.
 */
export function LeadTabs({ overview }: { overview: ReactNode }) {
  const [active, setActive] = useState(0);

  return (
    <div className="mt-3.5">
      <Tabs tabs={TAB_LABELS} active={active} onSelect={setActive} />
      <div className="mt-4">
        {active === 0 ? (
          overview
        ) : (
          <Card kind="dashed" className="p-8 text-center">
            <div className="font-serif text-[16px] font-semibold text-ink-2">
              {TAB_LABELS[active]}
            </div>
            <div className="mt-1 text-[12px] text-ink-3">
              This tab arrives in a later phase.
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

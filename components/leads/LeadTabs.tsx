"use client";

import { useState, type ReactNode } from "react";
import { Tabs, Card } from "@/components/ui";

const TAB_LABELS = ["Overview", "Conversation", "Rough estimate", "Selections", "Files", "Activity"];

/**
 * Lead-detail tab bar. Each panel is server-rendered and passed in via `panels`
 * keyed by tab label; tabs without a panel show a placeholder.
 */
export function LeadTabs({ panels }: { panels: Record<string, ReactNode> }) {
  const [active, setActive] = useState(0);
  const label = TAB_LABELS[active];
  const content = panels[label];

  return (
    <div className="mt-3.5">
      <Tabs tabs={TAB_LABELS} active={active} onSelect={setActive} />
      <div className="mt-4">
        {content ?? (
          <Card kind="dashed" className="p-8 text-center">
            <div className="font-serif text-[16px] font-semibold text-ink-2">{label}</div>
            <div className="mt-1 text-[12px] text-ink-3">This tab arrives in a later phase.</div>
          </Card>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { Tabs, Card } from "@/components/ui";

const BASE = ["Overview", "Jobs", "Paperwork", "Pricing", "Notes"];

/**
 * Sub-detail tab bar. Each panel is server-rendered and passed in via `panels`
 * keyed by the base tab name (e.g. "Jobs"); the visible Jobs label carries the
 * count. Tabs without a panel show a placeholder.
 */
export function SubTabs({
  panels,
  jobsCount,
}: {
  panels: Record<string, ReactNode>;
  jobsCount: number;
}) {
  const [active, setActive] = useState(0);
  const labels = BASE.map((b, i) => (i === 1 ? `Jobs (${jobsCount})` : b));
  const content = panels[BASE[active]];

  return (
    <div className="mt-3.5">
      <Tabs tabs={labels} active={active} onSelect={setActive} />
      <div className="mt-4">
        {content ?? (
          <Card kind="dashed" className="p-8 text-center">
            <div className="font-serif text-[16px] font-semibold text-ink-2">{labels[active]}</div>
            <div className="mt-1 text-[12px] text-ink-3">This tab arrives in a later phase.</div>
          </Card>
        )}
      </div>
    </div>
  );
}

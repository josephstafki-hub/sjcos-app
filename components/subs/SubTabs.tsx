"use client";

import { useState, type ReactNode } from "react";
import { Tabs, Card } from "@/components/ui";

/**
 * Sub-detail tab bar. Overview is fully built (passed in as server-rendered
 * content); the other tabs are placeholders until their phases land. The Jobs
 * label carries the count, matching the design.
 */
export function SubTabs({ overview, jobsCount }: { overview: ReactNode; jobsCount: number }) {
  const [active, setActive] = useState(0);
  const labels = ["Overview", `Jobs (${jobsCount})`, "Paperwork", "Pricing", "Notes"];

  return (
    <div className="mt-3.5">
      <Tabs tabs={labels} active={active} onSelect={setActive} />
      <div className="mt-4">
        {active === 0 ? (
          overview
        ) : (
          <Card kind="dashed" className="p-8 text-center">
            <div className="font-serif text-[16px] font-semibold text-ink-2">{labels[active]}</div>
            <div className="mt-1 text-[12px] text-ink-3">This tab arrives in a later phase.</div>
          </Card>
        )}
      </div>
    </div>
  );
}

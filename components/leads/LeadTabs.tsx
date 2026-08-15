"use client";

import { createContext, Suspense, useContext, useState, type ReactNode } from "react";
import { Tabs, Card } from "@/components/ui";
import { FocusScroll } from "@/components/shell/FocusScroll";

const TAB_LABELS = ["Overview", "Ops", "Tasks", "Conversation", "Rough estimate", "Documents", "Files", "Client portal", "Activity"];

/** Lets a panel rendered inside LeadTabs (e.g. a sidebar button in Overview)
 *  jump the tab bar to another tab, e.g. "Documents", without lifting state
 *  up into the server component that owns the panels. */
const SwitchTabContext = createContext<(label: string) => void>(() => {});
export function useSwitchLeadTab() {
  return useContext(SwitchTabContext);
}

/**
 * Lead-detail tab bar. Each panel is server-rendered and passed in via `panels`
 * keyed by tab label; tabs without a panel show a placeholder.
 */
export function LeadTabs({
  panels,
  initialTab,
  focus,
}: {
  panels: Record<string, ReactNode>;
  /** Tab named by `?tab=` in the URL (deep link from a notification). */
  initialTab?: string | null;
  /** `?focus=` key — the [data-focus] record to scroll to and flash. */
  focus?: string | null;
}) {
  const linked = initialTab ? TAB_LABELS.indexOf(initialTab) : -1;
  const [active, setActive] = useState(linked >= 0 ? linked : 0);
  // Same-page deep links (?tab=…&focus=…) update props without remounting —
  // render-phase sync so the tab follows the link.
  const linkKey = `${initialTab ?? ""}|${focus ?? ""}`;
  const [seenLinkKey, setSeenLinkKey] = useState(linkKey);
  if (linkKey !== seenLinkKey) {
    setSeenLinkKey(linkKey);
    if (linked >= 0) setActive(linked);
  }
  const label = TAB_LABELS[active];
  const content = panels[label];

  const switchTab = (target: string) => {
    const idx = TAB_LABELS.indexOf(target);
    if (idx >= 0) setActive(idx);
  };

  return (
    <div className="mt-3.5">
      <Suspense fallback={null}>
        <FocusScroll focus={focus} />
      </Suspense>
      <Tabs tabs={TAB_LABELS} active={active} onSelect={setActive} />
      <div className="mt-4">
        <SwitchTabContext.Provider value={switchTab}>
          {content ?? (
            <Card kind="dashed" className="p-8 text-center">
              <div className="font-serif text-[16px] font-semibold text-ink-2">{label}</div>
              <div className="mt-1 text-[12px] text-ink-3">This tab arrives in a later phase.</div>
            </Card>
          )}
        </SwitchTabContext.Provider>
      </div>
    </div>
  );
}

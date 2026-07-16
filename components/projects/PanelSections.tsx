"use client";

import { useContext, type ReactNode } from "react";
import { SectionNavContext } from "./TabNav";

/** Sub-nav for a tab that groups several panels under one lifecycle — Money
 *  (estimate → invoices → change orders → the paperwork for all three) and
 *  Closeout (punch list → final docs).
 *
 *  Like the tab bar itself, every section stays mounted and is hidden when
 *  inactive rather than swapping the subtree: remounting made the first click
 *  after a switch land on a node React was replacing, so it was silently lost. */
export function PanelSections({
  tab,
  sections,
}: {
  tab: string;
  sections: { label: string; node: ReactNode }[];
}) {
  const { sections: open, setSection } = useContext(SectionNavContext);
  // Fall back to the first section rather than trusting the context: a TabLink
  // naming a section this tab doesn't have would otherwise hide all of them and
  // leave the tab blank.
  const requested = open[tab];
  const active = sections.some((s) => s.label === requested) ? requested : sections[0]?.label;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1">
        {sections.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => setSection(tab, s.label)}
            aria-current={s.label === active ? "true" : undefined}
            className={[
              "rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors",
              s.label === active
                ? "border-ink bg-ink text-paper"
                : "border-rule bg-card text-ink-2 hover:bg-paper-2",
            ].join(" ")}
          >
            {s.label}
          </button>
        ))}
      </div>
      {sections.map((s) => (
        <div key={s.label} hidden={s.label !== active}>
          {s.node}
        </div>
      ))}
    </div>
  );
}

"use client";

import { useContext, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { SectionNavContext } from "./TabNav";

/** Sub-nav for a tab that groups several panels under one lifecycle — Money
 *  (estimate → invoices → change orders → the paperwork for all three) and
 *  Closeout (punch list → final docs).
 *
 *  Like the tab bar itself, every section stays mounted and is hidden when
 *  inactive rather than swapping the subtree: remounting made the first click
 *  after a switch land on a node React was replacing, so it was silently lost. */
function baseLabel(label: string): string {
  return label.split(" · ")[0].trim();
}

export function PanelSections({
  tab,
  sections,
  focusSections,
}: {
  tab: string;
  sections: { label: string; node: ReactNode }[];
  /** Which section owns a `?focus=` key, so a deep link lands on the right
   *  sub-panel. Keys are exact focus keys ("signature-12") or prefixes ending
   *  in "-" ("punch-"). Ignored once the owner clicks a section. */
  focusSections?: Record<string, string>;
}) {
  const { sections: open, setSection } = useContext(SectionNavContext);
  const params = useSearchParams();
  const focus = params.get("focus");
  let linked: string | undefined;
  if (focus && focusSections) {
    const mapped =
      focusSections[focus] ??
      Object.entries(focusSections).find(([k]) => k.endsWith("-") && focus.startsWith(k))?.[1];
    // Labels may carry a count suffix ("Uploads · 3"); match on the base name.
    if (mapped) linked = sections.find((s) => baseLabel(s.label) === baseLabel(mapped))?.label;
  }
  // Fall back to the first section rather than trusting the context: a TabLink
  // naming a section this tab doesn't have would otherwise hide all of them and
  // leave the tab blank.
  // Match on the base name: labels carry live counts ("Messages · 3") that
  // change after a send/upload re-render, and an exact match would fall back
  // to the first section and jump the owner to Activity mid-conversation.
  const requested = open[tab] ?? linked;
  const active =
    (requested && sections.find((s) => baseLabel(s.label) === baseLabel(requested))?.label) ??
    sections[0]?.label;

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

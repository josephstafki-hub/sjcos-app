/** The project-detail tab bar, in display order.
 *
 *  Shared rather than living in ProjectTabs so anything that names a tab —
 *  `stageToolTab`, `TabLink` — is checked against this list at compile time. A
 *  renamed tab used to fail silently: `indexOf` returned -1 and the click just
 *  did nothing.
 *
 *  "Money" and "Closeout" group several panels behind a sub-nav; their sections
 *  are composed in `app/projects/[slug]/page.tsx`. */
export const PROJECT_TABS = [
  "Overview",
  "Ops",
  "Floor",
  "Mood",
  "Selections",
  "Bidding",
  "Money",
  "Documents",
  "Schedule",
  "Subs",
  "Files",
  "Daily log",
  "Comms",
  "Permits",
  "Closeout",
  "Safety",
] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number];

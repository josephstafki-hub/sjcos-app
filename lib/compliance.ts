// Compliance calendar data builder. Mock-backed today; swaps to DB queries in
// Phase 7 (the compliance_items table already exists — see db/schema.sql, with
// kind/dueDate/owner). The window grouping below is what `ComplianceWindow`
// derives from dueDate; the shape stays stable.

import { ai } from "./ai";

/** Timeline dot tone — flag (urgent), accent (action/license), ghost (routine). */
export type ComplianceDot = "flag" | "accent" | "ghost";

export interface WindowItem {
  title: string;
  /** Due-date display, e.g. "Jun 1". */
  due: string;
}

export interface ComplianceWindowCard {
  label: string;
  /** Items in this window. */
  items: WindowItem[];
  /** Flag styling for the urgent window. */
  urgent: boolean;
}

export interface TimelineRow {
  date: string;
  dot: ComplianceDot;
  what: string;
  who: string;
  /** Next step / note. */
  step: string;
}

export interface ComplianceData {
  eyebrow: string;
  /** AI outlook shown in the brief bubble. */
  summary: string;
  filters: string[];
  windows: ComplianceWindowCard[];
  timeline: TimelineRow[];
}

const WINDOWS: ComplianceWindowCard[] = [
  {
    label: "Urgent · < 14 days",
    urgent: true,
    items: [
      { title: "Carl Lund · COI", due: "Jun 1" },
      { title: "IRS CP2100 reply", due: "Jun 15" },
    ],
  },
  {
    label: "30 day window",
    urgent: false,
    items: [
      { title: "Q2 estimated tax · MN", due: "Jun 17" },
      { title: "Q2 estimated tax · Federal", due: "Jun 17" },
      { title: "Auto policy renewal", due: "Jun 28" },
    ],
  },
  {
    label: "60 / 90 day window",
    urgent: false,
    items: [
      { title: "Marco COI", due: "Aug 14" },
      { title: "Brad COI", due: "Aug 14" },
      { title: "Rivera HVAC COI", due: "Sep 1" },
      { title: "MN contractor license · renewal", due: "Sep 30" },
      { title: "Tomas COI", due: "Oct 3" },
    ],
  },
];

const TIMELINE: TimelineRow[] = [
  { date: "JUN 1", dot: "flag", what: "Carl Lund · COI expires", who: "AI requesting renewal", step: "Send reminder + receive doc" },
  { date: "JUN 15", dot: "flag", what: "IRS CP2100 mismatch · respond", who: "Joe + Dani", step: "Draft response ready · review" },
  { date: "JUN 17", dot: "ghost", what: "Q2 estimated tax (MN + Fed)", who: "Dani · QuickBooks", step: "Auto-pull payments" },
  { date: "JUN 28", dot: "ghost", what: "Auto policy renewal", who: "State Farm", step: "Verify additional insured stays on policy" },
  { date: "JUL 31", dot: "ghost", what: "Q2 sales tax filing", who: "Dani", step: "P&L close runs Jul 26" },
  { date: "AUG 14", dot: "ghost", what: "Marco + Brad COI", who: "AI auto-requests Jul 14", step: "—" },
  { date: "SEP 30", dot: "accent", what: "MN contractor license · renewal", who: "Joe", step: "$200 fee · CE hours TBD" },
  { date: "JAN 31", dot: "ghost", what: "1099 issue (all subs > $600)", who: "AI prep · Dani files", step: "8 subs expected" },
];

export async function getComplianceData(): Promise<ComplianceData> {
  const urgent = WINDOWS.find((w) => w.urgent)?.items.length ?? 0;
  const next30 = WINDOWS.filter((w) => w.label !== "60 / 90 day window").reduce(
    (n, w) => n + w.items.length,
    0,
  );

  // The outlook is the AI touch-point — routed through the service so Phase 7
  // composes it from the real compliance_items rows with no screen change.
  const { summary } = await ai.summarize({
    focus: "compliance",
    text:
      "Carl Lund's COI expires Jun 1 — he's not on a job, but I'll request the " +
      "renewal automatically. The IRS CP2100 notice still needs a response by " +
      "Jun 15.",
  });

  return {
    eyebrow: `${next30} items in next 30 days · ${urgent} urgent`,
    summary,
    filters: ["All", "COI", "Licenses", "Tax"],
    windows: WINDOWS,
    timeline: TIMELINE,
  };
}

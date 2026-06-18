// Compliance calendar data builder. DB-backed (Phase 7.2): reads the
// compliance_items table via lib/db. The timeline is the full ordered list of
// open items; the three windows are derived by bucketing on days-until-due
// (urgent < 14d / 30-day / 60-90d) relative to CURRENT_DATE, so the view tracks
// real time. The AI outlook still routes through lib/ai.ts.

import { ai } from "./ai";
import { query } from "./db";

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
  /** compliance_items.id — used by the resolve action. */
  id: string;
  date: string;
  dot: ComplianceDot;
  what: string;
  who: string;
  /** Next step / note. */
  step: string;
}

export interface ComplianceData {
  eyebrow: string;
  /** Input for the AI outlook; the text streams in via getComplianceSummary so
   *  the page isn't blocked on inference. */
  summaryInput: string;
  filters: string[];
  windows: ComplianceWindowCard[];
  timeline: TimelineRow[];
}

// ─── DB row → display mapping ────────────────────────────────────────────────

interface ComplianceRow {
  id: string;
  title: string;
  /** "Jun 1" — window item display. */
  due_label: string;
  /** "JUN 1" — timeline display. */
  timeline_date: string;
  /** Integer days from today; negative if overdue. */
  days_until: number;
  who: string;
  step: string;
  dot: string;
}

const COMPLIANCE_SELECT = `
  SELECT id, title,
         to_char(due_date, 'FMMon FMDD')        AS due_label,
         upper(to_char(due_date, 'FMMon FMDD'))  AS timeline_date,
         (due_date - CURRENT_DATE)::int          AS days_until,
         COALESCE(who, '')                       AS who,
         COALESCE(NULLIF(step, ''), '—')         AS step,
         COALESCE(dot, 'ghost')                  AS dot
  FROM compliance_items
  WHERE resolved = false
  ORDER BY due_date`;

export async function getComplianceData(): Promise<ComplianceData> {
  const { rows } = await query<ComplianceRow>(COMPLIANCE_SELECT);

  // Bucket open items by days-until-due. Overdue items fall into the urgent
  // window. Items beyond 90 days (e.g. next year's 1099 run) stay on the
  // timeline but don't crowd a window card.
  const inWindow = (lo: number, hi: number) =>
    rows
      .filter((r) => r.days_until <= hi && r.days_until > lo)
      .map((r) => ({ title: r.title, due: r.due_label }));

  const windows: ComplianceWindowCard[] = [
    { label: "Urgent · < 14 days", urgent: true, items: inWindow(-Infinity, 14) },
    { label: "30 day window", urgent: false, items: inWindow(14, 30) },
    { label: "60 / 90 day window", urgent: false, items: inWindow(30, 90) },
  ];

  const timeline: TimelineRow[] = rows.map((r) => ({
    id: r.id,
    date: r.timeline_date,
    dot: (r.dot === "flag" || r.dot === "accent" ? r.dot : "ghost") as ComplianceDot,
    what: r.title,
    who: r.who,
    step: r.step,
  }));

  const urgent = windows[0].items.length;
  const next30 = urgent + windows[1].items.length;

  // The outlook is the AI touch-point — routed through the service. The input
  // is composed from the urgent rows so the swap to a real model in Phase 7.3
  // needs no screen change. The mock passthrough relays this text whole.
  const urgentLine = windows[0].items.length
    ? windows[0].items.map((i) => `${i.title} (due ${i.due})`).join("; ")
    : "Nothing urgent in the next 14 days";
  const summaryInput = `${urgent} item${urgent === 1 ? "" : "s"} need attention soon: ${urgentLine}.`;

  return {
    eyebrow: `${next30} items in next 30 days · ${urgent} urgent`,
    summaryInput,
    filters: ["All", "COI", "Licenses", "Tax"],
    windows,
    timeline,
  };
}

/** The AI compliance outlook. Streamed separately (see AiStream) so the page
 *  paints before the model responds. */
export async function getComplianceSummary(text: string): Promise<string> {
  const { summary } = await ai.summarize({ focus: "compliance", text });
  return summary;
}

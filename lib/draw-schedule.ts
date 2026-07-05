// Draw / payment schedule — client-safe (NO db import, like esign-types). Both
// the contract generator (client) and lib/documents.ts (server) use these.
// A draw schedule is a list of percent-of-total payment milestones; the contract
// renders dollar amounts from each percent × the estimate total.

export interface DrawLine {
  label: string;
  /** Percent of the contract total (0–100). */
  percent: number;
  /** Project status whose arrival auto-bills this draw (7-inv). "" / undefined =
   *  manual only. Must be a PROJECT_STATUSES key. */
  triggerStatus?: string;
  /** Set once the milestone invoice has been generated, so re-flipping the
   *  status doesn't bill it twice. */
  billed?: boolean;
}

/** Status points a draw can auto-bill on (client-safe subset of the project
 *  lifecycle — keys must match PROJECT_STATUSES). "" = manual, no auto-bill. */
export const DRAW_TRIGGER_STATUSES: { key: string; label: string }[] = [
  { key: "", label: "Manual (no auto-bill)" },
  { key: "construction_contract", label: "Contract signed" },
  { key: "construction", label: "Construction start" },
  { key: "closeout", label: "Closeout" },
  { key: "warranty", label: "Completion" },
];

/** Default schedule: a deposit up front, then the remaining balance split evenly
 *  across progress draws + a final payment. Each milestone is pre-wired to a
 *  project stage so it auto-bills as the job advances (owner can change the
 *  triggers, or set them to Manual, before generating the contract). */
export function defaultDrawSchedule(depositPct = 10): DrawLine[] {
  const deposit = Math.max(0, Math.min(100, Math.round(depositPct)));
  const remaining = 100 - deposit;
  // Three even draws over the remaining balance: rough-in, progress, final.
  const each = Math.round((remaining / 3) * 100) / 100;
  const last = Math.round((remaining - each * 2) * 100) / 100;
  return [
    { label: "Deposit (on signing)", percent: deposit, triggerStatus: "construction_contract" },
    { label: "Rough-in complete", percent: each, triggerStatus: "construction" },
    { label: "Substantial completion", percent: each, triggerStatus: "closeout" },
    { label: "Final / punch-list", percent: last, triggerStatus: "warranty" },
  ];
}

export function sumPercent(lines: DrawLine[]): number {
  return Math.round(lines.reduce((s, l) => s + (Number(l.percent) || 0), 0) * 100) / 100;
}

/** Coerce arbitrary JSON into a clean DrawLine[]; returns null if unusable so the
 *  caller can fall back to the computed default. */
export function parseDrawSchedule(raw: unknown): DrawLine[] | null {
  if (!Array.isArray(raw)) return null;
  const lines: DrawLine[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const label = String(rec.label ?? "").trim();
    const percent = Math.max(0, Math.min(100, Number(rec.percent) || 0));
    if (!label) continue;
    const triggerStatus = typeof rec.triggerStatus === "string" ? rec.triggerStatus : "";
    const billed = rec.billed === true;
    lines.push({ label, percent: Math.round(percent * 100) / 100, triggerStatus, billed });
  }
  return lines.length > 0 ? lines : null;
}

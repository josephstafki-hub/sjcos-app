// Draw / payment schedule — client-safe (NO db import, like esign-types). Both
// the contract generator (client) and lib/documents.ts (server) use these.
// A draw schedule is a list of percent-of-total payment milestones; the contract
// renders dollar amounts from each percent × the estimate total.

export interface DrawLine {
  label: string;
  /** Percent of the contract total (0–100). */
  percent: number;
}

/** Default schedule: a deposit up front, then the remaining balance split evenly
 *  across progress draws + a final payment. Owner edits it before generating. */
export function defaultDrawSchedule(depositPct = 10): DrawLine[] {
  const deposit = Math.max(0, Math.min(100, Math.round(depositPct)));
  const remaining = 100 - deposit;
  // Three even draws over the remaining balance: rough-in, progress, final.
  const each = Math.round((remaining / 3) * 100) / 100;
  const last = Math.round((remaining - each * 2) * 100) / 100;
  return [
    { label: "Deposit (on signing)", percent: deposit },
    { label: "Rough-in complete", percent: each },
    { label: "Substantial completion", percent: each },
    { label: "Final / punch-list", percent: last },
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
    const label = String((r as Record<string, unknown>).label ?? "").trim();
    const percent = Math.max(0, Math.min(100, Number((r as Record<string, unknown>).percent) || 0));
    if (!label) continue;
    lines.push({ label, percent: Math.round(percent * 100) / 100 });
  }
  return lines.length > 0 ? lines : null;
}

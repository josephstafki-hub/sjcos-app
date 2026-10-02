// Measurement math (A18) — pure, no database.
//
// The rules this file enforces (VALIDATION.md "Measurement"):
//   • failed / corrected / unknown-effect / missed-commitment cases STAY in
//     the denominator — a rate is verified_success ÷ every eligible case that
//     reached a terminal outcome in the window;
//   • a rate is never reported without its numerator, denominator and the
//     observation window it was computed over; when the denominator is zero
//     the value is null, not 0 or 100;
//   • one-tap work is assisted automation, not an unattended completion;
//   • unknown numbers (owner seconds, cost, latency) are null and counted as
//     unknown — never coerced to 0.

export const CASE_KINDS = [
  "lead_followup",
  "package_release",
  "invoice",
  "purchase",
  "weekly_summary",
  "sub_docs",
  "closeout",
  "estimate",
  "other",
] as const;
export type CaseKind = (typeof CASE_KINDS)[number] | (string & {});

export const OUTCOMES = ["pending", "verified_success", "corrected", "failed", "unknown_effect", "missed_commitment"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const TERMINAL_OUTCOMES: readonly Outcome[] = ["verified_success", "corrected", "failed", "unknown_effect", "missed_commitment"];

export const MODES = ["unattended", "one_tap", "assisted", "manual", "unknown"] as const;
export type Mode = (typeof MODES)[number];

export interface CaseRow {
  kind: string;
  eligible: boolean;
  outcome: Outcome;
  mode: Mode;
  owner_seconds: number | null;
  agent_seconds: number | null;
  latency_ms: number | string | null; // bigint comes back as text from pg
  cost_usd: number | string | null;
  created_at: string;
  closed_at: string | null;
}

export interface Rate {
  numerator: number;
  denominator: number;
  /** numerator/denominator, or null when the denominator is 0. */
  value: number | null;
}

export interface KindSummary {
  kind: string;
  /** Cases opened in the window (eligible only). */
  eligible: number;
  /** Cases explicitly marked ineligible (shown so exclusions are visible). */
  excluded: number;
  pending: number;
  verified_success: number;
  corrected: number;
  failed: number;
  unknown_effect: number;
  missed_commitment: number;
  /** verified_success over all terminal cases (failures included). */
  verified_rate: Rate;
  /** Cases completed with no owner touch at all — one-tap is NOT counted here. */
  unattended: number;
  one_tap: number;
  assisted: number;
  manual: number;
  owner_minutes: number;
  owner_minutes_unknown: number;
  agent_minutes: number;
  cost_usd: number;
  cost_unknown: number;
  latency: { n: number; median_ms: number | null; mean_ms: number | null };
}

export interface Window {
  from: string;
  to: string;
}

export interface CaseSummary {
  window: Window;
  kinds: KindSummary[];
  totals: KindSummary;
  caveats: string[];
}

export function rate(numerator: number, denominator: number): Rate {
  return { numerator, denominator, value: denominator > 0 ? numerator / denominator : null };
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function emptyKind(kind: string): KindSummary {
  return {
    kind,
    eligible: 0,
    excluded: 0,
    pending: 0,
    verified_success: 0,
    corrected: 0,
    failed: 0,
    unknown_effect: 0,
    missed_commitment: 0,
    verified_rate: rate(0, 0),
    unattended: 0,
    one_tap: 0,
    assisted: 0,
    manual: 0,
    owner_minutes: 0,
    owner_minutes_unknown: 0,
    agent_minutes: 0,
    cost_usd: 0,
    cost_unknown: 0,
    latency: { n: 0, median_ms: null, mean_ms: null },
  };
}

/** Fold case rows (already filtered to the window) into per-kind summaries
 *  plus a total. Pure. */
export function summarizeCases(rows: CaseRow[], window: Window): CaseSummary {
  const byKind = new Map<string, { s: KindSummary; lat: number[] }>();
  const total = { s: emptyKind("all"), lat: [] as number[] };
  const fold = (t: { s: KindSummary; lat: number[] }, r: CaseRow) => {
    const s = t.s;
    if (!r.eligible) {
      s.excluded += 1;
      return;
    }
    s.eligible += 1;
    s[r.outcome] += 1;
    if (r.outcome !== "pending") {
      if (r.mode === "unattended") s.unattended += 1;
      else if (r.mode === "one_tap") s.one_tap += 1;
      else if (r.mode === "assisted") s.assisted += 1;
      else if (r.mode === "manual") s.manual += 1;
    }
    const os = num(r.owner_seconds);
    if (os === null) s.owner_minutes_unknown += 1;
    else s.owner_minutes += os / 60;
    const as = num(r.agent_seconds);
    if (as !== null) s.agent_minutes += as / 60;
    const c = num(r.cost_usd);
    if (c === null) s.cost_unknown += 1;
    else s.cost_usd += c;
    const l = num(r.latency_ms);
    if (l !== null) t.lat.push(l);
  };
  for (const r of rows) {
    let t = byKind.get(r.kind);
    if (!t) {
      t = { s: emptyKind(r.kind), lat: [] };
      byKind.set(r.kind, t);
    }
    fold(t, r);
    fold(total, r);
  }
  const finish = (t: { s: KindSummary; lat: number[] }) => {
    const s = t.s;
    const terminal = s.verified_success + s.corrected + s.failed + s.unknown_effect + s.missed_commitment;
    s.verified_rate = rate(s.verified_success, terminal);
    s.owner_minutes = round1(s.owner_minutes);
    s.agent_minutes = round1(s.agent_minutes);
    s.cost_usd = Math.round(s.cost_usd * 1e6) / 1e6;
    s.latency = {
      n: t.lat.length,
      median_ms: median(t.lat),
      mean_ms: t.lat.length ? Math.round(t.lat.reduce((a, b) => a + b, 0) / t.lat.length) : null,
    };
    return s;
  };
  const kinds = [...byKind.values()].map(finish).sort((a, b) => a.kind.localeCompare(b.kind));
  const totals = finish(total);
  const caveats = [
    `Rates are verified_success ÷ terminal cases opened between ${window.from} and ${window.to}; failed, corrected, unknown-effect and missed-commitment cases are in the denominator.`,
    "One-tap approvals are assisted automation, not unattended completions.",
  ];
  if (totals.owner_minutes_unknown) caveats.push(`${totals.owner_minutes_unknown} case(s) have no recorded owner time — owner minutes are a floor, not a total.`);
  if (totals.cost_unknown) caveats.push(`${totals.cost_unknown} case(s) have unknown cost — cost is a floor, not a total.`);
  if (totals.pending) caveats.push(`${totals.pending} case(s) still pending are counted as eligible but not in any rate yet.`);
  return { window, kinds, totals, caveats };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Owner seconds for a case: an explicit figure wins; otherwise the sum of the
 *  linked owner touches; null (unknown) when neither exists. Touches with a
 *  null `seconds` are counted as unknown time, never as zero. */
export function deriveOwnerSeconds(explicit: number | null | undefined, touches: { seconds: number | null }[]): { seconds: number | null; touches: number; touches_unknown_seconds: number } {
  const unknown = touches.filter((t) => t.seconds === null || t.seconds === undefined).length;
  if (explicit !== null && explicit !== undefined) return { seconds: Math.max(0, Math.round(explicit)), touches: touches.length, touches_unknown_seconds: unknown };
  const known = touches.filter((t) => typeof t.seconds === "number");
  if (!known.length) return { seconds: null, touches: touches.length, touches_unknown_seconds: unknown };
  return { seconds: known.reduce((a, t) => a + (t.seconds as number), 0), touches: touches.length, touches_unknown_seconds: unknown };
}

/** Mode from the touches: any owner touch means it was not unattended. A
 *  single approve/reject tap is one_tap; edits, corrections or manual sends
 *  are assisted; an explicit mode from the caller is kept. */
export function deriveMode(explicit: Mode | null | undefined, touches: { kind: string }[]): Mode {
  if (explicit && explicit !== "unknown") return explicit;
  if (!touches.length) return explicit ?? "unknown";
  const kinds = new Set(touches.map((t) => t.kind));
  const heavy = [...kinds].some((k) => /edit|correction|manual|rewrite|redo|review/.test(k));
  if (heavy) return "assisted";
  if (touches.length === 1 && [...kinds].every((k) => /approve|reject|deny|answer/.test(k))) return "one_tap";
  return "assisted";
}

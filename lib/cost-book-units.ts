// Pure cost-book constants + money helpers — NO db import, so client components
// (the cost-item modal) can import these without dragging pg into the browser
// bundle. lib/cost-book.ts re-exports for server-side convenience.

export const COST_UNITS = [
  { value: "sf", label: "per sq ft" },
  { value: "lf", label: "per lin ft" },
  { value: "ea", label: "each" },
  { value: "hr", label: "per hour" },
  { value: "ls", label: "lump sum" },
  { value: "cy", label: "per cu yd" },
] as const;

export type CostUnit = (typeof COST_UNITS)[number]["value"];

export const COST_UNIT_VALUES = COST_UNITS.map((u) => u.value) as CostUnit[];

export function unitLabel(u: string): string {
  return COST_UNITS.find((x) => x.value === u)?.label ?? u;
}

/** Categories offered in the cost-item form. Free-ish — "General" is the catch-all. */
export const COST_CATEGORIES = [
  "Demolition",
  "Concrete",
  "Framing",
  "Windows & doors",
  "Roofing",
  "Drywall",
  "Trim & millwork",
  "Cabinetry",
  "Flooring",
  "Tile",
  "Paint",
  "Plumbing",
  "Electrical",
  "HVAC",
  "Labor",
  "Materials",
  "General",
] as const;

// ── Money (cents) helpers — shared by server reads and client forms ──
export function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents ?? 0) / 100,
  );
}

/** Parse a user-typed dollar string ("12.50", "$1,200", "-3,200", "(3,200)")
 *  to integer cents. Sign is preserved so credit lines survive a re-save. */
export function dollarsToCents(input: string): number {
  const raw = String(input).trim();
  const negative = /^\s*[-(]/.test(raw) || /^-?\$?\s*-/.test(raw);
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) * (negative ? -1 : 1) || 0;
}

/** Cents → plain dollar string for prefilling an edit form ("12.50"). */
export function centsToInput(cents: number): string {
  return ((cents ?? 0) / 100).toFixed(2);
}

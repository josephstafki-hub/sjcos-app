// Precon billing-rate metadata — client-safe (no db), shared by the Settings
// editor and the precon auto-resolver (lib/doc-templates/fill.ts) so the labels,
// keys, and defaults can't drift. Defaults are Joe's provided rates (Site Super
// corrected to $62/hr, 2026-07-10). Values are display strings ("$52 / hr").

export const BILLING_RATE_ROWS: { key: string; label: string; default: string }[] = [
  { key: "rates.founder", label: "Founder & CEO", default: "Unbilled" },
  { key: "rates.pm", label: "Project Manager", default: "$52 / hr" },
  { key: "rates.apm", label: "Assistant Project Manager", default: "$36 / hr" },
  { key: "rates.super", label: "Site Superintendent", default: "$62 / hr" },
  { key: "rates.lead_carpenter", label: "Lead Carpenter", default: "$68 / hr" },
  { key: "rates.carpenter", label: "Carpenter", default: "$45 / hr" },
  { key: "rates.apprentice", label: "Apprentice Carpenter", default: "$20 / hr" },
];

/** Third-party markup on subs/materials/permits in the precon agreement. */
export const MARKUP_KEY = "rates.markup";
export const MARKUP_DEFAULT = "20%";

/** Pre-con fee rule (Joe 2026-10-28): a percentage of the LOW end of the lead's
 *  rough-estimate total. The Pre-Construction Agreement fills its fee from it;
 *  Joe can still change the fee on the draft. Blank = no rule (fee left empty). */
export const PRECON_FEE_PCT_KEY = "rates.precon_fee_pct";
export const PRECON_FEE_PCT_DEFAULT = "5%";

/** Fee in whole-dollar cents from a rough total ("$233,500 – $360,000" or
 *  "$295,500") and a percent string ("5%"). Null when either is unusable. */
export function preconFeeCents(roughTotal: string | null | undefined, pct: string | null | undefined): number | null {
  const low = /\$?\s*([\d,]+(?:\.\d+)?)/.exec(String(roughTotal ?? ""));
  const rate = /([\d.]+)/.exec(String(pct ?? ""));
  if (!low || !rate) return null;
  const dollars = Number(low[1].replace(/,/g, ""));
  const p = Number(rate[1]);
  if (!(dollars > 0) || !(p > 0) || p > 100) return null;
  return Math.round((dollars * p) / 100) * 100;
}

// The lead overview list's value for a rough estimate. Plain .mjs so the app
// (lib/leads.ts re-exports it) and the MCP server (mcp/lead-tools.mjs) share
// the one definition — a rough estimate saved from either path shows the same
// "$51–65k" on /leads.

/** Compact a rough-estimate total range like "$51,000 – $64,500" down to the
 *  overview list's "$51–65k" style value_display, plus the average of its
 *  figures (in raw dollars) for sorting/forecast. Null when the total has no
 *  numbers.
 *
 *  Only dollar amounts count when there are any, and never a "+$6,200"
 *  difference: "Option B (incl. 2nd floor) $196,000" is not a $2 figure and
 *  "15x15: $44,000 / 18x15: $50,200 (+$6,200)" is $44–50k (2026-10-30). The
 *  range runs lowest to highest figure, so two options read as one span.
 *  Mirrored in SQL by lead_estimate_value() (db/migrations/0043) — keep the
 *  two in step.
 *  @param {string} total
 *  @returns {{ display: string, value: number } | null} */
export function compactEstimateValue(total) {
  const num = (n) => Number(n.replace(/,/g, ""));
  const dollars = [...total.matchAll(/(\+\s*)?\$\s*(\d[\d,]*(?:\.\d+)?)/g)].filter((m) => !m[1]).map((m) => num(m[2]));
  const nums = dollars.length ? dollars : (total.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(num);
  if (nums.length === 0) return null;
  const lo = Math.round(Math.min(...nums) / 1000);
  const hi = Math.round(Math.max(...nums) / 1000);
  const display = nums.length > 1 && lo !== hi ? `$${lo}–${hi}k` : `$${lo}k`;
  const value = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  return { display, value };
}

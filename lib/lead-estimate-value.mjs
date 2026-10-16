// The lead overview list's value for a rough estimate. Plain .mjs so the app
// (lib/leads.ts re-exports it) and the MCP server (mcp/lead-tools.mjs) share
// the one definition — a rough estimate saved from either path shows the same
// "$51–65k" on /leads.

/** Compact a rough-estimate total range like "$51,000 – $64,500" down to the
 *  overview list's "$51–65k" style value_display, plus a midpoint estimate_value
 *  (in raw dollars) for sorting/forecast. Null when the total has no numbers.
 *  @param {string} total
 *  @returns {{ display: string, value: number } | null} */
export function compactEstimateValue(total) {
  const nums = total.match(/[\d,]+(?:\.\d+)?/g)?.map((n) => Number(n.replace(/,/g, "")));
  if (!nums || nums.length === 0) return null;
  const ks = nums.map((n) => Math.round(n / 1000));
  const display = ks.length > 1 && ks[0] !== ks[ks.length - 1] ? `$${ks[0]}–${ks[ks.length - 1]}k` : `$${ks[0]}k`;
  const value = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  return { display, value };
}

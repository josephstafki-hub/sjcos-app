/** A zero price is ambiguous in legacy selections. Only explicit notes establish
 * inclusion or pricing elsewhere; never infer either from the room or product. */
export function selectionPriceLabel(price: number, note: string): string {
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  if (price > 0) return money(price);
  if (price < 0) return `${money(-price)} credit`;
  const missing = "Price not posted — confirm with Joe";
  if (/\b(?:not|isn.t|is not)\s+(?:included|quoted|priced)\b/i.test(note)) return missing;
  if (/\bincluded\b/i.test(note)) return "Included";
  if (/\b(?:quoted|priced)\s+(?:with|in|as part of|elsewhere)\b/i.test(note)) return "Priced with other work — effect on total unconfirmed; confirm with Joe";
  return missing;
}

// Payment-terms parsing (A07a). Pure. A due date is only ever derived from
// terms text that verifiably parses — "Net 30", "net 15 days", "due on
// receipt", "payment due within 10 days". Anything else is UNKNOWN and the
// invoice carries the `terms_unknown` exception instead of a guessed Net 7.

export interface ParsedTerms {
  /** Days after issue the balance is due; 0 = due on receipt. */
  netDays: number;
  /** Normalized label, e.g. "Net 30" / "Due on receipt". */
  label: string;
}

export function parseNetTerms(text: string | null | undefined): ParsedTerms | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  if (/\bdue\s+(up)?on\s+receipt\b/i.test(t) || /\bpayable\s+(up)?on\s+receipt\b/i.test(t)) {
    return { netDays: 0, label: "Due on receipt" };
  }
  const net = t.match(/\bnet\s*[-:]?\s*(\d{1,3})\b/i);
  if (net) {
    const n = Number(net[1]);
    if (n >= 0 && n <= 365) return { netDays: n, label: `Net ${n}` };
  }
  const within = t.match(/\b(?:due|payable)\s+(?:in|within)\s+(\d{1,3})\s+(?:calendar\s+|business\s+)?days?\b/i);
  if (within) {
    const n = Number(within[1]);
    if (n >= 0 && n <= 365 && !/business/i.test(within[0])) return { netDays: n, label: `Net ${n}` };
  }
  return null;
}

/** Add whole days to a YYYY-MM-DD date string (UTC-safe, no DST drift). */
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

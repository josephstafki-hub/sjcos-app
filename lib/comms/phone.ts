// E.164 normalization for US numbers. Pure — no server-only, no db — so the
// SMS/voice paths, the 10DLC script and the unit tests all share ONE rule:
//
//   10 digits            → +1 + digits          (US local)
//   11 digits, leading 1 → +  + digits          (US with country code)
//   anything else        → rejected (we do not guess international numbers)
//
// Rejecting beats "sending to whatever the regex produced": a mis-normalized
// number is a text to a stranger, which is a real cost under A2P 10DLC.

export type E164Result = { ok: true; e164: string } | { ok: false; error: string };

export function normalizeE164(raw: string | null | undefined): E164Result {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, error: "Phone number is empty." };
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) {
    if (digits[0] === "0" || digits[0] === "1") {
      return { ok: false, error: `"${s}" is not a valid US number (area code cannot start with ${digits[0]}).` };
    }
    return { ok: true, e164: `+1${digits}` };
  }
  if (digits.length === 11 && digits[0] === "1") {
    if (digits[1] === "0" || digits[1] === "1") {
      return { ok: false, error: `"${s}" is not a valid US number (area code cannot start with ${digits[1]}).` };
    }
    return { ok: true, e164: `+${digits}` };
  }
  return {
    ok: false,
    error: `"${s}" is not a 10-digit US number (got ${digits.length} digits). Enter it like +16125551234.`,
  };
}

/** Normalize or throw — for call sites that have already validated input. */
export function toE164(raw: string): string {
  const r = normalizeE164(raw);
  if (!r.ok) throw new Error(r.error);
  return r.e164;
}

/** True when `raw` is already a strict +E.164 US number. */
export function isE164(raw: string | null | undefined): boolean {
  return /^\+1[2-9]\d{9}$/.test((raw ?? "").trim());
}

/** Last 10 digits — the record-matching key against leads/subs/vendors phone
 *  columns, which are stored however Joe typed them. */
export function last10(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "").slice(-10);
}

/** "(612) 555-1234" for display; falls back to the input. */
export function formatUsPhone(raw: string | null | undefined): string {
  const d = last10(raw);
  if (d.length !== 10) return (raw ?? "").trim();
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

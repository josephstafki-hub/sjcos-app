// Payment authorization (Joe, 2026-11-02). Square's risk team asked for a
// signed card authorization on Chuck Spaeth's $22,043.56 portal payment;
// none existed, because a client paying in the portal types the card in
// Square's own form. From now on the pay page asks the client to type their
// name and tick "I authorize…" before anything is charged, and the server
// keeps that statement (payment_authorizations, migration 0072) with the
// time, the portal login, IP and browser. Settings › Payments prints it as
// the form Square asks for.
//
// Pure, no server-only imports: the pay page shows exactly the words the
// server records, built by the same function from the same figures (the
// server re-checks the amount and surcharge the page showed).

export const AUTHORIZATION_VERSION = "2026-11-02.1";
export const AUTHORIZATION_COMPANY = "SJ Carpentry LLC";

export interface AuthorizationFacts {
  signerName: string;
  method: "card" | "ach";
  invoiceNumber: string;
  milestone: string;
  /** The project address, or its name when no address is on file. */
  projectLabel: string;
  /** The invoice balance being paid (what the invoice is credited). */
  amountCents: number;
  /** Credit card surcharge on top; 0 for debit / prepaid / ACH. */
  surchargeCents: number;
}

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

/** Trim and collapse spaces; null when it isn't a plausible typed name. */
export function cleanSignerName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 120 || !/\p{L}/u.test(name)) return null;
  return name;
}

/** The exact words the client agrees to. */
export function authorizationStatement(f: AuthorizationFacts): string {
  const total = usd(f.amountCents + f.surchargeCents);
  const what = `invoice ${f.invoiceNumber}${f.milestone.trim() ? ` (${f.milestone.trim()})` : ""}${f.projectLabel.trim() ? ` for the project at ${f.projectLabel.trim()}` : ""}`;
  if (f.method === "ach") {
    return `I, ${f.signerName}, am the account holder or am authorized to use this bank account. I authorize ${AUTHORIZATION_COMPANY} to debit ${total} one time from the bank account I connected on this page, to pay ${what}.`;
  }
  const surcharge = f.surchargeCents > 0 ? ` This total is the ${usd(f.amountCents)} invoice balance plus a ${usd(f.surchargeCents)} credit card surcharge.` : "";
  return `I, ${f.signerName}, am the cardholder or am authorized to use this card. I authorize ${AUTHORIZATION_COMPANY} to charge ${total} one time to the card I entered on this page, to pay ${what}.${surcharge}`;
}

/** The client's IP as nginx saw it (X-Real-IP is set from $remote_addr and
 *  can't be forged by the browser; the last X-Forwarded-For hop is nginx's). */
export function requestIp(h: Pick<Headers, "get">): string {
  const real = h.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const hops = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return (hops[hops.length - 1] ?? "").slice(0, 64);
}

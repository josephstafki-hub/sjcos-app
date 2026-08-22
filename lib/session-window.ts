// Session cookie name + lifetimes. Deliberately dependency-free: proxy.ts runs
// on the Edge runtime and cannot import lib/session.ts (which pulls in
// "server-only" and next/headers), but both sides have to agree on the cookie
// name and the window or renewal silently mints a session the other rejects.

export const SESSION_COOKIE = "sjcos_session";

export type Role = "owner" | "sub" | "client";

/** How long a session survives with NO activity at all.
 *
 *  Longer for the portal roles on purpose. A client or sub has no password —
 *  their emailed link is the credential — so an expired session means digging
 *  through their inbox. The owner has a password and a browser that remembers
 *  it, so a shorter idle window costs him nothing and keeps a forgotten laptop
 *  from staying signed into the whole business for a month. */
export function sessionMaxAgeS(role: Role): number {
  const days = role === "owner" ? 7 : 30;
  return days * 24 * 60 * 60;
}

/** Sessions SLIDE: proxy.ts re-issues the cookie on the first request that
 *  arrives more than this long after the token was minted, so anyone who keeps
 *  using the portal never gets signed out. Renewing on every single request
 *  would re-sign a JWT on every prefetch and navigation for no benefit — a day
 *  is fine-grained enough when the idle window is measured in weeks. */
export const SESSION_RENEW_AFTER_S = 24 * 60 * 60;

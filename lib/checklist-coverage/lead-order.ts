// Pure and client-safe: how the checklist's lead picker orders its results.

/** The call's own lead first, marked `on_call` (only when it also matches what
 *  Joe typed), then the rest — each lead once, 12 at most. */
export function orderForCall<L extends { id: string }>(onCall: L[], found: L[], typed: boolean): (L & { on_call: boolean })[] {
  const foundIds = new Set(found.map((l) => l.id));
  const first = onCall.filter((l) => !typed || foundIds.has(l.id));
  const firstIds = new Set(first.map((l) => l.id));
  return [
    ...first.map((l) => ({ ...l, on_call: true })),
    ...found.filter((l) => !firstIds.has(l.id)).map((l) => ({ ...l, on_call: false })),
  ].slice(0, 12);
}

/** The lead's call that is live right now (ringing or on the line), matched on
 *  the lead the call or its checklist is tied to, else on the lead's phone. */
export function liveCallForLead<C extends { id: string; number: string; lead_slug: string | null }>(calls: C[] | null | undefined, lead: { slug: string; phone: string | null }): C | null {
  const last10 = (n: string | null) => (n ?? "").replace(/\D/g, "").slice(-10);
  const phone = last10(lead.phone);
  return (calls ?? []).find((c) => c.lead_slug === lead.slug)
    ?? (phone.length === 10 ? (calls ?? []).find((c) => !c.lead_slug && last10(c.number) === phone) : undefined)
    ?? null;
}

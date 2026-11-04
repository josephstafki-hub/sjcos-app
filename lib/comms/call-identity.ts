import { formatUsPhone } from "./phone.ts";

type Identity = { contact_name: string | null; counterparty_number: string; link_type: string | null; link_slug: string | null };
type Match = { contactName: string; linkType: string; linkSlug: string };
export function callIdentityLabel(call: Pick<Identity, "contact_name" | "counterparty_number">): string {
  return call.contact_name?.trim() || formatUsPhone(call.counterparty_number);
}
/** Enrich legacy history at read time; never change the saved call or its explicit link. */
export async function resolveCallIdentity<T extends Identity>(call: T, match: (phone: string) => Promise<Match | null>): Promise<T> {
  if (call.contact_name?.trim()) return call;
  const found = await match(call.counterparty_number);
  if (!found) return call;
  return { ...call, contact_name: found.contactName, link_type: call.link_type ?? found.linkType, link_slug: call.link_slug ?? found.linkSlug };
}

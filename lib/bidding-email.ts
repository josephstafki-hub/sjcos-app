// The bid request email a sub receives: plain text, packet attached. Shared
// by the Bidding-tab Send (lib/bidding.ts) and an approved release card
// (lib/procurement/release-send.ts) so both send the same words. Pure.

export interface BidEmailPackage {
  title: string;
  project_name: string;
  scope_notes: string;
  /** "Nov 7" style, or null when the package has no due date. */
  due_label: string | null;
}

/** The bid request email itself — plain text, packet attached. */
function bidGreetingName(subName: string, notes?: string | null): string {
  const contact = notes?.match(/(?:^|\n)Greeting contact:\s*([^\.\n]+)/i)?.[1]?.trim();
  if (contact) {
    if (/\band\b/i.test(contact)) return contact.replace(/\s+[A-Z][a-z]+$/, "");
    return contact.split(/\s+/)[0] || contact;
  }
  return subName.split(/\s+/)[0] || subName;
}

export function composeBidEmail(
  subName: string,
  subNotes: string | null,
  pkg: BidEmailPackage,
  personalNote: string,
  fileLabels: string[],
): { subject: string; body: string } {
  const firstName = bidGreetingName(subName, subNotes);
  const subject = `Bid request: ${pkg.title} — ${pkg.project_name}`;
  const body = [
    `Hi ${firstName},`,
    "",
    `I'd like your price on ${pkg.title} for ${pkg.project_name}.`,
    ...(pkg.scope_notes ? ["", "Scope:", pkg.scope_notes] : []),
    ...(personalNote ? ["", `A note for you: ${personalNote}`] : []),
    ...(pkg.due_label ? ["", `Bids are due by ${pkg.due_label}.`] : []),
    "",
    `The packet is attached (${fileLabels.join(", ")}). Reply to this email with your number — ` +
      "line items, exclusions, and lead time all welcome. Questions, just reply.",
    "",
    "— Joe Stafki",
    "SJ Carpentry LLC",
  ].join("\n");
  return { subject, body };
}

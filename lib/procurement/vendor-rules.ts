// Vendor restrictions and the manual-marketplace rule (A13; Joe's standing
// instruction 2026-09-03: "Fiverr is never automated: no bot, no browser
// script, no bypassing a bot check; messages to Fiverr sellers are handed to
// Joe to paste and the order click is his. Fiverr gig starting prices are
// floors, not quotes; only a custom offer against a written scope counts as a
// price.").
//
// Pure module. Restrictions come from the trusted vendor/sub record: a note
// line starting with "RESTRICT:" or "DO NOT " is a hard stop for automation on
// that payee (the owner writes those lines; agents cannot).

export interface PayeeRecord {
  name: string;
  email?: string | null;
  notes?: string | null;
}

export interface ManualMarketplace {
  marketplace: "fiverr";
  /** Hand-off steps for the owner. The agent prepares text; the clicks are Joe's. */
  steps: string[];
  priceRule: string;
}

const FIVERR_RE = /fiverr/i;

/** Detect a payee that lives on a manual-only marketplace. */
export function manualMarketplaceFor(payee: PayeeRecord): ManualMarketplace | null {
  const hay = `${payee.name} ${payee.email ?? ""} ${payee.notes ?? ""}`;
  if (FIVERR_RE.test(hay)) {
    return {
      marketplace: "fiverr",
      steps: [
        "Agent drafts the message/brief text and attaches it to the work item; nothing is sent.",
        "Joe opens Fiverr himself, pastes the message and places or accepts the custom offer.",
        "Joe records the order number and the custom-offer price back on the commitment.",
        "Only that custom offer against the written scope is the committed price.",
      ],
      priceRule: "Gig starting prices are floors, not quotes; only a custom offer against a written scope counts as a price.",
    };
  }
  return null;
}

export interface RestrictionVerdict {
  ok: boolean;
  restrictions: string[];
  manual: ManualMarketplace | null;
}

const RESTRICT_LINE_RE = /^\s*(?:RESTRICT:|DO NOT\b)(.*)$/i;

/** Owner-written restriction lines on the trusted record plus the marketplace rule. */
export function vendorRestrictions(payee: PayeeRecord): RestrictionVerdict {
  const restrictions: string[] = [];
  for (const line of (payee.notes ?? "").split(/\r?\n/)) {
    const m = RESTRICT_LINE_RE.exec(line);
    if (m) restrictions.push(line.trim());
  }
  const manual = manualMarketplaceFor(payee);
  return { ok: restrictions.length === 0, restrictions, manual };
}

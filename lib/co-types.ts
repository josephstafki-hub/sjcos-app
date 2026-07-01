// Change-order shared types + pure helpers. NO db import — safe for client
// components (mirrors lib/esign-types.ts / lib/cost-book-units.ts split so pg
// never leaks into a client bundle). Money is CENTS.

export type CoStatus = "draft" | "sent" | "approved" | "declined";

export const CO_STATUS_LABEL: Record<CoStatus, string> = {
  draft: "Draft",
  sent: "Awaiting signature",
  approved: "Approved",
  declined: "Declined",
};

export const CO_STATUS_KIND: Record<CoStatus, "money" | "accent" | "flag" | "ghost"> = {
  approved: "money",
  sent: "accent",
  declined: "flag",
  draft: "ghost",
};

/** Format cents as whole-dollar USD (change orders are quoted in round dollars). */
export function fmtCoUsd(cents: number): string {
  return `$${Math.round((cents || 0) / 100).toLocaleString("en-US")}`;
}

/** Parse a user-typed dollar amount ("$2,500" / "2500") into cents. */
export function coDollarsToCents(input: string): number {
  const n = Number(String(input).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
}

/** Display shape shared by the server read + the client tab. */
export interface ChangeOrderView {
  id: number;
  title: string;
  description: string;
  priceCents: number;
  priceLabel: string;
  status: CoStatus;
  createdAtLabel: string;
  /** The linked signature request id, if one has been sent. */
  signatureRequestId: number | null;
}

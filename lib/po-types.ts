// Purchase-order shared types + pure helpers. NO db import — safe for client
// components (mirrors lib/co-types.ts). Money is CENTS.

export type PoStatus = "draft" | "queued" | "sent" | "partial" | "fulfilled" | "closed" | "void";
export type PoVendorKind = "vendor" | "sub" | "one_off";

export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  sent: "Sent",
  partial: "Partially received",
  fulfilled: "Fulfilled",
  closed: "Closed",
  void: "Void",
};

export const PO_STATUS_KIND: Record<PoStatus, "money" | "accent" | "flag" | "ghost"> = {
  draft: "ghost",
  queued: "ghost",
  sent: "accent",
  partial: "accent",
  fulfilled: "money",
  closed: "money",
  void: "flag",
};

/** Format cents as whole-dollar USD (POs are quoted in round dollars). */
export function fmtPoUsd(cents: number): string {
  return `$${Math.round((cents || 0) / 100).toLocaleString("en-US")}`;
}

/** Parse a user-typed dollar amount ("$2,500" / "2500") into cents. */
export function poDollarsToCents(input: string): number {
  const n = Number(String(input).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
}

export interface PoLineView {
  id: number;
  description: string;
  unit: string;
  qtyOrdered: number;
  qtyReceived: number;
  unitCost: number;
  unitCostLabel: string;
  extended: number;
  extendedLabel: string;
  costItemId: number | null;
}

/** Display shape shared by the server read + the client tab. */
export interface PurchaseOrderView {
  id: number;
  poNumber: string;
  title: string;
  notes: string;
  vendorKind: PoVendorKind;
  vendorId: string | null;
  subSlug: string | null;
  vendorName: string;
  vendorEmail: string;
  vendorPhone: string;
  status: PoStatus;
  subtotal: number;
  subtotalLabel: string;
  createdAtLabel: string;
  sentAtLabel: string | null;
  lines: PoLineView[];
}

export interface VendorOption {
  id: string;
  slug: string;
  name: string;
  trade: string;
  email: string;
  phone: string;
  fav: boolean;
}

export interface AssignedSubOption {
  slug: string;
  name: string;
  trade: string;
  email: string | null;
  phone: string | null;
}

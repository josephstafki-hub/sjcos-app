import "server-only";

// Vendors directory (materials suppliers — distinct from subs, which are
// labor). Mirrors lib/subs.ts, minus the sub-only COI/rating/jobs-count
// content: a vendor card is just name/trade/contact/fav + PO history.

import { query } from "./db";
import type { VendorOption } from "./po-types";

export interface VendorCard {
  slug: string;
  initials: string;
  name: string;
  trade: string;
  email: string;
  phone: string;
  fav: boolean;
  poCount: number;
}

export interface VendorsData {
  summary: string;
  vendors: VendorCard[];
}

interface VendorRow {
  id: string;
  slug: string;
  name: string;
  trade: string;
  email: string | null;
  phone: string | null;
  notes: string;
  fav: boolean;
  po_count: number;
}

const VENDOR_SELECT = `
  SELECT v.id, v.slug, v.name, v.trade, v.email, v.phone, v.notes, v.fav,
         (SELECT count(*)::int FROM purchase_orders po WHERE po.vendor_id = v.id) AS po_count
    FROM vendors v`;

function vendorInitials(name: string): string {
  const w = name.split(/\s+/).filter((x) => /^[A-Za-z]/.test(x));
  if (w.length === 0) return name.slice(0, 2).toUpperCase();
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[1][0]).toUpperCase();
}

function rowToCard(r: VendorRow): VendorCard {
  return {
    slug: r.slug,
    initials: vendorInitials(r.name),
    name: r.name,
    trade: r.trade,
    email: r.email ?? "",
    phone: r.phone ?? "",
    fav: r.fav,
    poCount: r.po_count,
  };
}

export async function getVendorsData(): Promise<VendorsData> {
  const { rows } = await query<VendorRow>(`${VENDOR_SELECT} ORDER BY v.fav DESC, v.name`);
  const vendors = rows.map(rowToCard);
  return {
    summary: `${vendors.length} vendor${vendors.length === 1 ? "" : "s"}`,
    vendors,
  };
}

/** Saved-vendor options for the PO vendor picker (name/trade/contact + fav,
 *  favorites first). */
export async function listVendors(): Promise<VendorOption[]> {
  const { rows } = await query<{ id: string; slug: string; name: string; trade: string; email: string | null; phone: string | null; fav: boolean }>(
    `SELECT id, slug, name, trade, email, phone, fav FROM vendors ORDER BY fav DESC, name`,
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    trade: r.trade,
    email: r.email ?? "",
    phone: r.phone ?? "",
    fav: r.fav,
  }));
}

export interface VendorDetail {
  slug: string;
  initials: string;
  name: string;
  trade: string;
  email: string;
  phone: string;
  fav: boolean;
  notes: string;
  purchaseOrders: { poNumber: string; projectName: string; projectSlug: string; title: string; status: string; subtotalLabel: string; createdLabel: string }[];
}

export async function getVendor(slug: string): Promise<VendorDetail | null> {
  const { rows } = await query<VendorRow>(`${VENDOR_SELECT} WHERE v.slug = $1`, [slug]);
  if (!rows[0]) return null;
  const card = rowToCard(rows[0]);

  const { rows: poRows } = await query<{
    po_number: string;
    project_name: string;
    project_slug: string;
    title: string;
    status: string;
    subtotal: number;
    created_label: string;
  }>(
    `SELECT po.po_number, p.name AS project_name, p.slug AS project_slug, po.title, po.status, po.subtotal,
            to_char(po.created_at, 'Mon FMDD, YYYY') AS created_label
       FROM purchase_orders po JOIN projects p ON p.id = po.project_id
      WHERE po.vendor_id = $1
      ORDER BY po.created_at DESC`,
    [rows[0].id],
  );

  return {
    slug: card.slug,
    initials: card.initials,
    name: card.name,
    trade: card.trade,
    email: card.email,
    phone: card.phone,
    fav: card.fav,
    notes: rows[0].notes,
    purchaseOrders: poRows.map((r) => ({
      poNumber: r.po_number,
      projectName: r.project_name,
      projectSlug: r.project_slug,
      title: r.title,
      status: r.status,
      subtotalLabel: `$${Math.round((r.subtotal || 0) / 100).toLocaleString("en-US")}`,
      createdLabel: r.created_label,
    })),
  };
}

import "server-only";

// Purchase-order reads (per-project procurement). Reads for the project Money
// tab's "Purchase orders" section, mirroring lib/change-orders.ts /
// lib/estimates.ts. Writes live in lib/actions/purchase-orders.ts.

import { query } from "./db";
import { fmtPoUsd, type PoLineView, type PoStatus, type PoVendorKind, type PurchaseOrderView } from "./po-types";
import { fmtUsd } from "./cost-book-units";

interface PoRow {
  id: string;
  po_number: string;
  title: string;
  notes: string;
  vendor_kind: string;
  vendor_id: string | null;
  sub_slug: string | null;
  vendor_name: string;
  vendor_email: string;
  vendor_phone: string;
  status: string;
  subtotal: number;
  created_label: string;
  sent_label: string | null;
  commitment_state: string | null;
  held_cents: string | null;
  bills: number | null;
}

interface PoLineRow {
  id: string;
  purchase_order_id: string;
  description: string;
  unit: string;
  qty_ordered: string;
  qty_received: string;
  unit_cost: number;
  extended: number;
  cost_item_id: string | null;
}

const PO_STATUSES: PoStatus[] = ["draft", "queued", "sent", "partial", "fulfilled", "closed", "void"];
const PO_VENDOR_KINDS: PoVendorKind[] = ["vendor", "sub", "one_off"];

function lineToView(r: PoLineRow): PoLineView {
  return {
    id: Number(r.id),
    description: r.description,
    unit: r.unit,
    qtyOrdered: Number(r.qty_ordered),
    qtyReceived: Number(r.qty_received),
    unitCost: r.unit_cost,
    unitCostLabel: fmtUsd(r.unit_cost),
    extended: r.extended,
    extendedLabel: fmtUsd(r.extended),
    costItemId: r.cost_item_id ? Number(r.cost_item_id) : null,
  };
}

/** "Committed · $1,200.00 of job cash held · 1 bill" — what the PO has
 *  bound (A13): the commitment, the cash held for it, bills against it. */
function commitmentLabel(r: PoRow): string | null {
  if (!r.commitment_state || r.commitment_state === "void" || r.commitment_state === "draft") return null;
  const held = Number(r.held_cents ?? 0);
  const parts = [r.commitment_state === "committed" ? "Committed" : r.commitment_state.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())];
  if (held > 0) parts.push(`${fmtPoUsd(held)} of job cash held`);
  if (r.bills) parts.push(`${r.bills} bill${r.bills === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function rowToView(r: PoRow, lines: PoLineView[]): PurchaseOrderView {
  return {
    id: Number(r.id),
    poNumber: r.po_number,
    title: r.title,
    notes: r.notes,
    vendorKind: PO_VENDOR_KINDS.includes(r.vendor_kind as PoVendorKind) ? (r.vendor_kind as PoVendorKind) : "one_off",
    vendorId: r.vendor_id,
    subSlug: r.sub_slug,
    vendorName: r.vendor_name,
    vendorEmail: r.vendor_email,
    vendorPhone: r.vendor_phone,
    status: PO_STATUSES.includes(r.status as PoStatus) ? (r.status as PoStatus) : "draft",
    subtotal: r.subtotal,
    subtotalLabel: fmtPoUsd(r.subtotal),
    createdAtLabel: r.created_label,
    sentAtLabel: r.sent_label,
    commitmentLabel: commitmentLabel(r),
    lines,
  };
}

/** All purchase orders for a project, newest first, with their lines. */
export async function getProjectPurchaseOrders(slug: string): Promise<PurchaseOrderView[]> {
  const { rows } = await query<PoRow>(
    `SELECT po.id, po.po_number, po.title, po.notes, po.vendor_kind, po.vendor_id, po.sub_slug,
            po.vendor_name, po.vendor_email, po.vendor_phone, po.status, po.subtotal,
            to_char(po.created_at, 'Mon FMDD, YYYY') AS created_label,
            to_char(po.sent_at, 'Mon FMDD, YYYY') AS sent_label,
            c.state AS commitment_state,
            (SELECT COALESCE(sum(r.amount_cents), 0) FROM cash_reservations r WHERE r.commitment_id = c.id AND r.state = 'reserved')::text AS held_cents,
            (SELECT count(*)::int FROM bills b WHERE b.commitment_id = c.id) AS bills
       FROM purchase_orders po
       LEFT JOIN commitments c ON c.id = po.commitment_id
       JOIN projects p ON p.id = po.project_id
      WHERE p.slug = $1
      ORDER BY po.created_at DESC, po.id DESC`,
    [slug],
  );
  if (rows.length === 0) return [];

  const ids = rows.map((r) => Number(r.id));
  const { rows: lineRows } = await query<PoLineRow>(
    `SELECT id, purchase_order_id, description, unit, qty_ordered, qty_received, unit_cost, extended, cost_item_id
       FROM purchase_order_lines WHERE purchase_order_id = ANY($1::bigint[]) ORDER BY sort_order, id`,
    [ids],
  );
  const linesByPo = new Map<number, PoLineView[]>();
  for (const lr of lineRows) {
    const poId = Number(lr.purchase_order_id);
    const list = linesByPo.get(poId) ?? [];
    list.push(lineToView(lr));
    linesByPo.set(poId, list);
  }

  return rows.map((r) => rowToView(r, linesByPo.get(Number(r.id)) ?? []));
}

/** One purchase order + its lines, scoped by project slug so one project can't
 *  read another's PO by id. */
export async function getPurchaseOrder(slug: string, id: number): Promise<PurchaseOrderView | null> {
  const { rows } = await query<PoRow>(
    `SELECT po.id, po.po_number, po.title, po.notes, po.vendor_kind, po.vendor_id, po.sub_slug,
            po.vendor_name, po.vendor_email, po.vendor_phone, po.status, po.subtotal,
            to_char(po.created_at, 'Mon FMDD, YYYY') AS created_label,
            to_char(po.sent_at, 'Mon FMDD, YYYY') AS sent_label,
            c.state AS commitment_state,
            (SELECT COALESCE(sum(r.amount_cents), 0) FROM cash_reservations r WHERE r.commitment_id = c.id AND r.state = 'reserved')::text AS held_cents,
            (SELECT count(*)::int FROM bills b WHERE b.commitment_id = c.id) AS bills
       FROM purchase_orders po
       LEFT JOIN commitments c ON c.id = po.commitment_id
       JOIN projects p ON p.id = po.project_id
      WHERE po.id = $1 AND p.slug = $2`,
    [id, slug],
  );
  if (!rows[0]) return null;
  const { rows: lineRows } = await query<PoLineRow>(
    `SELECT id, purchase_order_id, description, unit, qty_ordered, qty_received, unit_cost, extended, cost_item_id
       FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY sort_order, id`,
    [id],
  );
  return rowToView(rows[0], lineRows.map(lineToView));
}

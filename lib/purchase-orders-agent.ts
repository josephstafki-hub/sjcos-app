import "server-only";

// Agent-facing purchase-order writes (MCP surface). Plain server helpers — NOT
// "use server". They are reached ONLY through app/api/internal/purchase-orders,
// which is bearer-gated by CRON_SECRET (a trusted local caller, not a browser
// session), so they intentionally do NOT call requireRole. The owner-gated
// Server Actions in lib/actions/purchase-orders.ts stay the browser path; these
// mirror the same DB work for an MCP client, sharing the recompute step
// (lib/po-recompute.ts) so the two paths can't drift.
//
// ─── THE SAFETY LINE (do not move it) ───────────────────────────────────────
// This module can draft a PO, edit it, add/edit/delete its lines, and flag it
// "queued" (ready for review) — mirrors queue_newsletter_issue's "parks, never
// sends" contract. It CANNOT send: there is no send/recordReceipt/close/void
// action here. A real email to a vendor only ever goes out via
// sendPurchaseOrder, reachable only from the owner's "Send to vendor" click in
// the app. Keep it that way.

import { query, queryOne } from "./db";
import { recomputePurchaseOrder } from "./po-recompute";
import { poDollarsToCents, type PoVendorKind } from "./po-types";

export type AgentResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const VENDOR_KINDS: PoVendorKind[] = ["vendor", "sub", "one_off"];

async function projectBySlug(slug: string) {
  return queryOne<{ id: string; name: string }>(`SELECT id, name FROM projects WHERE slug = $1`, [slug]);
}

interface CreateInput {
  projectSlug: string;
  title: string;
  notes?: string;
  vendorKind?: string;
  vendorId?: string;
  subSlug?: string;
  vendorName: string;
  vendorEmail?: string;
  vendorPhone?: string;
}

export async function agentCreatePurchaseOrder(input: CreateInput): Promise<AgentResult<{ id: number; poNumber: string }>> {
  const project = await projectBySlug(input.projectSlug);
  if (!project) return { ok: false, error: `Project "${input.projectSlug}" not found.` };
  const title = (input.title ?? "").trim();
  if (!title) return { ok: false, error: "A title is required." };
  const vendorName = (input.vendorName ?? "").trim();
  if (!vendorName) return { ok: false, error: "A vendor name is required." };
  const vendorKind = VENDOR_KINDS.includes(input.vendorKind as PoVendorKind) ? (input.vendorKind as PoVendorKind) : "one_off";

  const { count } = (await queryOne<{ count: number }>(
    `SELECT count(*)::int AS count FROM purchase_orders WHERE project_id = $1`,
    [project.id],
  )) ?? { count: 0 };
  const poNumber = `PO-${String(count + 1).padStart(3, "0")}`;

  const ins = await queryOne<{ id: string }>(
    `INSERT INTO purchase_orders
       (project_id, po_number, vendor_kind, vendor_id, sub_slug, vendor_name, vendor_email, vendor_phone,
        title, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft')
     RETURNING id`,
    [
      project.id, poNumber, vendorKind,
      vendorKind === "vendor" ? input.vendorId ?? null : null,
      vendorKind === "sub" ? input.subSlug ?? null : null,
      vendorName, (input.vendorEmail ?? "").trim(), (input.vendorPhone ?? "").trim(),
      title, (input.notes ?? "").trim(),
    ],
  );
  return { ok: true, data: { id: Number(ins!.id), poNumber } };
}

/** Edit a draft/queued PO's header fields (locked once sent). */
export async function agentUpdatePurchaseOrder(
  id: number,
  patch: { title?: string; notes?: string },
): Promise<AgentResult> {
  const cur = await queryOne<{ status: string }>(`SELECT status FROM purchase_orders WHERE id = $1`, [id]);
  if (!cur) return { ok: false, error: "Purchase order not found." };
  if (!["draft", "queued"].includes(cur.status)) return { ok: false, error: "Only a draft or queued PO can be edited." };
  await query(
    `UPDATE purchase_orders SET title = COALESCE($2, title), notes = COALESCE($3, notes) WHERE id = $1`,
    [id, patch.title?.trim(), patch.notes?.trim()],
  );
  return { ok: true };
}

export async function agentAddLine(
  poId: number,
  line: { description: string; unit?: string; qtyOrdered: number; unitCost: string | number },
): Promise<AgentResult<{ id: number }>> {
  const description = (line.description ?? "").trim();
  if (!description) return { ok: false, error: "A line description is required." };
  const unit = (line.unit ?? "ea").trim() || "ea";
  const qtyOrdered = Math.max(0, Number(line.qtyOrdered) || 0);
  const unitCost = typeof line.unitCost === "number" ? Math.max(0, Math.round(line.unitCost)) : poDollarsToCents(String(line.unitCost ?? ""));
  const extended = Math.round(qtyOrdered * unitCost);
  const ins = await queryOne<{ id: string }>(
    `INSERT INTO purchase_order_lines (purchase_order_id, description, unit, qty_ordered, unit_cost, extended, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6, COALESCE((SELECT max(sort_order)+1 FROM purchase_order_lines WHERE purchase_order_id = $1), 0))
     RETURNING id`,
    [poId, description, unit, qtyOrdered, unitCost, extended],
  );
  await recomputePurchaseOrder(poId);
  return { ok: true, data: { id: Number(ins!.id) } };
}

export async function agentUpdateLine(
  lineId: number,
  patch: { description?: string; unit?: string; qtyOrdered?: number; unitCost?: string | number },
): Promise<AgentResult> {
  const cur = await queryOne<{ purchase_order_id: string; description: string; unit: string; qty_ordered: string; unit_cost: number }>(
    `SELECT purchase_order_id, description, unit, qty_ordered, unit_cost FROM purchase_order_lines WHERE id = $1`,
    [lineId],
  );
  if (!cur) return { ok: false, error: "Line not found." };
  const description = patch.description !== undefined ? patch.description.trim() : cur.description;
  const unit = patch.unit !== undefined ? patch.unit.trim() || "ea" : cur.unit;
  const qtyOrdered = patch.qtyOrdered !== undefined ? Math.max(0, Number(patch.qtyOrdered) || 0) : Number(cur.qty_ordered);
  const unitCost =
    patch.unitCost === undefined
      ? cur.unit_cost
      : typeof patch.unitCost === "number"
        ? Math.max(0, Math.round(patch.unitCost))
        : poDollarsToCents(String(patch.unitCost));
  const extended = Math.round(qtyOrdered * unitCost);
  await query(
    `UPDATE purchase_order_lines SET description=$2, unit=$3, qty_ordered=$4, unit_cost=$5, extended=$6 WHERE id=$1`,
    [lineId, description, unit, qtyOrdered, unitCost, extended],
  );
  await recomputePurchaseOrder(Number(cur.purchase_order_id));
  return { ok: true };
}

export async function agentDeleteLine(lineId: number): Promise<AgentResult> {
  const row = await queryOne<{ purchase_order_id: string }>(
    `DELETE FROM purchase_order_lines WHERE id = $1 RETURNING purchase_order_id`,
    [lineId],
  );
  if (!row) return { ok: false, error: "Line not found." };
  await recomputePurchaseOrder(Number(row.purchase_order_id));
  return { ok: true };
}

/** Draft → queued. Agent-safe "ready for review" marker — no email goes out. */
export async function agentQueuePurchaseOrder(id: number): Promise<AgentResult> {
  const r = await query(`UPDATE purchase_orders SET status = 'queued' WHERE id = $1 AND status = 'draft'`, [id]);
  if (r.rowCount === 0) return { ok: false, error: "Only a draft PO can be queued." };
  return { ok: true };
}

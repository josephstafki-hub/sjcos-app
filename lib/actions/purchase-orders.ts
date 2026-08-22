"use server";

// Purchase-order write paths (per-project procurement). Owner-gated, mirrors
// lib/actions/change-orders.ts + lib/actions/estimates.ts. Reads stay in
// lib/purchase-orders.ts. Money is CENTS. A PO's subtotal is recomputed from
// its lines after every line mutation; its status is recomputed from its
// lines' qty_received after every receiving update.
//
// sendPurchaseOrder emails a vendor (mirrors sendInvoice) — it is called from
// the owner-clicked "Send" button in components/projects/PurchaseOrders.tsx.
// Agents can only send a PO by spending an owner grant (lib/owner-grants.ts →
// MCP send_purchase_order). queuePurchaseOrder just flags a draft "ready for
// review" (mirrors queue_newsletter_issue): it is agent-safe and never sends.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { sendPurchaseOrderOp } from "@/lib/send-ops";
import { poDollarsToCents, type PoVendorKind } from "@/lib/po-types";
import { recomputePurchaseOrder as recompute } from "@/lib/po-recompute";

type Result = { ok: true; id?: number } | { ok: false; error: string };

const VENDOR_KINDS: PoVendorKind[] = ["vendor", "sub", "one_off"];

async function projectBySlug(slug: string) {
  return queryOne<{ id: string; name: string }>(`SELECT id, name FROM projects WHERE slug = $1`, [slug]);
}

function vendorFields(formData: FormData): {
  vendorKind: PoVendorKind;
  vendorId: string | null;
  subSlug: string | null;
  vendorName: string;
  vendorEmail: string;
  vendorPhone: string;
} {
  const raw = String(formData.get("vendorKind") ?? "one_off");
  const vendorKind = VENDOR_KINDS.includes(raw as PoVendorKind) ? (raw as PoVendorKind) : "one_off";
  return {
    vendorKind,
    vendorId: vendorKind === "vendor" ? String(formData.get("vendorId") ?? "").trim() || null : null,
    subSlug: vendorKind === "sub" ? String(formData.get("subSlug") ?? "").trim() || null : null,
    vendorName: String(formData.get("vendorName") ?? "").trim(),
    vendorEmail: String(formData.get("vendorEmail") ?? "").trim(),
    vendorPhone: String(formData.get("vendorPhone") ?? "").trim(),
  };
}

/** Draft a new purchase order on a project. */
export async function createPurchaseOrder(slug: string, formData: FormData): Promise<Result> {
  const user = await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "A title is required." };
  const notes = String(formData.get("notes") ?? "").trim();
  const v = vendorFields(formData);
  if (!v.vendorName) return { ok: false, error: "A vendor name is required." };

  const { count } = (await queryOne<{ count: number }>(
    `SELECT count(*)::int AS count FROM purchase_orders WHERE project_id = $1`,
    [project.id],
  )) ?? { count: 0 };
  const poNumber = `PO-${String(count + 1).padStart(3, "0")}`;

  const ins = await queryOne<{ id: string }>(
    `INSERT INTO purchase_orders
       (project_id, po_number, vendor_kind, vendor_id, sub_slug, vendor_name, vendor_email, vendor_phone,
        title, notes, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11)
     RETURNING id`,
    [
      project.id, poNumber, v.vendorKind, v.vendorId, v.subSlug, v.vendorName, v.vendorEmail, v.vendorPhone,
      title, notes, user.id,
    ],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true, id: Number(ins!.id) };
}

/** Edit a draft/queued PO's header fields (locked once sent). */
export async function updatePurchaseOrder(slug: string, id: number, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "A title is required." };
  const notes = String(formData.get("notes") ?? "").trim();
  const v = vendorFields(formData);
  if (!v.vendorName) return { ok: false, error: "A vendor name is required." };

  const r = await query(
    `UPDATE purchase_orders po
        SET title = $3, notes = $4, vendor_kind = $5, vendor_id = $6, sub_slug = $7,
            vendor_name = $8, vendor_email = $9, vendor_phone = $10
       FROM projects p
      WHERE po.id = $1 AND po.project_id = p.id AND p.slug = $2 AND po.status IN ('draft','queued')`,
    [id, slug, title, notes, v.vendorKind, v.vendorId, v.subSlug, v.vendorName, v.vendorEmail, v.vendorPhone],
  );
  if (r.rowCount === 0) return { ok: false, error: "Only a draft or queued PO can be edited." };
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

function parseLine(formData: FormData) {
  const description = String(formData.get("description") ?? "").trim();
  const unit = String(formData.get("unit") ?? "ea").trim() || "ea";
  const qtyOrdered = Math.max(0, Number(formData.get("qtyOrdered")) || 0);
  const unitCost = poDollarsToCents(String(formData.get("unitCost") ?? ""));
  const costItemRaw = String(formData.get("costItemId") ?? "").trim();
  const costItemId = costItemRaw && /^\d+$/.test(costItemRaw) ? Number(costItemRaw) : null;
  const extended = Math.round(qtyOrdered * unitCost);
  return { description, unit, qtyOrdered, unitCost, costItemId, extended };
}

export async function addPOLine(poId: number, slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const v = parseLine(formData);
  if (!v.description) return { ok: false, error: "A line description is required." };
  await query(
    `INSERT INTO purchase_order_lines
       (purchase_order_id, cost_item_id, description, unit, qty_ordered, unit_cost, extended, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
        COALESCE((SELECT max(sort_order)+1 FROM purchase_order_lines WHERE purchase_order_id = $1), 0))`,
    [poId, v.costItemId, v.description, v.unit, v.qtyOrdered, v.unitCost, v.extended],
  );
  await recompute(poId);
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

export async function updatePOLine(lineId: number, slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const v = parseLine(formData);
  if (!v.description) return { ok: false, error: "A line description is required." };
  const row = await queryOne<{ purchase_order_id: string }>(
    `UPDATE purchase_order_lines
        SET description=$2, unit=$3, qty_ordered=$4, unit_cost=$5, extended=$6, cost_item_id=$7
      WHERE id=$1 RETURNING purchase_order_id`,
    [lineId, v.description, v.unit, v.qtyOrdered, v.unitCost, v.extended, v.costItemId],
  );
  if (row) await recompute(Number(row.purchase_order_id));
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

export async function deletePOLine(lineId: number, slug: string): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ purchase_order_id: string }>(
    `DELETE FROM purchase_order_lines WHERE id = $1 RETURNING purchase_order_id`,
    [lineId],
  );
  if (row) await recompute(Number(row.purchase_order_id));
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Record receiving progress on a line (owner, or the internal MCP proxy).
 *  Clamped to qty_ordered — can't over-receive. Triggers status recompute. */
export async function recordReceipt(lineId: number, slug: string, qtyReceived: number): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ purchase_order_id: string }>(
    `UPDATE purchase_order_lines
        SET qty_received = LEAST(GREATEST($2, 0), qty_ordered)
      WHERE id = $1 RETURNING purchase_order_id`,
    [lineId, qtyReceived],
  );
  if (!row) return { ok: false, error: "Line not found." };
  await recompute(Number(row.purchase_order_id));
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Draft → queued. Agent-safe "ready for review" marker — no email goes out.
 *  Mirrors queue_newsletter_issue's "parks, never sends" contract. */
export async function queuePurchaseOrder(slug: string, id: number): Promise<Result> {
  await requireRole("owner");
  const r = await query(
    `UPDATE purchase_orders po SET status = 'queued'
       FROM projects p
      WHERE po.id = $1 AND po.project_id = p.id AND p.slug = $2 AND po.status = 'draft'`,
    [id, slug],
  );
  if (r.rowCount === 0) return { ok: false, error: "Only a draft PO can be queued." };
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Owner-only: email the PO to the vendor, then mark it sent. The send core
 *  lives in lib/send-ops.ts; the only other caller is the agent path, which
 *  must first spend an owner grant (lib/agent-sends.ts). */
export async function sendPurchaseOrder(slug: string, id: number): Promise<Result> {
  await requireRole("owner");
  const res = await sendPurchaseOrderOp(id, slug);
  if (!res.ok) return res;
  revalidatePath(`/projects/${slug}`);
  revalidatePath("/notifications");
  return { ok: true };
}

/** Owner accepts the PO as done even if a line came in short (shortage
 *  accepted, backorder written off, etc.) — an explicit terminal state. */
export async function closePurchaseOrder(slug: string, id: number): Promise<Result> {
  await requireRole("owner");
  const r = await query(
    `UPDATE purchase_orders po SET status = 'closed'
       FROM projects p
      WHERE po.id = $1 AND po.project_id = p.id AND p.slug = $2
        AND po.status IN ('sent','partial','fulfilled')`,
    [id, slug],
  );
  if (r.rowCount === 0) return { ok: false, error: "Only a sent, partially received, or fulfilled PO can be closed." };
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Cancel a PO before or after sending (e.g. the vendor can't fulfill it). */
export async function voidPurchaseOrder(slug: string, id: number): Promise<Result> {
  await requireRole("owner");
  const r = await query(
    `UPDATE purchase_orders po SET status = 'void'
       FROM projects p
      WHERE po.id = $1 AND po.project_id = p.id AND p.slug = $2 AND po.status <> 'void'`,
    [id, slug],
  );
  if (r.rowCount === 0) return { ok: false, error: "Purchase order not found." };
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Delete a draft/queued PO outright (sent+ are kept for the audit trail —
 *  void it instead). Mirrors deleteChangeOrder's status guard. */
export async function deletePurchaseOrder(slug: string, id: number): Promise<Result> {
  await requireRole("owner");
  const r = await query(
    `DELETE FROM purchase_orders po
       USING projects p
      WHERE po.id = $1 AND po.project_id = p.id AND p.slug = $2
        AND po.status IN ('draft','queued')`,
    [id, slug],
  );
  if (r.rowCount === 0) return { ok: false, error: "Only a draft or queued purchase order can be deleted." };
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

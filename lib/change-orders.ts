import "server-only";

// Change orders (Phase-3 execution, 7-co). Reads for the project "Change orders"
// tab. A CO is signed through the e-sign foundation (signature_requests with
// doc_type='change_order' and change_order_id link); its own status mirrors the
// linked request. Writes live in lib/actions/change-orders.ts.

import { query } from "./db";
import { fmtCoUsd, type ChangeOrderView, type CoStatus } from "./co-types";

interface CoRow {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  status: string;
  created_label: string;
  signature_request_id: string | null;
}

function rowToView(r: CoRow): ChangeOrderView {
  return {
    id: Number(r.id),
    title: r.title,
    description: r.description,
    priceCents: r.price_cents,
    priceLabel: fmtCoUsd(r.price_cents),
    status: (["draft", "sent", "approved", "declined"] as CoStatus[]).includes(r.status as CoStatus)
      ? (r.status as CoStatus)
      : "draft",
    createdAtLabel: r.created_label,
    signatureRequestId: r.signature_request_id ? Number(r.signature_request_id) : null,
  };
}

/** All change orders for a project, newest first, with any linked signature
 *  request id (for the "View / sign in portal" affordance). */
export async function getProjectChangeOrders(slug: string): Promise<ChangeOrderView[]> {
  const { rows } = await query<CoRow>(
    `SELECT co.id, co.title, co.description, co.price_cents, co.status,
            to_char(co.created_at, 'Mon FMDD, YYYY') AS created_label,
            sr.id AS signature_request_id
       FROM change_orders co
       JOIN projects p ON p.id = co.project_id
       LEFT JOIN signature_requests sr ON sr.change_order_id = co.id
      WHERE p.slug = $1
      ORDER BY co.created_at DESC, co.id DESC`,
    [slug],
  );
  return rows.map(rowToView);
}

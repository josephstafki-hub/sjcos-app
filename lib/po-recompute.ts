import "server-only";

// Shared recompute step for purchase orders — resums subtotal from lines and
// derives status from receiving progress. Used by both the owner-gated browser
// actions (lib/actions/purchase-orders.ts) and the agent-facing writes
// (lib/purchase-orders-agent.ts) so the two paths can never drift.

import { query } from "./db";

export async function recomputePurchaseOrder(poId: number) {
  await query(
    `UPDATE purchase_orders
        SET subtotal = s.sub
       FROM (SELECT COALESCE(sum(extended), 0)::int AS sub FROM purchase_order_lines WHERE purchase_order_id = $1) s
      WHERE purchase_orders.id = $1`,
    [poId],
  );
  await query(
    `UPDATE purchase_orders po
        SET status = CASE
              WHEN po.status NOT IN ('sent','partial','fulfilled') THEN po.status
              WHEN r.total_lines = 0 THEN po.status
              WHEN r.fully_received = r.total_lines THEN 'fulfilled'
              WHEN r.any_received > 0 THEN 'partial'
              ELSE 'sent'
            END,
            fulfilled_at = CASE
              WHEN r.total_lines > 0 AND r.fully_received = r.total_lines THEN now()
              ELSE po.fulfilled_at
            END
       FROM (
         SELECT count(*)::int AS total_lines,
                count(*) FILTER (WHERE qty_received >= qty_ordered AND qty_ordered > 0)::int AS fully_received,
                count(*) FILTER (WHERE qty_received > 0)::int AS any_received
           FROM purchase_order_lines WHERE purchase_order_id = $1
       ) r
      WHERE po.id = $1`,
    [poId],
  );
}

// The purchase-order email a vendor receives. One composer for Joe's
// "Send to vendor" (lib/send-ops.ts) and a PO committed through its purchase
// decision (lib/procurement/commitments.ts commitOnApproval), whose intent
// used to carry no subject or body, so the email provider refused it. Pure.

import type { Run } from "../commands/core.ts";
import { fmtUsd } from "../cost-book-units.ts";

export interface PoEmail {
  to: string;
  subject: string;
  body: string;
}

export type PoForEmail =
  | { ok: true; po: { po_number: string; vendor_name: string; subtotal: number; slug: string; project_name: string; project_id: string }; email: PoEmail }
  | { ok: false; error: string };

/** A draft/queued PO and its default email. The recipient falls back from the
 *  PO's own address to the saved vendor's / sub's email. */
export async function composePoEmail(run: Run, id: number, slug?: string | null): Promise<PoForEmail> {
  const [po] = await run<{ po_number: string; title: string; notes: string; vendor_name: string; vendor_email: string; status: string; subtotal: number; slug: string; project_name: string; project_id: string }>(
    `SELECT po.po_number, po.title, po.notes, po.vendor_name, po.status, po.subtotal, p.id AS project_id,
            COALESCE(NULLIF(trim(po.vendor_email), ''), NULLIF(trim(v.email), ''), NULLIF(trim(s.email), ''), '') AS vendor_email,
            p.slug, p.name AS project_name
       FROM purchase_orders po
       JOIN projects p ON p.id = po.project_id
       LEFT JOIN vendors v ON po.vendor_kind = 'vendor' AND v.id = po.vendor_id
       LEFT JOIN subs s ON po.vendor_kind = 'sub' AND s.slug = po.sub_slug
      WHERE po.id = $1 AND ($2::text IS NULL OR p.slug = $2)`,
    [id, slug ?? null],
  );
  if (!po) return { ok: false, error: "Purchase order not found." };
  if (!["draft", "queued"].includes(po.status)) return { ok: false, error: "This purchase order has already been sent." };
  const lines = await run<{ description: string; unit: string; qty_ordered: string; unit_cost: number; extended: number }>(
    `SELECT description, unit, qty_ordered, unit_cost, extended FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY sort_order, id`,
    [id],
  );
  if (lines.length === 0) return { ok: false, error: "Add at least one line before sending." };
  const lineText = lines.map((l) => `  • ${l.description}: ${Number(l.qty_ordered)} ${l.unit} × ${fmtUsd(l.unit_cost)} = ${fmtUsd(l.extended)}`).join("\n");
  const body =
    `${po.po_number} — ${po.title}\n${po.project_name}\n\n${lineText}\n\n` +
    `Total: ${fmtUsd(po.subtotal)}\n\n` +
    `${po.notes ? `${po.notes}\n\n` : ""}` +
    `Please confirm receipt and expected delivery. Thank you!\n\nBest,\nJoe\nSJ Carpentry`;
  return {
    ok: true,
    po: { po_number: po.po_number, vendor_name: po.vendor_name, subtotal: Number(po.subtotal), slug: po.slug, project_name: po.project_name, project_id: po.project_id },
    email: { to: po.vendor_email.toLowerCase(), subject: `Purchase Order ${po.po_number} — ${po.project_name}`, body },
  };
}

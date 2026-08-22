// Send cores for purchase orders and invoices — the email + status flip,
// WITHOUT a session check. Two callers:
//   • the owner-clicked server actions (lib/actions/purchase-orders.ts,
//     lib/actions/money.ts), which requireRole("owner") first;
//   • the agent path (lib/agent-sends.ts), which has already spent an owner
//     grant (lib/owner-grants.ts) for this exact target.
// Nothing else may call these: they reach a real inbox.

import { query, queryOne } from "@/lib/db";
import { emit } from "@/lib/notify";
import { gmailConfigured, sendNewEmail } from "@/lib/gmail";
import { usd, type InvoiceLine } from "@/lib/money";
import { fmtPoUsd } from "@/lib/po-types";
import { fmtUsd } from "@/lib/cost-book-units";

export type SendOpResult = { ok: true; summary: string } | { ok: false; error: string };

/** Email a draft/queued PO to its vendor and mark it sent. */
export async function sendPurchaseOrderOp(id: number, slug?: string): Promise<SendOpResult> {
  const po = await queryOne<{
    id: string;
    po_number: string;
    title: string;
    notes: string;
    vendor_name: string;
    vendor_email: string;
    status: string;
    subtotal: number;
    slug: string;
    project_name: string;
  }>(
    `SELECT po.id, po.po_number, po.title, po.notes, po.vendor_name, po.vendor_email, po.status, po.subtotal,
            p.slug, p.name AS project_name
       FROM purchase_orders po JOIN projects p ON p.id = po.project_id
      WHERE po.id = $1 AND ($2::text IS NULL OR p.slug = $2)`,
    [id, slug ?? null],
  );
  if (!po) return { ok: false, error: "Purchase order not found." };
  if (!["draft", "queued"].includes(po.status)) {
    return { ok: false, error: "This purchase order has already been sent." };
  }
  if (!po.vendor_email) return { ok: false, error: "No vendor email on file for this purchase order." };
  if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };

  const { rows: lines } = await query<{
    description: string;
    unit: string;
    qty_ordered: string;
    unit_cost: number;
    extended: number;
  }>(
    `SELECT description, unit, qty_ordered, unit_cost, extended
       FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY sort_order, id`,
    [id],
  );
  if (lines.length === 0) return { ok: false, error: "Add at least one line before sending." };

  const lineText = lines
    .map((l) => `  • ${l.description}: ${Number(l.qty_ordered)} ${l.unit} × ${fmtUsd(l.unit_cost)} = ${fmtUsd(l.extended)}`)
    .join("\n");
  const body =
    `${po.po_number} — ${po.title}\n${po.project_name}\n\n${lineText}\n\n` +
    `Total: ${fmtPoUsd(po.subtotal)}\n\n` +
    `${po.notes ? `${po.notes}\n\n` : ""}` +
    `Please confirm receipt and expected delivery. Thank you!\n\nBest,\nJoe\nSJ Carpentry`;

  try {
    await sendNewEmail({
      to: po.vendor_email.trim(),
      subject: `Purchase Order ${po.po_number} — ${po.project_name}`,
      bodyText: body,
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message || "Could not send the purchase order." };
  }

  await query(`UPDATE purchase_orders SET status = 'sent', sent_at = now() WHERE id = $1`, [id]);
  await emit({
    kind: "money",
    tag: "Money",
    accent: "money",
    icon: "money",
    title: `PO ${po.po_number} sent · ${po.project_name}`,
    subline: `${fmtPoUsd(po.subtotal)} · ${po.vendor_name}`,
    href: `/projects/${po.slug}`,
  });
  return { ok: true, summary: `PO ${po.po_number} emailed to ${po.vendor_name} <${po.vendor_email}>` };
}

interface InvoiceJoin {
  number: string;
  milestone: string;
  amount: number;
  line_items: InvoiceLine[];
  status: string;
  slug: string;
  project_name: string;
}

/** Email a drafted invoice to the project's client and mark it sent. */
export async function sendInvoiceOp(id: number): Promise<SendOpResult> {
  const inv = await queryOne<InvoiceJoin>(
    `SELECT i.number, i.milestone, i.amount, i.line_items, i.status,
            p.slug, p.name AS project_name
       FROM invoices i JOIN projects p ON p.id = i.project_id
      WHERE i.id = $1`,
    [id],
  );
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status !== "draft") return { ok: false, error: `Invoice ${inv.number} is already ${inv.status}.` };

  const client = await queryOne<{ email: string; name: string }>(
    `SELECT email, name FROM users WHERE link_slug = $1 AND role = 'client' AND active = true LIMIT 1`,
    [inv.slug],
  );
  if (!client?.email) return { ok: false, error: "No client email on file for this project." };
  if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };

  const first = client.name.split(/\s+/)[0] || "there";
  const lineText = (inv.line_items ?? []).map((l) => `  • ${l.label}: ${usd(l.amount)}`).join("\n");
  const body =
    `Hi ${first},\n\nPlease find the invoice for "${inv.milestone}" on the ` +
    `${inv.project_name} project below.\n\n${lineText}\n\nTotal due: ${usd(inv.amount)}\n\n` +
    `You can reply here with any questions. Thank you!\n\nBest,\nJoe\nSJ Carpentry`;

  try {
    await sendNewEmail({
      to: client.email.trim(),
      subject: `Invoice ${inv.number} — ${inv.project_name} (${inv.milestone})`,
      bodyText: body,
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message || "Could not send the invoice." };
  }

  await query(`UPDATE invoices SET status = 'sent', sent_at = now() WHERE id = $1`, [id]);
  await emit({
    kind: "money",
    tag: "Money",
    accent: "money",
    icon: "money",
    title: `Invoice ${inv.number} sent · ${inv.project_name}`,
    subline: `${usd(inv.amount)} · ${inv.milestone}`,
    href: `/projects/${inv.slug}`,
  });
  return { ok: true, summary: `Invoice ${inv.number} emailed to ${client.name} <${client.email}>` };
}

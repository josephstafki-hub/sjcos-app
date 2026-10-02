// Send cores for purchase orders and invoices — WITHOUT a session check. Two
// callers:
//   • the owner-clicked server actions (lib/actions/purchase-orders.ts,
//     lib/actions/money.ts), which requireAccess first — the click is the
//     decision, recorded as the intent's `owner` auth ref;
//   • the agent path (lib/agent-sends.ts), which passes the owner grant the
//     dispatcher spends at dispatch time.
// Nothing else may call these: they reach a real inbox.
//
// Since A05/A06 neither function calls Gmail. Each stages ONE permanent
// intent keyed on the record + its content revision, dispatches it inline,
// and reports the provider's real answer. The status flip (invoices.status /
// purchase_orders.status → 'sent') happens in lib/dispatch/effects.ts and
// ONLY when the provider accepted the message; a failure or an unknown
// outcome never reports "sent".

import { createHash } from "node:crypto";
import { query, queryOne } from "@/lib/db";
import { gmailConfigured } from "@/lib/gmail";
import { renderProjectInvoicePdf } from "@/lib/doc-drafts";
import { renderInlineDocPdf } from "@/lib/documents";
import { storeBuffer } from "@/lib/upload-store";
import { usd, type InvoiceLine } from "@/lib/money";
import { fmtPoUsd } from "@/lib/po-types";
import { fmtUsd } from "@/lib/cost-book-units";
import { withTransaction } from "@/lib/commands/db";
import { enqueueIntent, IntentPayloadMismatchError } from "@/lib/commands/intents";
import type { Principal } from "@/lib/commands/principal";
import { describeOutcome, dispatchIntentsNow } from "@/lib/dispatch/db";

export type SendOpResult = { ok: true; summary: string; intent_id?: string } | { ok: false; error: string; held?: boolean; intent_id?: string };

/** Who authorised the send. Omitted = the owner's own click (the caller
 *  already required access). */
export interface SendAuth {
  grantId?: string | null;
  decisionId?: string | null;
  /** 'owner' | 'mcp:<agent>' for the audit line. */
  actor?: string;
}

function principalFor(auth?: SendAuth): Principal {
  const actor = auth?.actor ?? "owner";
  if (actor.startsWith("mcp:")) return { kind: "agent", agent: actor.slice(4), runId: null, onBehalfOf: null };
  return { kind: "service", name: `send-ops:${actor}` };
}

const rev = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

/** Email a draft/queued PO to its vendor; it is marked sent when Gmail accepts. */
export async function sendPurchaseOrderOp(id: number, slug?: string, auth?: SendAuth): Promise<SendOpResult> {
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
  const to = po.vendor_email.trim().toLowerCase();
  const subject = `Purchase Order ${po.po_number} — ${po.project_name}`;
  const revision = rev(`${to}\n${subject}\n${body}`);
  const payload = {
    to,
    subject,
    bodyText: body,
    po_number: po.po_number,
    project_name: po.project_name,
    vendor_name: po.vendor_name,
    amount_label: fmtPoUsd(po.subtotal),
    slug: po.slug,
    _auth: { action: "send_purchase_order", target_kind: "purchase_order", target_id: String(id), amount_cents: Number(po.subtotal) },
  };
  return stageAndSend({
    operationKey: `po:${id}:send:${revision}`,
    kind: "send_purchase_order",
    targetKind: "purchase_order",
    targetId: String(id),
    recipient: to,
    payload,
    auth,
    what: `PO ${po.po_number} to ${po.vendor_name} <${po.vendor_email}>`,
  });
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

/** Email a drafted invoice to the project's client; it is marked sent when Gmail accepts. */
export async function sendInvoiceOp(id: number, auth?: SendAuth): Promise<SendOpResult> {
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
  const to = client.email.trim().toLowerCase();
  const subject = `Invoice ${inv.number} — ${inv.project_name} (${inv.milestone})`;
  const revision = rev(`${to}\n${subject}\n${lineText}\n${inv.amount}`);

  // The intent payload is JSON: the PDF is rendered ONCE per revision, kept
  // in the project Files (as the sent copy always was) and referenced by id.
  // A retry of the same revision reuses the stored file.
  const attachments: { filename: string; mimeType: string; fileId: string }[] = [];
  const existing = await queryOne<{ id: string }>(`SELECT id FROM files WHERE subtitle = $1 LIMIT 1`, [`Invoice — sent to client · ${inv.milestone} · rev ${revision}`]);
  if (existing) attachments.push({ filename: `Invoice ${inv.number}.pdf`, mimeType: "application/pdf", fileId: existing.id });
  else {
    const pdf =
      (await renderProjectInvoicePdf(inv.slug, id).catch(() => null)) ??
      (await renderInlineDocPdf({
        title: `Invoice ${inv.number}`,
        subtitle: `${inv.project_name} — ${inv.milestone}`,
        body: `${lineText}\n\nTotal due: ${usd(inv.amount)}`,
      }).catch(() => null));
    if (pdf) {
      const stored = await storeBuffer(pdf, {
        filename: `${inv.project_name} — Invoice ${inv.number}.pdf`,
        mime: "application/pdf",
        idPrefix: "doc",
        projectKey: inv.slug,
        tag: "INVOICE",
        subtitle: `Invoice — sent to client · ${inv.milestone} · rev ${revision}`,
      });
      if (stored.ok && stored.id) attachments.push({ filename: `Invoice ${inv.number}.pdf`, mimeType: "application/pdf", fileId: stored.id });
    }
  }

  const body =
    `Hi ${first},\n\nPlease find invoice ${inv.number} for "${inv.milestone}" on the ` +
    `${inv.project_name} project ${attachments.length ? "attached. A summary is below." : "below."}\n\n` +
    `${lineText}\n\nTotal due: ${usd(inv.amount)}\n\n` +
    `You can reply here with any questions. Thank you!\n\nBest,\nJoe\nSJ Carpentry`;
  const payload = {
    to,
    subject,
    bodyText: body,
    attachments,
    number: inv.number,
    milestone: inv.milestone,
    project_name: inv.project_name,
    amount_label: usd(inv.amount),
    slug: inv.slug,
    _auth: { action: "send_invoice", target_kind: "invoice", target_id: String(id), amount_cents: Number(inv.amount) },
  };
  return stageAndSend({
    operationKey: `invoice:${id}:send:${revision}`,
    kind: "send_invoice",
    targetKind: "invoice",
    targetId: String(id),
    recipient: to,
    payload,
    auth,
    what: `Invoice ${inv.number} to ${client.name} <${client.email}>`,
  });
}

/** Stage the intent (idempotent on the operation key) and dispatch it now. */
async function stageAndSend(p: {
  operationKey: string;
  kind: string;
  targetKind: string;
  targetId: string;
  recipient: string;
  payload: Record<string, unknown>;
  auth?: SendAuth;
  what: string;
}): Promise<SendOpResult> {
  let intentId: string;
  try {
    const { intent } = await withTransaction((run) =>
      enqueueIntent(run, {
        operationKey: p.operationKey,
        kind: p.kind,
        targetKind: p.targetKind,
        targetId: p.targetId,
        recipient: p.recipient,
        payload: p.payload,
        grantId: p.auth?.grantId ?? null,
        decisionId: p.auth?.decisionId ?? null,
        policyRef: p.auth?.grantId || p.auth?.decisionId ? null : `owner:${p.auth?.actor ?? "click"}`,
        principal: principalFor(p.auth),
      }),
    );
    intentId = intent.id;
    if (intent.state === "accepted" || intent.state === "confirmed") return { ok: true, summary: `${p.what} — already ${intent.state}.`, intent_id: intent.id };
    if (intent.state === "unknown") return { ok: false, held: true, intent_id: intent.id, error: `${p.what}: an earlier attempt is held with an unknown outcome; it is being reconciled and must not be resent.` };
  } catch (err) {
    if (err instanceof IntentPayloadMismatchError) return { ok: false, error: err.message };
    return { ok: false, error: (err as Error).message };
  }
  const [outcome] = await dispatchIntentsNow([intentId]);
  const d = describeOutcome(outcome, p.what);
  return d.ok ? { ok: true, summary: d.summary, intent_id: intentId } : { ok: false, error: d.error, held: d.held, intent_id: intentId };
}

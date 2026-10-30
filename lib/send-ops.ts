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
import { usd } from "@/lib/money";
import { fmtPoUsd } from "@/lib/po-types";
import { fmtUsd } from "@/lib/cost-book-units";
import { runDirect, withTransaction } from "@/lib/commands/db";
import {
  invoiceEmailBody,
  invoiceEmailPayload,
  invoiceEmailRevision,
  invoiceSendBlock,
  loadInvoiceEmail,
  type InvoiceEmail,
  type InvoiceEmailExtras,
} from "@/lib/billing/invoice-email";
import { enqueueIntent, IntentPayloadMismatchError } from "@/lib/commands/intents";
import type { Principal } from "@/lib/commands/principal";
import { describeOutcome, dispatchIntentsNow } from "@/lib/dispatch/db";
import { invoicePayLink } from "@/lib/client-invites";
import { portalPaymentSetup } from "@/lib/payments/server";
import { surchargeNotice } from "@/lib/payments/surcharge";

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

/** The email a PO send would put in the vendor's inbox. The owner can edit any
 *  of it before sending (Send to vendor opens it first); an agent can pass the
 *  same overrides to send_purchase_order. */
export interface PoEmail {
  to: string;
  subject: string;
  body: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type PoForEmail =
  | { ok: true; po: { po_number: string; vendor_name: string; subtotal: number; slug: string; project_name: string }; email: PoEmail }
  | { ok: false; error: string };

/** Load a draft/queued PO and build its default email. The recipient falls
 *  back from the PO's own address to the saved vendor's / sub's email. */
async function loadPoEmail(id: number, slug?: string): Promise<PoForEmail> {
  const po = await queryOne<{
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
    `SELECT po.po_number, po.title, po.notes, po.vendor_name, po.status, po.subtotal,
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
  if (!["draft", "queued"].includes(po.status)) {
    return { ok: false, error: "This purchase order has already been sent." };
  }

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
    `Total: ${fmtUsd(po.subtotal)}\n\n` +
    `${po.notes ? `${po.notes}\n\n` : ""}` +
    `Please confirm receipt and expected delivery. Thank you!\n\nBest,\nJoe\nSJ Carpentry`;
  return {
    ok: true,
    po,
    email: {
      to: po.vendor_email.toLowerCase(),
      subject: `Purchase Order ${po.po_number} — ${po.project_name}`,
      body,
    },
  };
}

/** The default email for a PO, for the owner to review/edit before sending. */
export async function previewPurchaseOrderEmail(id: number, slug?: string): Promise<{ ok: true; email: PoEmail } | { ok: false; error: string }> {
  const r = await loadPoEmail(id, slug);
  return r.ok ? { ok: true, email: r.email } : r;
}

/** Email a draft/queued PO to its vendor; it is marked sent when Gmail accepts.
 *  `edit` replaces any of the default To / Subject / Body (blank = keep the
 *  default). A new To is saved on the PO so the record shows where it went. */
export async function sendPurchaseOrderOp(id: number, slug?: string, auth?: SendAuth, edit?: Partial<PoEmail>): Promise<SendOpResult> {
  const loaded = await loadPoEmail(id, slug);
  if (!loaded.ok) return loaded;
  const { po } = loaded;
  const to = (edit?.to?.trim() || loaded.email.to).toLowerCase();
  const subject = edit?.subject?.trim() || loaded.email.subject;
  const body = edit?.body?.trim() || loaded.email.body;
  if (!to) return { ok: false, error: "No vendor email on file for this purchase order." };
  if (!EMAIL_RE.test(to)) return { ok: false, error: `"${to}" is not a valid email address.` };
  if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };

  await query(
    `UPDATE purchase_orders SET vendor_email = $2 WHERE id = $1 AND status IN ('draft','queued') AND vendor_email IS DISTINCT FROM $2`,
    [id, to],
  );

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
    what: `PO ${po.po_number} to ${po.vendor_name} <${to}>`,
  });
}

/** The email sendInvoiceOp would put in the client's inbox — for approval
 *  cards. Read-only: the pay link is shown as a placeholder (minting the real
 *  one can create a portal invite). */
export async function previewInvoiceEmail(id: number): Promise<{ ok: true; email: PoEmail; clientName: string } | { ok: false; error: string }> {
  const e = await loadInvoiceEmail(runDirect, id);
  if (!e) return { ok: false, error: "Invoice not found." };
  const setup = await portalPaymentSetup().catch(() => null);
  const online = !!setup?.online;
  return {
    ok: true,
    clientName: e.client.name,
    email: {
      to: e.client.email ?? "",
      subject: e.subject,
      body: invoiceEmailBody({ name: e.client.name, inv: e, lineText: e.lineText, attached: true, payUrl: online ? "[link to pay this invoice online]" : null, surchargeNote: setup?.online && setup.card ? surchargeNotice(setup.surcharge) : null }),
    },
  };
}

/** The parts of an invoice email that need the app: the PDF (rendered from
 *  the stored invoice), the portal pay link and Square's card-surcharge line.
 *  sendInvoiceOp uses it, and the billing commands load it for the invoices
 *  they issue on their own (lib/billing/commands.ts enqueueSend). */
export async function invoiceEmailExtras(e: InvoiceEmail): Promise<InvoiceEmailExtras> {
  const revision = invoiceEmailRevision(e);
  // The intent payload is JSON: the PDF is rendered ONCE per revision, kept
  // in the project Files (as the sent copy always was) and referenced by id.
  // A retry of the same revision reuses the stored file.
  const attachments: InvoiceEmailExtras["attachments"] = [];
  const existing = await queryOne<{ id: string }>(`SELECT id FROM files WHERE subtitle = $1 LIMIT 1`, [`Invoice — sent to client · ${e.milestone} · rev ${revision}`]);
  if (existing) attachments.push({ filename: `Invoice ${e.number}.pdf`, mimeType: "application/pdf", fileId: existing.id });
  else {
    const pdf =
      (await renderProjectInvoicePdf(e.slug, e.id).catch(() => null)) ??
      (await renderInlineDocPdf({
        title: `Invoice ${e.number}`,
        subtitle: `${e.project_name} — ${e.milestone}`,
        body: `${e.lineText}\n\nTotal due: ${usd(e.amount)}`,
      }).catch(() => null));
    if (pdf) {
      const stored = await storeBuffer(pdf, {
        filename: `${e.project_name} — Invoice ${e.number}.pdf`,
        mime: "application/pdf",
        idPrefix: "doc",
        projectKey: e.slug,
        tag: "INVOICE",
        subtitle: `Invoice — sent to client · ${e.milestone} · rev ${revision}`,
      });
      if (stored.ok && stored.id) attachments.push({ filename: `Invoice ${e.number}.pdf`, mimeType: "application/pdf", fileId: stored.id });
    }
  }

  // Square connected → a link straight to this invoice's pay page in the
  // portal. A link failure leaves the invoice email as it always was.
  const setup = await portalPaymentSetup().catch(() => null);
  const payUrl = setup?.online ? await invoicePayLink(e.slug, e.id).catch(() => null) : null;
  const surchargeNote = setup?.online && setup.card ? surchargeNotice(setup.surcharge) : null;
  return { attachments, payUrl, surchargeNote };
}

/** Email an invoice to the project's client; it is marked sent when Gmail
 *  accepts. A draft, or an issued invoice that never went out (billing found
 *  no client email, or its send failed). */
export async function sendInvoiceOp(id: number, auth?: SendAuth): Promise<SendOpResult> {
  const e = await loadInvoiceEmail(runDirect, id);
  if (!e) return { ok: false, error: "Invoice not found." };
  const blocked = invoiceSendBlock(e);
  if (blocked) return { ok: false, error: blocked };
  if (!e.client.email) return { ok: false, error: "No client email on file for this project." };
  if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };

  const payload = invoiceEmailPayload(e, await invoiceEmailExtras(e));
  // A resend of an unchanged invoice whose earlier send died for good (Gmail
  // down, provider refused) needs a fresh intent: the dead one never
  // dispatches again. invoiceSendBlock above has already refused anything
  // that may have gone out (accepted, delivered, unknown, live queue).
  const baseKey = `invoice:${id}:send:${invoiceEmailRevision(e)}`;
  const dead = (await queryOne<{ dead: number }>(
    `SELECT count(*)::int AS dead FROM action_intents
      WHERE (operation_key = $1 OR operation_key LIKE $1 || ':retry%') AND state IN ('permanent_failure','cancelled')`,
    [baseKey],
  ))?.dead ?? 0;
  return stageAndSend({
    operationKey: dead > 0 ? `${baseKey}:retry${dead}` : baseKey,
    kind: "send_invoice",
    targetKind: "invoice",
    targetId: String(id),
    recipient: e.client.email,
    payload,
    auth,
    what: `Invoice ${e.number} to ${e.client.name} <${e.client.email}>`,
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

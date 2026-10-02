// Delivery tracking: acknowledgement, receipt (partial / late / wrong /
// revised — each its own row), review and acceptance (A13). Pure `run`.
// Multiple orders per vendor stay distinct because every row hangs off one
// commitment id; nothing here makes anything payable.

import type { Run } from "../commands/core.ts";
import { principalLabel, type Principal } from "../commands/principal.ts";
import { getCommitment } from "./commitments.ts";
import type { Commitment, Delivery, DeliveryLine } from "./types.ts";

const DELIVERY_COLS = `id, commitment_id, kind, received_at::text AS received_at, lines, late, wrong, revised, reviewed, accepted, issues, evidence, recorded_by`;

export interface AcknowledgementInput {
  commitmentId: number;
  promisedDate?: string | null; // YYYY-MM-DD
  via: "email" | "phone" | "portal" | "in_person" | "other";
  note?: string;
  evidenceFileId?: string | null;
  principal: Principal;
}

export async function recordAcknowledgement(run: Run, input: AcknowledgementInput): Promise<{ ok: true; delivery: Delivery; commitment: Commitment } | { ok: false; reason: string }> {
  const c = await getCommitment(run, input.commitmentId, { forUpdate: true });
  if (!c) return { ok: false, reason: "No such commitment." };
  if (["draft", "approved", "void"].includes(c.state)) return { ok: false, reason: `Commitment is ${c.state}; it has not been placed yet.` };
  const ack = { at: new Date().toISOString(), via: input.via, note: input.note ?? "", evidenceFileId: input.evidenceFileId ?? null };
  const [d] = await run<Delivery>(
    `INSERT INTO deliveries (commitment_id, kind, evidence, recorded_by) VALUES ($1, 'acknowledgement', $2::jsonb, $3) RETURNING ${DELIVERY_COLS}`,
    [c.id, JSON.stringify(ack), principalLabel(input.principal)],
  );
  const [updated] = await run<Commitment>(
    `UPDATE commitments SET acknowledgement = $2::jsonb, promised_date = COALESCE($3::date, promised_date),
            state = CASE WHEN state = 'committed' THEN 'acknowledged' ELSE state END, updated_at = now()
      WHERE id = $1 RETURNING id, state, promised_date::text AS promised_date`,
    [c.id, JSON.stringify(ack), input.promisedDate ?? null],
  );
  return { ok: true, delivery: d, commitment: { ...c, state: updated.state, promised_date: updated.promised_date, acknowledgement: ack } };
}

export interface DeliveryInput {
  commitmentId: number;
  lines: DeliveryLine[];
  receivedAt?: string | null;
  wrong?: boolean;
  revised?: boolean;
  issues?: string[];
  evidenceFileIds?: string[];
  note?: string;
  principal: Principal;
}

function receivedTotals(items: Commitment["items"], deliveries: Delivery[]): { orderedQty: number; receivedQty: number; complete: boolean } {
  const ordered = new Map<string, number>();
  for (const i of items) ordered.set(i.lineId != null ? `line:${i.lineId}` : i.description.toLowerCase(), (ordered.get(i.lineId != null ? `line:${i.lineId}` : i.description.toLowerCase()) ?? 0) + i.qty);
  const received = new Map<string, number>();
  for (const d of deliveries) {
    if (d.kind !== "receipt" || d.wrong) continue;
    for (const l of d.lines) {
      const key = l.lineId != null ? `line:${l.lineId}` : l.description.toLowerCase();
      received.set(key, (received.get(key) ?? 0) + Number(l.qtyReceived || 0));
    }
  }
  let orderedQty = 0;
  let receivedQty = 0;
  let complete = true;
  if (!ordered.size) {
    // Service deliverables (a sub award) have no itemised order: any accepted
    // receipt is partial progress; completion is Joe's review, never inferred.
    const got = [...received.values()].reduce((s, q) => s + q, 0);
    return { orderedQty: 0, receivedQty: got, complete: false };
  }
  for (const [k, q] of ordered) {
    orderedQty += q;
    const r = Math.min(q, received.get(k) ?? 0);
    receivedQty += r;
    if (r < q) complete = false;
  }
  // Receipts that name something not on the itemised order (a service
  // deliverable described in the vendor's words) are partial progress, never
  // completion — Joe's review decides what they were worth.
  const unmatched = [...received.entries()].filter(([k]) => !ordered.has(k)).reduce((s, [, q]) => s + q, 0);
  if (unmatched > 0) {
    receivedQty += unmatched;
    complete = false;
  }
  return { orderedQty, receivedQty, complete };
}

/** Record what actually arrived. Partial, late, wrong and revised are all
 *  distinct facts on the row; the commitment state follows the running total. */
export async function recordDelivery(run: Run, input: DeliveryInput): Promise<{ ok: true; delivery: Delivery; commitment: Commitment; late: boolean; complete: boolean } | { ok: false; reason: string }> {
  const c = await getCommitment(run, input.commitmentId, { forUpdate: true });
  if (!c) return { ok: false, reason: "No such commitment." };
  if (["draft", "approved", "void"].includes(c.state)) return { ok: false, reason: `Commitment is ${c.state}; nothing can be received against it.` };
  if (!input.lines.length) return { ok: false, reason: "A delivery needs at least one line." };
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  // Late = the ORDER arrived after its promise. A wrong shipment or a vendor's
  // re-ship correction is recorded on its own flag, not as lateness.
  const late = !input.wrong && !input.revised && Boolean(c.promised_date) && receivedAt.toISOString().slice(0, 10) > String(c.promised_date);
  const [d] = await run<Delivery>(
    `INSERT INTO deliveries (commitment_id, kind, received_at, lines, late, wrong, revised, issues, evidence, recorded_by)
     VALUES ($1, 'receipt', $2, $3::jsonb, $4, $5, $6, $7::jsonb, $8::jsonb, $9) RETURNING ${DELIVERY_COLS}`,
    [c.id, receivedAt.toISOString(), JSON.stringify(input.lines), late, Boolean(input.wrong), Boolean(input.revised), JSON.stringify(input.issues ?? []),
      JSON.stringify({ fileIds: input.evidenceFileIds ?? [], note: input.note ?? "" }), principalLabel(input.principal)],
  );
  // Mirror quantities onto PO lines when the delivery names them.
  if (c.kind === "purchase_order" && !input.wrong) {
    for (const l of input.lines) {
      if (l.lineId != null) {
        await run(`UPDATE purchase_order_lines SET qty_received = LEAST(qty_ordered, qty_received + $2) WHERE id = $1 AND purchase_order_id = $3`, [l.lineId, Number(l.qtyReceived || 0), Number(c.ref)]);
      }
    }
    await run(
      `UPDATE purchase_orders po SET status = CASE
          WHEN po.status NOT IN ('sent','partial','fulfilled','queued') THEN po.status
          WHEN r.total = 0 THEN po.status
          WHEN r.full = r.total THEN 'fulfilled'
          WHEN r.any > 0 THEN 'partial' ELSE po.status END,
          fulfilled_at = CASE WHEN r.total > 0 AND r.full = r.total THEN now() ELSE po.fulfilled_at END
        FROM (SELECT count(*)::int AS total,
                     count(*) FILTER (WHERE qty_received >= qty_ordered AND qty_ordered > 0)::int AS full,
                     count(*) FILTER (WHERE qty_received > 0)::int AS any
                FROM purchase_order_lines WHERE purchase_order_id = $1) r
       WHERE po.id = $1`,
      [Number(c.ref)],
    );
  }
  const all = await listDeliveries(run, c.id);
  const totals = receivedTotals(c.items, all);
  const nextState = input.wrong ? c.state : totals.complete ? "delivered" : totals.receivedQty > 0 ? "partially_delivered" : c.state;
  const [updated] = await run<{ state: Commitment["state"] }>(
    `UPDATE commitments SET state = CASE WHEN state IN ('committed','acknowledged','partially_delivered') THEN $2 ELSE state END, updated_at = now() WHERE id = $1 RETURNING state`,
    [c.id, nextState],
  );
  return { ok: true, delivery: d, commitment: { ...c, state: updated.state }, late, complete: totals.complete };
}

export interface ReviewInput {
  deliveryId: number;
  accepted: boolean;
  issues?: string[];
  note?: string;
  principal: Principal;
}

/** Review a receipt: accepted or not, with issues. Acceptance of everything
 *  received flips the commitment to 'accepted' (a prerequisite for payable). */
export async function reviewDelivery(run: Run, input: ReviewInput): Promise<{ ok: true; delivery: Delivery; commitmentState: Commitment["state"] } | { ok: false; reason: string }> {
  const [d] = await run<Delivery>(`SELECT ${DELIVERY_COLS} FROM deliveries WHERE id = $1 FOR UPDATE`, [input.deliveryId]);
  if (!d) return { ok: false, reason: "No such delivery." };
  if (d.kind !== "receipt") return { ok: false, reason: "Only a receipt can be reviewed." };
  const [upd] = await run<Delivery>(
    `UPDATE deliveries SET reviewed = true, accepted = $2, issues = CASE WHEN $3::jsonb = '[]'::jsonb THEN issues ELSE $3::jsonb END,
            evidence = evidence || $4::jsonb WHERE id = $1 RETURNING ${DELIVERY_COLS}`,
    [d.id, input.accepted, JSON.stringify(input.issues ?? []), JSON.stringify({ reviewNote: input.note ?? "", reviewedBy: principalLabel(input.principal) })],
  );
  const c = await getCommitment(run, Number(d.commitment_id), { forUpdate: true });
  if (!c) return { ok: false, reason: "Commitment vanished." };
  const all = await listDeliveries(run, c.id);
  const receipts = all.filter((x) => x.kind === "receipt" && !x.wrong);
  const allReviewed = receipts.length > 0 && receipts.every((x) => x.reviewed);
  const allAccepted = allReviewed && receipts.every((x) => x.accepted);
  const totals = receivedTotals(c.items, all);
  let next = c.state;
  if (["partially_delivered", "delivered", "reviewed", "acknowledged", "committed"].includes(c.state)) {
    if (allAccepted && totals.complete) next = "accepted";
    else if (allReviewed) next = "reviewed";
  }
  if (next !== c.state) await run(`UPDATE commitments SET state = $2, updated_at = now() WHERE id = $1`, [c.id, next]);
  return { ok: true, delivery: upd, commitmentState: next };
}

export async function listDeliveries(run: Run, commitmentId: number): Promise<Delivery[]> {
  const rows = await run<Delivery>(`SELECT ${DELIVERY_COLS} FROM deliveries WHERE commitment_id = $1 ORDER BY id`, [commitmentId]);
  return rows.map((r) => ({ ...r, id: Number(r.id), commitment_id: Number(r.commitment_id), lines: Array.isArray(r.lines) ? r.lines : [], issues: Array.isArray(r.issues) ? r.issues : [] }));
}

/** Value of accepted deliveries in cents — the ceiling for what a matched
 *  bill can make payable. Service deliverables carry amountCents per line;
 *  goods use qty × the commitment's unit price (+ tax/shipping pro-rata once
 *  complete). */
export async function acceptedValueCents(run: Run, c: Commitment): Promise<number> {
  const all = await listDeliveries(run, c.id);
  const unitByKey = new Map<string, number>();
  for (const i of c.items) unitByKey.set(i.lineId != null ? `line:${i.lineId}` : i.description.toLowerCase(), i.unitCents);
  let value = 0;
  for (const d of all) {
    if (d.kind !== "receipt" || !d.accepted || d.wrong) continue;
    for (const l of d.lines) {
      if (l.amountCents != null) value += Math.round(Number(l.amountCents));
      else {
        const key = l.lineId != null ? `line:${l.lineId}` : l.description.toLowerCase();
        value += Math.round(Number(l.qtyReceived || 0) * (unitByKey.get(key) ?? 0));
      }
    }
  }
  if (c.state === "accepted" || c.state === "payable" || c.state === "paid") value += c.tax_cents + c.shipping_cents;
  return Math.min(value, c.total_cents);
}

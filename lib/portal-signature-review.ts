import { query } from "./db";

export interface PortalSignatureReview {
  version: string | null;
  amountCents: number | null;
}

/** IDs must come from the current portal's scoped signature read. Use the
 * rendered document's stored fields, rather than today's mutable job total. */
export async function getPortalSignatureReviews(ids: number[]): Promise<Record<number, PortalSignatureReview>> {
  if (!ids.length) return {};
  const { rows } = await query<{
    id: string; template_version: string | null;
    field_values: Record<string, unknown> | null; co_price_cents: string | null;
  }>(`SELECT sr.id, d.template_version, d.field_values, co.price_cents::text AS co_price_cents
        FROM signature_requests sr
        LEFT JOIN change_orders co ON co.id = sr.change_order_id
        LEFT JOIN LATERAL (
          SELECT template_version, field_values FROM document_drafts
           WHERE signature_request_id = sr.id AND status <> 'void'
           ORDER BY id DESC LIMIT 1
        ) d ON true
       WHERE sr.id = ANY($1::bigint[])`, [ids]);
  return Object.fromEntries(rows.map((r) => {
    const f = r.field_values ?? {};
    // These are money_cents fields in the document templates. Do not parse
    // handwritten text or infer an amount from unrelated project records.
    // A change order sent without a generated document still has its own price
    // on the change order being signed — that is the amount the signature approves.
    const coPrice = r.co_price_cents == null ? null : Number(r.co_price_cents);
    const amount = [f.net_change, f.contract_total, f.precon_fee, f.total, f.total_due, f.rough_total, coPrice]
      .find((v) => typeof v === "number" && Number.isSafeInteger(v));
    return [Number(r.id), { version: r.template_version || null, amountCents: typeof amount === "number" ? amount : null }];
  }));
}

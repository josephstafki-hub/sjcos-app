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
    field_values: Record<string, unknown> | null;
  }>(`SELECT sr.id, d.template_version, d.field_values
        FROM signature_requests sr
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
    const amount = [f.net_change, f.contract_total, f.precon_fee, f.total, f.total_due, f.rough_total]
      .find((v) => typeof v === "number" && Number.isSafeInteger(v));
    return [Number(r.id), { version: r.template_version || null, amountCents: typeof amount === "number" ? amount : null }];
  }));
}

import { queryOne } from "./db";

/** Read the same Postgres job ledger as Money. Never sum invoice-only paid
 *  amounts into a project total: payments recorded outside invoices count too. */
export async function getPortalFinancials(slug: string) {
  const row = await queryOne<{
    total_cents: string; collected_cents: string; opening_total_cents: string;
    estimate_cents: string; change_orders_cents: string; precon_cents: string; payments_cents: string; opening_collected_cents: string;
  }>(`SELECT p.total_cents, p.collected_cents, p.opening_total_cents,
             mp.estimate_cents, mp.change_orders_cents, mp.precon_cents,
             mp.payments_cents, p.opening_collected_cents
        FROM projects p, LATERAL project_money_parts(p.id) mp WHERE p.slug = $1`, [slug]);
  if (!row) return null;
  const currentCents = Number(row.total_cents);
  const paidCents = Number(row.collected_cents);
  return {
    contractCents: Number(row.estimate_cents),
    otherAgreedCents: Number(row.opening_total_cents) + Number(row.precon_cents),
    changesCents: Number(row.change_orders_cents),
    invoicePaidCents: Number(row.payments_cents),
    outsidePaidCents: Number(row.opening_collected_cents),
    currentCents, paidCents, remainingCents: Math.max(0, currentCents - paidCents),
  };
}

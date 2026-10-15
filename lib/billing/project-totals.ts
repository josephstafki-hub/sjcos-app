// The projects-list money: projects.contract_value / collected_to_date (whole
// dollars), the "% billed" bar (projects.progress = collected ÷ contract) and
// the value_display label. Hand-kept until a job's contract starts; from then
// on the invoices drive them.
//
//   adoptContractTotals(run, projectId)
//     At construction start (lib/workflow/construction-start.ts). Total =
//     everything collected before the contract (the hand-kept figure: a
//     pre-con / design fee) + the approved formal estimate. The job switches to
//     invoice-tracked billing (the same switch as Money › Overview's
//     reconcile: billing_source 'invoices' with that pre-contract money as the
//     opening balance), so collected = opening + paid invoices from here on.
//     Mahowald, 2026-10-14: still read "$17,580 pre-con (remodel TBD)", 100%,
//     after a $475,116.64 contract was signed and its deposit paid.
//   syncCollectedFromInvoices(run, projectId)
//     After every payment (recordInvoicePayment). No-op for hand-kept jobs.
//
// Pure over run(sql, params).

import type { Run } from "../commands/core.ts";

const PROGRESS = (collected: string, contract: string) =>
  `CASE WHEN ${contract} > 0 THEN LEAST(100, ROUND(100.0 * ${collected} / ${contract}))::int ELSE progress END`;

function usd(cents: number): string {
  const whole = Number.isInteger(cents / 100);
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export async function syncCollectedFromInvoices(run: Run, projectId: string): Promise<{ collectedCents: number } | null> {
  const [r] = await run<{ collected: string }>(
    `UPDATE projects p
        SET collected_to_date = ROUND((p.opening_collected_cents + COALESCE((SELECT SUM(i.amount) FROM invoices i WHERE i.project_id = p.id AND i.status = 'paid'), 0)) / 100.0)::int,
            updated_at = now()
      WHERE p.id = $1 AND p.billing_source = 'invoices'
      RETURNING (p.opening_collected_cents + COALESCE((SELECT SUM(i.amount) FROM invoices i WHERE i.project_id = p.id AND i.status = 'paid'), 0))::text AS collected`,
    [projectId],
  );
  if (!r) return null;
  await run(`UPDATE projects SET progress = ${PROGRESS("collected_to_date", "contract_value")} WHERE id = $1`, [projectId]);
  return { collectedCents: Number(r.collected) };
}

export async function adoptContractTotals(run: Run, projectId: string): Promise<{ adopted: boolean; reason?: string; totalCents?: number; collectedCents?: number }> {
  const [p] = await run<{ collected_to_date: number; billing_source: string; opening_collected_cents: string }>(
    `SELECT collected_to_date, billing_source, opening_collected_cents::text AS opening_collected_cents FROM projects WHERE id = $1 FOR UPDATE`,
    [projectId],
  );
  if (!p) return { adopted: false, reason: "project not found" };
  const [est] = await run<{ id: number; total: number }>(
    `SELECT id::int AS id, total::bigint::int AS total FROM estimates
      WHERE project_id = $1 AND status = 'approved' AND kind = 'formal'
      ORDER BY approved_at DESC NULLS LAST, id DESC LIMIT 1`,
    [projectId],
  );
  if (!est || !(est.total > 0)) return { adopted: false, reason: "no approved formal estimate" };

  // Contract invoices = the formal estimate's own billing (its initial invoice
  // and its draws). Anything else already paid here is pre-contract money the
  // hand-kept figure is assumed to include.
  const [inv] = await run<{ other_paid: string }>(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'paid' AND NOT (economic_key LIKE $2 OR economic_key LIKE 'draw:%')), 0)::text AS other_paid
       FROM invoices WHERE project_id = $1`,
    [projectId, `estimate:${est.id}:%`],
  );
  const preContractCents = p.billing_source === "invoices"
    ? Number(p.opening_collected_cents) + Number(inv.other_paid)
    : Math.round(Number(p.collected_to_date) * 100);
  const openingCents = Math.max(0, preContractCents - Number(inv.other_paid));
  const totalCents = preContractCents + est.total;
  const label = preContractCents > 0 ? `${usd(totalCents)} (${usd(est.total)} contract + ${usd(preContractCents)} pre-con)` : usd(totalCents);

  await run(
    `UPDATE projects
        SET contract_value = ROUND($2 / 100.0)::int, value_display = $3,
            billing_source = 'invoices', opening_collected_cents = $4, opening_billed_cents = GREATEST(opening_billed_cents, $4),
            opening_note = CASE WHEN opening_note = '' THEN $5 ELSE opening_note END,
            updated_at = now()
      WHERE id = $1`,
    [projectId, totalCents, label, openingCents, `Collected before the contract (pre-con / design), carried in when construction started on estimate #${est.id}.`],
  );
  const synced = await syncCollectedFromInvoices(run, projectId);
  return { adopted: true, totalCents, collectedCents: synced?.collectedCents };
}

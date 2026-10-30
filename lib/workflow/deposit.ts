// Construction deposit paid: the one definition every gate that waits on the
// contract's initial payment reads. Confirmed construction dates
// (lib/field/schedule-plans.ts, via FieldHooks.initialPaymentReceived) and
// committing materials (lib/procurement/gate.ts) both open on it.
//
// The deposit is the invoice construction-start starts the job on
// (isInitialInvoiceKey): the formal estimate's initial invoice
// `estimate:<id>:initial` or the deposit draw `draw:0:<label>`. Nothing else
// counts: not the pre-con fee (`precon:fee`) or any other pre-con invoice, not
// a manual / one-off invoice (`manual:*` or no key), not a later draw.
//
// "Paid" is invoices.status = 'paid', which syncInvoiceCashStatus derives from
// settled ledger rows only: a pending ACH payment leaves it open and a returned
// one re-opens it. The workflow's initial_paid_at stamp is deliberately not
// read here (construction-start accepts it): it never clears on a returned
// ACH, and record_workflow_event lets an agent set it with no evidence.
//
// Pure over run(sql, params): no server-only import.

import type { Run } from "../commands/core.ts";
import { isInitialInvoiceKey } from "./construction-start.ts";

/** The refusal wording, word for word, wherever a gate is closed on it. */
export const DEPOSIT_NOT_PAID = "construction deposit not paid yet (the pre-con fee doesn't count)";

/** True once the project's construction deposit invoice is paid in full. */
export async function constructionDepositPaid(run: Run, projectId: string): Promise<boolean> {
  const rows = await run<{ economic_key: string | null }>(
    `SELECT economic_key FROM invoices WHERE project_id = $1 AND status = 'paid' AND economic_key IS NOT NULL`,
    [projectId],
  );
  return rows.some((r) => isInitialInvoiceKey(r.economic_key));
}

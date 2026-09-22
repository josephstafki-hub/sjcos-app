"use server";

// Project-financials write paths (docs/project-financials-plan.md §4.7). Gated
// on the `money` area — "All other financials", the default fence for every
// money feature that is not estimates / invoices / POs / COs / bidding — except
// the billing reconcile, which is the owner's. Money is CENTS. Reads stay in
// lib/budget.ts; the SQL and the validation are lib/budget-writes.ts so the MCP
// tools run the very same statements.
//
// Every action is one transaction: a write that fails half way leaves nothing.

import { revalidatePath } from "next/cache";
import { bumpLiveChange, pool } from "@/lib/db";
import { requireAccess, requireRole } from "@/lib/dal";
import * as writes from "@/lib/budget-writes";
import type { Run } from "@/lib/budget-queries";
import type {
  AdoptResult, BudgetLineInput, BudgetSettingsInput, ChangeOrderCostsInput, CostSource, CostTarget,
  ExpenseInput, FundingEventInput, PartyInput, ReconcileBillingInput, WriteResult,
} from "@/lib/budget-writes";

/** Run `fn` against this job inside one transaction; commit only on `ok`. */
async function inProject<R extends { ok: boolean }>(slug: string, fn: (run: Run, projectId: string) => Promise<R>): Promise<R | { ok: false; error: string }> {
  const client = await pool.connect();
  try {
    const run: Run = async <T,>(sql: string, params?: unknown[]) => (await client.query(sql, params as never[])).rows as T[];
    const [project] = await run<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
    if (!project) return { ok: false, error: "Project not found." };
    await client.query("BEGIN");
    const result = await fn(run, project.id);
    await client.query(result.ok ? "COMMIT" : "ROLLBACK");
    if (result.ok) {
      bumpLiveChange("budget_lines");
      revalidatePath(`/projects/${slug}`);
    }
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, error: err instanceof Error ? err.message : "That didn't save." };
  } finally {
    client.release();
  }
}

/** Use a job's approved estimate as its budget: one line per estimate section.
 *  An estimate with no markup (the Houzz imports) yields lines and prices but
 *  leaves the budget unconfirmed, so no profit is claimed. */
export async function adoptEstimateAsBudget(slug: string, opts: { estimateId?: number; replace?: boolean } = {}): Promise<AdoptResult> {
  await requireAccess("money");
  return inProject(slug, (run, projectId) => writes.adoptEstimateAsBudget(run, { projectId, ...opts }));
}

export async function saveBudgetLine(slug: string, input: BudgetLineInput): Promise<WriteResult<{ id: number }>> {
  await requireAccess("money");
  return inProject(slug, (run, projectId) => writes.saveBudgetLine(run, projectId, input));
}

export async function deleteBudgetLine(slug: string, id: number): Promise<WriteResult> {
  await requireAccess("money");
  return inProject(slug, (run, projectId) => writes.deleteBudgetLine(run, projectId, id));
}

export async function saveBudgetSettings(slug: string, input: BudgetSettingsInput): Promise<WriteResult> {
  await requireAccess("money");
  return inProject(slug, (run, projectId) => writes.saveBudgetSettings(run, projectId, input));
}

export async function saveExpense(slug: string, input: ExpenseInput): Promise<WriteResult<{ id: number }>> {
  const user = await requireAccess("money");
  return inProject(slug, (run, projectId) => writes.saveExpense(run, projectId, input, user.id));
}

export async function deleteExpense(slug: string, id: number): Promise<WriteResult> {
  await requireAccess("money");
  return inProject(slug, (run, projectId) => writes.deleteExpense(run, projectId, id));
}

export async function assignCost(slug: string, args: { source: CostSource; id: number; target: CostTarget }): Promise<WriteResult> {
  await requireAccess("money");
  return inProject(slug, (run, projectId) => writes.assignCost(run, projectId, args));
}

export async function linkCostToPurchaseOrder(
  slug: string, args: { source: "sub_invoice" | "expense"; id: number; purchaseOrderId: number | null },
): Promise<WriteResult> {
  await requireAccess("money");
  return inProject(slug, (run, projectId) => writes.linkCostToPurchaseOrder(run, projectId, args));
}

export async function setSubInvoicePayment(
  slug: string, args: { id: number; status: "submitted" | "approved" | "paid"; paidCents?: number },
): Promise<WriteResult> {
  await requireAccess("money");
  return inProject(slug, (run, projectId) => writes.setSubInvoicePayment(run, projectId, args));
}

export async function saveChangeOrderCosts(slug: string, input: ChangeOrderCostsInput): Promise<WriteResult> {
  await requireAccess("money");
  return inProject(slug, (run, projectId) => writes.saveChangeOrderCosts(run, projectId, input));
}

/** Who pays for the base price, and the payments expected from them — saved together, all or nothing. */
export async function savePayersAndFunding(slug: string, input: { parties: PartyInput[]; events: FundingEventInput[] }): Promise<WriteResult> {
  await requireAccess("money");
  return inProject(slug, async (run, projectId) => {
    const parties = await writes.saveParties(run, projectId, input.parties);
    return parties.ok ? writes.saveFundingEvents(run, projectId, input.events) : parties;
  });
}

/** Owner only: it changes which number the whole app calls "collected". */
export async function reconcileBilling(slug: string, input: ReconcileBillingInput): Promise<WriteResult<{ collectedCents: number }>> {
  await requireRole("owner");
  const result = await inProject(slug, (run, projectId) => writes.reconcileBilling(run, projectId, input));
  if (result.ok) revalidatePath("/today");
  return result;
}

export async function unreconcileBilling(slug: string): Promise<WriteResult> {
  await requireRole("owner");
  return inProject(slug, (run, projectId) => writes.unreconcileBilling(run, projectId));
}

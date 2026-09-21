"use server";

// Project-financials write paths (docs/project-financials-plan.md §4.7). Gated
// on the `money` area — "All other financials", the default fence for every
// money feature that is not estimates / invoices / POs / COs / bidding. Money
// is CENTS. Reads stay in lib/budget.ts; the SQL is lib/budget-writes.ts so the
// MCP tools run the same statements.

import { revalidatePath } from "next/cache";
import { bumpLiveChange, pool } from "@/lib/db";
import { requireAccess } from "@/lib/dal";
import { adoptEstimateAsBudget as adopt, type AdoptResult } from "@/lib/budget-writes";
import type { Run } from "@/lib/budget-queries";

/** Use a job's approved estimate as its budget: one line per estimate section.
 *  All-or-nothing. An estimate with no markup (the Houzz imports) yields lines
 *  and prices but leaves the budget unconfirmed, so no profit is claimed. */
export async function adoptEstimateAsBudget(
  slug: string,
  opts: { estimateId?: number; replace?: boolean } = {},
): Promise<AdoptResult> {
  await requireAccess("money");
  const client = await pool.connect();
  try {
    const run: Run = async <T,>(sql: string, params?: unknown[]) => (await client.query(sql, params as never[])).rows as T[];
    const [project] = await run<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
    if (!project) return { ok: false, error: "Project not found." };
    await client.query("BEGIN");
    const result = await adopt(run, { projectId: project.id, ...opts });
    await client.query(result.ok ? "COMMIT" : "ROLLBACK");
    if (result.ok) {
      bumpLiveChange("budget_lines");
      revalidatePath(`/projects/${slug}`);
    }
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, error: err instanceof Error ? err.message : "Could not adopt the estimate." };
  } finally {
    client.release();
  }
}

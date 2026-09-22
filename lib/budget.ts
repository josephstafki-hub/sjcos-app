import "server-only";

// Project financials — the server half of the builder: run the queries, hand
// the rows to the pure assembler. All the rules live in lib/budget-assemble.ts
// and lib/budget-types.ts, where they are unit-tested; the SQL lives in
// lib/budget-queries.ts, shared with the MCP server. Reads only — writes are
// lib/actions/budget.ts. Spec: docs/project-financials-plan.md §7.

import { query } from "@/lib/db";
import { assembleBudgetView } from "@/lib/budget-assemble";
import { buildCompanyMoney, type CompanyMoney } from "@/lib/budget-company";
import { findProjects, loadRawProjectMoney, todayCentral, type Run } from "@/lib/budget-queries";
import type { BudgetView } from "@/lib/budget-types";

const run: Run = async <T,>(sql: string, params?: unknown[]) => (await query(sql, params)).rows as T[];

/** One view per project id, in one round of set-based queries. */
export async function getBudgetViews(projectIds: string[]): Promise<Map<string, BudgetView>> {
  const asOf = todayCentral();
  const raw = await loadRawProjectMoney(run, projectIds);
  return new Map([...raw].map(([id, money]) => [id, assembleBudgetView(money, { asOf })]));
}

/** The project Money › Overview. null when the slug names no project. */
export async function getProjectBudget(slug: string): Promise<BudgetView | null> {
  const [project] = await findProjects(run, { slug });
  if (!project) return null;
  return (await getBudgetViews([project.id])).get(project.id) ?? null;
}

/** The company /money page: every job, open and closed. */
export async function getCompanyMoney(): Promise<CompanyMoney> {
  const projects = await findProjects(run, "all");
  const views = await getBudgetViews(projects.map((p) => p.id));
  return buildCompanyMoney(projects.map((p) => views.get(p.id)).filter((v): v is BudgetView => !!v));
}

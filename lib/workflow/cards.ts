// Workflow cards Joe answers (Tier 3: W03 and W11). Pure: `run` only.
//
//   W03 stageAllocationReview  — before any bid request goes out, Joe sees who
//                                does each scope item (him / a sub / a
//                                supplier, supply vs install, his dedicated
//                                prices). Approving records the review; it
//                                sends nothing (each package still has its
//                                own release card). A package release on a
//                                job whose allocation wasn't reviewed stages
//                                this card first (lib/procurement/packages.ts).
//   W11 prepare_change_order   — a selection over its allowance. Approving
//                                drafts the change order (Joe, 2026-10-30:
//                                approving this card is what creates it);
//                                before the contract it is a Pre-con change
//                                estimate instead (the same rule the tables
//                                enforce: project_scope_change_path). Nothing is
//                                sent to the client by this step.
//
// settleWorkflowCard is called from lib/decisions/resolve.ts on approval, under
// a savepoint; it returns the line the approval reply shows.

import type { Run } from "../commands/core.ts";
import { hashInput } from "../commands/core.ts";
import { stageDecision, type Decision } from "../commands/decisions.ts";
import type { Principal } from "../commands/principal.ts";
import { principalLabel } from "../commands/principal.ts";
import { recordWorkflowEvent } from "./engine.ts";

export const ALLOCATION_REVIEW_ACTION = "review_scope_allocation";
export const OVERAGE_CHANGE_ORDER_ACTION = "prepare_change_order";

interface AllocRow {
  key: string;
  title: string;
  responsibility: string;
  supply_by: string;
  install_by: string;
  dedicated_price_cents: string | null;
  price_basis: string | null;
  revision: number;
}

async function allocation(run: Run, projectId: string): Promise<AllocRow[]> {
  return run<AllocRow>(
    `SELECT key, title, responsibility, supply_by, install_by, dedicated_price_cents::text AS dedicated_price_cents, price_basis, revision
       FROM scope_items WHERE project_id = $1 AND status NOT IN ('superseded','excluded') ORDER BY key`,
    [projectId],
  );
}

const allocationHash = (rows: AllocRow[]) =>
  hashInput(rows.map((r) => ({ key: r.key, responsibility: r.responsibility, supply_by: r.supply_by, install_by: r.install_by, price: r.dedicated_price_cents, basis: r.price_basis })));

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const WHO: Record<string, string> = { joe: "Joe", sub: "a sub", supplier: "a supplier", unassigned: "not decided", client: "the client" };

/** True when Joe approved the allocation as it stands now. */
export async function allocationReviewed(run: Run, projectId: string): Promise<boolean> {
  const rows = await allocation(run, projectId);
  if (!rows.length) return true; // no scope register: nothing to review
  const [ev] = await run<{ n: number }>(
    `SELECT count(*)::int AS n FROM project_workflow_events WHERE project_id = $1 AND kind = 'scope_allocation_reviewed' AND detail->>'allocation_hash' = $2`,
    [projectId, allocationHash(rows)],
  );
  return Number(ev?.n ?? 0) > 0;
}

/** Stage (or return the pending) scope-allocation review card. */
export async function stageAllocationReview(run: Run, projectId: string, principal: Principal): Promise<{ ok: true; decision: Decision; created: boolean } | { ok: false; reason: string }> {
  const rows = await allocation(run, projectId);
  if (!rows.length) return { ok: false, reason: "This job has no scope register to review." };
  const [p] = await run<{ name: string; slug: string }>(`SELECT name, slug FROM projects WHERE id = $1`, [projectId]);
  const line = (r: AllocRow) => {
    const price = r.dedicated_price_cents != null ? ` · your price ${usd(Number(r.dedicated_price_cents))} (${r.price_basis === "client_price" ? "client's price" : "your cost"})` : "";
    const split = r.supply_by !== r.install_by && r.supply_by !== "unassigned" && r.install_by !== "unassigned" ? ` · supply ${WHO[r.supply_by] ?? r.supply_by}, install ${WHO[r.install_by] ?? r.install_by}` : "";
    return `${r.title}: ${WHO[r.responsibility] ?? r.responsibility}${split}${price}`;
  };
  const unassigned = rows.filter((r) => r.responsibility === "unassigned");
  const hash = allocationHash(rows);
  const { decision, created } = await stageDecision(run, {
    kind: "scope_allocation",
    action: ALLOCATION_REVIEW_ACTION,
    title: `Who does what · ${p?.name ?? "job"}`,
    summary: {
      inclusions: rows.map(line),
      gaps: unassigned.map((r) => `${r.title}: not decided yet`),
      effect: "Approving confirms who does each part before any bid request goes out. It sends nothing; each bid package still gets its own release card. Work you keep is left out of sub bids (its materials stay).",
    },
    targetKind: "project",
    targetId: projectId,
    projectId,
    content: { projectId, allocation_hash: hash },
    dedupeKey: `scope_allocation:${projectId}`,
    options: ["approve", "request_changes", "hold"],
    href: p ? `/projects/${p.slug}` : null,
    requestedBy: principal,
  });
  return { ok: true, decision, created };
}

/** What an approved W03 / W11 card does. Null when the decision is neither. */
export async function settleWorkflowCard(run: Run, d: Decision, principal: Principal): Promise<string | null> {
  if (d.action === ALLOCATION_REVIEW_ACTION && d.project_id) {
    const rows = await allocation(run, d.project_id);
    const hash = allocationHash(rows);
    const unassigned = rows.filter((r) => r.responsibility === "unassigned").length;
    await recordWorkflowEvent(run, {
      projectId: d.project_id,
      kind: "scope_allocation_reviewed",
      ref: `decision:${d.id}`,
      detail: { allocation_hash: hash, items: rows.length, unassigned, matches_card: d.content_hash === hashInput({ projectId: d.project_id, allocation_hash: hash }) },
      actor: principalLabel(principal),
    });
    if (d.content_hash !== hashInput({ projectId: d.project_id, allocation_hash: hash })) {
      return "Recorded, but the allocation changed after this card was made; the current one is what counts now.";
    }
    return unassigned ? `Allocation reviewed; ${unassigned} item${unassigned === 1 ? " is" : "s are"} still not decided.` : "Allocation reviewed. Bid packages can be released.";
  }
  if (d.action === OVERAGE_CHANGE_ORDER_ACTION && d.project_id) {
    const summary = d.summary as { changes?: string[] };
    const description = summary.changes?.[0] ?? d.title;
    const price = Number(d.amount_cents ?? 0);
    // The same rule the tables enforce: a change order once under contract,
    // a Pre-con change estimate before that.
    const [path] = await run<{ path: string }>(`SELECT project_scope_change_path($1) AS path`, [d.project_id]);
    if (path?.path === "change_order") {
      const [co] = await run<{ id: string }>(
        `INSERT INTO change_orders (project_id, title, description, price_cents, status) VALUES ($1, $2, $3, $4, 'draft') RETURNING id`,
        [d.project_id, d.title.slice(0, 300), description, price],
      );
      return `Change order #${co.id} drafted (${usd(price)}) under Money › Change orders. Send it to the client from there; the extra work waits for their acceptance and payment.`;
    }
    // Before the contract: a Pre-con change estimate (one line at the client price).
    const [est] = await run<{ id: string }>(
      `INSERT INTO estimates (project_id, kind, title, status) VALUES ($1, 'precon_change', $2, 'draft') RETURNING id`,
      [d.project_id, d.title.slice(0, 300)],
    );
    await run(
      `INSERT INTO estimate_lines (estimate_id, description, section, unit, qty, unit_cost, markup, extended, sort_order)
       VALUES ($1, $2, 'Selection over allowance', 'ea', 1, $3, 0, $3, 0)`,
      [est.id, description, price],
    );
    await run(`UPDATE estimates SET subtotal = $2, total = $2, markup_total = 0 WHERE id = $1`, [est.id, price]);
    return `The contract isn't signed yet, so this is Pre-con change #${est.id} (${usd(price)}) under Money › Pre-con changes. Send it to the client from there.`;
  }
  return null;
}

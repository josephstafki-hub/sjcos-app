// Deposit paid + construction agreement signed → the job starts construction.
//
//   onInvoicePaid(run, invoiceId, principal)
//     Called by recordInvoicePayment (lib/billing/core.ts) inside the payment
//     transaction when an invoice becomes fully paid — so Square, the Mark paid
//     button and MCP record_manual_payment all land here. An initial invoice
//     (`estimate:<id>:initial` or the deposit draw `draw:0:…`) records
//     initial_paid on the workflow, then tries maybeStartConstruction.
//   maybeStartConstruction(run, projectId, ref, principal)
//     Also called when the construction agreement is signed (engine.ts), for
//     the job that paid before it signed. With BOTH gates met and the project
//     still before construction: projects.status → construction, the project
//     total / % billed adopt the contract (lib/billing/project-totals.ts), the draws set
//     to bill at "Construction start" are DRAFTED for Joe (never sent from
//     here), a notification lands, and the business agent is woken with a
//     'permit' trigger to work out the city's permit requirements and file a
//     permit brief on the project. Idempotent: a second call finds the project
//     already in construction and the trigger already queued.
//
// Pure over run(sql, params): no server-only import.

import type { Run } from "../commands/core.ts";
import { principalLabel, type Principal } from "../commands/principal.ts";
import { drawEconomicKey, issueMilestoneInvoice } from "../billing/core.ts";
import { parseDrawSchedule } from "../draw-schedule.ts";
import { adoptContractTotals } from "../billing/project-totals.ts";
import { enqueueAgentTrigger } from "../agent-runtime/triggers.ts";
import { getProjectWorkflow, noteWorkflowEvent, recordWorkflowEvent } from "./engine.ts";

/** Project statuses before construction, in lifecycle order (lib/projects.ts). */
const PRE_CONSTRUCTION = ["precon_signed", "floor_plan", "mood_board", "selections", "bidding", "construction_contract"];

export function isInitialInvoiceKey(key: string | null | undefined): boolean {
  return /^estimate:\d+:initial$/.test(key ?? "") || /^draw:0:/.test(key ?? "");
}

export interface ConstructionStart {
  started: boolean;
  reason?: string;
  projectId?: string;
  slug?: string;
  draftedDraws?: number[];
  permitTriggerId?: string;
}

export async function onInvoicePaid(run: Run, invoiceId: number, principal: Principal): Promise<{ initial: boolean; start: ConstructionStart | null }> {
  const [inv] = await run<{ id: number; project_id: string; economic_key: string | null; status: string; number: string }>(
    `SELECT id::int AS id, project_id, economic_key, status, number FROM invoices WHERE id = $1`,
    [invoiceId],
  );
  if (!inv || inv.status !== "paid" || !isInitialInvoiceKey(inv.economic_key)) return { initial: false, start: null };
  await noteWorkflowEvent(run, {
    projectId: inv.project_id,
    kind: "initial_paid",
    ref: `invoice:${inv.id}`,
    detail: { invoice_id: inv.id, number: inv.number },
    actor: principalLabel(principal),
  });
  const start = await maybeStartConstruction(run, inv.project_id, `invoice:${inv.id}`, principal);
  return { initial: true, start };
}

async function initialPaid(run: Run, projectId: string, stamped: string | null): Promise<boolean> {
  if (stamped) return true;
  const [r] = await run<{ n: number }>(
    `SELECT count(*)::int AS n FROM invoices
      WHERE project_id = $1 AND status = 'paid' AND (economic_key ~ '^estimate:[0-9]+:initial$' OR economic_key LIKE 'draw:0:%')`,
    [projectId],
  );
  return r.n > 0;
}

export async function maybeStartConstruction(run: Run, projectId: string, ref: string, principal: Principal): Promise<ConstructionStart> {
  const wf = await getProjectWorkflow(run, projectId);
  if (!wf?.contract_signed_at) return { started: false, reason: "construction agreement not signed" };
  if (!(await initialPaid(run, projectId, wf.initial_paid_at))) return { started: false, reason: "initial payment not received" };

  const [proj] = await run<{ id: string; slug: string; name: string; address: string | null }>(
    `UPDATE projects SET status = 'construction', updated_at = now()
      WHERE id = $1 AND status = ANY($2::text[])
      RETURNING id, slug, name, address`,
    [projectId, PRE_CONSTRUCTION],
  );
  if (!proj) return { started: false, reason: "project is not before construction" };

  const actor = principalLabel(principal);
  await recordWorkflowEvent(run, {
    projectId,
    kind: "construction_started",
    ref,
    detail: { contract_signed_at: wf.contract_signed_at, by: ref },
    actor,
  });

  // The projects-list total / % billed: pre-con money + the signed contract,
  // invoice-tracked from here on.
  await adoptContractTotals(run, projectId);

  // Draws pre-wired to "Construction start" — drafted, never sent from here.
  const draftedDraws: number[] = [];
  const [est] = await run<{ id: number; total: number; draw_schedule: unknown }>(
    `SELECT id::int AS id, total, draw_schedule FROM estimates
      WHERE project_id = $1 AND status = 'approved' AND kind = 'formal' AND draw_schedule IS NOT NULL
      ORDER BY approved_at DESC NULLS LAST, id DESC LIMIT 1`,
    [projectId],
  );
  const lines = est ? parseDrawSchedule(est.draw_schedule) : null;
  if (est && lines) {
    let changed = false;
    for (const [index, l] of lines.entries()) {
      if (l.triggerStatus !== "construction") continue;
      const r = await issueMilestoneInvoice(run, {
        projectId,
        economicKey: drawEconomicKey(index, l.label),
        milestone: l.label,
        amountCents: Math.round(((est.total ?? 0) * l.percent) / 100),
        source: "draw",
        estimateId: est.id,
        status: "draft",
        principal,
      });
      if (r.created) draftedDraws.push(r.invoice.id);
      if (!l.billed) {
        l.billed = true;
        changed = true;
      }
    }
    if (changed) await run(`UPDATE estimates SET draw_schedule = $1::jsonb WHERE id = $2`, [JSON.stringify(lines), est.id]);
  }

  const trig = await enqueueAgentTrigger(run, {
    kind: "permit",
    ref: `project:${projectId}:permit`,
    projectId,
    enqueuedBy: "workflow:construction-start",
    payload: { project_slug: proj.slug, address: proj.address, started_by: ref },
  });

  await run(
    `INSERT INTO notifications (kind, tag, accent, icon, title, subline, when_label, href)
     VALUES ('job', 'Job', 'accent', 'project', $1, $2, 'Just now', $3)`,
    [
      `${proj.name} → Construction`,
      `Contract signed and deposit paid. Permit research started${draftedDraws.length ? `; ${draftedDraws.length} construction-start draw drafted for review` : ""}.`,
      `/projects/${proj.slug}`,
    ],
  );

  return { started: true, projectId, slug: proj.slug, draftedDraws, permitTriggerId: trig.trigger.id };
}

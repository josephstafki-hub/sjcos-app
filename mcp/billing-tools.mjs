// A07 billing tools: verified balances, milestone confirmation staging, final
// reconciliation, manual payment recording. Invoice ISSUANCE is automatic
// under its policies (acceptance / owner confirmation / client sign-off) —
// there is deliberately no "issue invoice" tool for agents.

import { z } from "zod";
import { invoiceBalance, verifiedBalances, recordInvoicePayment, invoiceCollisionReport } from "../lib/billing/core.ts";
import { stageMilestoneConfirmation, finalReconciliation, resolveDraw } from "../lib/billing/commands.ts";
import { txOver, principalFor, fail, agentNameOf } from "./tool-shared.mjs";

export function registerBillingTools(server, { rows, json, pool, slugToId, currentPrincipal }) {
  const tx = txOver(pool);
  const run = async (sql, params) => rows(sql, params ?? []);
  const principal = () => principalFor(currentPrincipal, agentNameOf(server));
  const project = async (slug) => {
    const id = await slugToId("projects", slug);
    if (!id) throw new Error(`No project ${slug}`);
    return id;
  };

  server.registerTool(
    "invoice_balances",
    { title: "Verified invoice balances", description: "Issued amount, settled payments, credits, returns, pending payments, delivery state and the verified remaining balance per invoice (one invoice, or every open invoice on a project). Zero balance stops reminders; disputes and pending payments hold them.", inputSchema: { invoice_id: z.number().int().optional(), project_slug: z.string().optional(), only_open: z.boolean().optional() } },
    async ({ invoice_id, project_slug, only_open }) => {
      try {
        if (invoice_id) return json((await invoiceBalance(run, invoice_id)) ?? { ok: false, error: "no such invoice" });
        const id = project_slug ? await project(project_slug) : null;
        return json(await verifiedBalances(run, { projectId: id, onlyOpen: only_open ?? true }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "stage_milestone_confirmation",
    { title: "Ask Joe to confirm a milestone (W10 → progress invoice)", description: "With the field evidence (report ids, photos, sub completion claim) stages the milestone_confirmation decision for the draw. On Joe's approval the progress invoice issues once, automatically. A sub's claim or photos alone never bill.", inputSchema: { project_slug: z.string(), milestone_key: z.union([z.string(), z.number().int()]), evidence: z.record(z.string(), z.unknown()).optional() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const p = await principal();
        return json(await tx((r) => stageMilestoneConfirmation(r, { projectId: id, milestoneKey: a.milestone_key, principal: p, evidence: a.evidence })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "draw_schedule",
    { title: "Contract draw schedule", description: "The approved formal estimate's payment structure (retainer / draws / final) with which draws are already billed — the predetermined structure the automatic invoices follow.", inputSchema: { project_slug: z.string(), milestone_key: z.union([z.string(), z.number().int()]).optional() } },
    async ({ project_slug, milestone_key }) => {
      try {
        const id = await project(project_slug);
        if (milestone_key != null) return json((await resolveDraw(run, id, milestone_key)) ?? { ok: false, error: "no such draw on the approved formal estimate" });
        const est = await run(`SELECT id::int AS id, status, draw_schedule, total FROM estimates WHERE project_id = $1 AND kind = 'formal' ORDER BY approved_at DESC NULLS LAST, id DESC LIMIT 1`, [id]);
        return json(est[0] ?? { ok: false, error: "no formal estimate" });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "final_reconciliation",
    { title: "Final invoice reconciliation preview (W12)", description: "Contract total + approved change-order balances − issued invoices' settled amounts − credits: the verified remaining balance the final invoice will charge after written sign-off, with any uncertainty that would hold it (pending payments, negative remainder).", inputSchema: { project_slug: z.string() } },
    async ({ project_slug }) => {
      try {
        const id = await project(project_slug);
        return json((await finalReconciliation(run, id)) ?? { ok: false, error: "no approved formal estimate" });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "record_manual_payment",
    { title: "Record a payment Joe received outside Square", description: "A check / cash / bank transfer Joe confirmed: applied to the invoice once (idempotent on provider_ref when given). Requires a person behind the call with the invoices area; agents record what Joe told them, with the reference.", inputSchema: { invoice_id: z.number().int(), amount_cents: z.number().int().positive(), method: z.enum(["check", "cash", "ach", "card", "manual"]), reference: z.string().optional(), received_at: z.string().optional(), note: z.string().optional() } },
    async (a) => {
      try {
        const p = await principal();
        if (!p.onBehalfOf) return json({ ok: false, error: "Recording a payment needs a signed-in person behind the agent (Joe or an authorised team member)." });
        return json(await tx((r) => recordInvoicePayment(r, { invoiceId: a.invoice_id, kind: "payment", amountCents: a.amount_cents, method: a.method, provider: a.reference ? "manual" : null, providerRef: a.reference ?? null, receivedAt: a.received_at ?? null, status: "settled", note: a.note ?? "", principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "invoice_collision_report",
    { title: "Invoice collision report (read-only)", description: "Existing invoices sharing a milestone label or amount per project, and invoices with no economic key — for explicit legacy resolution before anything is renumbered or merged (nothing is).", inputSchema: {} },
    async () => {
      try {
        return json(await invoiceCollisionReport(run));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

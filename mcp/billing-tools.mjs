// A07 billing tools: verified balances, milestone confirmation staging, final
// reconciliation, manual payment recording. Agents never issue an invoice
// themselves: they stage Joe's card (stage_initial_invoice for the first draw,
// stage_milestone_confirmation for progress draws) and his approval issues it.

import { z } from "zod";
import { invoiceBalance, verifiedBalances, recordInvoicePayment, invoiceCollisionReport, issueMilestoneInvoice } from "../lib/billing/core.ts";
import { stageMilestoneConfirmation, stageInitialInvoiceDecision, finalReconciliation, resolveDraw } from "../lib/billing/commands.ts";
import { txOver, principalFor, fail, agentNameOf, areaRefusal } from "./tool-shared.mjs";

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
    "stage_initial_invoice",
    {
      title: "Ask Joe to issue the first-draw invoice (contract signing / deposit)",
      description:
        "Stages Joe's card for the project's FIRST draw invoice, figured from the formal estimate's payment schedule as it stands now " +
        "(amount, client recipient, whether the client signed and whether the lines changed since). A formal estimate still in draft (never sent " +
        "from the app) is used too, flagged on the card. When Joe approves it, the app creates " +
        "the invoice and emails it to the client with the PDF and pay link; do not send it yourself. Use this, not stage_decision, for an " +
        "initial invoice: a stage_decision card creates no invoice when approved. Add your findings as gaps / money_check.",
      inputSchema: {
        project_slug: z.string(),
        gaps: z.array(z.string()).optional().describe("Open questions Joe should see on the card."),
        money_check: z.string().optional().describe("One plain line on the money, e.g. credits already inside the total."),
        work_item_id: z.string().uuid().optional().describe("Work item to wake when Joe answers."),
      },
    },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const p = await principal();
        return json(await tx((r) => stageInitialInvoiceDecision(r, { projectId: id, principal: p, gaps: a.gaps, moneyCheck: a.money_check ?? null, workItemId: a.work_item_id ?? null })));
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

  // Same edit as the payment-schedule editor on the contract generator
  // (lib/actions/documents.ts updateDrawSchedule). Spaeth, 2026-10-28: the
  // default 10% deposit went out because no agent could change the schedule.
  server.registerTool(
    "set_draw_schedule",
    {
      title: "Set the contract's payment schedule",
      description:
        "Replace the formal estimate's payment schedule (the draws the contract prints and the invoices bill). Percentages must " +
        "total 100. Joe's rule: a job this size takes AT LEAST 50% up front; never leave the default small deposit. A draw " +
        "that already has an invoice keeps billed:true (pass the draws in order; the first is the deposit). triggerStatus = the " +
        "project stage that auto-bills the draw: construction_contract | construction | closeout | warranty | '' (manual). " +
        "After changing it, re-create the contract document (create_document_draft contract) so the PDF shows the new draws.",
      inputSchema: {
        project_slug: z.string(),
        draws: z
          .array(z.object({ label: z.string().min(1).max(120), percent: z.number().min(0).max(100), trigger_status: z.enum(["", "construction_contract", "construction", "closeout", "warranty"]).optional() }))
          .min(1)
          .max(12),
      },
    },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const total = a.draws.reduce((s, d) => s + d.percent, 0);
        if (Math.abs(total - 100) > 0.5) return json({ ok: false, error: `Percentages must add up to 100% (currently ${total}%).` });
        const [est] = await run(`SELECT id::int AS id, total::int AS total, draw_schedule FROM estimates WHERE project_id = $1 AND kind = 'formal' ORDER BY (status = 'approved') DESC, (status = 'sent') DESC, id DESC LIMIT 1`, [id]);
        if (!est) return json({ ok: false, error: "This job has no formal estimate." });
        const old = Array.isArray(est.draw_schedule) ? est.draw_schedule : [];
        const lines = a.draws.map((d, i) => ({
          label: d.label.trim(),
          percent: Math.round(d.percent * 100) / 100,
          triggerStatus: d.trigger_status ?? "",
          billed: old[i]?.billed === true,
        }));
        await run(`UPDATE estimates SET draw_schedule = $2::jsonb WHERE id = $1`, [est.id, JSON.stringify(lines)]);
        const issued = await run(`SELECT number, milestone, amount::int AS amount_cents, status FROM invoices WHERE project_id = $1 AND status <> 'void' ORDER BY id`, [id]);
        return json({
          ok: true,
          estimate_id: est.id,
          total_cents: est.total,
          draws: lines.map((l) => ({ ...l, amount_cents: Math.round((est.total * l.percent) / 100) })),
          invoices_on_job: issued,
          next: "Re-create the contract document so it prints these draws. If a draw already billed a different amount, bill the difference with create_invoice_draft.",
        });
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

  // A one-off invoice that no draw schedule produces — the pre-con fee once the
  // lead is converted, a deposit Joe names, a T&M bill. Same as Money › New
  // invoice: it is created as a DRAFT and nothing is emailed. Sending stays
  // behind the grant (request_owner_permission action send_invoice, target_id =
  // the invoice id). Idempotent per (project, key) so a retry never double-bills.
  server.registerTool(
    "create_invoice_draft",
    {
      title: "Draft a one-off invoice (nothing is sent)",
      description:
        "Create a DRAFT invoice on a project with the lines you give, exactly like Money › New invoice in the app. " +
        "For amounts no draw schedule produces: the pre-con fee (kind 'precon_fee' — use the fee on the job's " +
        "Pre-Construction Agreement draft, list_document_drafts → precon_fee), a deposit or one-off charge Joe named. " +
        "Amounts are INTEGER CENTS and must come from a record or from Joe, never invented. Not for the contract's " +
        "first draw (stage_initial_invoice) or progress draws (stage_milestone_confirmation). Nothing is emailed: to " +
        "send it, request_owner_permission { action: 'send_invoice', target_id: <invoice id> } — Joe's Approve sends it. " +
        "Re-running with the same project and key returns the existing invoice instead of a second one.",
      inputSchema: {
        project_slug: z.string(),
        kind: z.enum(["precon_fee", "other"]).describe("precon_fee = the pre-construction retainer (one per job)."),
        milestone: z.string().min(1).max(120).describe("Invoice title, e.g. 'Pre-construction fee'."),
        lines: z
          .array(z.object({ label: z.string().min(1).max(300), amount_cents: z.number().int().positive() }))
          .min(1)
          .max(20),
        key: z
          .string()
          .regex(/^[a-z0-9-]{1,40}$/)
          .optional()
          .describe("kind 'other' only: a short stable name for this charge (e.g. 'permit-fee'); defaults from the title."),
        terms: z
          .string()
          .max(60)
          .optional()
          .describe("Payment terms, e.g. 'Due on receipt' or 'Net 7'. precon_fee is always due on receipt (the agreement says so)."),
      },
    },
    async (a) => {
      try {
        const refusal = await areaRefusal(rows, currentPrincipal, "invoices");
        if (refusal) return json({ ok: false, error: refusal });
        const id = await project(a.project_slug);
        const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "charge";
        const economicKey = a.kind === "precon_fee" ? "precon:fee" : `manual:${a.key ?? slug(a.milestone)}`;
        const lines = a.lines.map((l) => ({ label: l.label.trim(), amount: l.amount_cents }));
        const amountCents = lines.reduce((s, l) => s + l.amount, 0);
        const p = await principal();
        const { invoice, created } = await tx((r) =>
          issueMilestoneInvoice(r, { projectId: id, economicKey, milestone: a.milestone, amountCents, lines, source: "manual", status: "draft", terms: a.kind === "precon_fee" ? "Due on receipt" : (a.terms ?? null), principal: p }),
        );
        return json({
          ok: true,
          created,
          invoice_id: Number(invoice.id),
          number: invoice.number,
          status: invoice.status,
          amount_cents: Number(invoice.amount),
          ...(created ? {} : { note: "An invoice with this key already exists on the project — returned it, nothing new was created." }),
          next: `To send: request_owner_permission { action: "send_invoice", target_id: "${invoice.id}" }. Joe's Approve emails it.`,
        });
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

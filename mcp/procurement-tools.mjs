// A13 procurement + cash tools (WORKFLOW W05–W09). Direct calls into the pure
// procurement/funding libraries inside one transaction per tool. Every
// commitment, payment and package release is a DECISION Joe (or an
// authorised delegate) resolves; the dispatcher performs the send/charge
// afterwards. No vendor payment rail exists: an approved payment stays
// "manual_pending" until Joe confirms it moved.

import { z } from "zod";
import { listCommitments, getCommitment, prepareCommitment, stagePurchaseDecision, commitOnApproval, voidCommitment } from "../lib/procurement/commitments.ts";
import { recordAcknowledgement, recordDelivery, reviewDelivery, listDeliveries } from "../lib/procurement/deliveries.ts";
import { receiveBill, getBill, stagePaymentDecision, executePayment, recordManualPaymentConfirmation } from "../lib/procurement/bills.ts";
import { planBuyout } from "../lib/procurement/buyout.ts";
import { stagePackageRelease, stageSupplierPricingRequest, selectBidForEstimate, awardBid } from "../lib/procurement/packages.ts";
import { projectFunding, projectFundingForecast, escalateShortfall } from "../lib/funding/index.ts";
import { txOver, principalFor, fail, agentNameOf } from "./tool-shared.mjs";

export function registerProcurementTools(server, { rows, json, pool, slugToId, currentPrincipal }) {
  const tx = txOver(pool);
  const run = async (sql, params) => rows(sql, params ?? []);
  const principal = () => principalFor(currentPrincipal, agentNameOf(server));
  const project = async (slug) => {
    const id = await slugToId("projects", slug);
    if (!id) throw new Error(`No project ${slug}`);
    return id;
  };

  server.registerTool(
    "get_project_funding",
    { title: "Project cash available to commit (W09)", description: "Reconciled collected funds − spent − reserved (+ approved company funding). Invoices sent, promised payments and pending ACH are FORECAST only, never spendable. Unknown cash status blocks commitments, not planning.", inputSchema: { project_slug: z.string(), forecast: z.boolean().optional() } },
    async ({ project_slug, forecast }) => {
      try {
        const id = await project(project_slug);
        return json(forecast ? await projectFundingForecast(run, id) : await projectFunding(run, id));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "plan_buyout",
    { title: "Material buyout schedule (W09)", description: "Order deadlines backward from need-on-site dates: quote validity, lead time, deposit/balance terms, delivery window and buffer, aligned to expected milestone collections. Surfaces a future shortfall early (a funding decision), never a hidden overdraft.", inputSchema: { project_slug: z.string(), escalate: z.boolean().optional() } },
    async ({ project_slug, escalate }) => {
      try {
        const id = await project(project_slug);
        const p = await principal();
        return json(await tx((r) => planBuyout(r, id, { principal: p, escalate: escalate ?? false })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_commitments",
    { title: "List commitments (orders, awards, offers)", description: "Purchase orders, sub awards and accepted supplier offers with their lifecycle (draft → approved → committed → acknowledged → delivered → reviewed → accepted → payable → paid) and reservations.", inputSchema: { project_slug: z.string().optional(), states: z.array(z.string()).optional(), commitment_id: z.number().int().optional() } },
    async ({ project_slug, states, commitment_id }) => {
      try {
        if (commitment_id) {
          const c = await getCommitment(run, commitment_id);
          return json(c ? { commitment: c, deliveries: await listDeliveries(run, commitment_id) } : { ok: false, error: "no such commitment" });
        }
        const id = project_slug ? await project(project_slug) : null;
        return json(await listCommitments(run, { projectId: id, states }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "stage_purchase_decision",
    { title: "Stage a one-tap purchase decision (W09)", description: "From a purchase order or an awarded bid: prepares the commitment (payee from trusted records, scope/items, total incl. tax + shipping, terms) and stages the purchase decision. A changed total/payee needs a fresh decision. pay_now_bundled=true only when the preview states order AND immediate charge with one total; a later bill is never covered.", inputSchema: { source: z.object({ kind: z.enum(["purchase_order", "sub_award", "supplier_offer"]), ref: z.string().describe("PO id / bid submission id / quote id") }), terms: z.string().optional(), tax_cents: z.number().int().optional(), shipping_cents: z.number().int().optional(), pay_now_bundled: z.boolean().optional(), href: z.string().optional(), work_item_id: z.string().uuid().optional() } },
    async (a) => {
      try {
        const p = await principal();
        return json(
          await tx(async (r) => {
            const prep = await prepareCommitment(r, { source: a.source, principal: p, terms: a.terms ?? null, taxCents: a.tax_cents ?? null, shippingCents: a.shipping_cents ?? null });
            if (!prep.ok) return prep;
            const staged = await stagePurchaseDecision(r, { commitmentId: prep.commitment.id, principal: p, payNowBundled: a.pay_now_bundled ?? false, href: a.href ?? null, workItemId: a.work_item_id ?? null });
            return { ...staged, commitment: prep.commitment };
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "commit_on_approval",
    { title: "Commit an APPROVED purchase (W09)", description: "After the purchase decision is approved: consumes it, reserves project cash atomically (refused with the exact shortfall when funds are short — a company-funding decision is staged), checks the construction gate (signed agreement + initial payment) unless preconstruction_service is stated, and queues the PO for dispatch. Refused while the decision is pending.", inputSchema: { commitment_id: z.number().int(), decision_id: z.string().uuid(), preconstruction_service: z.boolean().optional() } },
    async (a) => {
      try {
        const p = await principal();
        return json(await tx((r) => commitOnApproval(r, { commitmentId: a.commitment_id, decisionId: a.decision_id, principal: p, preconstructionService: a.preconstruction_service ?? false })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "record_acknowledgement",
    { title: "Vendor acknowledged an order", description: "Records the vendor's acknowledgement and promised date (evidence, not payable).", inputSchema: { commitment_id: z.number().int(), promised_date: z.string().optional(), via: z.enum(["email", "phone", "portal", "in_person", "other"]), note: z.string().optional(), evidence_file_id: z.string().optional() } },
    async (a) => {
      try {
        const p = await principal();
        return json(await tx((r) => recordAcknowledgement(r, { commitmentId: a.commitment_id, promisedDate: a.promised_date ?? null, via: a.via, note: a.note, evidenceFileId: a.evidence_file_id ?? null, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "record_delivery",
    { title: "Record a delivery (partial / late / wrong / revised)", description: "What arrived against an order, by line. Wrong shipments do not advance the order; revised re-ships are distinct; lateness is measured against the promise. Nothing becomes payable here — Joe reviews.", inputSchema: { commitment_id: z.number().int(), lines: z.array(z.object({ lineId: z.number().int().optional(), description: z.string(), qtyReceived: z.number(), amountCents: z.number().int().optional() })), received_at: z.string().optional(), wrong: z.boolean().optional(), revised: z.boolean().optional(), issues: z.array(z.string()).optional(), evidence_file_ids: z.array(z.string()).optional(), note: z.string().optional() } },
    async (a) => {
      try {
        const p = await principal();
        return json(await tx((r) => recordDelivery(r, { commitmentId: a.commitment_id, lines: a.lines, receivedAt: a.received_at ?? null, wrong: a.wrong, revised: a.revised, issues: a.issues, evidenceFileIds: a.evidence_file_ids, note: a.note, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "review_delivery",
    { title: "Accept or reject a delivery (owner review)", description: "Joe's acceptance of what arrived sets the ceiling a matched bill can make payable. Owner authority; record what Joe decided.", inputSchema: { delivery_id: z.number().int(), accepted: z.boolean(), issues: z.array(z.string()).optional(), note: z.string().optional() } },
    async (a) => {
      try {
        const p = await principal();
        return json(await tx((r) => reviewDelivery(r, { deliveryId: a.delivery_id, accepted: a.accepted, issues: a.issues, note: a.note, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "receive_bill",
    { title: "A vendor/sub bill arrived", description: "Records the bill (scoped file handle only, never bytes) and matches it against the commitment + accepted deliveries. A file arriving makes nothing payable by itself.", inputSchema: { project_slug: z.string().optional(), commitment_id: z.number().int().optional(), payee_kind: z.enum(["vendor", "sub", "one_off"]), vendor_id: z.string().optional(), sub_slug: z.string().optional(), payee_name: z.string(), bill_number: z.string().optional(), amount_cents: z.number().int(), file_id: z.string().optional() } },
    async (a) => {
      try {
        const id = a.project_slug ? await project(a.project_slug) : null;
        const p = await principal();
        return json(await tx((r) => receiveBill(r, { projectId: id, commitmentId: a.commitment_id ?? null, payeeKind: a.payee_kind, vendorId: a.vendor_id ?? null, subSlug: a.sub_slug ?? null, payeeName: a.payee_name, billNumber: a.bill_number, amountCents: a.amount_cents, fileId: a.file_id ?? null, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "stage_payment_decision",
    { title: "Stage the SEPARATE payment decision for a bill", description: "Payment is its own one-tap decision (never implied by the purchase approval): matched obligation, acceptance, payable amount and the validated destination. Untrusted email can never set a payee's bank details.", inputSchema: { bill_id: z.number().int(), href: z.string().optional() } },
    async (a) => {
      try {
        const p = await principal();
        return json(await tx((r) => stagePaymentDecision(r, { billId: a.bill_id, principal: p, href: a.href ?? null })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "execute_approved_payment",
    { title: "Execute an APPROVED payment", description: "Consumes the payment decision. With no supported payment rail the bill becomes manual_pending with Joe's execution step — it is never reported paid until record_manual_payment_confirmation with evidence. Retries cannot duplicate a disbursement.", inputSchema: { bill_id: z.number().int(), decision_id: z.string().uuid() } },
    async (a) => {
      try {
        const p = await principal();
        return json(await tx((r) => executePayment(r, { billId: a.bill_id, decisionId: a.decision_id, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "record_manual_payment_confirmation",
    { title: "Joe confirms a manual payment moved", description: "Evidence (check number, bank confirmation, date, amount) that the approved bill was actually paid outside SJC OS. Consumes/releases the cash reservation and escalates any shortfall.", inputSchema: { bill_id: z.number().int(), evidence: z.object({ method: z.string(), reference: z.string().optional(), paidAt: z.string().optional(), amountCents: z.number().int().optional(), note: z.string().optional(), fileId: z.string().optional() }) } },
    async (a) => {
      try {
        const p = await principal();
        return json(await tx((r) => recordManualPaymentConfirmation(r, { billId: a.bill_id, evidence: a.evidence, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "stage_package_release",
    { title: "Stage bid-package release cards (W06)", description: "One exact release decision per recipient for a bid package revision: verified recipient + trade, included work, exclusions (Joe's retained work named), quantities/units, attachment revisions, assumptions/gaps, changes since the last review, exact effect. Individual release at any time; NOT sent until approved.", inputSchema: { package_id: z.number().int(), invite_ids: z.array(z.number().int()).optional(), inclusions: z.array(z.string()).optional(), exclusions: z.array(z.string()).optional(), quantities: z.array(z.object({ label: z.string(), qty: z.union([z.number(), z.string()]), unit: z.string().optional() })).optional(), assumptions: z.array(z.string()).optional(), gaps: z.array(z.string()).optional(), href: z.string().optional() } },
    async (a) => {
      try {
        const p = await principal();
        return json(await tx((r) => stagePackageRelease(r, { packageId: a.package_id, inviteIds: a.invite_ids ?? null, inclusions: a.inclusions, exclusions: a.exclusions, quantities: a.quantities, assumptions: a.assumptions, gaps: a.gaps, principal: p, href: a.href ?? null })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "stage_vendor_pricing_request",
    { title: "Stage a pricing request to a vendor record (W05, procurement side)", description: "Exact products/quantities (or explicit quantity gaps), need-by date and attachments to a TRUSTED vendor record; a release decision for Joe. Marketplace vendors (Fiverr) get manual steps, never automation.", inputSchema: { project_slug: z.string(), vendor_id: z.string(), products: z.array(z.object({ description: z.string(), model: z.string().optional(), variant: z.string().optional(), finish: z.string().optional(), unit: z.string(), qty: z.number().nullable(), qtyGap: z.string().optional() })), needed_by: z.string().optional(), attachments: z.array(z.object({ label: z.string(), fileId: z.string(), revision: z.string().optional() })).optional(), notes: z.string().optional(), href: z.string().optional() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const p = await principal();
        return json(await tx((r) => stageSupplierPricingRequest(r, { projectId: id, vendorId: a.vendor_id, products: a.products, neededBy: a.needed_by ?? null, attachments: a.attachments, notes: a.notes, principal: p, href: a.href ?? null })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "select_bid_for_estimate",
    { title: "Propose a sub bid for the estimate (not an award)", description: "Stages Joe's choice of a bid for ESTIMATE use. Choosing a bid is not awarding the work and not a purchase.", inputSchema: { invite_id: z.number().int(), rationale: z.string().optional(), href: z.string().optional() } },
    async (a) => {
      try {
        const p = await principal();
        return json(await tx((r) => selectBidForEstimate(r, { inviteId: a.invite_id, principal: p, rationale: a.rationale, href: a.href ?? null })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "award_bid",
    { title: "Award a bid (purchase decision required)", description: "Without decision_id this only stages the purchase decision. With an APPROVED decision it commits the award (cash reservation, construction gate) — the award email is then dispatched.", inputSchema: { invite_id: z.number().int(), decision_id: z.string().uuid().optional(), preconstruction_service: z.boolean().optional(), href: z.string().optional() } },
    async (a) => {
      try {
        const p = await principal();
        return json(await tx((r) => awardBid(r, { inviteId: a.invite_id, decisionId: a.decision_id ?? null, principal: p, preconstructionService: a.preconstruction_service ?? false, href: a.href ?? null })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "request_company_funding",
    { title: "Stage a company-cash funding decision (W09)", description: "When project funds actually collected cannot cover a commitment: stages the explicit funding decision naming project, amount, purpose and effect. An ordinary purchase tap never authorises company cash.", inputSchema: { project_slug: z.string(), amount_cents: z.number().int().positive(), purpose: z.string(), effect: z.string().optional(), commitment_id: z.number().int().optional() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const p = await principal();
        return json(await tx((r) => escalateShortfall(r, { projectId: id, amountCents: a.amount_cents, purpose: a.purpose, effect: a.effect, commitmentId: a.commitment_id ?? null, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "void_commitment",
    { title: "Void a commitment (draft/approved only)", description: "Cancels an unsent commitment and releases its reservation. Committed orders are cancelled with the vendor, not voided here.", inputSchema: { commitment_id: z.number().int(), reason: z.string() } },
    async (a) => {
      try {
        return json({ ok: await tx((r) => voidCommitment(r, a.commitment_id, a.reason)) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // Read helper used by the bill tools' consumers.
  server.registerTool(
    "get_bill",
    { title: "Bill status", description: "A bill's match state, payable ceiling, payment decision and payment state (approved / manual_pending / paid with evidence).", inputSchema: { bill_id: z.number().int() } },
    async ({ bill_id }) => {
      try {
        const b = await getBill(run, bill_id);
        return json(b ?? { ok: false, error: "no such bill" });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

// A15 / WORKFLOW W02–W07 estimating tools. Direct calls into the pure
// estimating library (lib/estimating) inside one transaction per tool.
// Nothing here sends: supplier requests and competing-quote choices are
// staged as decisions (the dispatcher announces them); owner prices need the
// owner (or a decision reference); the client price is never touched after
// an offer is sent.

import { z } from "zod";
import { getScopeRegister, allocateScope, applySiteFindings, getSiteVisitPlan } from "../lib/estimating/scope.ts";
import { setDesignPath, applyClientExactProduct, applyFeedback, applyClientDirectionApproval, applySelectionChoice, getDesignDecisions } from "../lib/estimating/design.ts";
import { researchPrice, candidateSuppliers, stageSupplierPricingRequest, recordSupplierEvidence } from "../lib/estimating/pricing.ts";
import { fakeFetcher } from "../lib/estimating/fetcher.ts";
import { recordQuote, incorporateQuote, compareCompetingQuotes, chooseSupplierQuote, incorporateSubBid, applyOwnerPricing, recomputeDraftEstimate, freezeOfferedPrices, marginExposureReport, stageAllowanceOverage, loadLines } from "../lib/estimating/assembly.ts";
import { estimateReadiness } from "../lib/estimating/readiness.ts";
import { proposePricingSetup, listPricingSetups } from "../lib/estimating/setup.ts";
import { costLearningPreview } from "../lib/estimating/learning.ts";
import { txOver, principalFor, fail, agentNameOf } from "./tool-shared.mjs";

const product = z.object({ name: z.string().optional(), brand: z.string().optional(), model: z.string().optional(), variant: z.string().optional(), finish: z.string().optional(), sku: z.string().optional(), url: z.string().optional() });

export function registerEstimatingTools(server, { rows, json, pool, slugToId, currentPrincipal, estimatingCall }) {
  const tx = txOver(pool);
  const run = async (sql, params) => rows(sql, params ?? []);
  const principal = () => principalFor(currentPrincipal, agentNameOf(server));
  const project = async (slug) => {
    const id = await slugToId("projects", slug);
    if (!id) throw new Error(`No project ${slug}`);
    return id;
  };
  const formalEstimate = async (projectId) => {
    const r = await run(`SELECT id::int AS id FROM estimates WHERE project_id = $1 AND kind = 'formal' ORDER BY created_at LIMIT 1`, [projectId]);
    if (!r[0]) throw new Error("This project has no formal estimate yet (it is created when the pre-con agreement is signed; get_project_workflow shows the gate).");
    return r[0].id;
  };

  server.registerTool(
    "get_scope_register",
    { title: "Scope register + site-visit plan", description: "The project's work packages: trade, responsibility (Joe / sub / supplier / unassigned), supply-vs-install split, exclusions, quantities, unverified assumptions, Joe's dedicated prices — plus the current site-visit plan and its open checklist items.", inputSchema: { project_slug: z.string() } },
    async ({ project_slug }) => {
      try {
        const id = await project(project_slug);
        return json({ ok: true, register: await getScopeRegister(run, id), site_visit_plan: await getSiteVisitPlan(run, id), design: await getDesignDecisions(run, id) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "allocate_scope",
    { title: "Allocate a scope item (W03)", description: "Record Joe's scope allocation: who does the work (joe/sub/supplier), supply/install split, and — for work Joe retains — his dedicated price with its basis (internal_cost or client_price). Retaining removes the LABOR from sub solicitation; materials stay. Ambiguous basis is refused with a question, never guessed. Owner input only: an agent records what Joe said.", inputSchema: { project_slug: z.string(), key: z.string(), responsibility: z.enum(["joe", "sub", "supplier", "unassigned"]).optional(), supply_by: z.enum(["joe", "sub", "supplier", "client", "unassigned"]).optional(), install_by: z.enum(["joe", "sub", "unassigned"]).optional(), dedicated_price_cents: z.number().int().positive().optional(), price_basis: z.enum(["internal_cost", "client_price"]).optional(), price_scope_note: z.string().optional(), notes: z.string().optional() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const p = await principal();
        return json(await tx((r) => allocateScope(r, id, { key: a.key, responsibility: a.responsibility, supply_by: a.supply_by, install_by: a.install_by, dedicated_price_cents: a.dedicated_price_cents ?? null, price_basis: a.price_basis ?? null, price_scope_note: a.price_scope_note, notes: a.notes, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "record_site_findings",
    { title: "Record site-visit findings (W03)", description: "Source-linked facts from Joe's uploaded notes/photos: measurements (with the scope quantity they answer), conditions, decisions, issues, new unpriced work. Updates affected scopes, quantities and estimate inputs; preserves Joe's allocations and prices unless a finding explicitly targets them (targets_price). Ambiguous findings become targeted questions. Never a package release.", inputSchema: { project_slug: z.string(), findings: z.array(z.object({ fact_key: z.string(), scope_key: z.string().optional(), kind: z.enum(["measurement", "condition", "decision", "issue", "preference", "new_work", "question"]), statement: z.string(), measurement: z.number().optional(), unit: z.string().optional(), source_note: z.string(), media_ref: z.string().optional(), targets_price: z.boolean().optional(), quantity_label: z.string().optional(), new_scope: z.object({ key: z.string(), title: z.string(), trade: z.string().optional(), room: z.string().optional() }).optional() })) } },
    async ({ project_slug, findings }) => {
      try {
        const id = await project(project_slug);
        const p = await principal();
        return json(await tx((r) => applySiteFindings(r, id, findings, { principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "set_design_path",
    { title: "Set a scope's design path (W04)", description: "Per room/scope: 'undefined' direction → mood board; 'defined' → selections; 'exact' → the client-specified product goes straight into the draft estimate. Changing an approved direction lists what it affects (selections, estimate items) instead of restarting.", inputSchema: { project_slug: z.string(), scope_key: z.string(), direction: z.enum(["undefined", "defined", "exact"]), room: z.string().optional(), board_room: z.string().optional(), notes: z.string().optional() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const p = await principal();
        return json(await tx((r) => setDesignPath(r, { project_id: id, scope_key: a.scope_key, direction: a.direction, room: a.room, board_room: a.board_room ?? null, notes: a.notes, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "apply_client_product",
    { title: "Client-specified product → estimate (W04 row 3)", description: "The client named the exact product/finish (source-linked instruction). Adds/updates its estimate item with cost UNKNOWN (a gap + research task), no selection board. Returns what research is still missing (unit, quantity, price).", inputSchema: { project_slug: z.string(), instruction_ref: z.string().describe("message id / note ref the client's instruction came from"), product, scope_key: z.string().optional(), qty: z.number().optional(), unit: z.string().optional() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const est = await formalEstimate(id);
        const p = await principal();
        return json(await tx((r) => applyClientExactProduct(r, { project_id: id, estimate_id: est, scope_key: a.scope_key ?? null, product: a.product, qty: a.qty ?? null, unit: a.unit ?? null, instruction_ref: a.instruction_ref, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "apply_design_feedback",
    { title: "Apply owner/client feedback to a design artifact (W04)", description: "Records feedback on the current board/selection revision. A comment ('looks great') changes nothing; a change request bumps the revision and puts the package back in Joe's review before any client release. Positive comments are never approval.", inputSchema: { project_slug: z.string(), scope_key: z.string(), author: z.string(), body: z.string() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        return json(await tx((r) => applyFeedback(r, { project_id: id, scope_key: a.scope_key, author: a.author, body: a.body })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "apply_client_direction_approval",
    { title: "Client approved a mood-board direction → prepare selections", description: "When the client approved a room's mood board (recorded on the board), prepare the undecided selections for that room, once (drafts Joe reviews before the client sees them).", inputSchema: { project_slug: z.string(), room: z.string() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const p = await principal();
        return json(await tx((r) => applyClientDirectionApproval(r, { project_id: id, room: a.room, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "apply_selection_choice",
    { title: "Client chose a selection → estimate (W07)", description: "Incorporate the client's actual choice on a selection into the draft estimate: the chosen option's item is added, superseded options / the allowance it replaces are removed once, partial choices stay open. Unselected options are never added.", inputSchema: { project_slug: z.string(), selection_id: z.number().int() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const est = await formalEstimate(id);
        const p = await principal();
        return json(await tx((r) => applySelectionChoice(r, { selection_id: a.selection_id, estimate_id: est, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "research_price",
    { title: "Research a product price (W05)", description: "Identify the exact model/variant/finish/unit and look for a price online (and in permissioned history) with source, date, currency, unit basis and tax/freight coverage. Records dated price observations; a supported online price provisionally lands in the draft estimate marked provisional. Never substitutes a similar product silently; never supplies a missing physical quantity.", inputSchema: { product, unit: z.string().optional(), qty: z.number().optional(), project_slug: z.string().optional(), item_key: z.string().optional(), urls: z.array(z.string()).optional() } },
    async (a) => {
      try {
        const id = a.project_slug ? await project(a.project_slug) : null;
        const est = id ? await formalEstimate(id).catch(() => null) : null;
        const input = { product: a.product, unit: a.unit ?? null, qty: a.qty ?? null, project_id: id, estimate_id: est, item_key: a.item_key ?? null, urls: a.urls };
        // The SSRF-guarded page fetcher lives in the app; use it when the app
        // is up, otherwise research history only and say so.
        if (estimatingCall) {
          const viaApp = await estimatingCall("research_price", { input });
          if (viaApp?.ok) return json(viaApp);
        }
        const out = await tx((r) => researchPrice(r, input, fakeFetcher()));
        return json({ ...out, fetcher: "history_only", note: "Online lookup unavailable from this process (app unreachable); only permissioned price history was searched." });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "candidate_suppliers",
    { title: "Likely suppliers for a category (W05)", description: "Three evidence levels kept apart: (1) category inference (a lumberyard for lumber/doors/windows/siding/roofing — e.g. Siweck Lumber), (2) history / owner-confirmed relationship, (3) a current quote. Category is a sourcing clue, never proof of stock, brand or a discount.", inputSchema: { category: z.string() } },
    async ({ category }) => {
      try {
        return json(await candidateSuppliers(run, category));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "record_supplier_evidence",
    { title: "Record supplier knowledge", description: "Add dated evidence that a supplier can source a category (level 2 = owner-confirmed/history, level 3 = current quote). Never invents a standing discount.", inputSchema: { name: z.string(), category: z.string(), evidence_level: z.union([z.literal(2), z.literal(3)]), source: z.string(), observed_at: z.string().optional(), notes: z.string().optional() } },
    async (a) => {
      try {
        return json(await tx((r) => recordSupplierEvidence(r, a)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "stage_supplier_pricing_request",
    { title: "Stage a supplier pricing request for Joe's approval (W05)", description: "Builds the exact request (products, quantities or explicit quantity gaps, need dates, documents) and stages a release decision. NOT sent: Joe approves the card (SJC OS / Telegram). Overrides the routine-message policy on purpose.", inputSchema: { project_slug: z.string(), supplier_name: z.string(), vendor_id: z.string().optional(), products: z.array(z.object({ product, qty: z.number().nullable(), unit: z.string().nullable(), item_key: z.string().optional(), scope_key: z.string().optional(), quantity_gap: z.string().optional() })), need_dates: z.object({ materials_on_site: z.string().optional(), quote_by: z.string().optional() }).optional(), documents: z.array(z.object({ label: z.string(), file_id: z.string().optional(), revision: z.string().optional() })).optional(), notes: z.string().optional() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const p = await principal();
        return json(await tx((r) => stageSupplierPricingRequest(r, { project_id: id, supplier_name: a.supplier_name, vendor_id: a.vendor_id ?? null, products: a.products, need_dates: a.need_dates, documents: a.documents, notes: a.notes, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "record_quote",
    { title: "Record a supplier/sub quote (W07)", description: "Store a received quote with its lines (exact products, units, quantities, supply/install, tax/freight coverage, expiry). Give competing offers the same competing_group. Then incorporate_quote decides what happens.", inputSchema: { project_slug: z.string(), supplier_kind: z.enum(["vendor", "sub"]), supplier_name: z.string(), vendor_id: z.string().optional(), sub_slug: z.string().optional(), quote_ref: z.string().optional(), revision: z.number().int().optional(), received_at: z.string().optional(), expires_at: z.string().optional(), includes_tax: z.boolean().optional(), tax_cents: z.number().int().optional(), includes_freight: z.boolean().optional(), freight_cents: z.number().int().optional(), competing_group: z.string().optional(), coverage: z.object({ scope_keys: z.array(z.string()).optional(), item_keys: z.array(z.string()).optional(), exclusions: z.array(z.string()).optional() }).optional(), notes: z.string().optional(), lines: z.array(z.object({ description: z.string(), product: product.optional(), unit: z.string().optional(), quantity: z.number().optional(), unit_price_cents: z.number().int().optional(), extended_cents: z.number().int().optional(), supply: z.boolean().optional(), install: z.boolean().optional(), scope_key: z.string().optional(), item_key: z.string().optional(), notes: z.string().optional() })) } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        return json(await tx((r) => recordQuote(r, { ...a, project_id: id, vendor_id: a.vendor_id ?? null, sub_slug: a.sub_slug ?? null })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "incorporate_quote",
    { title: "Incorporate a quote into the draft estimate (W07)", description: "Noncompetitive quote → replaces the matching provisional cost after product/quantity/coverage checks (skips with reasons otherwise). Competing quotes → held and compared, one supplier_choice decision for Joe; nothing summed or auto-picked. Never changes a client price already sent.", inputSchema: { project_slug: z.string(), quote_id: z.string().uuid() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const est = await formalEstimate(id);
        const p = await principal();
        return json(await tx((r) => incorporateQuote(r, { quote_id: a.quote_id, estimate_id: est, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "compare_competing_quotes",
    { title: "Compare competing quotes (W07)", description: "Equivalent-scope comparison for a competing group (totals, coverage, exclusions, lead times) and the single pending supplier_choice decision. Joe chooses; then choose_supplier_quote.", inputSchema: { project_slug: z.string(), group: z.string() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const p = await principal();
        return json(await tx((r) => compareCompetingQuotes(r, id, a.group, p)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "choose_supplier_quote",
    { title: "Apply Joe's supplier choice", description: "After the supplier_choice decision is APPROVED, incorporate the chosen quote (others in the group are rejected). Refused while the decision is pending.", inputSchema: { project_slug: z.string(), quote_id: z.string().uuid(), decision_id: z.string().uuid() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const est = await formalEstimate(id);
        const p = await principal();
        return json(await tx((r) => chooseSupplierQuote(r, { quote_id: a.quote_id, decision_id: a.decision_id, estimate_id: est, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "incorporate_sub_bid",
    { title: "Joe approved a sub bid for the estimate (W07)", description: "Records the bid as a sub quote covering the named scope keys (with its exclusions as gaps) and incorporates it. Owner authority (or a decision reference) is required; this does NOT award the work.", inputSchema: { project_slug: z.string(), bid_submission_id: z.number().int(), scope_keys: z.array(z.string()).min(1), auth_ref: z.string().optional().describe("decision:<id> when Joe approved on a card") } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const est = await formalEstimate(id);
        const p = await principal();
        return json(await tx((r) => incorporateSubBid(r, { bid_submission_id: a.bid_submission_id, estimate_id: est, scope_keys: a.scope_keys, principal: p, auth_ref: a.auth_ref ?? null })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "apply_owner_pricing",
    { title: "Apply Joe's dedicated price to an estimate item (W07)", description: "Joe supplied a price for an item: applied to that item with its basis (client_price used as-is; internal_cost marked up once). Owner input only — record what Joe stated.", inputSchema: { project_slug: z.string(), item_key: z.string(), price_cents: z.number().int().positive(), basis: z.enum(["internal_cost", "client_price"]), note: z.string().optional() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const est = await formalEstimate(id);
        const p = await principal();
        return json(await tx((r) => applyOwnerPricing(r, { estimate_id: est, item_key: a.item_key, price_cents: a.price_cents, basis: a.basis, principal: p, note: a.note })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "estimate_readiness",
    { title: "Estimate readiness (evidence checks, W07)", description: "Recompute the draft and score it on evidence: scope allocation, quantities/units, price sources and dates, sub quotes, exclusions, uncertainty, margin arithmetic. Lists hard/soft gaps, provisional lines, allowances, margin exposure and whether a fixed proposal or only a rough range is supportable. Not model confidence.", inputSchema: { project_slug: z.string() } },
    async ({ project_slug }) => {
      try {
        const id = await project(project_slug);
        const est = await formalEstimate(id);
        const out = await tx(async (r) => {
          const rc = await recomputeDraftEstimate(r, est);
          return { recompute: rc, readiness: await estimateReadiness(r, est, { persist: true }), margin: await marginExposureReport(r, est), lines: await loadLines(r, est) };
        });
        return json(out);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "freeze_offered_prices",
    { title: "Freeze the offered client prices (send-time snapshot)", description: "Call when Joe's approved offer is SENT: snapshots every client price as committed. Later supplier costs change internal margin only; a changed estimate after this needs a fresh proposal decision. Owner authority required.", inputSchema: { project_slug: z.string() } },
    async ({ project_slug }) => {
      try {
        const id = await project(project_slug);
        const est = await formalEstimate(id);
        const p = await principal();
        if (p.onBehalfOf?.role !== "owner") return json({ ok: false, error: "Freezing an offer is the owner's send; stage the proposal decision instead." });
        return json(await tx((r) => freezeOfferedPrices(r, est, p)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "stage_allowance_overage",
    { title: "Client chose above an allowance → change-order payload + decision (W07/W11)", description: "Prices the overage (chosen cost with the active markup minus the allowance) as a change-order payload and stages a change_order decision for Joe. No change_orders row is written here; under the allowance returns the credit.", inputSchema: { project_slug: z.string(), item_key: z.string(), chosen: z.object({ description: z.string(), cost_cents: z.number().int(), source_ref: z.record(z.string(), z.unknown()).optional() }) } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        const est = await formalEstimate(id);
        const p = await principal();
        return json(await tx((r) => stageAllowanceOverage(r, { estimate_id: est, item_key: a.item_key, chosen: a.chosen, principal: p })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "pricing_setup",
    { title: "Pricing setup (rates, markup, allowances)", description: "List the versioned pricing setups (only Joe activates one), or propose a new evidence-backed draft from the cost book and closed jobs; unsupported values stay NULL with a reason, never zero.", inputSchema: { propose: z.boolean().optional(), notes: z.string().optional() } },
    async ({ propose, notes }) => {
      try {
        if (propose) {
          const p = await principal();
          return json(await tx((r) => proposePricingSetup(r, p, { notes })));
        }
        return json(await listPricingSetups(run));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "cost_learning_preview",
    { title: "Cost learning preview (A15 closeout learning)", description: "What verified closeout actuals would change in the cost book under the outlier/small-sample guards, and the revision history (applied, proposed, rolled back). Preview only; automatic updates run only under the active learning.cost_update policy; markup changes are always a decision.", inputSchema: {} },
    async () => {
      try {
        return json(await costLearningPreview(run));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

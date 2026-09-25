import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUnit,
  unitsCompatible,
  productKey,
  identifyProduct,
  breakdownScope,
  extractStatedQuantities,
  siteVisitPlanFor,
  decideDesignPath,
  inferDirection,
  classifyFeedback,
  priceLine,
  committedPrice,
  clientFacingLines,
  prepareAllowanceOverageChangeOrder,
  priceObservationGaps,
  quoteCoverageCheck,
  outlierGuard,
  estimateReadinessScore,
  heldOutEvaluation,
} from "../lib/estimating/rules.ts";
import { fakeFetcher, chooseFetcher } from "../lib/estimating/fetcher.ts";

// Pure rules for A15 / WORKFLOW W02–W07: no db, no network. The DB-backed
// counterparts are in tests/estimating-db.test.mjs.

const base = { id: 1, item_key: "x", description: "Thing", qty: 2, unit: "ea", unit_cost: 0, markup: 0, source_kind: "client_product", internal_cost_cents: null, owner_price_override_cents: null, owner_price_basis: null, is_allowance: false, allowance_cents: null, cost_observed_at: null, provisional: false };

test("units: aliases normalize, unknown units are null (a gap), wrong units are flagged", () => {
  assert.equal(normalizeUnit("Sq. Ft."), "sf");
  assert.equal(normalizeUnit("linear feet"), "lf");
  assert.equal(normalizeUnit("EACH"), "ea");
  assert.equal(normalizeUnit("bananas"), null);
  assert.equal(unitsCompatible("sqft", "sf"), true);
  assert.equal(unitsCompatible("sf", "lf"), false);
  assert.equal(unitsCompatible("sf", "bananas"), false);
});

test("product identity: stable key, missing fields named, quantity is never invented", () => {
  const p = { brand: "Delta", model: "Trinsic 559LF", finish: "Matte Black" };
  assert.equal(productKey(p), "delta|trinsic-559lf||matte-black");
  const id = identifyProduct(p, { unit: "ea", qty: null });
  assert.deepEqual(id.missing, ["quantity"]);
  assert.equal(id.exact, true);
  assert.ok(identifyProduct({ name: "some faucet" }, {}).missing.includes("brand"));
});

test("W02 scope breakdown: deterministic packages, trades, supplier categories, finishes, exclusions, unverified marks; stated quantities are lead statements", () => {
  const facts = { lead_id: "L1", name: "Kitchen remodel", scope: "Full kitchen remodel, about 220 sq ft, new deck out back", intake: [{ question: "Timeline", answer: "spring" }] };
  const b = breakdownScope(facts);
  const keys = b.items.map((i) => i.key);
  assert.ok(keys.includes("kitchen.cabinetry") && keys.includes("deck.framing") && keys.includes("general.permits"));
  assert.deepEqual(b.matched_rules, ["Kitchen", "Exterior"]);
  const cab = b.items.find((i) => i.key === "kitchen.cabinetry");
  assert.equal(cab.trade, "Cabinetry");
  assert.deepEqual(cab.supplier_categories, ["cabinets"]);
  assert.ok(cab.required_finishes.some((f) => f.label.startsWith("Cabinet") && f.status === "undecided"));
  assert.equal(cab.unverified, true);
  assert.ok(cab.assumptions[0].unverified);
  assert.ok(cab.dependencies.includes("kitchen.demo"), "finishes depend on demo in the same room");
  const floor = b.items.find((i) => i.key === "kitchen.flooring");
  const q = floor.quantities.find((x) => x.unit === "sf");
  assert.equal(q.qty, 220);
  assert.equal(q.basis, "lead_statement", "a stated number is not a measurement");
  const cabRun = cab.quantities.find((x) => x.unit === "lf");
  assert.equal(cabRun.qty, null, "unmeasured quantity stays unknown");
  assert.ok(b.items.find((i) => i.key === "kitchen.appliances").exclusions.length > 0);
  assert.equal(breakdownScope({ scope: "" }).items.every((i) => i.key.startsWith("general.")), true);
  const odd = breakdownScope({ scope: "install a koi pond" });
  assert.equal(odd.unmatched_text, true);
  assert.equal(odd.items[0].key, "general.unclassified");
  assert.deepEqual(extractStatedQuantities("1,200 sq ft and 40 lf"), [
    { label: "Stated in lead", qty: 1200, unit: "sf", basis: "lead_statement", source: "1,200 sq ft" },
    { label: "Stated in lead", qty: 40, unit: "lf", basis: "lead_statement", source: "40 lf" },
  ]);
});

test("W03 site-visit plan is tailored by scope: measurements for unknown quantities, photos, trade inspections, client questions", () => {
  const b = breakdownScope({ scope: "bathroom remodel" });
  const plan = siteVisitPlanFor(b.items);
  const tile = plan.filter((p) => p.scope_key === "bath.tile");
  assert.ok(tile.some((p) => p.kind === "measure" && p.unit === "sf"));
  assert.ok(tile.some((p) => p.kind === "photo"));
  assert.ok(tile.some((p) => p.kind === "inspect" && /substrate/i.test(p.prompt)));
  assert.ok(tile.some((p) => p.kind === "question" && /Floor tile/.test(p.prompt)));
  assert.ok(plan.every((p) => p.status === "open"));
});

test("W04 design path: unclear → mood board, defined → selections, exact → direct estimate; comments are not approval", () => {
  assert.equal(decideDesignPath("undefined"), "mood_board");
  assert.equal(decideDesignPath("defined"), "selections");
  assert.equal(decideDesignPath("exact"), "direct_estimate");
  assert.equal(inferDirection({ exact_products: 1 }), "exact");
  assert.equal(inferDirection({ style_defined: true }), "defined");
  assert.equal(inferDirection({ stated_preferences: 1 }), "undefined");
  assert.equal(classifyFeedback("Love it, looks great!"), "comment");
  assert.equal(classifyFeedback("Closer, but warmer wood tones please"), "change_request");
});

test("W07 line pricing: unknown cost is a gap not zero; owner client price is never marked up; owner internal cost marked up once; allowance shows as its amount", () => {
  const unknown = priceLine(base, { default_markup_pct: 20 });
  assert.equal(unknown.extended_cents, null);
  assert.equal(unknown.internal_cost_cents, null);
  assert.ok(unknown.gaps.some((g) => g.kind === "unknown_cost" && g.severity === "hard"));

  const ownerClient = priceLine({ ...base, owner_price_override_cents: 100000, owner_price_basis: "client_price" }, { default_markup_pct: 20 });
  assert.equal(ownerClient.extended_cents, 100000, "no double markup");
  assert.equal(ownerClient.mode, "owner_client_price");

  const ownerCost = priceLine({ ...base, owner_price_override_cents: 100000, owner_price_basis: "internal_cost" }, { default_markup_pct: 20 });
  assert.equal(ownerCost.extended_cents, 120000);
  assert.equal(ownerCost.internal_cost_cents, 100000);

  const costPlus = priceLine({ ...base, internal_cost_cents: 50000 }, { default_markup_pct: 25 });
  assert.equal(costPlus.extended_cents, 62500);

  const allowance = priceLine({ ...base, is_allowance: true, allowance_cents: 150000 }, { default_markup_pct: 20 });
  assert.equal(allowance.extended_cents, 150000);
  assert.equal(allowance.mode, "allowance");
  const emptyAllowance = priceLine({ ...base, is_allowance: true, allowance_cents: null }, { default_markup_pct: 20 });
  assert.equal(emptyAllowance.extended_cents, null);

  const legacy = priceLine({ ...base, source_kind: null, unit_cost: 1000, qty: 3 }, { default_markup_pct: 10 });
  assert.equal(legacy.internal_cost_cents, 3000, "legacy editor line: unit_cost × qty is the cost");
  assert.equal(legacy.extended_cents, 3300);

  const stale = priceLine({ ...base, internal_cost_cents: 100, cost_observed_at: "2025-01-01T00:00:00Z" }, { default_markup_pct: 0, now: new Date("2026-09-23") });
  assert.ok(stale.gaps.some((g) => g.kind === "stale_price"));
  const badUnit = priceLine({ ...base, unit: "bananas", internal_cost_cents: 100 }, { default_markup_pct: 0 });
  assert.ok(badUnit.gaps.some((g) => g.kind === "missing_unit"));
  const noQty = priceLine({ ...base, qty: 0, internal_cost_cents: 100 }, { default_markup_pct: 0 });
  assert.ok(noQty.gaps.some((g) => g.kind === "missing_quantity"));
});

test("W07 committed price: a sent line keeps its offered price; added lines / changed quantities are offer changes", () => {
  const snap = { revision: 1, offered_at: "2026-09-01", total: 1000, lines: [{ item_key: "a", line_id: 1, description: "A", qty: 2, unit: "ea", extended: 1000, internal_cost_cents: 800, is_allowance: false, allowance_cents: null, allowance_scope: null }] };
  assert.deepEqual(committedPrice({ item_key: "a", id: 1, qty: 2, description: "A" }, 1500, snap), { extended_cents: 1000, offer_changed: null });
  const qty = committedPrice({ item_key: "a", id: 1, qty: 3, description: "A" }, 1500, snap);
  assert.equal(qty.extended_cents, 1000);
  assert.equal(qty.offer_changed.kind, "offer_changed");
  const added = committedPrice({ item_key: "b", id: 2, qty: 1, description: "B" }, 500, snap);
  assert.equal(added.offer_changed.kind, "offer_changed");
  assert.deepEqual(committedPrice({ item_key: "a", id: 1, qty: 2, description: "A" }, 1500, null), { extended_cents: 1500, offer_changed: null });
});

test("client-facing serializer hides provisional/internal/source, keeps allowance terms, withholds unpriceable lines instead of showing $0", () => {
  const lines = [
    { description: "Faucet", section: "Kitchen", qty: 1, unit: "ea", extended: 42000, is_allowance: false, allowance_cents: null, allowance_scope: null, provisional: true, internal_cost_cents: 35000, superseded_by: null },
    { description: "Tile allowance", section: "Bath", qty: 1, unit: "ls", extended: 150000, is_allowance: true, allowance_cents: 150000, allowance_scope: "Floor tile", provisional: false, internal_cost_cents: 150000, superseded_by: null },
    { description: "Mystery", section: "Bath", qty: 1, unit: "ea", extended: 0, is_allowance: false, allowance_cents: null, allowance_scope: null, provisional: true, internal_cost_cents: null, superseded_by: null },
    { description: "Old", section: "Bath", qty: 1, unit: "ea", extended: 10, is_allowance: false, allowance_cents: null, allowance_scope: null, provisional: false, internal_cost_cents: 5, superseded_by: 9 },
  ];
  const out = clientFacingLines(lines);
  assert.equal(out.lines.length, 2);
  assert.equal(JSON.stringify(out.lines).includes("provisional"), false);
  assert.equal(JSON.stringify(out.lines).includes("internal"), false);
  assert.equal(out.lines[0].price_cents, 42000);
  assert.equal(out.lines[1].allowance.covers, "Floor tile");
  assert.match(out.lines[1].allowance.terms, /change order/);
  assert.deepEqual(out.withheld, ["Mystery"]);
});

test("allowance overage: priced CO payload only above the allowance; under is a credit (null)", () => {
  const line = { item_key: "allow:tile", description: "Tile allowance", allowance_cents: 150000, allowance_scope: "Floor tile" };
  const co = prepareAllowanceOverageChangeOrder({ allowance_line: line, chosen: { description: "Marble 12x24", cost_cents: 200000 }, markup_pct: 20 });
  assert.equal(co.kind, "change_order_draft");
  assert.equal(co.chosen_cents, 240000);
  assert.equal(co.overage_cents, 90000);
  assert.equal(co.price_cents, 90000);
  assert.deepEqual(co.requires, ["owner_approval", "client_acceptance", "payment_before_work"]);
  assert.equal(prepareAllowanceOverageChangeOrder({ allowance_line: line, chosen: { description: "Ceramic", cost_cents: 100000 }, markup_pct: 20 }), null);
});

test("W05 price observations: missing unit/freight/tax are gaps, old quotes are dated evidence, no price is not $0", () => {
  const now = new Date("2026-09-23");
  const good = priceObservationGaps({ product: { brand: "A", model: "B" }, unit: "ea", price_cents: 1000, source_kind: "online", includes_tax: false, includes_freight: false, observed_at: "2026-09-20" }, { now });
  assert.deepEqual(good, []);
  const kinds = priceObservationGaps({ product: { brand: "A", model: "B" }, unit: null, price_cents: null, source_kind: "online", observed_at: "2026-09-20" }, { now }).map((g) => g.kind);
  assert.deepEqual(kinds.sort(), ["missing_freight", "missing_tax", "missing_unit", "unknown_cost"]);
  const old = priceObservationGaps({ product: { brand: "A", model: "B" }, unit: "ea", price_cents: 1000, source_kind: "historical_quote", includes_tax: true, includes_freight: true, observed_at: "2025-11-01" }, { now });
  assert.equal(old[0].kind, "stale_price");
  assert.match(old[0].detail, /dated evidence/);
  const expired = priceObservationGaps({ product: { brand: "A", model: "B" }, unit: "ea", price_cents: 1000, source_kind: "supplier_quote", includes_tax: true, includes_freight: true, observed_at: "2026-09-01", expires_at: "2026-09-10" }, { now });
  assert.equal(expired[0].severity, "hard");
});

test("quote coverage: product / unit / quantity must match before a quote prices an item", () => {
  assert.equal(quoteCoverageCheck({ product_key: "a|b", unit: "sf", quantity: 100 }, { product_key: "a|b", unit: "sq ft", qty: 100 }).ok, true);
  const bad = quoteCoverageCheck({ product_key: "a|c", unit: "lf", quantity: 50 }, { product_key: "a|b", unit: "sf", qty: 100 });
  assert.deepEqual(bad.issues.map((i) => i.kind).sort(), ["coverage_missing", "coverage_missing", "units_mismatch"]);
});

test("V25 learning guards: small samples and big jumps are recorded, not applied; outliers flagged", () => {
  const few = outlierGuard(1000, [1100, 1200]);
  assert.equal(few.apply, false);
  assert.match(few.reason, /need 3/);
  const ok = outlierGuard(1000, [1100, 1150, 1050, 1200]);
  assert.equal(ok.apply, true);
  assert.equal(ok.proposed_unit_cost, 1125);
  const jump = outlierGuard(1000, [1500, 1600, 1550]);
  assert.equal(jump.apply, false);
  assert.match(jump.reason, /exceeds 25%/);
  const withOutlier = outlierGuard(1000, [1000, 1050, 950, 9000]);
  assert.deepEqual(withOutlier.outliers, [9000]);
  assert.equal(withOutlier.apply, true);
  assert.equal(withOutlier.proposed_unit_cost, 1000);
  assert.equal(outlierGuard(1000, []).apply, false);
});

test("readiness is arithmetic over evidence: hard gaps block a fixed proposal; a rough range is still possible", () => {
  const scope = [
    { key: "k.cab", status: "allocated", responsibility: "sub", unverified: false, quantities: [{ label: "run", qty: 20, unit: "lf", basis: "site_measurement" }], exclusions: ["appliances"] },
    { key: "k.top", status: "open", responsibility: "unassigned", unverified: true, quantities: [{ label: "area", qty: null, unit: "sf", basis: "unknown" }], exclusions: [] },
  ];
  const lines = [
    { item_key: "scope:k.cab", scope_item_key: "k.cab", provisional: false, internal_cost_cents: 500000, is_allowance: false, cost_observed_at: null, source_kind: "sub_bid", extended: 600000, superseded_by: null },
    { item_key: "scope:k.top", scope_item_key: "k.top", provisional: true, internal_cost_cents: null, is_allowance: false, cost_observed_at: null, source_kind: "assumption", extended: 0, superseded_by: null },
  ];
  const r = estimateReadinessScore({ scope_items: scope, lines, gaps: [{ kind: "unknown_cost", ref: "scope:k.top", severity: "hard", detail: "" }], sub_trades_needed: ["Cabinetry"], sub_quotes_present: ["Cabinetry"], markup_pct: 20 });
  assert.equal(r.eligibility, "rough_range");
  assert.equal(r.hard_gaps.length, 1);
  assert.equal(r.margin.margin_cents, null, "margin unknown while a cost is unknown");
  assert.equal(r.margin.unknown_cost_lines, 1);
  assert.ok(r.rough_range.low_cents < r.rough_range.high_cents);
  const full = estimateReadinessScore({ scope_items: [scope[0]], lines: [lines[0]], gaps: [], sub_trades_needed: ["Cabinetry"], sub_quotes_present: ["Cabinetry"], markup_pct: 20 });
  assert.equal(full.eligibility, "fixed_proposal");
  assert.equal(full.margin.margin_cents, 100000);
  const noMarkup = estimateReadinessScore({ scope_items: [scope[0]], lines: [lines[0]], gaps: [], sub_trades_needed: [], sub_quotes_present: [], markup_pct: null });
  assert.notEqual(noMarkup.eligibility, "fixed_proposal", "no active markup → no fixed price");
  assert.ok(Object.keys(r.components).length >= 7);
});

test("V17 held-out evaluation reports per-scope error and counts unknowns honestly", () => {
  const rep = heldOutEvaluation(
    [{ scope_key: "a", cents: 1100 }, { scope_key: "b", cents: null }, { scope_key: "c", cents: 900 }],
    [{ scope_key: "a", cents: 1000 }, { scope_key: "b", cents: 500 }, { scope_key: "c", cents: 1000 }, { scope_key: "d", cents: null }],
  );
  assert.equal(rep.compared, 2);
  assert.equal(rep.unknown, 2);
  assert.equal(rep.mean_abs_error_pct, 10);
  assert.equal(rep.bias_pct, 0);
  assert.match(rep.note, /not counted as zero/);
});

test("fetcher: fake under SJC_OUTBOUND_DISABLED, fixtures by product key, nothing found is empty not $0", async () => {
  process.env.SJC_OUTBOUND_DISABLED = "1";
  let liveCalled = false;
  const f = chooseFetcher(() => { liveCalled = true; return fakeFetcher(); }, { "delta|t1||black": [{ price_cents: 25000, unit: "ea", url: "https://example.test/p" }] });
  assert.equal(f.mode, "fake");
  assert.equal(liveCalled, false);
  const hit = await f.lookup({ brand: "Delta", model: "T1", finish: "Black" });
  assert.equal(hit.results[0].price_cents, 25000);
  const miss = await f.lookup({ brand: "Nope", model: "X" });
  assert.deepEqual(miss, { ok: true, results: [] });
});

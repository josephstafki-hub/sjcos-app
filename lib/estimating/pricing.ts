// Price discovery and supplier knowledge (WORKFLOW W05). Pure `run` style.
// Online prices are dated, sourced evidence that may PROVISIONALLY support an
// internal draft cost; supplier candidates come in three separated evidence
// levels; a supplier pricing request is staged behind a package_release
// decision and never sent from here.

import type { Run } from "../commands/core.ts";
import { contentHashOf, stageDecision } from "../commands/decisions.ts";
import type { Principal } from "../commands/principal.ts";
import { principalLabel } from "../commands/principal.ts";
import { recomputeDraftEstimate, upsertEstimateLine } from "./assembly.ts";
import { identifyProduct, normalizeUnit, priceObservationGaps, productKey } from "./rules.ts";
import type { FetchedPrice, Gap, PriceFetcher, PriceObservationInput, ProductIdentity } from "./types.ts";

export { identifyProduct } from "./rules.ts";

export async function recordPriceObservation(run: Run, o: PriceObservationInput): Promise<{ id: string; product_key: string; created: boolean; gaps: Gap[] }> {
  const key = productKey(o.product);
  const observedAt = o.observed_at ?? new Date().toISOString();
  const [row] = await run<{ id: string; inserted: boolean }>(
    `INSERT INTO price_observations (product_key, product, unit, unit_basis, pack_qty, price_cents, currency, source_kind, source_url, source_ref, observed_at, includes_tax, includes_freight, expires_at, supplier_name, vendor_id, project_id, notes)
     VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12,$13,$14::timestamptz,$15,$16,$17,$18)
     ON CONFLICT (product_key, source_kind, source_ref, observed_at) DO UPDATE SET notes = price_observations.notes
     RETURNING id, (xmax = 0) AS inserted`,
    [key, JSON.stringify(o.product), normalizeUnit(o.unit) ?? o.unit ?? null, o.unit_basis ?? "per_unit", o.pack_qty ?? null, o.price_cents ?? null, o.currency ?? "USD", o.source_kind, o.source_url ?? null, o.source_ref ?? "", observedAt, o.includes_tax ?? null, o.includes_freight ?? null, o.expires_at ?? null, o.supplier_name ?? null, o.vendor_id ?? null, o.project_id ?? null, o.notes ?? ""],
  );
  return { id: row.id, product_key: key, created: row.inserted, gaps: priceObservationGaps({ ...o, observed_at: observedAt }) };
}

export interface ResearchResult {
  product_key: string;
  identity: ReturnType<typeof identifyProduct>;
  fetcher: "live" | "fake";
  observations: Array<{ id: string; price_cents: number | null; unit: string | null; url: string; observed_at: string; gaps: Gap[]; substitution_note: string | null }>;
  historical: Array<{ id: string; price_cents: number | null; source_kind: string; observed_at: string; supplier_name: string | null; stale: boolean }>;
  /** The best current evidence that can provisionally support a draft cost, or null. */
  provisional: { observation_id: string; price_cents: number; unit: string; per_qty_cents: number | null } | null;
  gaps: Gap[];
  applied_line_id: number | null;
}

/** Look the product up through the injected fetcher (live: product pages;
 *  fake under SJC_OUTBOUND_DISABLED) and in permissioned history, record
 *  every observation with source/date/unit/coverage, and — when an estimate
 *  item is named — put the supported price on it as PROVISIONAL (supplier
 *  quote pending). Web pricing never supplies an unknown quantity. */
export async function researchPrice(
  run: Run,
  input: { product: ProductIdentity; unit?: string | null; qty?: number | null; project_id?: string | null; estimate_id?: number | null; item_key?: string | null; urls?: string[] },
  fetcher: PriceFetcher,
): Promise<ResearchResult> {
  const identity = identifyProduct(input.product, { unit: input.unit, qty: input.qty });
  const key = identity.product_key;
  const gaps: Gap[] = [];
  for (const m of identity.missing) {
    if (m === "quantity") gaps.push({ kind: "missing_quantity", ref: key, severity: "hard", detail: "quantity unknown — measure it (plans/site notes); a web price cannot supply it" });
    else if (m === "unit") gaps.push({ kind: "missing_unit", ref: key, severity: "hard", detail: "unit basis unknown" });
    else gaps.push({ kind: "unverified_assumption", ref: key, severity: "soft", detail: `product identity incomplete: ${m}` });
  }
  const observations: ResearchResult["observations"] = [];
  const looked = await fetcher.lookup(input.product, { urls: input.urls });
  if (looked.ok) {
    for (const r of looked.results as FetchedPrice[]) {
      const rec = await recordPriceObservation(run, {
        product: r.matched_product ?? input.product,
        unit: r.unit ?? input.unit ?? null,
        unit_basis: r.unit_basis,
        pack_qty: r.pack_qty ?? null,
        price_cents: r.price_cents,
        source_kind: "online",
        source_url: r.url,
        source_ref: r.url,
        observed_at: r.observed_at,
        includes_tax: r.includes_tax ?? null,
        includes_freight: r.includes_freight ?? null,
        supplier_name: r.supplier_name ?? null,
        project_id: input.project_id ?? null,
        notes: r.substitution_note ?? "",
      });
      observations.push({ id: rec.id, price_cents: r.price_cents, unit: r.unit ?? input.unit ?? null, url: r.url, observed_at: r.observed_at ?? new Date().toISOString(), gaps: rec.gaps, substitution_note: r.substitution_note ?? null });
    }
  } else {
    gaps.push({ kind: "unknown_cost", ref: key, severity: "hard", detail: `lookup failed: ${looked.error}` });
  }
  const hist = await run<{ id: string; price_cents: string | null; source_kind: string; observed_at: string; supplier_name: string | null; expires_at: string | null }>(
    `SELECT id, price_cents::text AS price_cents, source_kind, observed_at::text AS observed_at, supplier_name, expires_at::text AS expires_at FROM price_observations WHERE product_key = $1 AND source_kind <> 'online' ORDER BY observed_at DESC LIMIT 10`,
    [key],
  );
  const now = Date.now();
  const historical = hist.map((h) => ({ id: h.id, price_cents: h.price_cents == null ? null : Number(h.price_cents), source_kind: h.source_kind, observed_at: h.observed_at, supplier_name: h.supplier_name, stale: (h.expires_at != null && new Date(h.expires_at).getTime() < now) || now - new Date(h.observed_at).getTime() > 90 * 86_400_000 }));

  // Provisional support: the newest online observation with a price AND a compatible unit.
  const usable = observations.find((o) => o.price_cents != null && o.price_cents > 0 && normalizeUnit(o.unit) != null && (input.unit == null || normalizeUnit(o.unit) === normalizeUnit(input.unit)) && !o.substitution_note);
  const provisional = usable ? { observation_id: usable.id, price_cents: usable.price_cents!, unit: normalizeUnit(usable.unit)!, per_qty_cents: input.qty != null && input.qty > 0 ? Math.round(usable.price_cents! * input.qty) : null } : null;
  if (!provisional) gaps.push({ kind: "unknown_cost", ref: key, severity: "hard", detail: observations.length ? "online results lack a usable price/unit or describe a different product" : "no online price found" });

  let appliedLine: number | null = null;
  if (provisional && input.estimate_id && input.item_key) {
    if (provisional.per_qty_cents == null) {
      gaps.push({ kind: "missing_quantity", ref: input.item_key, severity: "hard", detail: "unit price found but quantity unknown — line stays unpriced" });
    } else {
      const [line] = await run<{ id: string; owner_price_basis: string | null; cost_basis: string | null }>(`SELECT id, owner_price_basis, cost_basis FROM estimate_lines WHERE estimate_id = $1 AND item_key = $2 AND superseded_by IS NULL`, [input.estimate_id, input.item_key]);
      if (line && line.owner_price_basis !== "client_price" && !(line.cost_basis ?? "").startsWith("quote:")) {
        const up = await upsertEstimateLine(run, input.estimate_id, {
          item_key: input.item_key,
          description: (await run<{ description: string }>(`SELECT description FROM estimate_lines WHERE id = $1`, [line.id]))[0].description,
          qty: input.qty ?? undefined,
          unit: provisional.unit,
          source_kind: "online_price",
          source_ref: { product: input.product, observation_id: provisional.observation_id },
          internal_cost_cents: provisional.per_qty_cents,
          cost_basis: `online:${provisional.observation_id}`,
          cost_observed_at: new Date().toISOString(),
          provisional: true,
          evidence: { kind: "online_price", observation_id: provisional.observation_id, url: usable!.url, cents: provisional.price_cents, unit: provisional.unit, note: "supplier quote pending", at: new Date().toISOString() },
        });
        appliedLine = up.id;
        await recomputeDraftEstimate(run, input.estimate_id);
      }
    }
  }
  return { product_key: key, identity, fetcher: fetcher.mode, observations, historical, provisional, gaps, applied_line_id: appliedLine };
}

export interface SupplierCandidates {
  category: string;
  inferred: Array<{ id: string; name: string; source: string; vendor_id: string | null; observed_at: string | null; notes: string }>;
  history: Array<{ id: string; name: string; source: string; vendor_id: string | null; observed_at: string | null; notes: string }>;
  current: Array<{ id: string; name: string; source: string; vendor_id: string | null; observed_at: string | null; notes: string }>;
  note: string;
}

/** Candidate suppliers for a category, with the three evidence levels kept
 *  apart: 1 = category inference, 2 = history / owner-confirmed relationship,
 *  3 = current dated quote. Vendor rows whose `trade` matches are level 1. */
export async function candidateSuppliers(run: Run, category: string): Promise<SupplierCandidates> {
  const cat = category.trim().toLowerCase();
  const rows = await run<{ id: string; name: string; evidence_level: number; source: string; vendor_id: string | null; observed_at: string | null; notes: string }>(
    `SELECT id, name, evidence_level, source, vendor_id, observed_at::text AS observed_at, notes FROM supplier_capabilities WHERE lower(category) = $1 ORDER BY evidence_level DESC, name`,
    [cat],
  );
  const vendors = await run<{ id: string; name: string; trade: string }>(`SELECT id, name, trade FROM vendors WHERE lower(trade) LIKE '%' || $1 || '%'`, [cat]);
  const pick = (lvl: number) => rows.filter((r) => r.evidence_level === lvl).map((r) => ({ id: r.id, name: r.name, source: r.source, vendor_id: r.vendor_id, observed_at: r.observed_at, notes: r.notes }));
  const inferred = pick(1);
  for (const v of vendors) if (!rows.some((r) => r.name.toLowerCase() === v.name.toLowerCase())) inferred.push({ id: `vendor:${v.id}`, name: v.name, source: `vendors.trade = "${v.trade}"`, vendor_id: v.id, observed_at: null, notes: "Vendor roster trade match — category inference only." });
  return { category: cat, inferred, history: pick(2), current: pick(3), note: "Levels are separate evidence: a category match is not a relationship, a relationship is not a current price, and no discount is assumed from any of them." };
}

/** Owner correction or a historical quote/purchase teaches the record (level 2);
 *  a current dated quote is level 3. Idempotent per (name, category, level, source). */
export async function recordSupplierEvidence(run: Run, input: { name: string; category: string; evidence_level: 2 | 3; source: string; observed_at?: string | null; vendor_id?: string | null; sub_slug?: string | null; notes?: string }): Promise<{ id: string; created: boolean }> {
  const [row] = await run<{ id: string; inserted: boolean }>(
    `INSERT INTO supplier_capabilities (name, category, evidence_level, source, observed_at, vendor_id, sub_slug, notes)
     VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8)
     ON CONFLICT (lower(name), lower(category), evidence_level, COALESCE(source, '')) DO UPDATE SET notes = EXCLUDED.notes, observed_at = COALESCE(EXCLUDED.observed_at, supplier_capabilities.observed_at)
     RETURNING id, (xmax = 0) AS inserted`,
    [input.name, input.category.toLowerCase(), input.evidence_level, input.source, input.observed_at ?? null, input.vendor_id ?? null, input.sub_slug ?? null, input.notes ?? ""],
  );
  return { id: row.id, created: row.inserted };
}

export interface PricingRequestInput {
  project_id: string;
  supplier_name: string;
  vendor_id?: string | null;
  products: Array<{ product: ProductIdentity; qty: number | null; unit: string | null; item_key?: string | null; scope_key?: string | null; quantity_gap?: string | null }>;
  need_dates?: { materials_on_site?: string | null; quote_by?: string | null };
  documents?: Array<{ label: string; file_id?: string | null; revision?: string | null }>;
  notes?: string;
  principal: Principal;
}

export interface StagedPricingRequest {
  request_id: string;
  revision: number;
  decision_id: string;
  decision_created: boolean;
  recipient: string | null;
  payload: Record<string, unknown>;
  gaps: string[];
  sent: false;
}

/** W05: build the exact request (products, quantities OR explicit quantity
 *  gaps, need dates, documents), resolve the recipient from the trusted
 *  vendor record, and stage a package_release decision. Same content → same
 *  pending decision; changed content → new revision supersedes it. Never sends. */
export async function stageSupplierPricingRequest(run: Run, input: PricingRequestInput): Promise<StagedPricingRequest> {
  const [vendor] = input.vendor_id
    ? await run<{ id: string; name: string; email: string | null }>(`SELECT id, name, email FROM vendors WHERE id = $1`, [input.vendor_id])
    : await run<{ id: string; name: string; email: string | null }>(`SELECT id, name, email FROM vendors WHERE lower(name) = lower($1) LIMIT 1`, [input.supplier_name]);
  const recipient = vendor?.email?.trim().toLowerCase() || null;
  const gaps: string[] = [];
  if (!recipient) gaps.push(`No trusted contact on file for ${input.supplier_name} — add the vendor's email in Vendors before release.`);
  const products = input.products.map((p) => {
    const ident = identifyProduct(p.product, { unit: p.unit, qty: p.qty });
    const qtyGap = p.qty == null || !(p.qty > 0) ? (p.quantity_gap ?? "quantity not yet measured — please quote per unit") : null;
    if (qtyGap) gaps.push(`${ident.product_key}: ${qtyGap}`);
    if (!ident.exact) gaps.push(`${ident.product_key}: product identity incomplete (${ident.missing.filter((m) => m !== "quantity" && m !== "unit").join(", ")})`);
    return { product: p.product, product_key: ident.product_key, quantity: p.qty, unit: normalizeUnit(p.unit) ?? p.unit, quantity_gap: qtyGap, item_key: p.item_key ?? null, scope_key: p.scope_key ?? null };
  });
  const payload = {
    kind: "supplier_pricing_request",
    supplier: { name: vendor?.name ?? input.supplier_name, vendor_id: vendor?.id ?? null, recipient },
    project_id: input.project_id,
    products,
    need_dates: input.need_dates ?? {},
    documents: input.documents ?? [],
    notes: input.notes ?? "",
    terms: "Nonbinding request for current pricing, lead time, tax and delivery. Not an order.",
  };
  const hash = contentHashOf(payload);
  const [prev] = await run<{ id: string; revision: number; content_hash: string; status: string }>(`SELECT id, revision, content_hash, status FROM supplier_pricing_requests WHERE project_id = $1 AND supplier_name = $2 ORDER BY revision DESC LIMIT 1 FOR UPDATE`, [input.project_id, input.supplier_name]);
  let requestId: string;
  let revision: number;
  if (prev && prev.content_hash === hash && prev.status === "staged") {
    requestId = prev.id;
    revision = prev.revision;
  } else {
    revision = (prev?.revision ?? 0) + 1;
    const [r] = await run<{ id: string }>(`INSERT INTO supplier_pricing_requests (project_id, supplier_name, vendor_id, recipient, revision, payload, content_hash) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id`, [input.project_id, input.supplier_name, vendor?.id ?? null, recipient, revision, JSON.stringify(payload), hash]);
    requestId = r.id;
    if (prev && prev.status === "staged") await run(`UPDATE supplier_pricing_requests SET status = 'superseded' WHERE id = $1`, [prev.id]);
  }
  const { decision, created } = await stageDecision(run, {
    kind: "package_release",
    action: "send_supplier_pricing_request",
    title: `Pricing request → ${vendor?.name ?? input.supplier_name} (rev ${revision})`,
    summary: {
      recipients: [{ name: vendor?.name ?? input.supplier_name, address: recipient ?? "(no contact on file)", role: "supplier" }],
      inclusions: products.map((p) => `${p.product.brand ?? ""} ${p.product.name ?? p.product.model ?? ""} ${p.product.finish ?? ""}`.trim() + (p.quantity != null ? ` × ${p.quantity} ${p.unit ?? ""}` : " (quantity: gap)")),
      quantities: products.filter((p) => p.quantity != null).map((p) => ({ label: p.product_key, qty: p.quantity!, unit: p.unit ?? undefined })),
      attachments: (input.documents ?? []).map((d) => ({ label: d.label, revision: d.revision ?? undefined, fileId: d.file_id ?? undefined })),
      gaps,
      effect: "Approving sends this nonbinding pricing request to the supplier. It is not an order.",
    },
    targetKind: "supplier_pricing_request",
    targetId: requestId,
    recipient,
    projectId: input.project_id,
    content: payload,
    artifactRevision: `pricing_request:${requestId}:r${revision}`,
    dedupeKey: `project:${input.project_id}:pricing_request:${input.supplier_name.toLowerCase()}`,
    requestedBy: input.principal,
  });
  await run(`UPDATE supplier_pricing_requests SET decision_id = $2 WHERE id = $1`, [requestId, decision.id]);
  void principalLabel;
  return { request_id: requestId, revision, decision_id: decision.id, decision_created: created, recipient, payload, gaps, sent: false };
}

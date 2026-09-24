// Pure estimating rules (A15, WORKFLOW W02–W07). No db, no network, no model
// call: every function here is deterministic so tests/estimating-rules.test.mjs
// can pin the behaviour. The DB modules in this folder call these.

import { createHash } from "node:crypto";
import type {
  DesignPath,
  DirectionSufficiency,
  EstimateLineRecord,
  Gap,
  LeadFacts,
  OfferedSnapshot,
  PriceBasis,
  PriceObservationInput,
  ProductIdentity,
  ScopeItemDraft,
  ScopeQuantity,
  SiteVisitPlanItem,
} from "./types.ts";

// ─── Units ───────────────────────────────────────────────────────────────────

export type NormalUnit = "sf" | "lf" | "ea" | "hr" | "ls" | "cy" | "sy" | "sheet" | "bf";

const UNIT_ALIASES: Record<string, NormalUnit> = {
  sf: "sf", sqft: "sf", "sq ft": "sf", "sq. ft.": "sf", "square feet": "sf", "square foot": "sf", ft2: "sf", "ft²": "sf",
  lf: "lf", "lin ft": "lf", "linear feet": "lf", "linear foot": "lf", "lin. ft.": "lf", ft: "lf", feet: "lf", foot: "lf",
  ea: "ea", each: "ea", pc: "ea", pcs: "ea", piece: "ea", pieces: "ea", unit: "ea", units: "ea", item: "ea",
  hr: "hr", hrs: "hr", hour: "hr", hours: "hr",
  ls: "ls", lump: "ls", "lump sum": "ls", lot: "ls", job: "ls",
  cy: "cy", "cu yd": "cy", "cubic yard": "cy", "cubic yards": "cy", yard: "cy", yards: "cy", yd3: "cy",
  sy: "sy", "sq yd": "sy", "square yard": "sy", "square yards": "sy",
  sheet: "sheet", sheets: "sheet", sht: "sheet",
  bf: "bf", "board feet": "bf", "board foot": "bf", bdft: "bf",
};

/** "Sq. Ft." → "sf"; unknown → null (a gap, never a guess). */
export function normalizeUnit(raw: string | null | undefined): NormalUnit | null {
  if (raw == null) return null;
  const k = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (!k) return null;
  return UNIT_ALIASES[k] ?? UNIT_ALIASES[k.replace(/\.$/, "")] ?? null;
}

export function unitsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeUnit(a);
  const y = normalizeUnit(b);
  return x != null && y != null && x === y;
}

// ─── Product identity ────────────────────────────────────────────────────────

function slugPart(s: string | undefined | null): string {
  return (s ?? "").toString().trim().toLowerCase().replace(/[^a-z0-9.+-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Stable key: brand|model|variant|finish (falls back to sku / name). */
export function productKey(p: ProductIdentity): string {
  const core = [slugPart(p.brand), slugPart(p.model), slugPart(p.variant), slugPart(p.finish)];
  if (core.some(Boolean)) return core.join("|");
  if (p.sku) return `sku|${slugPart(p.sku)}`;
  return `name|${slugPart(p.name)}`;
}

/** What is still missing before a price can be looked up exactly. */
export function identifyProduct(p: ProductIdentity, opts: { unit?: string | null; qty?: number | null } = {}) {
  const missing: string[] = [];
  if (!p.brand && !p.sku && !p.url) missing.push("brand");
  if (!p.model && !p.sku && !p.url) missing.push("model");
  if (!p.finish && !p.variant) missing.push("finish_or_variant");
  if (normalizeUnit(opts.unit) == null) missing.push("unit");
  if (opts.qty == null || !(opts.qty > 0)) missing.push("quantity");
  return { product_key: productKey(p), product: p, missing, exact: missing.filter((m) => m !== "quantity" && m !== "unit").length === 0 };
}

// ─── Scope breakdown from lead facts (W02) ───────────────────────────────────

interface ScopeRule {
  match: RegExp;
  room: string;
  items: Array<Omit<ScopeItemDraft, "room" | "assumptions" | "dependencies" | "quantities" | "source_refs" | "unverified" | "exclusions"> & { exclusions?: string[]; deps?: string[]; quantity_labels?: { label: string; unit: string }[] }>;
}

const R = (key: string, title: string, trade: string, work_package: string, supplier_categories: string[], finishes: string[] = [], extra: Partial<ScopeRule["items"][number]> = {}) => ({
  key,
  title,
  trade,
  work_package,
  supplier_categories,
  required_finishes: finishes.map((label) => ({ label, status: "undecided" as const, ref: null })),
  ...extra,
});

const SCOPE_RULES: ScopeRule[] = [
  {
    match: /\bkitchen\b/i,
    room: "Kitchen",
    items: [
      R("kitchen.demo", "Kitchen demolition and disposal", "Demolition", "Demo", ["disposal"], [], { quantity_labels: [{ label: "Room floor area", unit: "sf" }] }),
      R("kitchen.cabinetry", "Kitchen cabinetry (supply + install)", "Cabinetry", "Cabinets", ["cabinets"], ["Cabinet line / door style", "Cabinet finish", "Hardware"], { quantity_labels: [{ label: "Cabinet run", unit: "lf" }] }),
      R("kitchen.countertops", "Countertops (template, fabricate, install)", "Countertops", "Countertops", ["countertops"], ["Countertop material", "Edge profile"], { quantity_labels: [{ label: "Countertop area", unit: "sf" }] }),
      R("kitchen.backsplash", "Backsplash tile", "Tile", "Tile", ["tile"], ["Backsplash tile", "Grout color"], { quantity_labels: [{ label: "Backsplash area", unit: "sf" }] }),
      R("kitchen.plumbing", "Kitchen plumbing rough + trim", "Plumbing", "Plumbing", ["plumbing fixtures"], ["Sink", "Faucet"]),
      R("kitchen.electrical", "Kitchen electrical (circuits, lighting, outlets)", "Electrical", "Electrical", ["lighting", "electrical"], ["Light fixtures"]),
      R("kitchen.flooring", "Kitchen flooring", "Flooring", "Flooring", ["flooring"], ["Flooring material"], { quantity_labels: [{ label: "Floor area", unit: "sf" }] }),
      R("kitchen.paint", "Kitchen drywall patch + paint", "Paint", "Paint", ["paint"], ["Paint colors"]),
      R("kitchen.appliances", "Appliance set + hookups", "General", "Appliances", ["appliances"], ["Appliance package"], { exclusions: ["Appliances assumed client-supplied unless stated"] }),
    ],
  },
  {
    match: /\b(bath|bathroom|shower|powder\s*room|ensuite|en-suite)\b/i,
    room: "Bathroom",
    items: [
      R("bath.demo", "Bathroom demolition and disposal", "Demolition", "Demo", ["disposal"]),
      R("bath.plumbing", "Bathroom plumbing rough + trim", "Plumbing", "Plumbing", ["plumbing fixtures"], ["Toilet", "Faucets", "Shower valve / trim"]),
      R("bath.tile", "Shower / floor tile and waterproofing", "Tile", "Tile", ["tile"], ["Floor tile", "Wall / shower tile", "Grout color"], { quantity_labels: [{ label: "Floor tile area", unit: "sf" }, { label: "Wall tile area", unit: "sf" }] }),
      R("bath.vanity", "Vanity, top and mirror", "Cabinetry", "Vanity", ["cabinets", "countertops"], ["Vanity", "Vanity top", "Mirror"]),
      R("bath.electrical", "Bathroom electrical + exhaust fan", "Electrical", "Electrical", ["lighting", "electrical"], ["Light fixtures"]),
      R("bath.paint", "Bathroom drywall + paint", "Paint", "Paint", ["paint"], ["Paint colors"]),
      R("bath.door_trim", "Door and trim", "Trim & millwork", "Trim", ["doors", "lumber"], ["Interior door style"]),
    ],
  },
  {
    match: /\b(deck|porch|pergola)\b/i,
    room: "Exterior",
    items: [
      R("deck.footings", "Footings and posts", "Concrete", "Deck", ["concrete", "lumber"], [], { quantity_labels: [{ label: "Footing count", unit: "ea" }] }),
      R("deck.framing", "Deck framing", "Framing", "Deck", ["lumber"], [], { quantity_labels: [{ label: "Deck area", unit: "sf" }] }),
      R("deck.decking", "Decking surface", "Carpentry", "Deck", ["decking", "lumber"], ["Decking material / color"], { quantity_labels: [{ label: "Deck area", unit: "sf" }] }),
      R("deck.railing", "Railing and stairs", "Carpentry", "Deck", ["railing", "lumber"], ["Railing style"], { quantity_labels: [{ label: "Railing length", unit: "lf" }] }),
      R("deck.permit", "Deck permit and inspections", "General", "Permits", [], [], { exclusions: ["Permit fees at cost"] }),
    ],
  },
  {
    match: /\b(addition|bump[- ]?out|new\s+room|second\s+story|dormer)\b/i,
    room: "Addition",
    items: [
      R("addition.excavation", "Excavation and grading", "Excavation", "Site", ["excavation"]),
      R("addition.foundation", "Foundation / footings", "Concrete", "Foundation", ["concrete"], [], { quantity_labels: [{ label: "Footprint", unit: "sf" }] }),
      R("addition.framing", "Framing (walls, floor, roof)", "Framing", "Framing", ["lumber"], [], { quantity_labels: [{ label: "Footprint", unit: "sf" }] }),
      R("addition.roofing", "Roofing and flashing tie-in", "Roofing", "Roofing", ["roofing"], ["Shingle / roofing product"], { quantity_labels: [{ label: "Roof area", unit: "sf" }] }),
      R("addition.windows_doors", "Windows and exterior doors", "Windows & doors", "Openings", ["windows", "doors"], ["Window line", "Exterior door"], { quantity_labels: [{ label: "Window count", unit: "ea" }] }),
      R("addition.siding", "Siding, housewrap and exterior trim", "Siding", "Exterior", ["siding", "lumber"], ["Siding product / color"], { quantity_labels: [{ label: "Wall area", unit: "sf" }] }),
      R("addition.insulation", "Insulation and air sealing", "Insulation", "Envelope", ["insulation"]),
      R("addition.drywall", "Drywall", "Drywall", "Interior", ["drywall"], [], { quantity_labels: [{ label: "Wall + ceiling area", unit: "sf" }] }),
      R("addition.electrical", "Electrical", "Electrical", "Electrical", ["electrical", "lighting"], ["Light fixtures"]),
      R("addition.hvac", "HVAC extension", "HVAC", "Mechanical", ["hvac"]),
      R("addition.plumbing", "Plumbing (if wet room)", "Plumbing", "Plumbing", ["plumbing fixtures"]),
      R("addition.flooring", "Flooring", "Flooring", "Finishes", ["flooring"], ["Flooring material"]),
      R("addition.trim_paint", "Interior trim and paint", "Trim & millwork", "Finishes", ["lumber", "paint"], ["Trim profile", "Paint colors"]),
    ],
  },
  {
    match: /\b(basement|lower\s+level)\b/i,
    room: "Basement",
    items: [
      R("basement.egress", "Egress window / well", "Windows & doors", "Egress", ["windows", "excavation"], ["Egress window"]),
      R("basement.framing", "Basement framing", "Framing", "Framing", ["lumber"]),
      R("basement.insulation", "Insulation / vapor control", "Insulation", "Envelope", ["insulation"]),
      R("basement.drywall", "Drywall + ceiling", "Drywall", "Interior", ["drywall"], ["Ceiling treatment"]),
      R("basement.electrical", "Basement electrical", "Electrical", "Electrical", ["electrical", "lighting"], ["Light fixtures"]),
      R("basement.plumbing", "Basement plumbing (if bath/wet bar)", "Plumbing", "Plumbing", ["plumbing fixtures"]),
      R("basement.flooring", "Basement flooring", "Flooring", "Finishes", ["flooring"], ["Flooring material"]),
      R("basement.trim_paint", "Trim, doors and paint", "Trim & millwork", "Finishes", ["doors", "lumber", "paint"], ["Interior door style", "Paint colors"]),
    ],
  },
  {
    match: /\bgarage\b/i,
    room: "Garage",
    items: [
      R("garage.slab", "Slab / footings", "Concrete", "Foundation", ["concrete"]),
      R("garage.framing", "Garage framing", "Framing", "Framing", ["lumber"]),
      R("garage.roofing", "Garage roofing", "Roofing", "Roofing", ["roofing"], ["Shingle / roofing product"]),
      R("garage.siding", "Garage siding + trim", "Siding", "Exterior", ["siding", "lumber"], ["Siding product / color"]),
      R("garage.overhead_door", "Overhead door + opener", "Windows & doors", "Openings", ["doors"], ["Overhead door style"]),
      R("garage.electrical", "Garage electrical", "Electrical", "Electrical", ["electrical"]),
    ],
  },
  { match: /\b(roof|roofing|shingles?)\b/i, room: "Exterior", items: [R("roof.replace", "Roof tear-off and re-roof", "Roofing", "Roofing", ["roofing"], ["Shingle / roofing product"], { quantity_labels: [{ label: "Roof area", unit: "sf" }] })] },
  { match: /\b(siding|housewrap|exterior\s+trim)\b/i, room: "Exterior", items: [R("siding.replace", "Siding, housewrap and exterior trim", "Siding", "Exterior", ["siding", "lumber"], ["Siding product / color"], { quantity_labels: [{ label: "Wall area", unit: "sf" }] })] },
  { match: /\bwindows?\b/i, room: "Exterior", items: [R("windows.replace", "Window replacement + trim", "Windows & doors", "Openings", ["windows", "lumber"], ["Window line"], { quantity_labels: [{ label: "Window count", unit: "ea" }] })] },
  { match: /\b(interior\s+doors?|door\s+replacement)\b/i, room: "Interior", items: [R("doors.interior", "Interior doors + casing", "Trim & millwork", "Doors", ["doors", "lumber"], ["Interior door style"], { quantity_labels: [{ label: "Door count", unit: "ea" }] })] },
  { match: /\b(floor|flooring|hardwood|lvp|laminate|carpet)\b/i, room: "Interior", items: [R("flooring.install", "Flooring supply + install", "Flooring", "Flooring", ["flooring"], ["Flooring material"], { quantity_labels: [{ label: "Floor area", unit: "sf" }] })] },
  { match: /\b(trim|millwork|wainscot|crown|built[- ]?ins?|mantel|stair)\b/i, room: "Interior", items: [R("millwork.custom", "Custom trim / millwork", "Trim & millwork", "Millwork", ["lumber"], ["Trim profile", "Stain / paint finish"])] },
  { match: /\b(paint|painting|repaint)\b/i, room: "Interior", items: [R("paint.interior", "Interior painting", "Paint", "Paint", ["paint"], ["Paint colors"])] },
  { match: /\b(tile|tiling)\b/i, room: "Interior", items: [R("tile.general", "Tile work", "Tile", "Tile", ["tile"], ["Tile selection", "Grout color"], { quantity_labels: [{ label: "Tile area", unit: "sf" }] })] },
];

const ALWAYS_ITEMS = [
  R("general.permits", "Permits and inspections", "General", "Permits", [], [], { exclusions: ["Permit fees passed through at cost"] }),
  R("general.pm", "Project management, protection and cleanup", "General", "General conditions", ["disposal"]),
];

function leadText(f: LeadFacts): string {
  const parts = [f.name, f.scope, f.notes];
  for (const q of f.intake ?? []) parts.push(`${q.question}: ${q.answer}`);
  if (f.qualification?.rationale) parts.push(f.qualification.rationale);
  if (f.rough_estimate?.notes) parts.push(f.rough_estimate.notes);
  for (const li of f.rough_estimate?.line_items ?? []) parts.push(li.label);
  return parts.filter(Boolean).join("\n");
}

/** Pull "1,200 sq ft"-style quantities out of the lead text; each one is a
 *  lead statement (basis 'lead_statement'), never a measurement. */
export function extractStatedQuantities(text: string): ScopeQuantity[] {
  const out: ScopeQuantity[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(sq\.?\s*ft\.?|sqft|square\s+feet|sf|lin\.?\s*ft\.?|linear\s+feet|lf|cu\.?\s*yd\.?|cy)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const qty = Number(m[1].replace(/,/g, ""));
    const unit = normalizeUnit(m[2]);
    if (Number.isFinite(qty) && unit) out.push({ label: "Stated in lead", qty, unit, basis: "lead_statement", source: m[0] });
  }
  return out;
}

/** Deterministic preliminary scope register from the lead's facts. Every
 *  item is `unverified` and carries its source; concealed conditions and
 *  unmeasured quantities are gaps, not guesses. An agent may enrich later
 *  (scope_registers.enrichment) but nothing here needs a model. */
export function breakdownScope(facts: LeadFacts): { items: ScopeItemDraft[]; matched_rules: string[]; unmatched_text: boolean } {
  const text = leadText(facts);
  const stated = extractStatedQuantities(text);
  const items: ScopeItemDraft[] = [];
  const matched: string[] = [];
  const seen = new Set<string>();
  const src = (kind: "lead_scope" | "lead_intake" | "lead_estimate", ref: string) => ({ kind, ref });
  const sourceRefs = [src("lead_scope", facts.lead_id ?? "lead")];
  if (facts.intake?.length) sourceRefs.push(src("lead_intake", `${facts.intake.length} answers`));
  if (facts.rough_estimate) sourceRefs.push(src("lead_estimate", "rough estimate"));

  const push = (room: string, rule: ScopeRule["items"][number]) => {
    if (seen.has(rule.key)) return;
    seen.add(rule.key);
    const quantities: ScopeQuantity[] = (rule.quantity_labels ?? []).map((q) => {
      const hit = stated.find((s) => s.unit === q.unit);
      return hit ? { ...hit, label: q.label } : { label: q.label, qty: null, unit: q.unit, basis: "unknown" };
    });
    items.push({
      key: rule.key,
      title: rule.title,
      trade: rule.trade,
      work_package: rule.work_package,
      room,
      supplier_categories: rule.supplier_categories,
      exclusions: rule.exclusions ?? [],
      assumptions: [{ text: "Concealed conditions not known until the site visit", unverified: true, source: "W02 rule" }],
      dependencies: rule.deps ?? [],
      required_finishes: rule.required_finishes,
      quantities,
      source_refs: sourceRefs,
      unverified: true,
    });
  };

  for (const rule of SCOPE_RULES) {
    if (rule.match.test(text)) {
      matched.push(rule.room);
      for (const it of rule.items) push(rule.room, it);
    }
  }
  const unmatched = items.length === 0;
  for (const it of ALWAYS_ITEMS) push("General", it);
  if (unmatched && text.trim()) {
    items.unshift({
      key: "general.unclassified",
      title: `Work as described: ${text.trim().slice(0, 120)}`,
      trade: "General",
      work_package: "Unclassified",
      room: "General",
      supplier_categories: [],
      exclusions: [],
      assumptions: [{ text: "Scope text did not match a known work package; needs owner/agent breakdown", unverified: true, source: "W02 rule" }],
      dependencies: [],
      required_finishes: [],
      quantities: [],
      source_refs: sourceRefs,
      unverified: true,
    });
  }
  // deps: demo before finishes inside the same room
  for (const it of items) {
    const demo = items.find((d) => d.room === it.room && d.key.endsWith(".demo"));
    if (demo && demo.key !== it.key && !it.dependencies.includes(demo.key) && !it.key.startsWith("general.")) it.dependencies.push(demo.key);
  }
  return { items, matched_rules: matched, unmatched_text: unmatched };
}

/** Site-visit plan tailored to the scope (W03): what to inspect, measure,
 *  photograph and ask, per scope key. */
export function siteVisitPlanFor(items: ScopeItemDraft[]): SiteVisitPlanItem[] {
  const out: SiteVisitPlanItem[] = [];
  let n = 0;
  const add = (scope_key: string, kind: SiteVisitPlanItem["kind"], prompt: string, unit: string | null = null, location: string | null = null) => {
    n += 1;
    out.push({ id: `p${n}`, scope_key, kind, prompt, unit, location, status: "open", finding_id: null });
  };
  for (const it of items) {
    for (const q of it.quantities) {
      if (q.qty == null || q.basis !== "site_measurement") add(it.key, "measure", `${q.label} for ${it.title}`, q.unit, it.room);
    }
    add(it.key, "photo", `Existing conditions for ${it.title}`, null, it.room);
    switch (it.trade) {
      case "Plumbing":
        add(it.key, "inspect", "Locate supply/drain, shutoffs and venting; note access from below", null, it.room);
        break;
      case "Electrical":
        add(it.key, "inspect", "Panel capacity, existing circuits and box locations", null, "Panel");
        break;
      case "Framing":
      case "Concrete":
        add(it.key, "inspect", "Bearing, existing structure, soil/grade and access for materials", null, it.room);
        break;
      case "Tile":
        add(it.key, "inspect", "Substrate flatness and waterproofing condition", null, it.room);
        break;
      case "Cabinetry":
        add(it.key, "measure", "Wall-to-wall, ceiling height and window/door offsets", "lf", it.room);
        break;
      case "Roofing":
        add(it.key, "inspect", "Layers, decking condition, flashing and ventilation", null, "Roof");
        break;
      case "Windows & doors":
        add(it.key, "measure", "Rough openings and sill heights", "ea", it.room);
        break;
      default:
        break;
    }
    for (const f of it.required_finishes) {
      if (f.status === "undecided") add(it.key, "question", `Client direction on: ${f.label}`, null, it.room);
    }
    for (const a of it.assumptions) if (a.unverified) add(it.key, "inspect", `Verify: ${a.text}`, null, it.room);
  }
  return out;
}

// ─── Design path (W04) ───────────────────────────────────────────────────────

export function decideDesignPath(direction: DirectionSufficiency): DesignPath {
  switch (direction) {
    case "exact":
      return "direct_estimate";
    case "defined":
      return "selections";
    default:
      return "mood_board";
  }
}

/** Infer direction from what the client actually supplied. Exact products
 *  win; a defined style/material set means selections; otherwise a mood board. */
export function inferDirection(input: { exact_products?: number; stated_preferences?: number; style_defined?: boolean }): DirectionSufficiency {
  if ((input.exact_products ?? 0) > 0) return "exact";
  if (input.style_defined || (input.stated_preferences ?? 0) >= 2) return "defined";
  return "undefined";
}

/** Text feedback is never an approval: only an explicit approval action is. */
export function classifyFeedback(body: string): "comment" | "change_request" {
  const t = body.toLowerCase();
  if (/\b(change|swap|instead|prefer|rather|different|not (a )?fan|too|less|more|warmer|cooler|darker|lighter|remove|add)\b/.test(t)) return "change_request";
  return "comment";
}

// ─── Line pricing (W07) ──────────────────────────────────────────────────────

export interface LinePricing {
  /** Total internal cost for the line; null = unknown. */
  internal_cost_cents: number | null;
  /** Client selling price for the line; null = cannot be offered. */
  extended_cents: number | null;
  markup_pct_applied: number | null;
  mode: "allowance" | "owner_client_price" | "owner_internal_cost" | "cost_plus_markup" | "unknown";
  gaps: Gap[];
}

type PricingLine = Pick<
  EstimateLineRecord,
  "item_key" | "id" | "qty" | "unit" | "unit_cost" | "markup" | "source_kind" | "internal_cost_cents" | "owner_price_override_cents" | "owner_price_basis" | "is_allowance" | "allowance_cents" | "cost_observed_at" | "provisional" | "description"
>;

/** One place for the money rules: allowance shows as the allowance amount;
 *  an owner CLIENT price is applied as-is (never marked up again); an owner
 *  INTERNAL cost gets markup once; a known cost gets markup once; an unknown
 *  cost is NOT zero — it is a gap. */
export function priceLine(line: PricingLine, opts: { default_markup_pct: number; stale_after_days?: number; now?: Date }): LinePricing {
  const ref = line.item_key ?? `line:${line.id}`;
  const gaps: Gap[] = [];
  const markup = Number.isFinite(Number(line.markup)) && Number(line.markup) > 0 ? Number(line.markup) : opts.default_markup_pct;
  if (!(line.qty > 0)) gaps.push({ kind: "missing_quantity", ref, severity: "hard", detail: `${line.description}: quantity is not known` });
  if (normalizeUnit(line.unit) == null) gaps.push({ kind: "missing_unit", ref, severity: "hard", detail: `${line.description}: unit "${line.unit}" is not a known unit` });

  if (line.is_allowance) {
    if (line.allowance_cents == null || line.allowance_cents <= 0) {
      gaps.push({ kind: "unknown_cost", ref, severity: "hard", detail: `${line.description}: allowance amount not set` });
      return { internal_cost_cents: null, extended_cents: null, markup_pct_applied: null, mode: "allowance", gaps };
    }
    return { internal_cost_cents: line.allowance_cents, extended_cents: line.allowance_cents, markup_pct_applied: 0, mode: "allowance", gaps };
  }
  if (line.owner_price_override_cents != null && line.owner_price_basis === "client_price") {
    // Joe's selling price for his own work: no markup on top of it.
    return { internal_cost_cents: line.internal_cost_cents, extended_cents: line.owner_price_override_cents, markup_pct_applied: null, mode: "owner_client_price", gaps };
  }
  if (line.owner_price_override_cents != null && line.owner_price_basis === "internal_cost") {
    const cost = line.owner_price_override_cents;
    return { internal_cost_cents: cost, extended_cents: Math.round(cost * (1 + markup / 100)), markup_pct_applied: markup, mode: "owner_internal_cost", gaps };
  }
  let cost = line.internal_cost_cents;
  if (cost == null && line.source_kind == null && line.unit_cost > 0 && line.qty > 0) {
    // Legacy editor line: unit_cost is the cost the owner typed.
    cost = Math.round(line.qty * line.unit_cost);
  }
  if (cost == null) {
    gaps.push({ kind: "unknown_cost", ref, severity: "hard", detail: `${line.description}: no cost evidence yet (not zero)` });
    return { internal_cost_cents: null, extended_cents: null, markup_pct_applied: null, mode: "unknown", gaps };
  }
  const staleDays = opts.stale_after_days ?? 90;
  if (line.cost_observed_at) {
    const age = ((opts.now ?? new Date()).getTime() - new Date(line.cost_observed_at).getTime()) / 86_400_000;
    if (age > staleDays) gaps.push({ kind: "stale_price", ref, severity: "soft", detail: `${line.description}: cost evidence is ${Math.round(age)} days old` });
  }
  return { internal_cost_cents: cost, extended_cents: Math.round(cost * (1 + markup / 100)), markup_pct_applied: markup, mode: "cost_plus_markup", gaps };
}

/** Applies the committed-price rule: once offered, a line's client price is
 *  the snapshot's; a line that is new or whose quantity changed since the
 *  offer is an offer change (fresh approval), never a silent reprice. */
export function committedPrice(line: Pick<EstimateLineRecord, "item_key" | "id" | "qty" | "description">, computed: number | null, snapshot: OfferedSnapshot | null): { extended_cents: number | null; offer_changed: Gap | null } {
  if (!snapshot) return { extended_cents: computed, offer_changed: null };
  const snap = snapshot.lines.find((l) => (line.item_key ? l.item_key === line.item_key : l.line_id === line.id));
  const ref = line.item_key ?? `line:${line.id}`;
  if (!snap) return { extended_cents: computed, offer_changed: { kind: "offer_changed", ref: `offer:${ref}`, severity: "hard", detail: `${line.description}: added after the offer was sent` } };
  if (Number(snap.qty) !== Number(line.qty)) {
    return { extended_cents: snap.extended, offer_changed: { kind: "offer_changed", ref: `offer:${ref}`, severity: "hard", detail: `${line.description}: quantity changed after the offer (${snap.qty} → ${line.qty})` } };
  }
  return { extended_cents: snap.extended, offer_changed: null };
}

// ─── Client-facing serializer ────────────────────────────────────────────────

export interface ClientFacingLine {
  description: string;
  section: string;
  qty: number;
  unit: string;
  price_cents: number;
  /** Present only for allowances: what it covers and the amount. */
  allowance?: { amount_cents: number; covers: string; terms: string };
}

/** Hides provisional flags, internal cost, source and supplier discounts.
 *  Shows allowance identity and terms. Lines that cannot be offered (unknown
 *  cost, no committed price) are NOT silently zero — they are omitted and
 *  reported in `withheld` so the caller refuses to present an incomplete offer. */
export function clientFacingLines(lines: Array<Pick<EstimateLineRecord, "description" | "section" | "qty" | "unit" | "extended" | "is_allowance" | "allowance_cents" | "allowance_scope" | "provisional" | "internal_cost_cents" | "superseded_by">>, opts: { offered?: OfferedSnapshot | null } = {}): { lines: ClientFacingLine[]; withheld: string[] } {
  const out: ClientFacingLine[] = [];
  const withheld: string[] = [];
  for (const l of lines) {
    if (l.superseded_by != null) continue;
    const snap = opts.offered?.lines.find((s) => s.description === l.description && s.qty === l.qty);
    const price = snap ? snap.extended : l.extended;
    if (l.is_allowance) {
      const amt = l.allowance_cents ?? price;
      if (!(amt > 0)) {
        withheld.push(l.description);
        continue;
      }
      out.push({
        description: l.description,
        section: l.section,
        qty: l.qty,
        unit: l.unit,
        price_cents: amt,
        allowance: { amount_cents: amt, covers: l.allowance_scope ?? l.description, terms: "Allowance — if your selection costs more than this amount, the difference is a change order; if less, the difference is credited." },
      });
      continue;
    }
    if (!(price > 0) || (l.internal_cost_cents == null && !snap)) {
      withheld.push(l.description);
      continue;
    }
    out.push({ description: l.description, section: l.section, qty: l.qty, unit: l.unit, price_cents: price });
  }
  return { lines: out, withheld };
}

// ─── Allowance overage (W07) ─────────────────────────────────────────────────

export interface AllowanceOveragePayload {
  kind: "change_order_draft";
  title: string;
  description: string;
  price_cents: number;
  allowance_cents: number;
  chosen_cents: number;
  overage_cents: number;
  markup_pct: number | null;
  item_key: string | null;
  chosen: { description: string; source_ref: Record<string, unknown> };
  requires: ["owner_approval", "client_acceptance", "payment_before_work"];
}

/** Pure: the priced change-order data for a selection above its allowance.
 *  Returns null when the choice is at or under the allowance (a credit, not a
 *  CO). WS-money/WS-field write the change_orders row; this only prepares it. */
export function prepareAllowanceOverageChangeOrder(input: {
  allowance_line: Pick<EstimateLineRecord, "item_key" | "description" | "allowance_cents" | "allowance_scope">;
  chosen: { description: string; cost_cents: number; source_ref?: Record<string, unknown> };
  markup_pct: number | null;
  /** True when the allowance was presented as a client-facing (already marked-up) amount. Default true. */
  allowance_is_client_amount?: boolean;
}): AllowanceOveragePayload | null {
  const allowance = input.allowance_line.allowance_cents ?? 0;
  const markup = input.markup_pct ?? 0;
  const chosenClient = input.allowance_is_client_amount === false ? input.chosen.cost_cents : Math.round(input.chosen.cost_cents * (1 + markup / 100));
  const overage = chosenClient - allowance;
  if (overage <= 0) return null;
  return {
    kind: "change_order_draft",
    title: `Allowance overage — ${input.allowance_line.allowance_scope ?? input.allowance_line.description}`,
    description: `${input.chosen.description} was chosen for "${input.allowance_line.allowance_scope ?? input.allowance_line.description}". The allowance carried ${fmtCents(allowance)}; the selection comes to ${fmtCents(chosenClient)}. Difference: ${fmtCents(overage)}.`,
    price_cents: overage,
    allowance_cents: allowance,
    chosen_cents: chosenClient,
    overage_cents: overage,
    markup_pct: input.markup_pct,
    item_key: input.allowance_line.item_key,
    chosen: { description: input.chosen.description, source_ref: input.chosen.source_ref ?? {} },
    requires: ["owner_approval", "client_acceptance", "payment_before_work"],
  };
}

export function fmtCents(c: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);
}

// ─── Price observations (W05) ────────────────────────────────────────────────

/** What is missing before an observation can support a draft cost. */
export function priceObservationGaps(o: PriceObservationInput & { observed_at?: string }, opts: { now?: Date; stale_after_days?: number } = {}): Gap[] {
  const ref = productKey(o.product);
  const gaps: Gap[] = [];
  if (o.price_cents == null) gaps.push({ kind: "unknown_cost", ref, severity: "hard", detail: "no price found" });
  if (normalizeUnit(o.unit) == null) gaps.push({ kind: "missing_unit", ref, severity: "hard", detail: "unit basis unknown" });
  if (o.includes_freight == null) gaps.push({ kind: "missing_freight", ref, severity: "soft", detail: "freight/delivery coverage unknown" });
  if (o.includes_tax == null) gaps.push({ kind: "missing_tax", ref, severity: "soft", detail: "tax coverage unknown" });
  const now = opts.now ?? new Date();
  if (o.expires_at && new Date(o.expires_at).getTime() < now.getTime()) gaps.push({ kind: "stale_price", ref, severity: "hard", detail: `expired ${o.expires_at}` });
  else if (o.observed_at) {
    const age = (now.getTime() - new Date(o.observed_at).getTime()) / 86_400_000;
    if (age > (opts.stale_after_days ?? 90)) gaps.push({ kind: "stale_price", ref, severity: "soft", detail: `observed ${Math.round(age)} days ago — dated evidence, not a current price` });
  }
  return gaps;
}

/** A quote line may price an estimate item only when the product, unit and
 *  quantity actually match; otherwise the mismatch is reported, not forced. */
export function quoteCoverageCheck(q: { product_key?: string | null; unit?: string | null; quantity?: number | null; supply?: boolean; install?: boolean }, item: { product_key?: string | null; unit: string; qty: number }): { ok: boolean; issues: Gap[] } {
  const issues: Gap[] = [];
  const ref = item.product_key ?? "item";
  if (q.product_key && item.product_key && q.product_key !== item.product_key) issues.push({ kind: "coverage_missing", ref, severity: "hard", detail: `quoted ${q.product_key}, estimate item is ${item.product_key}` });
  if (q.unit && !unitsCompatible(q.unit, item.unit)) issues.push({ kind: "units_mismatch", ref, severity: "hard", detail: `quoted per ${q.unit}, estimate item is per ${item.unit}` });
  if (q.quantity != null && item.qty > 0 && Math.abs(q.quantity - item.qty) / item.qty > 0.05) issues.push({ kind: "coverage_missing", ref, severity: "hard", detail: `quoted ${q.quantity}, estimate needs ${item.qty}` });
  return { ok: issues.length === 0, issues };
}

// ─── Learning guards (A15 / DESIGN "Cost learning") ──────────────────────────

export interface OutlierVerdict {
  apply: boolean;
  reason: string;
  n: number;
  median_unit_cost: number | null;
  proposed_unit_cost: number | null;
  delta_pct: number | null;
  outliers: number[];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Small-sample + outlier guard. `samples` are verified unit costs (cents).
 *  Nothing replaces an established value below `min_samples`, beyond
 *  `max_delta_pct` from it, or when a single sample sits far from its peers. */
export function outlierGuard(established: number | null, samples: number[], opts: { min_samples?: number; max_delta_pct?: number; outlier_pct?: number } = {}): OutlierVerdict {
  const minN = opts.min_samples ?? 3;
  const maxDelta = opts.max_delta_pct ?? 25;
  const outlierPct = opts.outlier_pct ?? 60;
  const clean = samples.filter((s) => Number.isFinite(s) && s > 0);
  if (!clean.length) return { apply: false, reason: "no verified samples", n: 0, median_unit_cost: null, proposed_unit_cost: null, delta_pct: null, outliers: [] };
  const med = median(clean);
  const outliers = clean.length >= 3 ? clean.filter((s) => Math.abs(s - med) / med * 100 > outlierPct) : [];
  const kept = clean.filter((s) => !outliers.includes(s));
  const proposed = kept.length ? median(kept) : med;
  const n = kept.length;
  if (n < minN) return { apply: false, reason: `only ${n} usable sample${n === 1 ? "" : "s"} (need ${minN}) — recorded, not applied`, n, median_unit_cost: med, proposed_unit_cost: proposed, delta_pct: established ? Math.round(((proposed - established) / established) * 1000) / 10 : null, outliers };
  if (established != null && established > 0) {
    const delta = ((proposed - established) / established) * 100;
    if (Math.abs(delta) > maxDelta) return { apply: false, reason: `proposed change ${delta.toFixed(1)}% exceeds ${maxDelta}% — needs review`, n, median_unit_cost: med, proposed_unit_cost: proposed, delta_pct: Math.round(delta * 10) / 10, outliers };
    return { apply: true, reason: `${n} samples within ${maxDelta}% of the established value`, n, median_unit_cost: med, proposed_unit_cost: proposed, delta_pct: Math.round(delta * 10) / 10, outliers };
  }
  return { apply: true, reason: `${n} samples; no established value to protect`, n, median_unit_cost: med, proposed_unit_cost: proposed, delta_pct: null, outliers };
}

// ─── Readiness scoring (evidence checks, not model confidence) ───────────────

export interface ReadinessInput {
  scope_items: Array<{ key: string; status: string; responsibility: string; unverified: boolean; quantities: ScopeQuantity[]; exclusions: string[] }>;
  lines: Array<{ item_key: string | null; scope_item_key: string | null; provisional: boolean; internal_cost_cents: number | null; is_allowance: boolean; cost_observed_at: string | null; source_kind: string | null; extended: number; superseded_by: number | null }>;
  gaps: Gap[];
  sub_trades_needed: string[];
  sub_quotes_present: string[];
  markup_pct: number | null;
  now?: Date;
}

export interface Readiness {
  score: number;
  eligibility: "fixed_proposal" | "rough_range" | "not_ready";
  hard_gaps: Gap[];
  soft_gaps: Gap[];
  components: Record<string, { score: number; weight: number; note: string }>;
  margin: { internal_cost_known_cents: number; offered_cents: number; unknown_cost_lines: number; margin_cents: number | null; margin_pct: number | null };
  rough_range: { low_cents: number; high_cents: number } | null;
}

export function estimateReadinessScore(input: ReadinessInput): Readiness {
  const lines = input.lines.filter((l) => l.superseded_by == null);
  const components: Readiness["components"] = {};
  const part = (key: string, score: number, weight: number, note: string) => (components[key] = { score: Math.max(0, Math.min(1, score)), weight, note });

  // scope completeness: every open scope item is allocated or excluded and has a line
  const scope = input.scope_items.filter((s) => s.status !== "superseded" && s.status !== "excluded");
  const covered = scope.filter((s) => lines.some((l) => l.scope_item_key === s.key));
  part("scope_completeness", scope.length ? covered.length / scope.length : 0.5, 25, `${covered.length}/${scope.length} scope items carry an estimate item`);
  const allocated = scope.filter((s) => s.responsibility !== "unassigned");
  part("scope_allocation", scope.length ? allocated.length / scope.length : 0.5, 10, `${allocated.length}/${scope.length} scope items allocated (Joe / sub / supplier)`);

  // quantities and units
  const qs = scope.flatMap((s) => s.quantities);
  const measured = qs.filter((q) => q.qty != null && q.basis !== "unknown");
  part("quantities", qs.length ? measured.length / qs.length : 0.6, 15, `${measured.length}/${qs.length} required quantities have a value and basis`);

  // price evidence
  // Joe's dedicated client price is a committed number even when its internal cost is not recorded.
  const priced = lines.filter((l) => l.internal_cost_cents != null || l.is_allowance || l.source_kind === "owner_price");
  part("price_evidence", lines.length ? priced.length / lines.length : 0, 20, `${priced.length}/${lines.length} lines have a cost or an explicit allowance`);
  const firm = priced.filter((l) => !l.provisional || l.source_kind === "owner_price");
  part("price_firmness", priced.length ? firm.length / priced.length : 0, 10, `${firm.length}/${priced.length} priced lines are not provisional`);

  // sub quotes
  const need = input.sub_trades_needed;
  const have = need.filter((t) => input.sub_quotes_present.includes(t));
  part("sub_quotes", need.length ? have.length / need.length : 1, 10, need.length ? `${have.length}/${need.length} sub trades have a quote or approved bid` : "no sub trades");

  // exclusions stated
  const withExcl = scope.filter((s) => s.exclusions.length > 0).length;
  part("exclusions", scope.length ? Math.min(1, 0.5 + withExcl / scope.length / 2) : 0.5, 5, `${withExcl}/${scope.length} scope items state exclusions`);

  // uncertainty
  const unverified = scope.filter((s) => s.unverified).length;
  part("verified_assumptions", scope.length ? 1 - unverified / scope.length : 0.5, 5, `${unverified} scope items still carry unverified assumptions`);

  const hard = input.gaps.filter((g) => g.severity === "hard");
  const soft = input.gaps.filter((g) => g.severity === "soft");

  // margin arithmetic
  const known = lines.reduce((s, l) => s + (l.internal_cost_cents ?? 0), 0);
  const offered = lines.reduce((s, l) => s + (l.extended ?? 0), 0);
  const unknownLines = lines.filter((l) => l.internal_cost_cents == null && !l.is_allowance).length;
  const marginKnown = unknownLines === 0 && lines.length > 0;
  const margin = {
    internal_cost_known_cents: known,
    offered_cents: offered,
    unknown_cost_lines: unknownLines,
    margin_cents: marginKnown ? offered - known : null,
    margin_pct: marginKnown && offered > 0 ? Math.round(((offered - known) / offered) * 1000) / 10 : null,
  };

  const totalWeight = Object.values(components).reduce((s, c) => s + c.weight, 0);
  const score = Math.round((Object.values(components).reduce((s, c) => s + c.score * c.weight, 0) / totalWeight) * 100);

  let eligibility: Readiness["eligibility"] = "not_ready";
  if (hard.length === 0 && score >= 75 && input.markup_pct != null) eligibility = "fixed_proposal";
  else if (lines.length > 0 && priced.length > 0) eligibility = "rough_range";

  const rough_range = priced.length
    ? { low_cents: Math.round(offered * 0.9), high_cents: Math.round(offered * (1 + Math.max(0.15, (100 - score) / 100))) }
    : null;

  return { score, eligibility, hard_gaps: hard, soft_gaps: soft, components, margin, rough_range };
}

// ─── Misc ────────────────────────────────────────────────────────────────────

export function shortHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}

export function stableItemKey(prefix: string, ...parts: Array<string | number | null | undefined>): string {
  return `${prefix}:${parts.map((p) => (p == null ? "" : String(p))).join(":")}`;
}

export function basisLabel(b: PriceBasis | null): string {
  return b === "client_price" ? "client selling price (no markup added)" : b === "internal_cost" ? "internal cost (markup applied once)" : "not stated";
}

// ─── Held-out evaluation (A15 accept) ────────────────────────────────────────

export interface HeldOutReport {
  scopes: Array<{ scope_key: string; estimated_cents: number | null; actual_cents: number | null; error_pct: number | null; status: "compared" | "actual_unknown" | "estimate_unknown" }>;
  compared: number;
  unknown: number;
  mean_abs_error_pct: number | null;
  bias_pct: number | null;
  note: string;
}

/** Compare an estimate's internal costs with verified actuals per scope.
 *  Unknowns are counted and reported, never treated as zero error. */
export function heldOutEvaluation(estimated: Array<{ scope_key: string; cents: number | null }>, actual: Array<{ scope_key: string; cents: number | null }>): HeldOutReport {
  const keys = Array.from(new Set([...estimated.map((e) => e.scope_key), ...actual.map((a) => a.scope_key)]));
  const scopes: HeldOutReport["scopes"] = keys.map((k) => {
    const e = estimated.find((x) => x.scope_key === k)?.cents ?? null;
    const a = actual.find((x) => x.scope_key === k)?.cents ?? null;
    if (a == null) return { scope_key: k, estimated_cents: e, actual_cents: null, error_pct: null, status: "actual_unknown" };
    if (e == null) return { scope_key: k, estimated_cents: null, actual_cents: a, error_pct: null, status: "estimate_unknown" };
    return { scope_key: k, estimated_cents: e, actual_cents: a, error_pct: a > 0 ? Math.round(((e - a) / a) * 1000) / 10 : null, status: "compared" };
  });
  const cmp = scopes.filter((s) => s.status === "compared" && s.error_pct != null);
  const mae = cmp.length ? Math.round((cmp.reduce((s, c) => s + Math.abs(c.error_pct!), 0) / cmp.length) * 10) / 10 : null;
  const bias = cmp.length ? Math.round((cmp.reduce((s, c) => s + c.error_pct!, 0) / cmp.length) * 10) / 10 : null;
  const unknown = scopes.length - cmp.length;
  return { scopes, compared: cmp.length, unknown, mean_abs_error_pct: mae, bias_pct: bias, note: unknown ? `${unknown} scope(s) could not be compared (unknown estimate or actual) and are excluded from the error, not counted as zero` : "all scopes compared" };
}

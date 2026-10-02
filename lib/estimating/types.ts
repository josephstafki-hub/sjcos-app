// Shared record shapes for the estimating workstream (A15, WORKFLOW W02–W07).
// Pure: no db, no server-only. Money is integer cents; NULL = unknown, never 0.

export type Responsibility = "joe" | "sub" | "supplier" | "unassigned";
export type SupplyBy = "joe" | "sub" | "supplier" | "client" | "unassigned";
export type InstallBy = "joe" | "sub" | "none" | "unassigned";
export type PriceBasis = "internal_cost" | "client_price";
export type ScopeItemStatus = "open" | "allocated" | "priced" | "excluded" | "superseded";

export interface ScopeAssumption {
  text: string;
  unverified: boolean;
  source?: string;
}

export interface RequiredFinish {
  label: string;
  status: "undecided" | "chosen" | "client_supplied";
  ref?: string | null;
}

export interface ScopeQuantity {
  label: string;
  qty: number | null;
  unit: string | null;
  basis: "site_measurement" | "plan" | "lead_statement" | "assumption" | "unknown";
  source?: string;
}

export interface SourceRef {
  kind: "lead_intake" | "lead_scope" | "lead_estimate" | "site_finding" | "owner" | "agent" | "client";
  ref: string;
  at?: string;
}

export interface ScopeItemDraft {
  key: string;
  title: string;
  trade: string;
  work_package: string;
  room: string;
  supplier_categories: string[];
  exclusions: string[];
  assumptions: ScopeAssumption[];
  dependencies: string[];
  required_finishes: RequiredFinish[];
  quantities: ScopeQuantity[];
  source_refs: SourceRef[];
  unverified: boolean;
}

export interface ScopeItem extends ScopeItemDraft {
  id: string;
  project_id: string;
  responsibility: Responsibility;
  supply_by: SupplyBy;
  install_by: InstallBy;
  status: ScopeItemStatus;
  revision: number;
  dedicated_price_cents: number | null;
  price_basis: PriceBasis | null;
  price_scope_note: string;
  notes: string;
}

export interface LeadFacts {
  lead_id?: string | null;
  name?: string;
  scope?: string;
  address?: string | null;
  intake?: { question: string; answer: string }[];
  qualification?: { verdict?: string; rationale?: string } | null;
  rough_estimate?: { notes?: string; line_items?: { label: string; value: string }[] } | null;
  /** Free text from the owner or the agent (site notes are NOT lead facts). */
  notes?: string;
}

export type PlanItemKind = "inspect" | "measure" | "photo" | "question";

export interface SiteVisitPlanItem {
  id: string;
  scope_key: string;
  kind: PlanItemKind;
  prompt: string;
  unit?: string | null;
  location?: string | null;
  status: "open" | "answered" | "not_applicable";
  finding_id?: string | null;
}

export type FindingKind = "observation" | "measurement" | "photo" | "client_answer" | "decision" | "issue" | "new_work" | "price_instruction";

export interface SiteFindingInput {
  /** Stable per source+fact so re-uploading the same notes does not duplicate. */
  fact_key: string;
  scope_key?: string | null;
  kind: FindingKind;
  statement: string;
  measurement?: number | null;
  unit?: string | null;
  source_note: string;
  media_ref?: string | null;
  /** Explicit: this finding changes Joe's allocation or dedicated price. */
  targets_price?: boolean;
  /** For 'measurement': which scope quantity it answers. */
  quantity_label?: string | null;
  /** For 'new_work': the new scope item to add (unpriced). */
  new_scope?: Partial<ScopeItemDraft> & { key: string; title: string };
  /** For 'price_instruction': Joe's explicit new price for the scope. */
  price?: { cents: number; basis: PriceBasis } | null;
}

export type DirectionSufficiency = "undefined" | "defined" | "exact";
export type DesignPath = "mood_board" | "selections" | "direct_estimate";

export interface FeedbackEntry {
  at: string;
  author: string;
  body: string;
  kind: "comment" | "change_request" | "approval";
  revision: number;
}

export type EstimateSourceKind =
  | "client_product"
  | "selection"
  | "sub_bid"
  | "supplier_quote"
  | "online_price"
  | "owner_price"
  | "cost_book"
  | "assumption"
  | "allowance"
  | "manual";

export interface EstimateLineRecord {
  id: number;
  estimate_id: number;
  item_key: string | null;
  scope_item_key: string | null;
  cost_item_id: number | null;
  description: string;
  section: string;
  unit: string;
  qty: number;
  unit_cost: number;
  markup: number;
  extended: number;
  source_kind: EstimateSourceKind | null;
  source_ref: Record<string, unknown>;
  internal_cost_cents: number | null;
  cost_basis: string | null;
  cost_observed_at: string | null;
  owner_price_override_cents: number | null;
  owner_price_basis: PriceBasis | null;
  is_allowance: boolean;
  allowance_cents: number | null;
  allowance_scope: string | null;
  provisional: boolean;
  evidence: unknown[];
  superseded_by: number | null;
}

export interface OfferedLineSnapshot {
  item_key: string | null;
  line_id: number;
  description: string;
  qty: number;
  unit: string;
  extended: number;
  internal_cost_cents: number | null;
  is_allowance: boolean;
  allowance_cents: number | null;
  allowance_scope: string | null;
}

export interface OfferedSnapshot {
  revision: number;
  offered_at: string;
  total: number;
  lines: OfferedLineSnapshot[];
}

export type GapKind =
  | "unknown_cost"
  | "missing_quantity"
  | "missing_unit"
  | "units_mismatch"
  | "stale_price"
  | "missing_quote"
  | "unallocated_scope"
  | "unverified_assumption"
  | "coverage_missing"
  | "competing_quotes"
  | "offer_changed"
  | "missing_freight"
  | "missing_tax"
  | "partial_choice";

export interface Gap {
  kind: GapKind;
  ref: string;
  severity: "hard" | "soft";
  detail: string;
}

export interface ProductIdentity {
  name?: string;
  brand?: string;
  model?: string;
  variant?: string;
  finish?: string;
  sku?: string;
  url?: string;
}

export type PriceSourceKind = "online" | "historical_quote" | "purchase" | "supplier_quote" | "owner_stated";

export interface PriceObservationInput {
  product: ProductIdentity;
  unit: string | null;
  unit_basis?: string;
  pack_qty?: number | null;
  price_cents: number | null;
  currency?: string;
  source_kind: PriceSourceKind;
  source_url?: string | null;
  source_ref?: string;
  observed_at?: string;
  includes_tax?: boolean | null;
  includes_freight?: boolean | null;
  expires_at?: string | null;
  supplier_name?: string | null;
  vendor_id?: string | null;
  project_id?: string | null;
  notes?: string;
}

export interface PriceObservation extends PriceObservationInput {
  id: string;
  product_key: string;
  observed_at: string;
}

/** What a price fetcher returns for one product lookup. The real adapter wraps
 *  lib/product-fetch.ts; the fake (SJC_OUTBOUND_DISABLED=1) returns fixtures. */
export interface FetchedPrice {
  price_cents: number | null;
  unit: string | null;
  unit_basis?: string;
  pack_qty?: number | null;
  url: string;
  supplier_name?: string | null;
  observed_at?: string;
  includes_tax?: boolean | null;
  includes_freight?: boolean | null;
  matched_product?: ProductIdentity;
  /** Set when the page describes a similar-but-different product. */
  substitution_note?: string | null;
}

export interface PriceFetcher {
  readonly mode: "live" | "fake";
  lookup(product: ProductIdentity, opts?: { urls?: string[] }): Promise<{ ok: true; results: FetchedPrice[] } | { ok: false; error: string }>;
}

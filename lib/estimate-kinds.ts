// Where a job's estimates and change orders live, and which one a client change
// becomes — the one vocabulary the app, the MCP tools and the agents share
// (docs/estimates-and-change-orders.md). Pure: no db import, so client
// components, server code and the MCP server (plain Node importing .ts) can
// all use it.
//
// The DECISION is made by the database — project_scope_change_path() in
// db/schema.sql, enforced by triggers on change_orders and estimates so every
// writer gets the same answer. scopeChangePath() below mirrors it for copy and
// tests; the two must stay in step (tests/estimate-kinds*.test.mjs pin both).

import type { ProjectStatus } from "./types";

// ─── Estimate kinds ─────────────────────────────────────────────────────────

export type EstimateKind = "formal" | "precon_change";
export const ESTIMATE_KINDS: readonly EstimateKind[] = ["formal", "precon_change"];

export const ESTIMATE_KIND_LABEL: Record<EstimateKind, string> = {
  formal: "Formal estimate",
  precon_change: "Pre-con change",
};

export const ESTIMATE_KIND_HELP: Record<EstimateKind, string> = {
  formal: "The job's formal estimate. The client approves it; the contract and budget are built from it.",
  precon_change: "A client-requested addition or change, priced before the contract is signed.",
};

export function isEstimateKind(v: unknown): v is EstimateKind {
  return typeof v === "string" && (ESTIMATE_KINDS as readonly string[]).includes(v);
}

// ─── Which path a client change takes ───────────────────────────────────────

export type ScopeChangePath = "precon_estimate" | "change_order";

export interface ScopeChangeContext {
  status: ProjectStatus;
  /** Human label for `status` ("Floor plan"). */
  statusLabel: string;
  hasSignedContract: boolean;
  path: ScopeChangePath;
}

/** Mirrors PROJECT_STATUSES in lib/projects.ts, which is server-only and so
 *  out of reach for the MCP server and client components. */
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  precon_signed: "Pre-con signed",
  floor_plan: "Floor plan",
  mood_board: "Mood board",
  selections: "Selections",
  bidding: "Bidding",
  construction_contract: "Construction contract",
  construction: "Construction",
  closeout: "Closeout",
  warranty: "Warranty",
};

/** Statuses where the job is under contract whatever the paperwork shows. */
export const CHANGE_ORDER_STATUSES: ReadonlySet<ProjectStatus> = new Set<ProjectStatus>([
  "construction",
  "closeout",
  "warranty",
]);

/** The contract signature is the dividing line: before it a client change is
 *  a pre-con change estimate, after it it is a change order. The "Construction
 *  contract" stage straddles the line, so there the paperwork decides. Must
 *  match project_scope_change_path() in db/schema.sql. */
export function scopeChangePath(status: ProjectStatus, hasSignedContract: boolean): ScopeChangePath {
  if (CHANGE_ORDER_STATUSES.has(status)) return "change_order";
  if (status === "construction_contract" && hasSignedContract) return "change_order";
  return "precon_estimate";
}

export function scopeChangeContext(status: ProjectStatus, hasSignedContract: boolean): ScopeChangeContext {
  return {
    status,
    statusLabel: PROJECT_STATUS_LABEL[status] ?? status,
    hasSignedContract,
    path: scopeChangePath(status, hasSignedContract),
  };
}

// ─── Copy — quoted verbatim everywhere so an agent can find the spot ────────

/** Tab › section names exactly as the project page shows them. */
export const WHERE = {
  estimates: "Money › Estimate",
  changeOrders: "Money › Change orders",
  formalEstimateDoc: "Documents › Formal Estimate",
  changeOrderDoc: "Documents › Change Order",
} as const;

export const PRICING_RULE =
  `The formal estimate is the estimate in ${WHERE.estimates} (kind 'formal'): add or change its lines there ` +
  `(add_estimate_lines). ${WHERE.formalEstimateDoc} is only the PDF generated from it ` +
  `(create_document_draft estimate_doc + estimate_id) — regenerate it after the lines change. A client addition ` +
  `or change BEFORE the contract is signed is a new estimate with kind 'precon_change'; AFTER the contract is ` +
  `signed it is a change order (${WHERE.changeOrders}). Full rule: docs/estimates-and-change-orders.md.`;

/** The phase banner on the Money tab. */
export function describeScopeChangePath(ctx: ScopeChangeContext): { headline: string; detail: string } {
  if (ctx.path === "change_order") {
    return {
      headline: `Under contract · ${ctx.statusLabel}`,
      detail: `Client additions or changes are change orders now (${WHERE.changeOrders}).`,
    };
  }
  return {
    headline: `Pre-construction · ${ctx.statusLabel}`,
    detail:
      "A client addition or change is a new estimate here with kind Pre-con change. " +
      "Change orders start once the contract is signed.",
  };
}

/** Why a change order can't be created right now (path = precon_estimate). */
export function changeOrderRefusal(ctx: ScopeChangeContext): string {
  return (
    `Change orders start once the contract is signed. This job is still in pre-construction ` +
    `(${ctx.statusLabel}): price the client's addition or change as a Pre-con change estimate in ` +
    `${WHERE.estimates} instead.`
  );
}

/** Why a pre-con change estimate can't be created right now (path = change_order). */
export function preconChangeRefusal(ctx: ScopeChangeContext): string {
  return (
    `This job is under contract (${ctx.statusLabel}): a client addition or change is a change order ` +
    `(${WHERE.changeOrders}), not a Pre-con change estimate.`
  );
}

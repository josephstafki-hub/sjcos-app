// Evidence checks for an estimate (A15 accept: honest error/uncertainty). The
// score is arithmetic over scope completeness, quantities/units, price source
// and date, sub quotes, exclusions, unverified assumptions and margin — never
// a model's self-confidence. Stored on estimates.readiness for the UI.

import type { Run } from "../commands/core.ts";
import { loadLines } from "./assembly.ts";
import { estimateReadinessScore, type Readiness } from "./rules.ts";
import type { Gap, ScopeQuantity } from "./types.ts";

export type { Readiness } from "./rules.ts";

export interface ReadinessView extends Readiness {
  estimate_id: number;
  computed_at: string;
  gaps_accepted: Gap[];
  offer: { offered_at: string | null; offer_stale: boolean; revision: number };
}

export async function estimateReadiness(run: Run, estimateId: number, opts: { persist?: boolean } = {}): Promise<ReadinessView> {
  const [e] = await run<{ project_id: string | null; offered_at: string | null; offer_stale: boolean; revision: number }>(`SELECT project_id, offered_at::text AS offered_at, offer_stale, revision FROM estimates WHERE id = $1`, [estimateId]);
  if (!e) throw new Error(`estimate ${estimateId} not found`);
  const lines = await loadLines(run, estimateId);
  const scope = e.project_id
    ? await run<{ key: string; status: string; responsibility: string; install_by: string; trade: string; unverified: boolean; quantities: ScopeQuantity[]; exclusions: string[] }>(
        `SELECT key, status, responsibility, install_by, trade, unverified, quantities, exclusions FROM scope_items WHERE project_id = $1`,
        [e.project_id],
      )
    : [];
  const gapRows = await run<{ kind: Gap["kind"]; ref: string; severity: Gap["severity"]; detail: string; status: string }>(`SELECT kind, ref, severity, detail, status FROM estimate_gaps WHERE estimate_id = $1 AND status <> 'resolved'`, [estimateId]);
  const strip = (g: (typeof gapRows)[number]): Gap => ({ kind: g.kind, ref: g.ref, severity: g.severity, detail: g.detail });
  const open = gapRows.filter((g) => g.status === "open").map(strip);
  const accepted = gapRows.filter((g) => g.status === "accepted").map(strip);
  const subTrades = Array.from(new Set(scope.filter((s) => s.install_by === "sub" && s.status !== "excluded" && s.status !== "superseded").map((s) => s.trade)));
  const quoted = e.project_id
    ? await run<{ trade: string }>(
        `SELECT DISTINCT si.trade FROM quotes q JOIN quote_lines ql ON ql.quote_id = q.id JOIN scope_items si ON si.project_id = q.project_id AND si.key = ql.scope_key
          WHERE q.project_id = $1 AND q.supplier_kind = 'sub' AND q.approval_state = 'approved'`,
        [e.project_id],
      )
    : [];
  const [ps] = await run<{ config: { markup_pct?: number | null } }>(`SELECT config FROM pricing_setups WHERE state = 'active'`);
  const [legacy] = ps ? [] : await run<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'estimate.default_markup'`);
  const markup = ps?.config?.markup_pct ?? (legacy && Number.isFinite(Number(legacy.value)) ? Number(legacy.value) : null);
  const r = estimateReadinessScore({
    scope_items: scope.filter((s) => s.status !== "superseded").map((s) => ({ ...s, quantities: s.quantities ?? [], exclusions: s.exclusions ?? [] })),
    lines,
    gaps: open,
    sub_trades_needed: subTrades,
    sub_quotes_present: quoted.map((q) => q.trade),
    markup_pct: markup == null ? null : Number(markup),
  });
  const view: ReadinessView = { ...r, estimate_id: estimateId, computed_at: new Date().toISOString(), gaps_accepted: accepted, offer: { offered_at: e.offered_at, offer_stale: e.offer_stale, revision: e.revision } };
  if (opts.persist !== false) await run(`UPDATE estimates SET readiness = $2::jsonb WHERE id = $1`, [estimateId, JSON.stringify(view)]);
  return view;
}

/** Owner explicitly accepts the current hard gaps as assumptions (W03: Joe may
 *  approve a package when its limitations are visible). Records who/when. */
export async function acceptAssumptions(run: Run, estimateId: number, userId: string | null, gapKeys: string[] | "all"): Promise<number> {
  const rows =
    gapKeys === "all"
      ? await run(`UPDATE estimate_gaps SET status = 'accepted' WHERE estimate_id = $1 AND status = 'open' AND kind <> 'offer_changed' RETURNING id`, [estimateId])
      : await run(`UPDATE estimate_gaps SET status = 'accepted' WHERE estimate_id = $1 AND status = 'open' AND (kind || '|' || ref) = ANY($2::text[]) RETURNING id`, [estimateId, gapKeys]);
  await run(`UPDATE estimates SET assumptions_accepted_at = now(), assumptions_accepted_by = $2 WHERE id = $1`, [estimateId, userId]);
  return rows.length;
}

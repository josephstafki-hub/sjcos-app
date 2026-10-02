// Design direction, selections and feedback (WORKFLOW W04). Pure `run` style.
// Per room/scope: undefined direction → mood board; defined → selections;
// exact client product → straight into the working formal estimate. A client
// mood-board approval prepares selections automatically; a client selection
// choice becomes an estimate item (superseding the allowance it replaces);
// comments are never approval.

import type { Run } from "../commands/core.ts";
import type { Principal } from "../commands/principal.ts";
import { principalLabel } from "../commands/principal.ts";
import { loadLines, recomputeDraftEstimate, supersedeLine, upsertEstimateLine, type RecomputeResult } from "./assembly.ts";
import { classifyFeedback, decideDesignPath, identifyProduct, stableItemKey, normalizeUnit } from "./rules.ts";
import type { DesignPath, DirectionSufficiency, FeedbackEntry, ProductIdentity } from "./types.ts";

export { decideDesignPath, inferDirection } from "./rules.ts";

export interface DesignDecisionRow {
  id: string;
  project_id: string;
  scope_key: string;
  room: string;
  direction_sufficiency: DirectionSufficiency;
  path: DesignPath;
  board_room: string | null;
  board_revision: number | null;
  selection_ids: number[];
  client_direction_approved_at: string | null;
  owner_release_approved_at: string | null;
  feedback_log: FeedbackEntry[];
  partial_choices: { chosen: number[]; open: number[] };
  revision: number;
  status: string;
  notes: string;
}

const DD_COLS = `id, project_id, scope_key, room, direction_sufficiency, path, board_room, board_revision, selection_ids, client_direction_approved_at::text AS client_direction_approved_at,
  owner_release_approved_at::text AS owner_release_approved_at, feedback_log, partial_choices, revision, status, notes`;

export async function getDesignDecisions(run: Run, projectId: string): Promise<DesignDecisionRow[]> {
  const rows = await run<DesignDecisionRow>(`SELECT ${DD_COLS} FROM design_decisions WHERE project_id = $1 ORDER BY room, scope_key`, [projectId]);
  return rows.map((r) => ({ ...r, selection_ids: (r.selection_ids ?? []).map(Number), partial_choices: r.partial_choices ?? { chosen: [], open: [] } }));
}

/** Decide (or re-decide) the path for one room/scope. A changed direction
 *  bumps the revision and lists what it affects instead of restarting. */
export async function setDesignPath(run: Run, input: { project_id: string; scope_key: string; room?: string; direction: DirectionSufficiency; board_room?: string | null; notes?: string; principal?: Principal }): Promise<{ decision: DesignDecisionRow; path: DesignPath; changed: boolean; affected: string[] }> {
  const path = decideDesignPath(input.direction);
  const [existing] = await run<DesignDecisionRow>(`SELECT ${DD_COLS} FROM design_decisions WHERE project_id = $1 AND scope_key = $2 FOR UPDATE`, [input.project_id, input.scope_key]);
  if (!existing) {
    const [row] = await run<DesignDecisionRow>(
      `INSERT INTO design_decisions (project_id, scope_key, room, direction_sufficiency, path, board_room, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${DD_COLS}`,
      [input.project_id, input.scope_key, input.room ?? "", input.direction, path, path === "mood_board" ? (input.board_room ?? input.room ?? input.scope_key) : null, input.notes ?? ""],
    );
    return { decision: norm(row), path, changed: true, affected: [] };
  }
  if (existing.path === path && existing.direction_sufficiency === input.direction) return { decision: norm(existing), path, changed: false, affected: [] };
  const affected: string[] = [];
  if (existing.selection_ids?.length) affected.push(`${existing.selection_ids.length} selection(s) prepared under the old direction`);
  const lines = await run<{ description: string }>(`SELECT l.description FROM estimate_lines l JOIN estimates e ON e.id = l.estimate_id WHERE e.project_id = $1 AND l.scope_item_key = $2 AND l.superseded_by IS NULL`, [input.project_id, input.scope_key]);
  for (const l of lines) affected.push(`estimate item: ${l.description}`);
  const [row] = await run<DesignDecisionRow>(
    `UPDATE design_decisions SET direction_sufficiency = $3, path = $4, board_room = $5, revision = revision + 1, status = 'open', owner_release_approved_at = NULL,
       notes = CASE WHEN $6 <> '' THEN $6 ELSE notes END, feedback_log = feedback_log || $7::jsonb
      WHERE project_id = $1 AND scope_key = $2 RETURNING ${DD_COLS}`,
    [input.project_id, input.scope_key, input.direction, path, path === "mood_board" ? (input.board_room ?? existing.board_room ?? input.room ?? input.scope_key) : existing.board_room, input.notes ?? "", JSON.stringify([{ at: new Date().toISOString(), author: input.principal ? principalLabel(input.principal) : "system", body: `direction changed ${existing.direction_sufficiency} → ${input.direction}; affected: ${affected.join("; ") || "nothing"}`, kind: "change_request", revision: existing.revision + 1 }])],
  );
  return { decision: norm(row), path, changed: true, affected };
}

function norm(r: DesignDecisionRow): DesignDecisionRow {
  return { ...r, selection_ids: (r.selection_ids ?? []).map(Number), partial_choices: r.partial_choices ?? { chosen: [], open: [] } };
}

/** Client approved a mood board's direction (project_mood_boards.client_approved_at
 *  is set by lib/actions/mood.ts): prepare selections for the room's undecided
 *  finishes in the existing project_selections table. Idempotent per finish. */
export async function applyClientDirectionApproval(run: Run, input: { project_id: string; room: string; principal?: Principal }): Promise<{ selections_created: number[]; selections_existing: number[]; decisions: string[] }> {
  const [board] = await run<{ client_approved_at: string | null }>(`SELECT client_approved_at::text AS client_approved_at FROM project_mood_boards WHERE project_id = $1 AND room = $2`, [input.project_id, input.room]);
  if (!board?.client_approved_at) throw new Error(`the ${input.room} board has no client approval on record`);
  const scope = await run<{ key: string; title: string; required_finishes: Array<{ label: string; status: string; ref: string | null }> }>(
    `SELECT key, title, required_finishes FROM scope_items WHERE project_id = $1 AND lower(room) = lower($2) AND status NOT IN ('superseded','excluded')`,
    [input.project_id, input.room],
  );
  const created: number[] = [];
  const existingIds: number[] = [];
  const decisions: string[] = [];
  for (const s of scope) {
    let changed = false;
    const createdHere: number[] = [];
    const existingHere: number[] = [];
    const finishes = [...(s.required_finishes ?? [])];
    for (const f of finishes) {
      if (f.status !== "undecided") continue;
      const area = `${input.room} — ${f.label}`;
      const [have] = await run<{ id: string }>(`SELECT id FROM project_selections WHERE project_id = $1 AND area = $2`, [input.project_id, area]);
      if (have) {
        existingIds.push(Number(have.id));
        existingHere.push(Number(have.id));
        continue;
      }
      const [sel] = await run<{ id: string }>(
        `INSERT INTO project_selections (project_id, area, notes, status, sort_order)
         VALUES ($1, $2, $3, 'draft', COALESCE((SELECT max(sort_order)+1 FROM project_selections WHERE project_id = $1), 0)) RETURNING id`,
        [input.project_id, area, `Prepared from the approved ${input.room} mood board direction (${board.client_approved_at}). Owner reviews before the client sees it.`],
      );
      created.push(Number(sel.id));
      createdHere.push(Number(sel.id));
      f.ref = `selection:${sel.id}`;
      changed = true;
    }
    if (changed) await run(`UPDATE scope_items SET required_finishes = $3::jsonb WHERE project_id = $1 AND key = $2`, [input.project_id, s.key, JSON.stringify(finishes)]);
    const ids = [...createdHere, ...existingHere];
    const [dd] = await run<{ id: string }>(
      `INSERT INTO design_decisions (project_id, scope_key, room, direction_sufficiency, path, board_room, client_direction_approved_at, selection_ids, partial_choices, status)
       VALUES ($1,$2,$3,'defined','selections',$3,$4::timestamptz,$5,$6::jsonb,'open')
       ON CONFLICT (project_id, scope_key) DO UPDATE SET direction_sufficiency = 'defined', path = 'selections', client_direction_approved_at = COALESCE(design_decisions.client_direction_approved_at, EXCLUDED.client_direction_approved_at),
         selection_ids = COALESCE((SELECT array_agg(DISTINCT x) FROM unnest(design_decisions.selection_ids || EXCLUDED.selection_ids) AS x), '{}'::int[]), partial_choices = $6::jsonb
       RETURNING id`,
      [input.project_id, s.key, input.room, board.client_approved_at, ids, JSON.stringify({ chosen: [], open: ids })],
    );
    decisions.push(dd.id);
  }
  return { selections_created: created, selections_existing: existingIds, decisions };
}

/** Client chose a selection option (project_selections.chosen_option_id set
 *  by lib/actions/selections.ts decideSelection): incorporate it into the
 *  estimate, supersede the allowance/previous choice it replaces, and track
 *  the room's partial choices. Idempotent per selection. */
export async function applySelectionChoice(run: Run, input: { selection_id: number; estimate_id: number; principal?: Principal }): Promise<{ line_id: number; superseded: number[]; research_needed: boolean; partial: { chosen: number[]; open: number[] } | null; recompute: RecomputeResult }> {
  const [sel] = await run<{ id: string; project_id: string; area: string; status: string; chosen_option_id: string | null; allowance: number; section_name: string | null; opt_name: string; opt_brand: string; opt_sku: string; opt_url: string; opt_price: number; opt_id: string }>(
    `SELECT s.id, s.project_id, s.area, s.status, s.chosen_option_id, s.allowance, sec.name AS section_name,
            o.name AS opt_name, o.brand AS opt_brand, o.sku AS opt_sku, o.product_url AS opt_url, o.price AS opt_price, o.id AS opt_id
       FROM project_selections s
       LEFT JOIN project_sections sec ON sec.id = s.section_id
       LEFT JOIN project_selection_options o ON o.id = s.chosen_option_id
      WHERE s.id = $1`,
    [input.selection_id],
  );
  if (!sel) throw new Error("selection not found");
  if (sel.status !== "approved" || !sel.chosen_option_id) throw new Error(`selection ${sel.id} has no client choice yet (status ${sel.status})`);
  const key = stableItemKey("selection", sel.id);
  const product: ProductIdentity = { name: sel.opt_name, brand: sel.opt_brand, sku: sel.opt_sku, url: sel.opt_url };
  // option.price is DOLLARS in project_selection_options; 0 = unknown, never a $0 cost
  const priceCents = sel.opt_price > 0 ? Math.round(sel.opt_price * 100) : null;
  const lines = await loadLines(run, input.estimate_id);
  const superseded: number[] = [];
  const up = await upsertEstimateLine(run, input.estimate_id, {
    item_key: key,
    description: `${sel.area}: ${sel.opt_name}`,
    section: sel.section_name ?? "Selections",
    unit: "ea",
    qty: 1,
    scope_item_key: lines.find((l) => l.is_allowance && l.allowance_scope === `selection:${sel.id}`)?.scope_item_key ?? null,
    source_kind: "selection",
    source_ref: { selection_id: Number(sel.id), option_id: Number(sel.opt_id), product },
    internal_cost_cents: priceCents,
    cost_basis: priceCents == null ? null : `selection_option:${sel.opt_id}`,
    cost_observed_at: priceCents == null ? null : new Date().toISOString(),
    provisional: true, // listed option price until a supplier quote or purchase confirms it
    evidence: { kind: "client_choice", selection_id: Number(sel.id), option_id: Number(sel.opt_id), by: input.principal ? principalLabel(input.principal) : "client", at: new Date().toISOString() },
  });
  // The allowance (or a previous choice) this selection replaces goes away — once.
  for (const l of lines) {
    const coversThis = (l.is_allowance && (l.allowance_scope === `selection:${sel.id}` || l.allowance_scope === sel.area)) || (l.source_kind === "selection" && l.item_key !== key && (l.source_ref as { selection_id?: number }).selection_id === Number(sel.id));
    if (coversThis && l.id !== up.id && l.superseded_by == null) {
      await supersedeLine(run, l.id, up.id, `replaced by client choice on selection ${sel.id}`);
      superseded.push(l.id);
    }
  }
  // Partial choices in the room's design decision.
  const [dd] = await run<{ id: string; selection_ids: number[]; partial_choices: { chosen: number[]; open: number[] } }>(`SELECT id, selection_ids, partial_choices FROM design_decisions WHERE project_id = $1 AND $2 = ANY(selection_ids) FOR UPDATE`, [sel.project_id, Number(sel.id)]);
  let partial: { chosen: number[]; open: number[] } | null = null;
  if (dd) {
    const chosen = Array.from(new Set([...(dd.partial_choices?.chosen ?? []).map(Number), Number(sel.id)]));
    const open = (dd.selection_ids ?? []).map(Number).filter((id) => !chosen.includes(id));
    partial = { chosen, open };
    await run(`UPDATE design_decisions SET partial_choices = $2::jsonb, status = CASE WHEN $3::int = 0 THEN 'approved' ELSE status END WHERE id = $1`, [dd.id, JSON.stringify(partial), open.length]);
  }
  const recompute = await recomputeDraftEstimate(run, input.estimate_id, { principal: input.principal });
  return { line_id: up.id, superseded, research_needed: priceCents == null, partial, recompute };
}

/** W04 row 3: the client supplied an exact product/finish. Straight into the
 *  working formal estimate as a source-linked item with cost unknown (a gap
 *  and a research task), no selection board. */
export async function applyClientExactProduct(run: Run, input: { project_id: string; estimate_id: number; scope_key?: string | null; product: ProductIdentity; qty?: number | null; unit?: string | null; instruction_ref: string; principal?: Principal }): Promise<{ line_id: number; item_key: string; research: { product_key: string; missing: string[]; exact: boolean }; recompute: RecomputeResult }> {
  const ident = identifyProduct(input.product, { unit: input.unit, qty: input.qty });
  const key = stableItemKey("client_product", ident.product_key);
  const [scope] = input.scope_key ? await run<{ room: string; title: string }>(`SELECT room, title FROM scope_items WHERE project_id = $1 AND key = $2`, [input.project_id, input.scope_key]) : [];
  const up = await upsertEstimateLine(run, input.estimate_id, {
    item_key: key,
    description: [input.product.brand, input.product.name ?? input.product.model, input.product.finish].filter(Boolean).join(" "),
    section: scope?.room ?? "Client-specified",
    unit: normalizeUnit(input.unit) ?? input.unit ?? "ea",
    qty: input.qty ?? 0,
    scope_item_key: input.scope_key ?? null,
    source_kind: "client_product",
    source_ref: { product: input.product, instruction: input.instruction_ref },
    internal_cost_cents: null,
    provisional: true,
    evidence: { kind: "client_instruction", ref: input.instruction_ref, at: new Date().toISOString(), by: input.principal ? principalLabel(input.principal) : "client" },
  });
  if (input.scope_key) {
    await run(
      `INSERT INTO design_decisions (project_id, scope_key, room, direction_sufficiency, path, status, notes)
       VALUES ($1,$2,$3,'exact','direct_estimate','approved',$4)
       ON CONFLICT (project_id, scope_key) DO UPDATE SET direction_sufficiency = 'exact', path = 'direct_estimate', notes = EXCLUDED.notes`,
      [input.project_id, input.scope_key, scope?.room ?? "", `Client supplied exact product (${input.instruction_ref}); no selection board.`],
    );
    // the scope's required finish, if it matches, is now client_supplied
    await run(
      `UPDATE scope_items SET required_finishes = (
         SELECT COALESCE(jsonb_agg(CASE WHEN f->>'status' = 'undecided' THEN f || jsonb_build_object('status','client_supplied','ref',$3::text) ELSE f END), '[]'::jsonb)
           FROM jsonb_array_elements(required_finishes) f)
       WHERE project_id = $1 AND key = $2 AND jsonb_array_length(required_finishes) = 1`,
      [input.project_id, input.scope_key, key],
    );
  }
  const recompute = await recomputeDraftEstimate(run, input.estimate_id, { principal: input.principal });
  return { line_id: up.id, item_key: key, research: { product_key: ident.product_key, missing: ident.missing, exact: ident.exact }, recompute };
}

/** Feedback on a board/selection package: recorded with revision history. A
 *  change request reopens the artifact for owner review; a comment changes
 *  nothing about approval; approval is only ever the explicit approval action. */
export async function applyFeedback(run: Run, input: { project_id: string; scope_key: string; author: string; body: string; kind?: "comment" | "change_request" }): Promise<{ kind: "comment" | "change_request"; revision: number; approval_changed: false; needs_owner_review: boolean }> {
  const kind = input.kind ?? classifyFeedback(input.body);
  const [dd] = await run<{ revision: number }>(`SELECT revision FROM design_decisions WHERE project_id = $1 AND scope_key = $2 FOR UPDATE`, [input.project_id, input.scope_key]);
  if (!dd) throw new Error(`no design decision for ${input.scope_key}`);
  const revision = kind === "change_request" ? dd.revision + 1 : dd.revision;
  const entry: FeedbackEntry = { at: new Date().toISOString(), author: input.author, body: input.body, kind, revision };
  await run(
    `UPDATE design_decisions SET feedback_log = feedback_log || $3::jsonb, revision = $4,
       owner_release_approved_at = CASE WHEN $5 THEN NULL ELSE owner_release_approved_at END,
       status = CASE WHEN $5 THEN 'open' ELSE status END
      WHERE project_id = $1 AND scope_key = $2`,
    [input.project_id, input.scope_key, JSON.stringify([entry]), revision, kind === "change_request"],
  );
  return { kind, revision, approval_changed: false, needs_owner_review: kind === "change_request" };
}

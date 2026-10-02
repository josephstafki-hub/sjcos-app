// Estimate input package (A11 → A15 hand-off). Pure `run`. Snapshots the
// known facts, photo file ids, measurements and open questions for a lead as
// a numbered revision, then calls the injected `onEstimateInputsReady` hook
// (WS-estimating registers it; default is a no-op that only records the
// hand-off time). Unusual scope / disputes / business choices become a
// decision of kind 'other', not a stream of emails.

import type { Run } from "../commands/core.ts";
import { hashInput } from "../commands/core.ts";
import { stageDecision, type Decision } from "../commands/decisions.ts";
import { principalLabel, type Principal } from "../commands/principal.ts";
import { qualificationChecklist } from "./qualification.ts";

export type EstimateInputsHook = (run: Run, leadId: string, packageId: number) => Promise<void>;

let hook: EstimateInputsHook | null = null;
/** WS-estimating registers its intake here (e.g. from lib/estimating/index.ts). */
export function onEstimateInputsReady(fn: EstimateInputsHook | null): void {
  hook = fn;
}

export interface EstimateInputPackage {
  id: number;
  lead_id: string;
  revision: number;
  facts: Record<string, unknown>;
  photos: string[];
  measurements: unknown[];
  open_questions: string[];
  handed_to_estimating_at: string | null;
}

export async function prepareEstimateInputPackage(
  run: Run,
  input: { leadId: string; principal: Principal; extraQuestions?: string[]; hook?: EstimateInputsHook | null },
): Promise<{ ok: true; package: EstimateInputPackage; created: boolean } | { ok: false; reason: string }> {
  const [lead] = await run<{ id: string; slug: string; name: string }>(`SELECT id, slug, name FROM leads WHERE id = $1`, [input.leadId]);
  if (!lead) return { ok: false, reason: "lead not found" };
  const checklist = await qualificationChecklist(run, lead.id);
  const facts = Object.fromEntries(Object.entries(checklist.facts).map(([k, f]) => [k, { value: f.value, status: f.status, source: f.source_ref }]));
  const photos = await run<{ id: string }>(`SELECT id FROM files WHERE lead_slug = $1 AND storage_path IS NOT NULL AND type = 'img' ORDER BY created_at`, [lead.slug]);
  const measurements = checklist.facts.measurements.status === "known" ? [checklist.facts.measurements.value] : [];
  const openQuestions = [...checklist.missing.map((k) => `${k} not known`), ...(input.extraQuestions ?? [])];
  const snapshotHash = hashInput({ facts, photos: photos.map((p) => p.id), measurements, openQuestions });
  const [latest] = await run<EstimateInputPackage & { hash: string | null }>(
    `SELECT id, lead_id, revision, facts, photos, measurements, open_questions, handed_to_estimating_at::text AS handed_to_estimating_at, facts->>'_hash' AS hash
       FROM estimate_input_packages WHERE lead_id = $1 ORDER BY revision DESC LIMIT 1`,
    [lead.id],
  );
  if (latest && latest.hash === snapshotHash) return { ok: true, package: { ...latest, id: Number(latest.id), revision: Number(latest.revision) }, created: false };
  const revision = latest ? Number(latest.revision) + 1 : 1;
  const [row] = await run<EstimateInputPackage>(
    `INSERT INTO estimate_input_packages (lead_id, revision, facts, photos, measurements, open_questions, handed_to_estimating_at, created_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, now(), $7)
     RETURNING id, lead_id, revision, facts, photos, measurements, open_questions, handed_to_estimating_at::text AS handed_to_estimating_at`,
    [lead.id, revision, JSON.stringify({ ...facts, _hash: snapshotHash }), JSON.stringify(photos.map((p) => p.id)), JSON.stringify(measurements), JSON.stringify(openQuestions), principalLabel(input.principal)],
  );
  const pkg = { ...row, id: Number(row.id), revision: Number(row.revision) };
  const fn = input.hook === undefined ? hook : input.hook;
  if (fn) await fn(run, lead.id, pkg.id);
  await run(`INSERT INTO lead_activity (lead_id, kind, summary, actor) VALUES ($1, 'note', $2, $3)`, [lead.id, `Estimate inputs package rev ${revision} handed to estimating (${openQuestions.length} open question${openQuestions.length === 1 ? "" : "s"})`, principalLabel(input.principal)]);
  return { ok: true, package: pkg, created: true };
}

/** Unusual scope, a dispute or a real business choice → one decision for Joe. */
export async function routeLeadIssueToDecision(
  run: Run,
  input: { leadId: string; issue: string; options?: string[]; evidence?: string[]; principal: Principal },
): Promise<{ decision: Decision; created: boolean }> {
  const [lead] = await run<{ slug: string; name: string }>(`SELECT slug, name FROM leads WHERE id = $1`, [input.leadId]);
  const staged = await stageDecision(run, {
    kind: "other",
    action: "lead_business_choice",
    title: `${lead?.name ?? "Lead"}: ${input.issue}`.slice(0, 300),
    summary: { gaps: input.evidence ?? [], recommendation: "", effect: "Records your choice on the lead; no message goes out from this decision." },
    targetKind: "lead",
    targetId: input.leadId,
    leadId: input.leadId,
    href: lead ? `/leads/${lead.slug}` : null,
    options: input.options?.length ? input.options : ["approve", "reject"],
    dedupeKey: `lead:${input.leadId}:issue:${hashInput(input.issue).slice(0, 12)}`,
    requestedBy: input.principal,
  });
  return { decision: staged.decision, created: staged.created };
}

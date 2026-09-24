// Closeout sequence (A17 / W12):
//   internal_inspection → corrections (owner confirms) → client_walkthrough
//   (cannot be scheduled before the confirmation) → client_punch → signoff
//   (written, doc_type 'completion') → final_invoice (WS-money hook, once)
//   → post_project (postproject.ts).
//
// Uploading a photo is evidence of a correction, never acceptance of it.

import type { Run } from "../commands/core.ts";
import { isOwner, humanOf, type Principal } from "../commands/principal.ts";
import type { CloseoutHooks } from "./hooks.ts";
import { pinSignedSignatureRequest } from "./revisions.ts";
import { schedulePostProjectActions } from "./postproject.ts";

export type Phase = "internal_inspection" | "corrections" | "client_walkthrough" | "client_punch" | "signoff" | "final_invoice" | "post_project";

export interface ChecklistItem {
  key: string;
  label: string;
  state: "open" | "corrected" | "resolved" | "done";
  evidence: { reportIds: string[]; photoIds: string[] };
  source: string; // punch:<id> / report:<id> / client
  by?: string;
  at?: string;
}

export interface Checklist {
  id: string;
  project_id: string;
  phase: Phase;
  items: ChecklistItem[];
  status: "pending" | "in_progress" | "done" | "confirmed" | "blocked";
  blocked_reason: string | null;
  scheduled_for: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

const COLS = `id, project_id, phase, items, status, blocked_reason, scheduled_for::text AS scheduled_for, confirmed_by, confirmed_at::text AS confirmed_at`;

export async function getChecklist(run: Run, projectId: string, phase: Phase): Promise<Checklist | null> {
  const [row] = await run<Checklist>(`SELECT ${COLS} FROM closeout_checklists WHERE project_id = $1 AND phase = $2`, [projectId, phase]);
  return row ?? null;
}

async function upsert(run: Run, projectId: string, phase: Phase, items: ChecklistItem[], status: Checklist["status"], extra: Partial<Pick<Checklist, "blocked_reason" | "scheduled_for">> = {}): Promise<Checklist> {
  const [row] = await run<Checklist>(
    `INSERT INTO closeout_checklists (project_id, phase, items, status, blocked_reason, scheduled_for)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)
     ON CONFLICT (project_id, phase) DO UPDATE SET items = EXCLUDED.items, status = EXCLUDED.status,
       blocked_reason = EXCLUDED.blocked_reason, scheduled_for = COALESCE(EXCLUDED.scheduled_for, closeout_checklists.scheduled_for)
     RETURNING ${COLS}`,
    [projectId, phase, JSON.stringify(items), status, extra.blocked_reason ?? null, extra.scheduled_for ?? null],
  );
  return row;
}

/** Joe's internal inspection list: open punch items + unresolved snags. */
export async function prepareInternalInspection(run: Run, projectId: string): Promise<Checklist> {
  const punch = await run<{ id: string; item: string; done: boolean }>(`SELECT id, item, done FROM project_punch WHERE project_id = $1 ORDER BY sort_order, id`, [projectId]);
  const snags = await run<{ id: string; body: string; resolved_at: string | null }>(
    `SELECT r.id, r.body, i.resolved_at::text AS resolved_at FROM field_reports r LEFT JOIN field_incidents i ON i.source_report_id = r.id
      WHERE r.project_id = $1 AND r.kind = 'snag' ORDER BY r.reported_at`,
    [projectId],
  );
  const existing = await getChecklist(run, projectId, "internal_inspection");
  const prior = new Map((existing?.items ?? []).map((i) => [i.key, i]));
  const items: ChecklistItem[] = [
    ...punch.map((p) => prior.get(`punch:${p.id}`) ?? { key: `punch:${p.id}`, label: p.item, state: p.done ? ("done" as const) : ("open" as const), evidence: { reportIds: [], photoIds: [] }, source: `punch:${p.id}` }),
    ...snags.map((s) => prior.get(`snag:${s.id}`) ?? { key: `snag:${s.id}`, label: s.body.split("\n")[0], state: s.resolved_at ? ("done" as const) : ("open" as const), evidence: { reportIds: [s.id], photoIds: [] }, source: `report:${s.id}` }),
  ];
  const open = items.filter((i) => i.state === "open");
  const list = await upsert(run, projectId, "internal_inspection", items, open.length ? "in_progress" : "done");
  // Mirror open items into the corrections phase (unless already tracked).
  const corr = await getChecklist(run, projectId, "corrections");
  if (corr?.status !== "confirmed") {
    const priorCorr = new Map((corr?.items ?? []).map((i) => [i.key, i]));
    const corrItems = open.map((i) => priorCorr.get(i.key) ?? { ...i, state: "open" as const });
    await upsert(run, projectId, "corrections", corrItems, corrItems.some((i) => i.state === "open") ? "in_progress" : corrItems.length ? "done" : "pending");
  }
  return list;
}

/** A sub (or Joe) records evidence that an item was corrected. Evidence only —
 *  the item stays 'corrected', never 'done', until Joe confirms. */
export async function recordCorrection(run: Run, input: { projectId: string; itemKey: string; reportIds?: string[]; photoIds?: string[]; by: string }): Promise<Checklist> {
  const corr = await getChecklist(run, input.projectId, "corrections");
  if (!corr) throw new Error("Run the internal inspection first.");
  if (corr.status === "confirmed") return corr;
  let found = false;
  const items = corr.items.map((i) => {
    if (i.key !== input.itemKey) return i;
    found = true;
    return {
      ...i,
      state: "corrected" as const,
      by: input.by,
      at: new Date().toISOString(),
      evidence: {
        reportIds: [...new Set([...i.evidence.reportIds, ...(input.reportIds ?? [])])],
        photoIds: [...new Set([...i.evidence.photoIds, ...(input.photoIds ?? [])])],
      },
    };
  });
  if (!found) throw new Error(`No correction item ${input.itemKey}.`);
  return upsert(run, input.projectId, "corrections", items, items.some((i) => i.state === "open") ? "in_progress" : "done");
}

/** Owner gate: every correction item corrected (or done) → phase confirmed.
 *  Anything still open refuses; a non-owner refuses. */
export async function confirmCorrectionsBeforeWalkthrough(run: Run, principal: Principal, projectId: string): Promise<{ ok: true; checklist: Checklist } | { ok: false; reason: string; open: string[] }> {
  if (!isOwner(principal)) return { ok: false, reason: "Only Joe confirms corrections.", open: [] };
  const corr = await getChecklist(run, projectId, "corrections");
  if (!corr) return { ok: false, reason: "No corrections phase yet — run the internal inspection.", open: [] };
  const open = corr.items.filter((i) => i.state === "open").map((i) => i.label);
  if (open.length) return { ok: false, reason: `${open.length} item(s) still open.`, open };
  const items = corr.items.map((i) => ({ ...i, state: "done" as const }));
  const [row] = await run<Checklist>(
    `UPDATE closeout_checklists SET items = $3::jsonb, status = 'confirmed', confirmed_by = $4, confirmed_at = now() WHERE project_id = $1 AND phase = $2 RETURNING ${COLS}`,
    [projectId, "corrections", JSON.stringify(items), humanOf(principal)!.userId],
  );
  await run(`UPDATE project_punch SET done = true WHERE project_id = $1 AND done = false AND ('punch:' || id::text) = ANY($2::text[])`, [projectId, items.map((i) => i.key)]);
  return { ok: true, checklist: row };
}

/** The walkthrough cannot be scheduled until Joe confirmed the corrections. */
export async function scheduleClientWalkthrough(run: Run, input: { projectId: string; at: string }): Promise<{ ok: true; checklist: Checklist } | { ok: false; reason: string }> {
  const corr = await getChecklist(run, input.projectId, "corrections");
  if (!corr || corr.status !== "confirmed") {
    await upsert(run, input.projectId, "client_walkthrough", [], "blocked", { blocked_reason: "Joe has not confirmed the corrections yet." });
    return { ok: false, reason: "Client walkthrough is gated on Joe's confirmation of the corrected punch list." };
  }
  const list = await upsert(run, input.projectId, "client_walkthrough", [{ key: "walkthrough", label: "Client walkthrough", state: "open", evidence: { reportIds: [], photoIds: [] }, source: "owner" }], "in_progress", { scheduled_for: input.at });
  return { ok: true, checklist: list };
}

export async function recordClientPunch(run: Run, input: { projectId: string; items: { label: string; key?: string }[] }): Promise<Checklist> {
  const cur = await getChecklist(run, input.projectId, "client_punch");
  const prior = cur?.items ?? [];
  const items: ChecklistItem[] = [...prior];
  for (const it of input.items) {
    const key = it.key ?? `client:${items.length + 1}:${it.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
    if (items.some((i) => i.key === key)) continue;
    items.push({ key, label: it.label, state: "open", evidence: { reportIds: [], photoIds: [] }, source: "client" });
  }
  return upsert(run, input.projectId, "client_punch", items, items.some((i) => i.state === "open") ? "in_progress" : "done");
}

export async function resolveClientPunch(run: Run, input: { projectId: string; itemKey: string; reportIds?: string[]; photoIds?: string[]; by: string }): Promise<Checklist> {
  const cur = await getChecklist(run, input.projectId, "client_punch");
  if (!cur) throw new Error("No client punch list.");
  const items = cur.items.map((i) =>
    i.key === input.itemKey
      ? { ...i, state: "resolved" as const, by: input.by, at: new Date().toISOString(), evidence: { reportIds: [...new Set([...i.evidence.reportIds, ...(input.reportIds ?? [])])], photoIds: [...new Set([...i.evidence.photoIds, ...(input.photoIds ?? [])])] } }
      : i,
  );
  return upsert(run, input.projectId, "client_punch", items, items.some((i) => i.state === "open") ? "in_progress" : "done");
}

export interface SignoffResult {
  ok: true;
  recorded: boolean;
  hooksFired: boolean;
  blocked: string | null;
  projectId: string;
}

/** Record written client sign-off (signature_requests doc_type 'completion',
 *  status signed). Idempotent (UNIQUE project / request). The final-invoice
 *  hook + post-project scheduling fire exactly once, and only when no client
 *  punch item is still open (otherwise they fire from releaseSignoffHooks
 *  once the list is resolved). */
export async function recordWrittenSignoff(run: Run, signatureRequestId: number, hooks: CloseoutHooks): Promise<SignoffResult | { ok: false; reason: string }> {
  const [sr] = await run<{ id: string; project_id: string | null; doc_type: string; status: string; signed_at: string | null }>(
    `SELECT id, project_id, doc_type, status, signed_at::text AS signed_at FROM signature_requests WHERE id = $1`,
    [signatureRequestId],
  );
  if (!sr) return { ok: false, reason: "No such signature request." };
  if (!sr.project_id) return { ok: false, reason: "Sign-off is not project-scoped." };
  if (sr.doc_type !== "completion") return { ok: false, reason: `Expected a completion sign-off, got ${sr.doc_type}.` };
  if (sr.status !== "signed" || !sr.signed_at) return { ok: false, reason: "The client has not signed yet." };
  const rev = await pinSignedSignatureRequest(run, signatureRequestId);
  const [ins] = await run<{ id: string }>(
    `INSERT INTO client_signoffs (project_id, signature_request_id, signed_at, content_hash)
     VALUES ($1, $2, $3::timestamptz, $4) ON CONFLICT (project_id) DO NOTHING RETURNING id`,
    [sr.project_id, signatureRequestId, sr.signed_at, rev.content_hash],
  );
  await upsert(run, sr.project_id, "signoff", [{ key: "signoff", label: "Written client sign-off", state: "done", evidence: { reportIds: [], photoIds: [] }, source: `signature:${sr.id}` }], "done");
  const fired = await releaseSignoffHooks(run, sr.project_id, hooks);
  return { ok: true, recorded: !!ins, hooksFired: fired.fired, blocked: fired.blocked, projectId: sr.project_id };
}

/** Fire the once-only sign-off effects when the gate (no open client punch)
 *  holds. Safe to call any number of times. */
export async function releaseSignoffHooks(run: Run, projectId: string, hooks: CloseoutHooks): Promise<{ fired: boolean; blocked: string | null }> {
  const punch = await getChecklist(run, projectId, "client_punch");
  const open = (punch?.items ?? []).filter((i) => i.state === "open");
  if (open.length) {
    await run(`UPDATE client_signoffs SET hooks_blocked_reason = $2 WHERE project_id = $1 AND hooks_fired_at IS NULL`, [projectId, `${open.length} client punch item(s) still open`]);
    return { fired: false, blocked: `${open.length} client punch item(s) still open` };
  }
  const [row] = await run<{ signature_request_id: string }>(
    `UPDATE client_signoffs SET hooks_fired_at = now(), hooks_blocked_reason = NULL WHERE project_id = $1 AND hooks_fired_at IS NULL RETURNING signature_request_id`,
    [projectId],
  );
  if (!row) return { fired: false, blocked: null };
  await hooks.onClientSignoff(run, projectId, Number(row.signature_request_id));
  await upsert(run, projectId, "final_invoice", [{ key: "final_invoice", label: "Final reconciled invoice (WS-money)", state: "done", evidence: { reportIds: [], photoIds: [] }, source: "hook" }], "done");
  await schedulePostProjectActions(run, projectId);
  return { fired: true, blocked: null };
}

export async function closeoutOverview(run: Run, projectId: string): Promise<Checklist[]> {
  return run<Checklist>(`SELECT ${COLS} FROM closeout_checklists WHERE project_id = $1 ORDER BY array_position(ARRAY['internal_inspection','corrections','client_walkthrough','client_punch','signoff','final_invoice','post_project'], phase)`, [projectId]);
}

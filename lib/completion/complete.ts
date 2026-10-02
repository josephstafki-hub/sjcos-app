// Evidence-backed completion (A04). ONE command marks a work item done, from
// every surface (owner UI, MCP update_work_item_status → internal route,
// orchestrator, worker): completeWorkItem(run, { workItemId, principal,
// evidence }). It validates typed evidence against the step's contract and
// the authoritative record BEFORE flipping status, writes the agent_receipts
// row from the evidence (never an invented receipt), and advances the runbook
// on the same transaction via lib/completion/runbook-core.ts.
//
// Evidence kinds — different business outcomes, never interchangeable:
//   draft              an artifact exists (knowledge item / document draft)
//   provider_accepted  an action intent the provider accepted (state accepted|confirmed)
//   delivered          an action intent confirmed delivered (state confirmed)
//   business_response  the counterparty answered (obligation resolved / source event)
//   manual             a person resolved it: actor + reason, no receipt claimed
//   record             a row exists at the revision the caller saw (table + id + revision)
//
// Stale / wrong / missing evidence → refused with a reason, nothing written.
// Legacy items with no contract (required 'any') accept manual completion and
// are reported (`legacy: true`), not blocked.

import { onWorkItemDone } from "../agent-runtime/hooks.ts";
import type { Run } from "../commands/core.ts";
import { redactPrincipal } from "../commands/core.ts";
import type { Principal } from "../commands/principal.ts";
import { advanceRunbookTx, evidenceSatisfies, loadPinnedDefinition, type AdvanceOutcome, type RequiredEvidence } from "./runbook-core.ts";
import { resolveObligation } from "../obligations/core.ts";

export type CompletionEvidence =
  | { kind: "draft"; knowledge_item_id?: string | null; document_draft_id?: string | number | null; label?: string | null }
  | { kind: "provider_accepted"; intent_id: string; label?: string | null }
  | { kind: "delivered"; intent_id: string; label?: string | null }
  | { kind: "business_response"; obligation_id?: string | null; source_event_id?: string | null; label?: string | null }
  | { kind: "manual"; actor: string; reason: string }
  | { kind: "record"; table: string; id: string | number; revision: string; label?: string | null };

export interface CompleteWorkItemInput {
  workItemId: string;
  principal: Principal;
  evidence: CompletionEvidence;
  /** Optional agent_runs row to hang the receipt on. */
  agentRunId?: string | null;
  note?: string | null;
}

export type CompleteWorkItemResult =
  | { ok: true; workItemId: string; receiptId: string | null; alreadyDone: boolean; legacy: boolean; required: RequiredEvidence; runbook: AdvanceOutcome | null; obligationId: string | null }
  | { ok: false; error: string; required?: RequiredEvidence };

const RECORD_TABLES = new Set([
  "knowledge_items",
  "document_drafts",
  "estimates",
  "invoices",
  "purchase_orders",
  "files",
  "calls",
  "leads",
  "projects",
  "bid_packages",
  "obligations",
  "signature_requests",
]);

const EVIDENCE_KINDS = new Set(["draft", "provider_accepted", "delivered", "business_response", "manual", "record"]);

interface WiRow {
  id: string;
  status: string;
  title: string;
  runbook_instance_id: string | null;
  runbook_step_order: number | null;
  obligation_id: string | null;
  lead_id: string | null;
  project_id: string | null;
}

type Validation = { ok: true; uri: string | null; label: string; metadata: Record<string, unknown> } | { ok: false; error: string };

async function tableHasColumn(run: Run, table: string, column: string): Promise<boolean> {
  const rows = await run<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2) AS ok`,
    [table, column],
  );
  return rows[0]?.ok === true;
}

async function validate(run: Run, ev: CompletionEvidence): Promise<Validation> {
  if (!ev || typeof ev !== "object" || !EVIDENCE_KINDS.has((ev as { kind?: string }).kind ?? "")) {
    return { ok: false, error: `evidence.kind must be one of ${[...EVIDENCE_KINDS].join(", ")}` };
  }
  switch (ev.kind) {
    case "draft": {
      if (ev.knowledge_item_id) {
        const [k] = await run<{ id: string; kind: string }>(`SELECT id, kind FROM knowledge_items WHERE id = $1`, [ev.knowledge_item_id]);
        if (!k) return { ok: false, error: `draft evidence: knowledge item ${ev.knowledge_item_id} does not exist` };
        return { ok: true, uri: `/brain?open=${k.id}`, label: ev.label ?? `Draft (knowledge item ${k.id})`, metadata: { knowledge_item_id: k.id, knowledge_kind: k.kind } };
      }
      if (ev.document_draft_id != null) {
        const [d] = await run<{ id: string; title: string; status: string | null }>(`SELECT id::text AS id, title, status FROM document_drafts WHERE id = $1`, [ev.document_draft_id]);
        if (!d) return { ok: false, error: `draft evidence: document draft ${ev.document_draft_id} does not exist` };
        return { ok: true, uri: `/documents?draft=${d.id}`, label: ev.label ?? `Draft: ${d.title}`, metadata: { document_draft_id: d.id, document_status: d.status } };
      }
      return { ok: false, error: "draft evidence needs knowledge_item_id or document_draft_id (the artifact must exist; a description is not an artifact)" };
    }
    case "provider_accepted":
    case "delivered": {
      if (!ev.intent_id) return { ok: false, error: `${ev.kind} evidence needs intent_id` };
      const [it] = await run<{ id: string; state: string; provider_ref: string | null; kind: string; operation_key: string }>(
        `SELECT id, state, provider_ref, kind, operation_key FROM action_intents WHERE id = $1`,
        [ev.intent_id],
      );
      if (!it) return { ok: false, error: `${ev.kind} evidence: action intent ${ev.intent_id} does not exist` };
      const okStates = ev.kind === "delivered" ? ["confirmed"] : ["accepted", "confirmed"];
      if (!okStates.includes(it.state)) {
        return { ok: false, error: `${ev.kind} evidence: intent ${it.id} is '${it.state}', need ${okStates.join("|")} — an intent that is pending, unknown or failed is not proof` };
      }
      return { ok: true, uri: it.provider_ref, label: ev.label ?? `${it.kind} ${it.operation_key} (${it.state})`, metadata: { intent_id: it.id, state: it.state, provider_ref: it.provider_ref } };
    }
    case "business_response": {
      if (ev.obligation_id) {
        const [o] = await run<{ id: string; status: string; resolution: Record<string, unknown> }>(`SELECT id, status, resolution FROM obligations WHERE id = $1`, [ev.obligation_id]);
        if (!o) return { ok: false, error: `business_response evidence: obligation ${ev.obligation_id} does not exist` };
        if (o.status !== "done") return { ok: false, error: `business_response evidence: obligation ${o.id} is '${o.status}', not resolved` };
        return { ok: true, uri: null, label: ev.label ?? `Counterparty responded (obligation ${o.id})`, metadata: { obligation_id: o.id, resolution: o.resolution } };
      }
      if (ev.source_event_id) {
        const [s] = await run<{ id: string; provider: string; event_id: string; event_type: string }>(`SELECT id, provider, event_id, event_type FROM source_events WHERE id = $1`, [ev.source_event_id]);
        if (!s) return { ok: false, error: `business_response evidence: source event ${ev.source_event_id} does not exist` };
        return { ok: true, uri: null, label: ev.label ?? `${s.provider} ${s.event_type} ${s.event_id}`, metadata: { source_event_id: s.id, provider: s.provider, event_id: s.event_id } };
      }
      return { ok: false, error: "business_response evidence needs obligation_id or source_event_id" };
    }
    case "manual": {
      const actor = (ev.actor ?? "").trim();
      const reason = (ev.reason ?? "").trim();
      if (!actor || !reason) return { ok: false, error: "manual completion needs actor and reason" };
      return { ok: true, uri: null, label: `Manual: ${reason.slice(0, 160)}`, metadata: { actor, reason } };
    }
    case "record": {
      const table = String(ev.table ?? "").toLowerCase();
      if (!RECORD_TABLES.has(table)) return { ok: false, error: `record evidence: table '${table}' is not an accepted record table` };
      if (ev.id == null || !ev.revision) return { ok: false, error: "record evidence needs id and revision" };
      const hasUpdated = await tableHasColumn(run, table, "updated_at");
      const hasRevision = await tableHasColumn(run, table, "revision");
      const revExpr = hasRevision ? "revision::text" : hasUpdated ? "to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')" : "NULL::text";
      const [row] = await run<{ id: string; rev: string | null }>(`SELECT id::text AS id, ${revExpr} AS rev FROM ${table} WHERE id::text = $1`, [String(ev.id)]);
      if (!row) return { ok: false, error: `record evidence: ${table} ${ev.id} does not exist` };
      if (row.rev == null) return { ok: false, error: `record evidence: ${table} carries no revision column to verify against` };
      if (!sameRevision(row.rev, ev.revision)) return { ok: false, error: `record evidence is stale: ${table} ${ev.id} is at revision ${row.rev}, evidence cites ${ev.revision}` };
      return { ok: true, uri: null, label: ev.label ?? `${table} ${row.id} @ ${row.rev}`, metadata: { table, id: row.id, revision: row.rev } };
    }
  }
}

function sameRevision(current: string, claimed: string): boolean {
  if (current === claimed) return true;
  // Callers that read the row through JSON hold a millisecond-truncated ISO;
  // equal at ms precision is the same revision, anything else is stale.
  const a = Date.parse(current);
  const b = Date.parse(claimed);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

/** Current revision token for record evidence: what a caller should read
 *  before acting and cite when completing. */
export async function recordRevision(run: Run, table: string, id: string | number): Promise<string | null> {
  const t = table.toLowerCase();
  if (!RECORD_TABLES.has(t)) return null;
  const hasRevision = await tableHasColumn(run, t, "revision");
  const hasUpdated = await tableHasColumn(run, t, "updated_at");
  const revExpr = hasRevision ? "revision::text" : hasUpdated ? "to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')" : "NULL::text";
  const [row] = await run<{ rev: string | null }>(`SELECT ${revExpr} AS rev FROM ${t} WHERE id::text = $1`, [String(id)]);
  return row?.rev ?? null;
}

export async function completeWorkItem(run: Run, input: CompleteWorkItemInput): Promise<CompleteWorkItemResult> {
  const [wi] = await run<WiRow>(
    `SELECT id, status, title, runbook_instance_id, runbook_step_order, obligation_id, lead_id, project_id
       FROM work_items WHERE id = $1 FOR UPDATE`,
    [input.workItemId],
  );
  if (!wi) return { ok: false, error: `No work item ${input.workItemId}` };

  // The step's contract from the PINNED definition (never the live table).
  let required: RequiredEvidence = "any";
  if (wi.runbook_instance_id && wi.runbook_step_order != null) {
    const [inst] = await run<{ definition_version_id: string | null }>(`SELECT definition_version_id FROM runbook_instances WHERE id = $1`, [wi.runbook_instance_id]);
    const def = inst?.definition_version_id ? await loadPinnedDefinition(run, inst.definition_version_id) : null;
    required = def?.steps.find((s) => s.stepOrder === wi.runbook_step_order)?.requiredEvidence ?? "any";
  }

  if (wi.status === "done") {
    return { ok: true, workItemId: wi.id, receiptId: null, alreadyDone: true, legacy: required === "any", required, runbook: null, obligationId: wi.obligation_id };
  }
  if (wi.status === "cancelled") return { ok: false, error: `work item ${wi.id} is cancelled; reopen it before completing`, required };

  const v = await validate(run, input.evidence);
  if (!v.ok) return { ok: false, error: v.error, required };
  if (!evidenceSatisfies(required, input.evidence.kind)) {
    return { ok: false, error: `this step requires '${required}' evidence; '${input.evidence.kind}' does not satisfy it`, required };
  }

  const [receipt] = await run<{ id: string }>(
    `INSERT INTO agent_receipts (agent_run_id, work_item_id, receipt_kind, uri, label, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
    [
      input.agentRunId ?? null,
      wi.id,
      input.evidence.kind,
      v.uri,
      v.label.slice(0, 200),
      JSON.stringify({ ...v.metadata, evidence: input.evidence, principal: redactPrincipal(input.principal), note: input.note ?? null, required }),
    ],
  );
  await run(
    `UPDATE work_items SET status = 'done', completed_at = now(), updated_at = now(),
            blocked_reason = CASE WHEN $2::text IS NULL THEN blocked_reason ELSE $2 END
      WHERE id = $1`,
    [wi.id, input.note ?? null],
  );
  await onWorkItemDone(run, input.workItemId).catch(() => null); // A24: next trigger, idempotent

  if (wi.obligation_id) {
    await resolveObligation(run, wi.obligation_id, { kind: "work_item_done", work_item_id: wi.id, receipt_id: receipt.id }, principalName(input.principal));
  }

  let runbook: AdvanceOutcome | null = null;
  if (wi.runbook_instance_id) runbook = await advanceRunbookTx(run, wi.runbook_instance_id);

  return { ok: true, workItemId: wi.id, receiptId: receipt.id, alreadyDone: false, legacy: required === "any" && input.evidence.kind === "manual", required, runbook, obligationId: wi.obligation_id };
}

function principalName(p: Principal): string {
  if (p.kind === "user") return `${p.role}:${p.name}`;
  if (p.kind === "service") return p.name;
  return p.onBehalfOf ? `${p.agent} for ${p.onBehalfOf.name}` : p.agent;
}

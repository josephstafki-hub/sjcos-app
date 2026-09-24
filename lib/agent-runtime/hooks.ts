// Event hooks other features call to wake the operating agent (A24).
//
//   onDecisionResolved(run, decisionId)   → 'approval' trigger (approve / reject / revoke)
//   onWorkItemDone(run, workItemId)       → 'approval' trigger when the item was owner-approved,
//                                            else a 'note' trigger (a completed step is a fact)
//   onSignatureCompleted(run, requestId)  → 'signature' trigger (W02)
//   onInboundMessage(run, …)              → 'message' trigger
//
// All idempotent on (kind, ref) via enqueueAgentTrigger. Call INSIDE the
// transaction that recorded the underlying fact so a rollback leaves no wakeup
// behind. Pure over run(sql, params); never throws for a missing row (returns
// null) so a hook can never break the operational path that fired it.

import type { Run } from "../commands/core.ts";
import { enqueueAgentTrigger, type AgentTrigger, type TriggerKind } from "./triggers.ts";

async function safeEnqueue(run: Run, input: Parameters<typeof enqueueAgentTrigger>[1]): Promise<AgentTrigger | null> {
  try {
    const r = await enqueueAgentTrigger(run, input);
    return r.trigger;
  } catch (err) {
    console.error("[agent-runtime] enqueue failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function onDecisionResolved(run: Run, decisionId: string): Promise<AgentTrigger | null> {
  const [d] = await run<{ id: string; kind: string; action: string; status: string; project_id: string | null; lead_id: string | null; title: string; decided_via: string | null; decision_note: string | null; target_kind: string | null; target_id: string | null }>(
    `SELECT id, kind, action, status, project_id, lead_id, title, decided_via, decision_note, target_kind, target_id FROM decisions WHERE id = $1`,
    [decisionId],
  );
  if (!d) return null;
  if (d.status === "pending") return null;
  return safeEnqueue(run, {
    kind: "approval",
    ref: `decision:${d.id}:${d.status}`,
    projectId: d.project_id,
    leadId: d.lead_id,
    enqueuedBy: "hook:decision",
    payload: {
      decision_id: d.id,
      decision_kind: d.kind,
      action: d.action,
      status: d.status,
      title: d.title,
      target_kind: d.target_kind,
      target_id: d.target_id,
      decided_via: d.decided_via,
      note: d.decision_note ?? undefined,
    },
  });
}

export async function onWorkItemDone(run: Run, workItemId: string): Promise<AgentTrigger | null> {
  const [w] = await run<{ id: string; title: string; status: string; approval_status: string; project_id: string | null; lead_id: string | null; assignee_kind: string; expected_runbook_slug: string | null; blocked_reason: string | null }>(
    `SELECT id, title, status, approval_status, project_id, lead_id, assignee_kind, expected_runbook_slug, blocked_reason FROM work_items WHERE id = $1`,
    [workItemId],
  );
  if (!w || w.status !== "done") return null;
  const kind: TriggerKind = w.approval_status === "approved" ? "approval" : "note";
  return safeEnqueue(run, {
    kind,
    ref: `work_item:${w.id}:done`,
    projectId: w.project_id,
    leadId: w.lead_id,
    enqueuedBy: "hook:work_item",
    payload: { work_item_id: w.id, title: w.title, approval_status: w.approval_status, assignee_kind: w.assignee_kind, runbook_slug: w.expected_runbook_slug, note: w.blocked_reason ?? undefined },
  });
}

/** W02: a verified pre-construction (or other) signature. Only 'signed'
 *  requests wake the agent; declined/void never start preparation. */
export async function onSignatureCompleted(run: Run, requestId: number | string): Promise<AgentTrigger | null> {
  const [s] = await run<{ id: number; project_id: string | null; lead_slug: string | null; doc_type: string; title: string; status: string; signed_at: string | null; signed_name: string | null; lead_id: string | null }>(
    `SELECT s.id, s.project_id, s.lead_slug, s.doc_type, s.title, s.status, s.signed_at::text AS signed_at, s.signed_name, l.id AS lead_id
       FROM signature_requests s LEFT JOIN leads l ON l.slug = s.lead_slug WHERE s.id = $1`,
    [Number(requestId)],
  );
  if (!s || s.status !== "signed") return null;
  return safeEnqueue(run, {
    kind: "signature",
    ref: `signature_request:${s.id}:signed`,
    projectId: s.project_id,
    leadId: s.lead_id,
    enqueuedBy: "hook:signature",
    payload: { signature_request_id: s.id, doc_type: s.doc_type, title: s.title, signed_at: s.signed_at, signed_name: s.signed_name },
  });
}

export async function onInboundMessage(
  run: Run,
  msg: { provider: string; messageId: string; projectId?: string | null; leadId?: string | null; from?: string | null; subject?: string | null; text?: string | null; at?: string | null },
): Promise<AgentTrigger | null> {
  return safeEnqueue(run, {
    kind: "message",
    ref: `${msg.provider}:${msg.messageId}`,
    projectId: msg.projectId ?? null,
    leadId: msg.leadId ?? null,
    enqueuedBy: `hook:${msg.provider}`,
    payload: { messages: [{ from: msg.from ?? "?", channel: msg.provider, subject: msg.subject ?? undefined, text: msg.text ?? "", at: msg.at ?? new Date().toISOString() }] },
  });
}

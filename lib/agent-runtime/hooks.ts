// Event hooks other features call to wake the operating agent (A24).
//
//   onDecisionResolved(run, decisionId)   → 'approval' trigger (approve / reject / revoke)
//   onWorkItemDone(run, workItemId)       → 'approval' trigger when the item was owner-approved,
//                                            else a 'note' trigger (a completed step is a fact)
//   onSignatureCompleted(run, requestId)  → 'signature' trigger (W02)
//   onClientPlanApproved(run, floorplanId) → 'selection' trigger (portal floor-plan sign-off)
//
// Event wake-ups from people outside the company, only while the
// agent.event_wakeups policy is active (and lists the kind; migration 0049):
//   onInboundMessage(run, …)              → 'message' (text, portal, lead email reply)
//   onClientSelection(run, selectionId)   → 'selection' (portal choice / decline)
//   onMoodBoardApproved(run, …)           → 'selection' (portal mood-board approval)
//   onPaymentReceived(run, …)             → 'payment' (Square payment completed)
//   onQuoteRecorded(run, submissionId)    → 'quote' (a bid Joe recorded)
//   onSubReport(run, reportId)            → 'field_report' (a sub's day log)
//
// All idempotent on (kind, ref) via enqueueAgentTrigger. Call INSIDE the
// transaction that recorded the underlying fact so a rollback leaves no wakeup
// behind. Pure over run(sql, params); never throws for a missing row (returns
// null) so a hook can never break the operational path that fired it.

import type { Run } from "../commands/core.ts";
import { activePolicy } from "../commands/policies.ts";
import { enqueueAgentTrigger, type AgentTrigger, type TriggerKind } from "./triggers.ts";

export const EVENT_WAKEUPS_POLICY = "agent.event_wakeups";

/** True when the agent.event_wakeups policy is active and covers `kind`
 *  (a policy without a kinds list covers every kind). */
export async function eventWakeupOn(run: Run, kind: TriggerKind): Promise<boolean> {
  try {
    const p = await activePolicy(run, EVENT_WAKEUPS_POLICY);
    if (!p) return false;
    const kinds = (p.config as { kinds?: unknown }).kinds;
    return Array.isArray(kinds) ? kinds.includes(kind) : true;
  } catch {
    return false;
  }
}

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
  if (!msg.projectId && !msg.leadId) return null; // only from someone on a job or lead
  if (!(await eventWakeupOn(run, "message"))) return null;
  return safeEnqueue(run, {
    kind: "message",
    ref: `${msg.provider}:${msg.messageId}`,
    projectId: msg.projectId ?? null,
    leadId: msg.leadId ?? null,
    enqueuedBy: `hook:${msg.provider}`,
    payload: { messages: [{ from: msg.from ?? "?", channel: msg.provider, subject: msg.subject ?? undefined, text: msg.text ?? "", at: msg.at ?? new Date().toISOString() }] },
  });
}

/** A client approved a floor-plan version from the portal. Wakes the agent to
 *  act on it: cards still waiting on that plan's sign-off move on, and any
 *  brief that called the plan pending is corrected (Mahowald v4, 2026-10-14:
 *  approved Oct 9, a card sat "waiting on client" for five days). */
export async function onClientPlanApproved(run: Run, floorplanId: number): Promise<AgentTrigger | null> {
  const [f] = await run<{ id: number; project_id: string; version: number; client_approved_at: string | null; client_approved_name: string; notes: string }>(
    `SELECT id::int AS id, project_id, version, client_approved_at::text AS client_approved_at, client_approved_name, notes FROM project_floorplans WHERE id = $1`,
    [floorplanId],
  );
  if (!f?.client_approved_at) return null;
  return safeEnqueue(run, {
    kind: "selection",
    ref: `floorplan:${f.id}:approved`,
    projectId: f.project_id,
    enqueuedBy: "hook:floorplan-approved",
    payload: {
      event: "client approved a floor plan in the portal",
      floorplan_id: f.id,
      version: f.version,
      approved_at: f.client_approved_at,
      approved_by: f.client_approved_name,
      notes: f.notes.slice(0, 300),
      task: "Close or advance every open work item on this project that is waiting for this plan's sign-off, and correct any project file or brief that still calls it pending.",
    },
  });
}

/** A client chose an option (or declined them all) in the portal. */
export async function onClientSelection(run: Run, selectionId: number): Promise<AgentTrigger | null> {
  if (!(await eventWakeupOn(run, "selection"))) return null;
  const [sel] = await run<{ id: number; project_id: string; area: string; status: string; choice: string | null; price: number | null; decided_at: string | null }>(
    `SELECT id::int AS id, project_id, area, status, choice, price, decided_at::text AS decided_at FROM project_selections WHERE id = $1`,
    [selectionId],
  );
  if (!sel || !sel.decided_at) return null;
  return safeEnqueue(run, {
    kind: "selection",
    ref: `selection:${sel.id}:${sel.status}:${sel.decided_at}`,
    projectId: sel.project_id,
    enqueuedBy: "hook:portal-selection",
    payload: { event: sel.status === "approved" ? "client chose an option in the portal" : "client declined the options in the portal", selection_id: sel.id, area: sel.area, status: sel.status, choice: sel.choice, price: sel.price },
  });
}

/** A client approved a mood board's direction in the portal. */
export async function onMoodBoardApproved(run: Run, input: { projectId: string; room: string; approvedName: string }): Promise<AgentTrigger | null> {
  if (!(await eventWakeupOn(run, "selection"))) return null;
  return safeEnqueue(run, {
    kind: "selection",
    ref: `mood_board:${input.projectId}:${input.room}:approved`,
    projectId: input.projectId,
    enqueuedBy: "hook:mood-approved",
    payload: { event: "client approved a mood board in the portal", room: input.room, approved_by: input.approvedName, task: "Move on whatever was waiting for this direction (selections, design work, the estimate's allowances); never treat it as a product choice." },
  });
}

/** Money arrived through Square (the attempt just completed). */
export async function onPaymentReceived(run: Run, input: { attemptId: string; invoiceId: number; amountCents: number; method: string }): Promise<AgentTrigger | null> {
  if (!(await eventWakeupOn(run, "payment"))) return null;
  const [inv] = await run<{ project_id: string; number: string; milestone: string | null }>(`SELECT project_id, number, milestone FROM invoices WHERE id = $1`, [input.invoiceId]);
  if (!inv) return null;
  return safeEnqueue(run, {
    kind: "payment",
    ref: `payment_attempt:${input.attemptId}:completed`,
    projectId: inv.project_id,
    enqueuedBy: "hook:payment",
    payload: { event: "client paid online", invoice_id: input.invoiceId, invoice_number: inv.number, milestone: inv.milestone, amount_cents: input.amountCents, method: input.method },
  });
}

/** Joe recorded a sub's bid (the Bidding tab's Record bid). An agent's own
 *  record_bid never wakes another run. */
export async function onQuoteRecorded(run: Run, submissionId: number): Promise<AgentTrigger | null> {
  if (!(await eventWakeupOn(run, "quote"))) return null;
  const [b] = await run<{ id: number; total: number; invite_id: number; sub_name: string; title: string; project_id: string }>(
    `SELECT s.id::int AS id, s.total, s.invite_id::int AS invite_id, sb.name AS sub_name, p.title, p.project_id
       FROM bid_submissions s JOIN bid_invites i ON i.id = s.invite_id JOIN subs sb ON sb.slug = i.sub_slug JOIN bid_packages p ON p.id = i.package_id WHERE s.id = $1`,
    [submissionId],
  );
  if (!b) return null;
  return safeEnqueue(run, {
    kind: "quote",
    ref: `bid_submission:${b.id}`,
    projectId: b.project_id,
    enqueuedBy: "hook:bid-recorded",
    payload: { event: "a sub's bid was recorded", submission_id: b.id, invite_id: b.invite_id, sub: b.sub_name, package: b.title, total_cents: Number(b.total) },
  });
}

/** A sub posted a day log from the sub portal. */
export async function onSubReport(run: Run, reportId: string): Promise<AgentTrigger | null> {
  if (!(await eventWakeupOn(run, "field_report"))) return null;
  const [r] = await run<{ id: string; project_id: string; sub_slug: string | null; kind: string; body: string }>(`SELECT id, project_id, sub_slug, kind, body FROM field_reports WHERE id = $1`, [reportId]);
  if (!r) return null;
  return safeEnqueue(run, {
    kind: "field_report",
    ref: `field_report:${r.id}`,
    projectId: r.project_id,
    enqueuedBy: "hook:sub-report",
    payload: { event: "a sub posted a day log", report_id: r.id, sub: r.sub_slug, kind: r.kind, text: r.body.slice(0, 500) },
  });
}

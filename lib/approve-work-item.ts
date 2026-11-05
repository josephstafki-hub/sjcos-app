// The half of an Approve click that both approve actions share (lib/actions/
// engine.ts approveWorkItem, lib/actions/record-ops.ts approveRecordWorkItem),
// once the caller has flipped approval_status: try to send the staged draft,
// reopen the gate if the send failed, ping the assignee agent when nothing
// went out, advance a runbook step. Returns the ApproveResult the UI toasts —
// it always says whether an email went out.

import "server-only";
import { captureAgentMemory } from "@/lib/agent-memory";
import { withTransaction, runDirect, type Run } from "@/lib/commands/db";
import type { Principal } from "@/lib/commands/principal";
import { INACTIVE_OWNER, lockActiveOwner } from "@/lib/commands/owner-authorization";
import { freezeApprovedDraft, CHANGED_DRAFT, WEB_CHANGED_DRAFT } from "@/lib/approved-draft-snapshot";
import { reopenApprovalAfterFailedSend, sendApprovedClientDraft } from "@/lib/approved-draft-send";
import type { ApproveResult } from "@/lib/approved-draft-rules";
import { notifyAgentOwner } from "@/lib/dev-agents";
import { maybeAdvanceRunbook } from "@/lib/runbook-engine";

interface ApprovalEffects {
  id: string;
  approvedDraftId: string;
  assigneeKey: string | null;
  title: string;
  body: string;
  /** Page context for the agent ping, e.g. "lead kleven" / "project egan". */
  context?: string;
}

/** Pending is safe to start; running is never replayed after a crash. The
 * sender already has permanent intent keys and provider reconciliation, just
 * as on the phone path. A lost completion requires review, not another send. */
export async function finishApproval(opts: ApprovalEffects): Promise<ApproveResult> {
  const [claim] = await runDirect(`UPDATE approved_draft_dispatches SET phase='running',lease_until=now()+interval '2 minutes'
    WHERE approved_draft_id=$1 AND phase='pending' RETURNING approved_draft_id`, [opts.approvedDraftId]);
  if (!claim) {
    const [prior] = await runDirect<{ result: ApproveResult | null }>(`SELECT result FROM approved_draft_dispatches WHERE approved_draft_id=$1`, [opts.approvedDraftId]);
    return prior?.result ?? { ok: false, error: 'Your answer was recorded, but completion needs a check. Open the record before taking another action.' };
  }
  const result = await performApproval(opts);
  await runDirect(`UPDATE approved_draft_dispatches SET phase=$2,result=$3::jsonb,lease_until=NULL
    WHERE approved_draft_id=$1 AND phase='running'`,
    [opts.approvedDraftId, result.ok && result.held ? 'needs_review' : 'done', JSON.stringify(result)]);
  return result;
}

/** Runs in the existing dispatch pass. Claim statements commit before effects;
 * overlapping cron/interactive calls cannot both start the same snapshot. */
export async function sweepApprovedDrafts(limit = 50): Promise<number> {
  const interrupted = await runDirect<{ approved_draft_id: string; work_item_id: string }>(`WITH expired AS (
      SELECT approved_draft_id FROM approved_draft_dispatches WHERE phase='running' AND lease_until<=now() FOR UPDATE SKIP LOCKED
    ) UPDATE approved_draft_dispatches d SET phase='needs_review',lease_until=NULL,
      result=jsonb_build_object('ok',false,'error','Your answer was recorded, but completion needs a check. Open the record before taking another action.',
        'outcome','needs_review','needsReview',true,'evidence',jsonb_build_object('approvedDraftId',a.id,'workItemId',a.work_item_id,
          'sends',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i.id,'state',i.state,'provider_ref',i.provider_ref,'last_error',i.last_error)),'[]'::jsonb)
            FROM action_intents i WHERE i.payload->>'work_item_id'=a.work_item_id::text)))
    FROM expired e,approved_work_item_drafts a WHERE d.approved_draft_id=e.approved_draft_id AND a.id=d.approved_draft_id
    RETURNING d.approved_draft_id,a.work_item_id`);
  for (const item of interrupted) {
    // Same visible uncertainty as the phone's recovered effects checkpoint.
    await runDirect(`UPDATE work_items SET blocked_reason=$2 WHERE id=$1`, [item.work_item_id,
      'Your answer was recorded, but completion needs a check. Open the record before taking another action. Do not resend.']);
  }
  // Keep the warning repairable if a process stops between the phase change
  // and the card update above (no domain effects are repeated).
  await runDirect(`UPDATE work_items w SET blocked_reason=COALESCE(w.blocked_reason,
    'Your answer was recorded, but completion needs a check. Open the record before taking another action. Do not resend.')
    FROM approved_work_item_drafts a JOIN approved_draft_dispatches d ON d.approved_draft_id=a.id
    WHERE w.id=a.work_item_id AND d.phase='needs_review' AND w.approval_status='approved'`);
  const pending = await runDirect<{ id: string; work_item_id: string; snapshot: { title: string; body: string; assignee_key?: string | null } }>(
    `SELECT a.id,a.work_item_id,a.snapshot FROM approved_draft_dispatches d JOIN approved_work_item_drafts a ON a.id=d.approved_draft_id
     WHERE d.phase='pending' ORDER BY a.created_at LIMIT $1`, [limit]);
  for (const a of pending) {
    // Never infer source content from a mutable work item. All outbound data
    // and the approval gate were frozen together.
    await finishApproval({ id: a.work_item_id, approvedDraftId: a.id, assigneeKey: a.snapshot.assignee_key ?? null,
      title: a.snapshot.title, body: a.snapshot.body }).catch(error => {
      console.error('[approved-draft] interrupted dispatch:', (error as Error).message);
    });
  }
  return pending.length + interrupted.length;
}

async function performApproval(opts: ApprovalEffects): Promise<ApproveResult> {
  const send = await sendApprovedClientDraft(opts.id, opts.approvedDraftId);
  if (send.outcome === "failed") {
    await reopenApprovalAfterFailedSend(opts.id, send.error);
    return { ok: false, error: `Approved, but the email did not send: ${send.error}` };
  }
  if (send.outcome === "not_email") {
    // Nothing went out — the assignee agent completes the item as before, and
    // is told in the same breath that the app did not email anything.
    await notifyAgentOwner(opts.id, opts.assigneeKey, opts.title, opts.body, opts.context, send.notice);
  }
  if (send.outcome === "held") {
    // The provider could not confirm. The gate stays approved (a second
    // Approve is refused by claimApproval, never a second send); the agent is told
    // NOT to resend; the reconciliation sweep settles it.
    await notifyAgentOwner(opts.id, opts.assigneeKey, opts.title, opts.body, opts.context, `${send.notice} Do not send it again.`);
    await maybeAdvanceRunbook(opts.id);
    return { ok: true, held: { to: send.to, subject: send.subject }, notice: send.notice };
  }
  await maybeAdvanceRunbook(opts.id); // W6: a done-but-unapproved step advances on approval
  if (send.outcome === "posted") return { ok: true, posted: { to: send.to } };
  return send.outcome === "sent"
    ? { ok: true, sent: { to: send.to, subject: send.subject } }
    : { ok: true, notice: send.notice };
}

/** "Still waiting on Joe's approval", as SQL over work_items — the same test
 *  the board uses to show Approve (lib/engine-constants.ts bucketFor):
 *  approval_status = 'requested', or parked at approval_needed. A rejected
 *  draft never counts, whatever its status says: only a fresh
 *  submit_draft_for_approval (which sets 'requested') can re-open it. */
export const AWAITING_APPROVAL_SQL = `(approval_status = 'requested' OR (status = 'approval_needed' AND approval_status <> 'rejected'))`;

/** Why an Approve tap found nothing to approve. Nothing was sent. */
export function staleApprovalError(state: { approval_status: string; status: string } | null): string {
  if (!state) return "Work item not found.";
  if (state.approval_status === "rejected") return "Already rejected — nothing was sent.";
  if (state.approval_status === "approved") return "Already approved — nothing more was sent.";
  if (state.status === "cancelled") return "This was cancelled — nothing was sent.";
  return "This isn't waiting for approval any more — nothing was sent.";
}

export interface ClaimedApproval {
  approvedDraftId: string;
  title: string;
  body: string;
  assignee_key: string | null;
  lead_slug: string | null;
  project_slug: string | null;
}

/** Flip the approval gate — only on an item still awaiting approval, and the
 *  gate and frozen send evidence share a locked transaction. An old button tapped after Joe
 *  rejected (or already approved) the draft changes nothing, and of two taps
 *  racing, Postgres lets exactly one through (the loser re-reads the winner's
 *  row and no longer matches). The caller sends only on `ok: true`. */
export async function claimApproval(id: string, expectedBinding?: string | null): Promise<({ ok: true } & ClaimedApproval) | { ok: false; error: string }> {
  const result = await withTransaction(run => claimApprovalInTransaction(run, id, expectedBinding));
  // Web and native Today refresh their preview; push/Telegram retain card copy.
  return !result.ok && result.error === CHANGED_DRAFT ? { ok: false, error: WEB_CHANGED_DRAFT } : result;
}

/** Shared by web Approve and the phone/Telegram resolver. */
export async function claimApprovalInTransaction(run: Run, id: string, expectedBinding?: string | null): Promise<({ ok: true } & ClaimedApproval) | { ok: false; error: string }> {
  const [state] = await run<{ approval_status: string; status: string; waiting: boolean }>(
    `SELECT approval_status,status,${AWAITING_APPROVAL_SQL} AS waiting FROM work_items WHERE id=$1 FOR UPDATE`, [id],
  );
  if (!state?.waiting) return { ok: false, error: staleApprovalError(state ?? null) };
  const approvedDraftId = await freezeApprovedDraft(run, id, expectedBinding);
  if (!approvedDraftId) return { ok: false, error: CHANGED_DRAFT };
  const [item] = await run<Omit<ClaimedApproval, "approvedDraftId">>(
    `UPDATE work_items w SET approval_status='approved',
       status=CASE WHEN status='approval_needed' THEN 'queued' ELSE status END
     WHERE id=$1 RETURNING title,body,assignee_key,
       (SELECT slug FROM leads WHERE id=w.lead_id) AS lead_slug,
       (SELECT slug FROM projects WHERE id=w.project_id) AS project_slug`, [id],
  );
  return { ok: true, ...item, approvedDraftId };
}

/** Why a Decline tap changed nothing: the draft already went out, or the item
 *  is already settled. A stale button must never relabel a sent email as
 *  cancelled. */
export function staleDeclineError(state: { approval_status: string; status: string } | null): string {
  if (!state) return "Work item not found.";
  if (state.approval_status === "approved") return "Already approved and sent — Decline can't take it back.";
  if (state.approval_status === "rejected") return "Already declined.";
  if (state.status === "done") return "Already done — nothing to decline.";
  return "Already cancelled.";
}

/** Flip an item to rejected/cancelled — only while it is still open and not
 *  already approved; the check is the UPDATE itself (see claimApproval). */
export async function claimRejection(id: string, owner?: Principal): Promise<({ ok: true } & { title: string; body: string; assignee_key: string | null }) | { ok: false; error: string }> {
  // Legacy Telegram cards have no mapped phone card, but still need the same
  // atomic owner check as bound cards. Web callers authorize by their area.
  if (owner) return withTransaction(async run => {
    await run(`SELECT id FROM work_items WHERE id=$1 FOR UPDATE`, [id]);
    if (!await lockActiveOwner(run, owner)) return { ok: false, error: INACTIVE_OWNER };
    return claimRejectionWithRun(run, id);
  });
  return claimRejectionWithRun(runDirect, id);
}

async function claimRejectionWithRun(run: Run, id: string): ReturnType<typeof claimRejection> {
  const rows = await run<{ title: string; body: string; assignee_key: string | null }>(
    `UPDATE work_items SET approval_status = 'rejected', status = 'cancelled'
      WHERE id = $1 AND approval_status NOT IN ('approved','rejected') AND status NOT IN ('done','cancelled')
     RETURNING title, body, assignee_key`,
    [id],
  );
  if (rows[0]) return { ok: true, ...rows[0] };
  const now = await run<{ approval_status: string; status: string }>(`SELECT approval_status, status FROM work_items WHERE id = $1`, [id]);
  return { ok: false, error: staleDeclineError(now[0] ?? null) };
}

/** Approve a work item awaiting human approval, session-free — the /engine and
 *  Today buttons, the corner popup and the Telegram button all land here (the
 *  caller has already checked who is asking). Clears the gate, moves the item
 *  to queued, and sends the staged client draft when there is one. A tap on
 *  an item no longer awaiting approval is refused and sends nothing. The
 *  expected binding must come from the displayed preview; absent evidence
 *  fails closed, including calls from pages opened before bindings existed. */
export async function approveWorkItemById(id: string, expectedBinding?: string | null): Promise<ApproveResult> {
  const claim = await claimApproval(id, expectedBinding);
  if (!claim.ok) return claim;
  const { title, body, assignee_key, lead_slug, project_slug } = claim;
  const context = project_slug ? `project ${project_slug}` : lead_slug ? `lead ${lead_slug}` : undefined;
  return finishApproval({ id, approvedDraftId: claim.approvedDraftId, assigneeKey: assignee_key, title, body, context });
}

/** Decline (reject) a work item, session-free. Same effects as the /engine
 *  button: cancels it, records the rejection for the learning layer, and
 *  cancels a runbook step. */
export async function rejectWorkItemById(id: string, via = "/engine", owner?: Principal): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  const claim = await claimRejection(id, owner);
  if (!claim.ok) return claim;
  const rows = [claim];
  // W5 learning layer: a rejection is a signal about what NOT to propose.
  await captureAgentMemory({
    summary: `Rejected: ${rows[0].title}`,
    content: [
      `Work item "${rows[0].title}" was rejected by Joe on ${via}.`,
      rows[0].body ? `What was proposed:\n${rows[0].body.slice(0, 1000)}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    memoryType: "observation",
    runtimeName: rows[0].assignee_key ?? undefined,
    refs: [{ kind: "work_item", id, label: rows[0].title }],
  });
  await maybeAdvanceRunbook(id); // W6: rejecting a runbook step cancels its instance
  return { ok: true, title: rows[0].title };
}

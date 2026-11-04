// The half of an Approve click that both approve actions share (lib/actions/
// engine.ts approveWorkItem, lib/actions/record-ops.ts approveRecordWorkItem),
// once the caller has flipped approval_status: try to send the staged draft,
// reopen the gate if the send failed, ping the assignee agent when nothing
// went out, advance a runbook step. Returns the ApproveResult the UI toasts —
// it always says whether an email went out.

import "server-only";
import { captureAgentMemory } from "@/lib/agent-memory";
import { query } from "@/lib/db";
import { reopenApprovalAfterFailedSend, sendApprovedClientDraft } from "@/lib/approved-draft-send";
import type { ApproveResult } from "@/lib/approved-draft-rules";
import { notifyAgentOwner } from "@/lib/dev-agents";
import { maybeAdvanceRunbook } from "@/lib/runbook-engine";

export async function finishApproval(opts: {
  id: string;
  assigneeKey: string | null;
  title: string;
  body: string;
  /** Page context for the agent ping, e.g. "lead kleven" / "project egan". */
  context?: string;
}): Promise<ApproveResult> {
  const send = await sendApprovedClientDraft(opts.id);
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
  title: string;
  body: string;
  assignee_key: string | null;
  lead_slug: string | null;
  project_slug: string | null;
}

/** Flip the approval gate — only on an item still awaiting approval, and the
 *  check is the UPDATE itself. An old Telegram or app button tapped after Joe
 *  rejected (or already approved) the draft changes nothing, and of two taps
 *  racing, Postgres lets exactly one through (the loser re-reads the winner's
 *  row and no longer matches). The caller sends only on `ok: true`. */
export async function claimApproval(id: string): Promise<({ ok: true } & ClaimedApproval) | { ok: false; error: string }> {
  const { rows } = await query<ClaimedApproval>(
    `UPDATE work_items w
        SET approval_status = 'approved',
            status = CASE WHEN status = 'approval_needed' THEN 'queued' ELSE status END
      WHERE id = $1 AND ${AWAITING_APPROVAL_SQL}
      RETURNING title, body, assignee_key,
        (SELECT slug FROM leads WHERE id = w.lead_id) AS lead_slug,
        (SELECT slug FROM projects WHERE id = w.project_id) AS project_slug`,
    [id],
  );
  if (rows[0]) return { ok: true, ...rows[0] };
  const { rows: now } = await query<{ approval_status: string; status: string }>(
    `SELECT approval_status, status FROM work_items WHERE id = $1`,
    [id],
  );
  return { ok: false, error: staleApprovalError(now[0] ?? null) };
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
export async function claimRejection(id: string): Promise<({ ok: true } & { title: string; body: string; assignee_key: string | null }) | { ok: false; error: string }> {
  const { rows } = await query<{ title: string; body: string; assignee_key: string | null }>(
    `UPDATE work_items SET approval_status = 'rejected', status = 'cancelled'
      WHERE id = $1 AND approval_status NOT IN ('approved','rejected') AND status NOT IN ('done','cancelled')
     RETURNING title, body, assignee_key`,
    [id],
  );
  if (rows[0]) return { ok: true, ...rows[0] };
  const { rows: now } = await query<{ approval_status: string; status: string }>(`SELECT approval_status, status FROM work_items WHERE id = $1`, [id]);
  return { ok: false, error: staleDeclineError(now[0] ?? null) };
}

/** Approve a work item awaiting human approval, session-free — the /engine and
 *  Today buttons, the corner popup and the Telegram button all land here (the
 *  caller has already checked who is asking). Clears the gate, moves the item
 *  to queued, and sends the staged client draft when there is one. A tap on
 *  an item no longer awaiting approval is refused and sends nothing. */
export async function approveWorkItemById(id: string): Promise<ApproveResult> {
  const claim = await claimApproval(id);
  if (!claim.ok) return claim;
  const { title, body, assignee_key, lead_slug, project_slug } = claim;
  const context = project_slug ? `project ${project_slug}` : lead_slug ? `lead ${lead_slug}` : undefined;
  return finishApproval({ id, assigneeKey: assignee_key, title, body, context });
}

/** Decline (reject) a work item, session-free. Same effects as the /engine
 *  button: cancels it, records the rejection for the learning layer, and
 *  cancels a runbook step. */
export async function rejectWorkItemById(id: string, via = "/engine"): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  const claim = await claimRejection(id);
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

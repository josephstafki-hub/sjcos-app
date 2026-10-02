// The half of an Approve click that both approve actions share (lib/actions/
// engine.ts approveWorkItem, lib/actions/record-ops.ts approveRecordWorkItem),
// once the caller has flipped approval_status: try to send the staged draft,
// reopen the gate if the send failed, ping the assignee agent when nothing
// went out, advance a runbook step. Returns the ApproveResult the UI toasts —
// it always says whether an email went out.

import "server-only";
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
    // Approve finds the same intent, never a second send); the agent is told
    // NOT to resend; the reconciliation sweep settles it.
    await notifyAgentOwner(opts.id, opts.assigneeKey, opts.title, opts.body, opts.context, `${send.notice} Do not send it again.`);
    await maybeAdvanceRunbook(opts.id);
    return { ok: true, held: { to: send.to, subject: send.subject }, notice: send.notice };
  }
  await maybeAdvanceRunbook(opts.id); // W6: a done-but-unapproved step advances on approval
  return send.outcome === "sent"
    ? { ok: true, sent: { to: send.to, subject: send.subject } }
    : { ok: true, notice: send.notice };
}

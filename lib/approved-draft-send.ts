// When Joe approves a work item whose staged draft is an email addressed to
// the item's lead (or, failing that, its project's client), the approval
// click IS the send authorization — the app sends right then, exactly like
// the Send button on the lead-page first-response card. Anything that doesn't
// parse as an email to that record is left alone, the assignee agent is
// pinged as before, and the owner is TOLD nothing went out (toast + the
// notice on the card) — this has bitten us twice: a draft with no To: header
// (Kleven, 2026-09-22) read as plain "Approved", and the next day an agent
// re-sent an email Approve had already sent because nothing said so.
//
// The pure parts (header parser, send/skip decision, owner copy) live in
// lib/approved-draft-rules.ts so they can be unit-tested without a DB.

import "server-only";
import { query } from "@/lib/db";
import { gmailConfigured, sendNewEmail } from "@/lib/gmail";
import { logLeadActivity } from "@/lib/lead-activity";
import { sqlAbsoluteLabel } from "@/lib/time";
import { approveNotice, planApprovedSend, type RecordKind } from "@/lib/approved-draft-rules";

export type ApprovedDraftSend =
  | { outcome: "sent"; to: string; subject: string }
  | { outcome: "not_email"; reason: string; notice: string }
  | { outcome: "failed"; error: string };

interface ItemRow {
  lead_id: string | null;
  lead_slug: string | null;
  lead_email: string | null;
  project_id: string | null;
  project_slug: string | null;
  project_email: string | null;
  content: string | null;
  knowledge_uri: string | null;
  draft_at: string | null;
}

interface Target {
  kind: RecordKind;
  id: string;
  slug: string;
  email: string | null;
}

/** "Nothing was emailed" — remember why on the card (blocked_reason survives
 *  a refresh) whenever there was a draft that could plausibly have been an
 *  email. A plain approval with no draft at all gets the toast only. */
async function skipped(workItemId: string, reason: string, hadDraft: boolean): Promise<ApprovedDraftSend> {
  const notice = approveNotice(reason);
  if (hadDraft) {
    await query(`UPDATE work_items SET blocked_reason = $2, updated_at = now() WHERE id = $1`, [
      workItemId,
      notice.slice(0, 300),
    ]);
  }
  return { outcome: "not_email", reason, notice };
}

/** Double-send guard: anything that already emailed this client after the
 *  draft was staged — Joe replying by hand, an agent's send_email with
 *  work_item_id (its 'email' receipt), an earlier Approve — means leave it
 *  alone. Returns a one-line description of that prior send, or null. */
async function priorSendSince(target: Target, workItemId: string, draftAt: string): Promise<string | null> {
  const receipt = await query<{ at: string; label: string }>(
    `SELECT ${sqlAbsoluteLabel("created_at")} AS at, label FROM agent_receipts
      WHERE work_item_id = $1 AND receipt_kind = 'email' AND created_at > $2::timestamptz
      ORDER BY created_at DESC LIMIT 1`,
    [workItemId, draftAt],
  );
  if (receipt.rows[0]) return `${receipt.rows[0].at}: ${receipt.rows[0].label || "email receipt on this item"}`;

  const activity =
    target.kind === "lead"
      ? await query<{ at: string; summary: string }>(
          `SELECT ${sqlAbsoluteLabel("created_at")} AS at, summary FROM lead_activity
            WHERE lead_id = $1 AND kind = 'email' AND created_at > $2::timestamptz
            ORDER BY created_at DESC LIMIT 1`,
          [target.id, draftAt],
        )
      : await query<{ at: string; summary: string }>(
          `SELECT ${sqlAbsoluteLabel("created_at")} AS at, summary FROM client_activity
            WHERE project_id = $1 AND kind = 'message' AND entity_kind = 'email'
              AND created_at > $2::timestamptz
            ORDER BY created_at DESC LIMIT 1`,
          [target.id, draftAt],
        );
  const a = activity.rows[0];
  return a ? `${a.at}: ${a.summary}` : null;
}

/** Log the send where the record's own timeline lives: lead_activity for a
 *  lead (via logLeadActivity, so "Needs reply" clears and last_contact_at
 *  bumps like any real contact), client_activity for a project (there is no
 *  project-side email log; kind 'message' + entity_kind 'email' is what the
 *  guard above reads back). */
async function logSend(target: Target, workItemId: string, subject: string): Promise<void> {
  const summary = `Approved reply sent — ${subject}`.slice(0, 200);
  if (target.kind === "lead") {
    await logLeadActivity(target.slug, "email", summary);
    return;
  }
  await query(
    `INSERT INTO client_activity (project_id, kind, summary, detail, entity_kind, entity_id, actor_name, href)
     VALUES ($1, 'message', $2, $3, 'email', $4, 'Joe', $5)`,
    [target.id, summary, `Emailed ${target.email}`, workItemId, `/projects/${target.slug}?tab=Client%20portal`],
  );
}

/** Try to send the freshest staged draft on an approved work item. Only fires
 *  when the draft is an email whose To: matches the lead on the item, or —
 *  for project-linked items — the project's client email (projects.client_email,
 *  falling back to the linked lead's email, same as the project page shows). */
export async function sendApprovedClientDraft(workItemId: string): Promise<ApprovedDraftSend> {
  const { rows } = await query<ItemRow>(
    `SELECT w.lead_id, l.slug AS lead_slug, l.email AS lead_email,
            w.project_id, p.slug AS project_slug,
            NULLIF(COALESCE(NULLIF(p.client_email, ''), pl.email), '') AS project_email,
            k.content, r.uri AS knowledge_uri, k.created_at AS draft_at
       FROM work_items w
       LEFT JOIN leads l ON l.id = w.lead_id
       LEFT JOIN projects p ON p.id = w.project_id
       LEFT JOIN leads pl ON pl.id = p.lead_id
       LEFT JOIN LATERAL (
         SELECT uri FROM agent_receipts
          WHERE work_item_id = w.id AND receipt_kind = 'draft' AND uri LIKE 'knowledge_items/%'
          ORDER BY created_at DESC LIMIT 1
       ) r ON true
       LEFT JOIN knowledge_items k ON 'knowledge_items/' || k.id::text = r.uri
      WHERE w.id = $1`,
    [workItemId],
  );
  const row = rows[0];
  if (!row) return { outcome: "failed", error: "work item not found" };

  const target: Target | null =
    row.lead_id && row.lead_slug
      ? { kind: "lead", id: row.lead_id, slug: row.lead_slug, email: row.lead_email }
      : row.project_id && row.project_slug
        ? { kind: "project", id: row.project_id, slug: row.project_slug, email: row.project_email }
        : null;

  const plan = planApprovedSend({
    record: target ? { kind: target.kind, email: target.email } : null,
    draft: row.content,
  });
  if (plan.outcome === "not_email") return skipped(workItemId, plan.reason, row.content != null);
  if (plan.outcome === "failed") return plan;

  // Don't double-send: if any email already went to this client after the
  // draft was staged (Joe replied by hand, an agent sent), leave it alone.
  const prior = await priorSendSince(target!, workItemId, row.draft_at ?? new Date(0).toISOString());
  if (prior) {
    return skipped(workItemId, `an email already went out after this draft was staged (${prior})`, true);
  }
  if (!gmailConfigured()) return { outcome: "failed", error: "Gmail is not connected" };

  try {
    await sendNewEmail({ to: plan.to, subject: plan.subject, bodyText: plan.body });
  } catch (err) {
    return { outcome: "failed", error: (err as Error).message || "send failed" };
  }

  await logSend(target!, workItemId, plan.subject);
  await query(
    `INSERT INTO agent_receipts (work_item_id, receipt_kind, uri, label) VALUES ($1, 'email', $2, $3)`,
    [workItemId, row.knowledge_uri, `Approved draft emailed to ${plan.to}`.slice(0, 300)],
  );
  await query(
    `UPDATE work_items
        SET status = 'done', completed_at = now(), blocked_reason = NULL, updated_at = now()
      WHERE id = $1`,
    [workItemId],
  );
  return { outcome: "sent", to: plan.to, subject: plan.subject };
}

/** A send failure after approval: reopen the gate (Approve stays clickable for
 *  a retry) and surface the failure on the card. */
export async function reopenApprovalAfterFailedSend(workItemId: string, error: string): Promise<void> {
  await query(
    `UPDATE work_items
        SET approval_status = 'requested', status = 'approval_needed',
            blocked_reason = $2, updated_at = now()
      WHERE id = $1`,
    [workItemId, `Approved, but the send failed: ${error}`.slice(0, 300)],
  );
}

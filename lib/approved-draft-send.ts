// When Joe approves a work item whose staged draft is an email addressed to
// the item's lead, the approval click IS the send authorization — the app
// sends right then, exactly like the Send button on the lead-page first-
// response card. Anything that doesn't parse as an email to that lead is
// left alone and the assignee agent is pinged as before. This closes the
// gap where a runbook's "draft the reply" step got approved and everyone
// assumed the email went out, but no code path ever sent it.

import "server-only";
import { query } from "@/lib/db";
import { gmailConfigured, sendNewEmail } from "@/lib/gmail";

export type ApprovedDraftSend =
  | { outcome: "sent"; to: string; subject: string }
  | { outcome: "not_email"; reason: string }
  | { outcome: "failed"; error: string };

/** Parse the "To:/Subject:" header block agents put at the top of email
 *  drafts. Returns null when the draft isn't shaped like an email. */
function parseEmailDraft(content: string): { to: string; subject: string; body: string } | null {
  const lines = content.split(/\r?\n/);
  let to: string | null = null;
  let subject = "";
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      break;
    }
    const m = line.match(/^(To|Subject|From|Cc):\s*(.*)$/i);
    if (!m) break;
    const key = m[1].toLowerCase();
    if (key === "to") {
      const angled = m[2].match(/<([^>]+)>/);
      to = (angled ? angled[1] : m[2]).trim().toLowerCase();
    } else if (key === "subject") {
      subject = m[2].trim();
    }
  }
  if (!to) return null;
  const body = lines.slice(i).join("\n").trim();
  if (!body) return null;
  return { to, subject, body };
}

/** Try to send the freshest staged draft on an approved work item. Only fires
 *  when the draft is an email whose To: matches the lead on the item. */
export async function sendApprovedClientDraft(workItemId: string): Promise<ApprovedDraftSend> {
  const { rows } = await query<{
    lead_id: string | null;
    email: string | null;
    content: string | null;
    knowledge_uri: string | null;
    draft_at: string | null;
  }>(
    `SELECT w.lead_id, l.email, k.content, r.uri AS knowledge_uri, k.created_at AS draft_at
       FROM work_items w
       LEFT JOIN leads l ON l.id = w.lead_id
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
  if (!row?.lead_id) return { outcome: "not_email", reason: "no lead on the work item" };
  if (!row.content) return { outcome: "not_email", reason: "no staged draft on the work item" };
  const parsed = parseEmailDraft(row.content);
  if (!parsed) return { outcome: "not_email", reason: "staged draft has no To: header" };

  const leadEmail = (row.email ?? "").trim().toLowerCase();
  if (!leadEmail || parsed.to !== leadEmail) {
    return {
      outcome: "failed",
      error: `draft is addressed to ${parsed.to}, but the lead's email is ${leadEmail || "missing"}`,
    };
  }
  // Don't double-send: if any email already went to this lead after the draft
  // was staged (Joe replied by hand, another agent sent), leave it alone.
  const emailed = await query(
    `SELECT 1 FROM lead_activity
      WHERE lead_id = $1 AND kind = 'email' AND created_at > $2::timestamptz LIMIT 1`,
    [row.lead_id, row.draft_at],
  );
  if ((emailed.rowCount ?? 0) > 0) {
    return { outcome: "not_email", reason: "an email already went out after this draft was staged" };
  }
  if (!gmailConfigured()) return { outcome: "failed", error: "Gmail is not connected" };

  const subject = parsed.subject || "Re: your project inquiry — SJ Carpentry";
  try {
    await sendNewEmail({ to: leadEmail, subject, bodyText: parsed.body });
  } catch (err) {
    return { outcome: "failed", error: (err as Error).message || "send failed" };
  }

  await query(`INSERT INTO lead_activity (lead_id, kind, summary, actor) VALUES ($1, 'email', $2, 'Joe')`, [
    row.lead_id,
    `Approved reply sent — ${subject}`.slice(0, 300),
  ]);
  await query(
    `INSERT INTO agent_receipts (work_item_id, receipt_kind, uri, label) VALUES ($1, 'email', $2, $3)`,
    [workItemId, row.knowledge_uri, `Approved draft emailed to ${leadEmail}`.slice(0, 300)],
  );
  await query(`UPDATE work_items SET status = 'done', completed_at = now(), updated_at = now() WHERE id = $1`, [
    workItemId,
  ]);
  return { outcome: "sent", to: leadEmail, subject };
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

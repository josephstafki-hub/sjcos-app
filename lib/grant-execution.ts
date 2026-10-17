import "server-only";

// Send-on-approval (2026-10-17). A permission request that carries the exact
// send (scope.staged — see lib/owner-grant-types.ts) is performed by the app
// the moment Joe approves it: Telegram button, corner popup, /engine/
// permissions, /engine/decisions. Before this, approving only minted a grant
// and the send waited for the agent to come back — Joe tapped Approve on
// "email Scott at ABC" and nothing happened until he went back to the chat.
//
// The send goes through performGrantedAction, the same path an agent's
// send_* tool takes (validation, dispatcher, spend-at-dispatch, audit), so
// the grant's single use is what stops a later agent call from sending it
// twice. The claim below makes concurrent approvals (two taps, two surfaces)
// run it once.

import { query, queryOne } from "@/lib/db";
import { performGrantedAction } from "@/lib/agent-sends";
import { emit } from "@/lib/notify";
import { stagedSendOf, type StagedResult } from "@/lib/owner-grant-types";

export interface StagedRunOutcome {
  /** False when the grant carries no staged send (or it already ran). */
  ran: boolean;
  ok?: boolean;
  /** One plain line for the reply / Telegram card / toast. */
  line?: string;
}

async function setResult(grantId: string, result: StagedResult): Promise<void> {
  await query(
    `UPDATE owner_grants SET scope = jsonb_set(scope, '{staged_result}', $2::jsonb), updated_at = now() WHERE id = $1`,
    [grantId, JSON.stringify(result)],
  );
}

/** Perform the staged send of an approved grant, once. Never throws. */
export async function runStagedGrant(grantId: string | null | undefined): Promise<StagedRunOutcome> {
  if (!grantId) return { ran: false };
  try {
    // Claim: only an approved grant with a staged send and no result yet.
    const claimed = await queryOne<{ id: string; scope: Record<string, unknown>; requested_by: string }>(
      `UPDATE owner_grants
          SET scope = jsonb_set(scope, '{staged_result}', $2::jsonb), updated_at = now()
        WHERE id = $1 AND status = 'approved' AND scope ? 'staged' AND NOT (scope ? 'staged_result')
        RETURNING id, scope, requested_by`,
      [grantId, JSON.stringify({ state: "running", at: new Date().toISOString() } satisfies StagedResult)],
    );
    if (!claimed) return { ran: false };
    const staged = stagedSendOf({ scope: claimed.scope });
    if (!staged) return { ran: false };

    const r = await performGrantedAction({
      action: staged.action,
      grantId,
      target: staged.target_id ?? null,
      email: staged.email
        ? { to: staged.email.to, subject: staged.email.subject, body: staged.email.body, attachment_file_ids: staged.email.attachment_file_ids }
        : undefined,
      sms: staged.sms,
      override: staged.override,
      agent: `${claimed.requested_by} (approved)`.slice(0, 40),
    });
    const at = new Date().toISOString();
    const held = !r.ok && Boolean((r as { held?: unknown }).held);

    if (r.ok) {
      await setResult(grantId, { state: "sent", at, summary: r.summary });
      if (staged.email?.work_item_id) {
        // Same receipt the MCP send_email tool files, so the item shows it
        // went out and an agent's later send_email for it is refused.
        await query(`INSERT INTO agent_receipts (work_item_id, receipt_kind, label) VALUES ($1, 'email', $2)`, [
          staged.email.work_item_id,
          `Emailed ${staged.email.to} on Joe's approval — ${staged.email.subject}`.slice(0, 300),
        ]).catch(() => undefined);
      }
    } else {
      await setResult(grantId, { state: held ? "held" : "failed", at, error: r.error });
    }

    const what = staged.email ? `Email to ${staged.email.to}${staged.email.subject ? ` ("${staged.email.subject}")` : ""}` : staged.sms ? `Text to ${staged.sms.to}` : `${staged.action} ${staged.target_id ?? ""}`.trim();
    const line = r.ok
      ? `Sent ✓ ${what}.`
      : held
        ? `${what}: the provider didn't confirm it went out. It's held for a check against Sent mail — don't resend.`
        : `${what} was NOT sent: ${r.error}`;
    await emit({
      kind: "job",
      tag: r.ok ? "Sent" : "Send failed",
      accent: r.ok ? "money" : "flag",
      icon: staged.email ? "mail" : "chat",
      flagged: !r.ok,
      title: r.ok ? `Sent on your approval · ${what}` : `Not sent · ${what}`,
      subline: (r.ok ? (staged.email ? "Went out from the business Gmail." : "Accepted by the provider.") : r.error).slice(0, 200),
      href: "/engine/permissions",
      ref: `grant:${grantId}`,
    });
    return { ran: true, ok: r.ok, line };
  } catch (err) {
    console.error(`[grant-execution] staged send for grant ${grantId} failed:`, (err as Error).message);
    await setResult(grantId, { state: "failed", at: new Date().toISOString(), error: (err as Error).message }).catch(() => undefined);
    return { ran: true, ok: false, line: `Approved, but the send failed: ${(err as Error).message}` };
  }
}

/** Safety net for the dispatch pass: an approved request whose staged send
 *  never started (the process died between the approval commit and the
 *  send). Approvals older than a day are left alone: that send is stale, and
 *  a person should look first. A claim stuck at "running" is NOT retried;
 *  its outcome is unknown. */
export async function sweepStagedGrants(limit = 5): Promise<number> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM owner_grants
      WHERE status = 'approved' AND scope ? 'staged' AND NOT (scope ? 'staged_result')
        AND decided_at > now() - interval '1 day' AND decided_at < now() - interval '1 minute'
        AND expires_at > now()
      ORDER BY decided_at LIMIT $1`,
    [limit],
  );
  let n = 0;
  for (const r of rows) if ((await runStagedGrant(r.id)).ran) n++;
  return n;
}

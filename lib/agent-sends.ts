// Agent-side sends — the ONLY way an agent reaches a real inbox.
//
// performGrantedAction() is what the internal owner-grants route calls for
// every MCP send tool (mcp/grants-tools.mjs). It spends an owner grant for the
// exact action + target FIRST (lib/owner-grants.ts → consumeGrant), then runs
// the same send core the owner's own button would, and writes the outcome
// back onto the grant's audit trail + agent_runs. No grant, no send — and the
// grant decides, not the agent's say-so.

import { query, queryOne } from "@/lib/db";
import { sendBidPackageOp } from "@/lib/bidding";
import { sendInvoiceOp, sendPurchaseOrderOp } from "@/lib/send-ops";
import { releaseOutboxItem } from "@/lib/newsletter-outbox";
import { submitDocDraftForSignature } from "@/lib/doc-drafts";
import { gmailConfigured, sendNewEmail } from "@/lib/gmail";
import {
  ACTION_TARGET_KIND,
  consumeGrant,
  isGatedAction,
  recordGrantResult,
  refundGrantUse,
  type GatedAction,
} from "@/lib/owner-grants";

export interface AgentSendInput {
  action: string;
  grantId: string;
  /** Row id for record-backed actions; recipient address for send_email. */
  target?: string | number | null;
  /** send_email only. */
  email?: { to: string; subject: string; body: string };
  /** send_document_for_signature only: proceed past the "fields missing" gate. */
  override?: boolean;
  /** Who is acting (for the audit line). */
  agent?: string;
}

export type AgentSendResult = { ok: true; summary: string; [k: string]: unknown } | { ok: false; error: string };

async function ownerUser(): Promise<{ id: string | null; name: string }> {
  const u = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM users WHERE role = 'owner' AND active = true ORDER BY created_at LIMIT 1`,
  );
  return { id: u?.id ?? null, name: u?.name || "Owner" };
}

async function audit(agent: string, action: string, target: string, result: AgentSendResult): Promise<void> {
  try {
    await query(
      `INSERT INTO agent_runs (runtime_name, status, input_summary, output_summary, finished_at)
       VALUES ($1, $2, $3, $4, now())`,
      [
        `mcp:${agent}`.slice(0, 80),
        result.ok ? "succeeded" : "failed",
        `${action} ${target}`.slice(0, 200),
        (result.ok ? result.summary : result.error).slice(0, 500),
      ],
    );
  } catch {
    /* best-effort */
  }
}

/** Release every queued/failed outbox row for one issue. */
async function releaseIssue(issueId: number): Promise<AgentSendResult> {
  const issue = await queryOne<{ id: number; subject: string; status: string }>(
    `SELECT id, title AS subject, status FROM newsletters WHERE id = $1`,
    [issueId],
  );
  if (!issue) return { ok: false, error: `Newsletter issue ${issueId} not found.` };
  const pending = await query<{ id: number }>(
    `SELECT id FROM newsletter_outbox WHERE newsletter_id = $1 AND status IN ('queued','failed') ORDER BY queued_at`,
    [issueId],
  );
  if (!pending.rows.length) {
    return { ok: false, error: `Issue "${issue.subject}" has no queued outbox rows — queue it first (queue_newsletter_issue).` };
  }
  let released = 0;
  let failed = 0;
  for (const row of pending.rows) {
    const r = await releaseOutboxItem(row.id);
    if (r.ok) released++;
    else failed++;
  }
  return {
    ok: true,
    summary: `Released "${issue.subject}": ${released} sent${failed ? `, ${failed} failed (left as failed to retry)` : ""}.`,
    released,
    failed,
  };
}

export async function performGrantedAction(input: AgentSendInput): Promise<AgentSendResult> {
  const action = String(input.action ?? "");
  if (!isGatedAction(action)) return { ok: false, error: `Unknown gated action "${action}".` };
  const agent = (input.agent ?? "agent").slice(0, 40);
  const kind = ACTION_TARGET_KIND[action];

  // Resolve the target BEFORE spending the grant so a typo doesn't burn a use.
  let targetId: string;
  let to: string | undefined;
  if (action === "send_email") {
    to = (input.email?.to ?? "").trim();
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, error: "send_email needs a valid `to` address." };
    if (!(input.email?.body ?? "").trim()) return { ok: false, error: "send_email needs a body." };
    targetId = to.toLowerCase();
  } else {
    const n = Number(input.target);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: `${action} needs a numeric target id.` };
    targetId = String(n);
  }

  const spent = await consumeGrant(input.grantId, action as GatedAction, { kind, id: targetId, to });
  if (!spent.ok) return spent;

  let result: AgentSendResult;
  try {
    switch (action as GatedAction) {
      case "send_bid_package": {
        const r = await sendBidPackageOp(Number(targetId));
        result = r.ok
          ? { ...r, ok: true as const, summary: `Bid package ${targetId} emailed to its subs.` }
          : { ok: false, error: r.error ?? "Send failed." };
        break;
      }
      case "send_purchase_order":
        result = await sendPurchaseOrderOp(Number(targetId));
        break;
      case "send_invoice":
        result = await sendInvoiceOp(Number(targetId));
        break;
      case "release_newsletter_issue":
        result = await releaseIssue(Number(targetId));
        break;
      case "release_newsletter_outbox_item": {
        const r = await releaseOutboxItem(Number(targetId));
        result = r.ok ? { ok: true, summary: `Outbox row ${targetId} released.` } : { ok: false, error: r.error ?? "Release failed." };
        break;
      }
      case "send_document_for_signature": {
        const r = await submitDocDraftForSignature(Number(targetId), await ownerUser(), Boolean(input.override));
        result = r.ok
          ? { ok: true, summary: `Draft ${targetId} submitted for signature — ${r.delivery.note}`, delivery: r.delivery }
          : { ok: false, error: r.error };
        break;
      }
      case "send_email": {
        if (!gmailConfigured()) {
          result = { ok: false, error: "Gmail is not connected." };
          break;
        }
        await sendNewEmail({ to: to!, subject: input.email!.subject ?? "", bodyText: input.email!.body });
        result = { ok: true, summary: `Email sent to ${to}: "${(input.email!.subject ?? "").slice(0, 80)}"` };
        break;
      }
    }
  } catch (err) {
    result = { ok: false, error: (err as Error).message || "Send failed." };
  }

  await recordGrantResult(input.grantId, result.ok ? `ok: ${result.summary}` : `failed: ${result.error}`);
  // Single-recipient actions fail atomically (nothing went out), so hand the
  // use back. Bid packages and issue releases can partially send — keep spent.
  if (!result.ok && action !== "send_bid_package" && action !== "release_newsletter_issue") {
    await refundGrantUse(input.grantId);
  }
  await audit(agent, action, `${kind}:${targetId}`, result);
  return result;
}

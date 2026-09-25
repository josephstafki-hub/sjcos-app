// Agent-side sends — the ONLY way an agent reaches a real inbox.
//
// performGrantedAction() is what the internal owner-grants route calls for
// every MCP send tool (mcp/grants-tools.mjs). Since A05/A06 it does NOT
// call a provider itself: it stages a permanent action intent bound to the
// owner grant (or decision) for the exact action + target, then dispatches
// that intent inline through lib/dispatch so the agent gets a truthful
// answer:
//   • ok:true  only when the provider accepted/confirmed;
//   • an 'unknown' outcome is reported as HELD (not sent, not failed) with
//     no grant refund — a human or the reconciliation sweep settles it;
//   • a refusal at dispatch (grant spent/revoked, opt-out, paused lane,
//     changed payload) comes back with the reason.
// The grant is spent AT DISPATCH inside the same transaction that leases the
// intent (lib/dispatch/authority.ts), and given back only when the provider
// was provably never called.

import { createHash } from "node:crypto";
import { query, queryOne } from "@/lib/db";
import { notifyAgentFailure } from "@/lib/notify-owner";
import { sendBidPackageOp } from "@/lib/bidding";
import { sendInvoiceOp, sendPurchaseOrderOp } from "@/lib/send-ops";
import { releaseOutboxItem } from "@/lib/newsletter-outbox";
import { submitDocDraftForSignature } from "@/lib/doc-drafts";
import { sendSms } from "@/lib/sms";
import { placeCall } from "@/lib/voice";
import { withTransaction } from "@/lib/commands/db";
import { enqueueIntent } from "@/lib/commands/intents";
import { describeOutcome, dispatchIntentsNow } from "@/lib/dispatch/db";
import {
  ACTION_TARGET_KIND,
  checkGrantCovers,
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
  /** send_sms only. */
  sms?: { to: string; body: string };
  /** place_call only. */
  call?: { to: string; contact_name?: string | null };
  /** send_document_for_signature only: proceed past the "fields missing" gate. */
  override?: boolean;
  /** Who is acting (for the audit line). */
  agent?: string;
}

export type AgentSendResult = { ok: true; summary: string; [k: string]: unknown } | { ok: false; error: string; [k: string]: unknown };

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
    // W3: a failed granted send is a phone-worthy event (collapsed to one
    // push per runtime per hour inside notifyAgentFailure; never throws).
    if (!result.ok && !result.held) {
      await notifyAgentFailure(`mcp:${agent}`.slice(0, 80), result.error);
    }
  } catch {
    /* best-effort */
  }
}

/** Release every queued/failed outbox row for one issue: one intent per row,
 *  all bound to the same issue-level grant (its max_uses is raised to cover
 *  every recipient, so a retry of an unresolved recipient never needs a
 *  second approval while resolved recipients are never touched again). */
async function releaseIssue(issueId: number, grantId: string, agent: string): Promise<AgentSendResult> {
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
  await query(`UPDATE owner_grants SET max_uses = GREATEST(max_uses, uses + $2) WHERE id = $1 AND status = 'approved'`, [grantId, pending.rows.length]);
  let released = 0;
  let failed = 0;
  let held = 0;
  const problems: string[] = [];
  for (const row of pending.rows) {
    const r = await releaseOutboxItem(row.id, { grantId, actor: `mcp:${agent}`, grantAction: "release_newsletter_issue", grantTarget: String(issueId) });
    if (r.ok) released++;
    else if (r.held) held++;
    else {
      failed++;
      if (r.error && problems.length < 3) problems.push(`row ${row.id}: ${r.error}`);
    }
  }
  const summary = `Released "${issue.subject}": ${released} sent${held ? `, ${held} held for reconciliation (outcome unknown — not resent)` : ""}${failed ? `, ${failed} failed (left as failed to retry)` : ""}.`;
  if (released === 0 && held === 0) return { ok: false, error: `${summary}${problems.length ? ` ${problems.join("; ")}` : ""}`, released, failed, held };
  return { ok: true, summary, released, failed, held };
}

export async function performGrantedAction(input: AgentSendInput): Promise<AgentSendResult> {
  const action = String(input.action ?? "");
  if (!isGatedAction(action)) return { ok: false, error: `Unknown gated action "${action}".` };
  const agent = (input.agent ?? "agent").slice(0, 40);
  const kind = ACTION_TARGET_KIND[action];
  const actor = `mcp:${agent}`;

  // Texts and calls stage their own intents inside lib/sms.ts / lib/voice.ts
  // (the one provider path the owner's own buttons use too).
  if (action === "send_sms") {
    const to = (input.sms?.to ?? "").trim();
    const body = (input.sms?.body ?? "").trim();
    if (!to) return { ok: false, error: "send_sms needs a `to` phone number." };
    if (!body) return { ok: false, error: "send_sms needs a body." };
    const r = await sendSms({ to, body, grantId: input.grantId, actor });
    const result: AgentSendResult = r.ok ? { ok: true, summary: r.summary, thread_id: r.threadId } : { ok: false, error: r.error, held: r.blocked === "unknown" };
    await audit(agent, action, `phone:${to}`, result);
    return result;
  }
  if (action === "place_call") {
    const to = (input.call?.to ?? "").trim();
    if (!to) return { ok: false, error: "place_call needs a `to` phone number." };
    const r = await placeCall({ to, grantId: input.grantId, actor, contactName: input.call?.contact_name ?? null });
    const result: AgentSendResult = r.ok ? { ok: true, summary: r.summary, call_id: r.callId } : { ok: false, error: r.error, held: r.blocked === "unknown" };
    await audit(agent, action, `phone:${to}`, result);
    return result;
  }

  // Resolve the target BEFORE anything is staged so a typo doesn't burn a use.
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

  // Fast, relayable refusal when the grant plainly doesn't cover this. The
  // authoritative spend happens at dispatch.
  const covers = await checkGrantCovers(input.grantId, action as GatedAction, { kind, id: targetId, to });
  if (!covers.ok) return covers;

  let result: AgentSendResult;
  try {
    switch (action as GatedAction) {
      case "send_bid_package": {
        const r = await sendBidPackageOp(Number(targetId), { grantId: input.grantId, actor });
        result = r.ok
          ? { ...r, ok: true as const, summary: `Bid package ${targetId} emailed to its subs (${r.sent ?? 0}).` }
          : { ok: false, error: r.error ?? "Send failed.", sent: r.sent, held: r.held };
        break;
      }
      case "send_purchase_order": {
        const r = await sendPurchaseOrderOp(Number(targetId), undefined, { grantId: input.grantId, actor });
        result = r.ok ? r : { ok: false, error: r.error, held: r.held };
        break;
      }
      case "send_invoice": {
        const r = await sendInvoiceOp(Number(targetId), { grantId: input.grantId, actor });
        result = r.ok ? r : { ok: false, error: r.error, held: r.held };
        break;
      }
      case "release_newsletter_issue":
        result = await releaseIssue(Number(targetId), input.grantId, agent);
        break;
      case "release_newsletter_outbox_item": {
        const r = await releaseOutboxItem(Number(targetId), { grantId: input.grantId, actor });
        result = r.ok ? { ok: true, summary: `Outbox row ${targetId} released.` } : { ok: false, error: r.error ?? "Release failed.", held: r.held };
        break;
      }
      case "send_document_for_signature": {
        // Not yet on the intent path (lib/doc-drafts owns its delivery):
        // spend the grant up front as before and refund on a clean failure.
        const spent = await consumeGrant(input.grantId, action, { kind, id: targetId });
        if (!spent.ok) return spent;
        const r = await submitDocDraftForSignature(Number(targetId), await ownerUser(), Boolean(input.override));
        result = r.ok
          ? { ok: true, summary: `Draft ${targetId} submitted for signature — ${r.delivery.note}`, delivery: r.delivery }
          : { ok: false, error: r.error };
        await recordGrantResult(input.grantId, result.ok ? `ok: ${result.summary}` : `failed: ${result.error}`);
        if (!result.ok) await refundGrantUse(input.grantId);
        break;
      }
      case "send_email": {
        const email = input.email!;
        const payload = {
          to: targetId,
          subject: email.subject ?? "",
          bodyText: email.body,
          _auth: { action: "send_email", target_kind: "email", target_id: targetId, to: targetId },
        };
        const opKey = `email:${input.grantId}:${createHash("sha256").update(`${targetId}\n${payload.subject}\n${payload.bodyText}`).digest("hex").slice(0, 20)}`;
        const { intent } = await withTransaction((run) =>
          enqueueIntent(run, {
            operationKey: opKey,
            kind: "send_email",
            targetKind: "email",
            targetId,
            recipient: targetId,
            payload,
            grantId: input.grantId,
            principal: { kind: "agent", agent, runId: null, onBehalfOf: null },
          }),
        );
        const [outcome] = await dispatchIntentsNow([intent.id]);
        const d = describeOutcome(outcome, `Email to ${targetId}: "${(email.subject ?? "").slice(0, 80)}"`);
        result = d.ok ? { ok: true, summary: d.summary, intent_id: intent.id } : { ok: false, error: d.error, held: d.held, intent_id: intent.id };
        break;
      }
      case "send_sms":
      case "place_call":
        result = { ok: false, error: "unreachable" };
        break;
    }
  } catch (err) {
    result = { ok: false, error: (err as Error).message || "Send failed." };
  }

  await audit(agent, action, `${kind}:${targetId}`, result);
  return result;
}

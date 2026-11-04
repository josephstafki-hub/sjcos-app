// Joe replies to a card from Telegram (2026-10-29).
//
// He swipes-to-reply on a permission card (or on the bot's "what should
// change?" prompt, or on an agent's answer) and types what he wants. That
// message is matched to the card's decision, recorded as an owner_replies
// row, the request is pulled as "changes requested" (Joe's call: a reply
// withdraws it at once), and the note is routed:
//
//   route 'session' — the request names the Ask-window chat that filed it
//                     (owner_grants.conversation_id / run_id). The note goes
//                     to that chat after commit (lib/owner-reply-delivery.ts):
//                     into the live run, or as a new turn. The operating
//                     agent's own wake-up for the same decision is closed so
//                     two agents don't both redo it.
//   route 'agent'   — no chat to go back to (Hermes background jobs, a
//                     terminal session, a non-grant card): the operating agent
//                     is woken with the request and Joe's words.
//
// Staged drafts (2026-10-30): the "Approve & send / Decline" card for a
// submit_draft_for_approval work item is the card Joe gets most, and it is a
// work item, not a decision. A reply to it pulls the draft back (approval no
// longer requested — Approve on the old card can't send it) and routes the
// same way: the chat that submitted it (its 'draft' receipt names it) or the
// operating agent. The agent's fixed draft comes back threaded under his note
// (lib/notify-owner.ts notifyApprovalNeeded).
//
// Pure over run(sql, params) — the webhook calls it inside its transaction.

import type { Run } from "../commands/core.ts";
import type { Principal } from "../commands/principal.ts";
import { resolveFromChannel } from "./resolve.ts";
import { enqueueAgentTrigger } from "../agent-runtime/triggers.ts";

export interface ReplyTarget {
  /** A permission/decision card… */
  decisionId: string | null;
  /** …or a staged-draft (work item) card… */
  workItemId: string | null;
  /** …or a portal message push (a client or sub wrote in the portal). Exactly
   *  one of the three is set. Only ever matched by an explicit reply. */
  portal?: { channelKey: string; messageId: string | null } | null;
  /** How it was matched: Joe replied to a message, or it was the only open card. */
  matched: "reply" | "only_open";
}

/** Which card a Telegram message is about. A reply to a card, to the bot's
 *  prompt or to an agent's answer maps to that decision or draft. A plain
 *  message maps to the one open card when there is exactly one. Otherwise
 *  null + how many are open, so the bot can ask Joe to reply to the card. */
export async function findReplyTarget(run: Run, chatId: string, replyToMessageId: number | null): Promise<{ target: ReplyTarget | null; open: number }> {
  if (replyToMessageId != null) {
    // A reply to a portal message push: Joe is answering the client (or sub)
    // in the portal. Checked first and only on an explicit reply.
    const [portal] = await run<{ portal_channel_key: string; portal_message_id: string | null }>(
      `SELECT portal_channel_key, portal_message_id::text AS portal_message_id FROM telegram_reply_targets
        WHERE chat_id = $1 AND message_id = $2 AND portal_channel_key IS NOT NULL`,
      [chatId, replyToMessageId],
    );
    if (portal) return { target: { decisionId: null, workItemId: null, portal: { channelKey: portal.portal_channel_key, messageId: portal.portal_message_id }, matched: "reply" }, open: 0 };
    const [hit] = await run<{ decision_id: string | null; work_item_id: string | null }>(
      `SELECT decision_id, work_item_id FROM (
         SELECT t.decision_id, t.work_item_id, 0 AS pri, t.created_at FROM telegram_reply_targets t
          WHERE t.chat_id = $1 AND t.message_id = $2 AND (t.decision_id IS NOT NULL OR t.work_item_id IS NOT NULL)
         UNION ALL
         SELECT dd.decision_id, NULL::uuid, 1, d.created_at FROM decision_deliveries dd JOIN decisions d ON d.id = dd.decision_id
          WHERE dd.channel = 'telegram' AND dd.external_ref = $1 || ':' || $2::text
       ) x ORDER BY pri, created_at DESC LIMIT 1`,
      [chatId, replyToMessageId],
    );
    if (hit) return { target: { decisionId: hit.decision_id, workItemId: hit.decision_id ? null : hit.work_item_id, matched: "reply" }, open: 0 };
  }
  // Open cards that actually went to the phone recently: permission cards and
  // staged drafts still waiting on him.
  const open = await run<{ decision_id: string | null; work_item_id: string | null }>(
    `SELECT decision_id, work_item_id FROM (
       SELECT d.id AS decision_id, NULL::uuid AS work_item_id, d.created_at AS at FROM decisions d
        WHERE d.status = 'pending' AND d.created_at > now() - interval '7 days'
          AND EXISTS (SELECT 1 FROM decision_deliveries dd WHERE dd.decision_id = d.id AND dd.channel = 'telegram' AND dd.external_ref IS NOT NULL)
       UNION ALL
       SELECT NULL::uuid, w.id, w.updated_at FROM work_items w
        WHERE w.approval_status = 'requested'
          AND EXISTS (SELECT 1 FROM telegram_reply_targets t WHERE t.work_item_id = w.id AND t.kind = 'card' AND t.chat_id = $1 AND t.created_at > now() - interval '7 days')
     ) x ORDER BY at DESC LIMIT 5`,
    [chatId],
  );
  if (replyToMessageId == null && open.length === 1) return { target: { decisionId: open[0].decision_id, workItemId: open[0].work_item_id, matched: "only_open" }, open: 1 };
  return { target: null, open: open.length };
}

export interface RecordedReply {
  id: string;
  /** The card it was about: a decision, or a staged draft (work item). */
  decisionId: string | null;
  workItemId: string | null;
  /** The card's title (decision title or work item title). */
  title: string;
  grantId: string | null;
  route: "session" | "agent";
  conversationId: string | null;
  /** The request was pending and is now pulled ("changes requested"; for a
   *  draft: approval no longer requested). */
  pulled: boolean;
  /** What the decision already was when it wasn't pending (approved, superseded…). */
  priorStatus: string | null;
  triggerId: string | null;
}

/** Record Joe's reply, pull the request if it is still waiting, and decide
 *  where the note goes. Delivery to a chat happens after commit. */
export async function recordOwnerReply(
  run: Run,
  input: { decisionId?: string | null; workItemId?: string | null; text: string; chatId: string; messageId: number; principal: Principal },
): Promise<RecordedReply> {
  if (!input.decisionId) {
    if (!input.workItemId) throw new Error("no card to reply to");
    return recordDraftReply(run, { ...input, workItemId: input.workItemId });
  }
  const [d] = await run<{ id: string; status: string; title: string; project_id: string | null; lead_id: string | null; content_hash: string | null; action: string; target_kind: string | null; target_id: string | null }>(
    `SELECT id, status, title, project_id, lead_id, content_hash, action, target_kind, target_id FROM decisions WHERE id = $1`,
    [input.decisionId],
  );
  if (!d) throw new Error("decision not found");
  // The chat that filed it — only if that thread still exists.
  const [g] = await run<{ id: string; conversation_id: string | null }>(
    `SELECT g.id, c.id AS conversation_id
       FROM owner_grants g
       LEFT JOIN dev_agent_runs r ON r.id = g.run_id
       LEFT JOIN ai_conversations c ON c.id = COALESCE(g.conversation_id, r.conversation_id)
      WHERE g.decision_id = $1 ORDER BY g.created_at DESC LIMIT 1`,
    [d.id],
  );
  const conversationId = g?.conversation_id ?? null;
  const route: "session" | "agent" = conversationId ? "session" : "agent";

  const [row] = await run<{ id: string }>(
    `INSERT INTO owner_replies (decision_id, grant_id, body, chat_id, message_id, route, conversation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [d.id, g?.id ?? null, input.text, input.chatId, input.messageId, route, conversationId],
  );
  const replyId = row.id;

  let pulled = false;
  if (d.status === "pending") {
    const r = await resolveFromChannel(run, {
      decisionId: d.id,
      contentHash: d.content_hash,
      via: "telegram",
      principal: input.principal,
      outcome: "changes_requested",
      note: input.text,
    });
    pulled = r.ok;
  }

  // resolveFromChannel woke the operating agent for this decision
  // (agent-runtime/hooks onDecisionResolved). Close that wake-up when the
  // chat that asked will handle it; otherwise hand the agent Joe's words.
  const ownerFacts = {
    owner_reply_id: replyId,
    owner_reply: input.text,
    owner_reply_how: "Joe replied to this card on Telegram. Either file a revised request (request_owner_permission — a new request for the same send replaces the old one) or tell him why not with reply_to_owner, passing owner_reply_id. Not both.",
    decision_id: d.id,
    decision_title: d.title,
    ...(g ? { grant_id: g.id } : {}),
  };
  let triggerId: string | null = null;
  const wakeRef = `decision:${d.id}:rejected`;
  if (route === "session") {
    await run(
      `UPDATE agent_triggers SET state = 'done', done_at = now(), last_error = $2
        WHERE kind = 'approval' AND ref = $1 AND state = 'pending'`,
      [wakeRef, `routed to the chat that filed it (owner reply ${replyId})`],
    );
  } else {
    const [woken] = pulled
      ? await run<{ id: string }>(`UPDATE agent_triggers SET payload = payload || $2::jsonb WHERE kind = 'approval' AND ref = $1 AND state IN ('pending','leased') RETURNING id`, [wakeRef, JSON.stringify(ownerFacts)])
      : [];
    if (woken) triggerId = woken.id;
    else {
      const t = await enqueueAgentTrigger(run, {
        kind: "message",
        ref: `owner_reply:${replyId}`,
        projectId: d.project_id,
        leadId: d.lead_id,
        enqueuedBy: "telegram:owner-reply",
        payload: { ...ownerFacts, decision_status: pulled ? "rejected" : d.status, action: d.action, target_kind: d.target_kind, target_id: d.target_id },
      });
      triggerId = t.trigger.id;
    }
  }
  await run(`UPDATE owner_replies SET trigger_id = $2 WHERE id = $1`, [replyId, triggerId]);
  // Joe can reply to his own message's thread again; keep the mapping.
  await run(
    `INSERT INTO telegram_reply_targets (chat_id, message_id, decision_id, owner_reply_id, kind) VALUES ($1, $2, $3, $4, 'owner_reply')
     ON CONFLICT (chat_id, message_id) DO NOTHING`,
    [input.chatId, input.messageId, d.id, replyId],
  );
  return { id: replyId, decisionId: d.id, workItemId: null, title: d.title, grantId: g?.id ?? null, route, conversationId, pulled, priorStatus: pulled ? null : d.status, triggerId };
}

/** What the operating agent is told to do with a reply about a draft. */
export function draftReplyHow(workItemId: string): string {
  return (
    `Joe replied to this draft's card on Telegram, so the draft is pulled back (not approved, nothing was sent). ` +
    `Either make the change and call submit_draft_for_approval on work item ${workItemId} again with the revised draft (Joe gets the new card), ` +
    `or tell him why not with reply_to_owner, passing owner_reply_id. Not both.`
  );
}

/** Joe replied about a staged draft (a work item awaiting approval). */
async function recordDraftReply(
  run: Run,
  input: { workItemId: string; text: string; chatId: string; messageId: number },
): Promise<RecordedReply> {
  const [w] = await run<{ id: string; title: string; approval_status: string; lead_id: string | null; project_id: string | null }>(
    `SELECT id, title, approval_status, lead_id, project_id FROM work_items WHERE id = $1`,
    [input.workItemId],
  );
  if (!w) throw new Error("work item not found");
  // The chat that submitted the draft (submit_draft_for_approval records the
  // in-app run on the receipt) — only if that thread still exists.
  const [src] = await run<{ conversation_id: string }>(
    `SELECT c.id AS conversation_id
       FROM agent_receipts r
       LEFT JOIN dev_agent_runs dr ON dr.id::text = r.metadata->>'run_id'
       JOIN ai_conversations c ON c.id::text = COALESCE(r.metadata->>'conversation_id', dr.conversation_id::text)
      WHERE r.work_item_id = $1 AND r.receipt_kind = 'draft'
      ORDER BY r.created_at DESC LIMIT 1`,
    [w.id],
  );
  const conversationId = src?.conversation_id ?? null;
  const route: "session" | "agent" = conversationId ? "session" : "agent";

  const [row] = await run<{ id: string }>(
    `INSERT INTO owner_replies (work_item_id, body, chat_id, message_id, route, conversation_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [w.id, input.text, input.chatId, input.messageId, route, conversationId],
  );
  const replyId = row.id;

  // Pull it: the old card's Approve must not send the draft he just asked to
  // change. The agent's submit_draft_for_approval puts it back to 'requested'.
  const pulledRows = await run<{ id: string }>(
    `UPDATE work_items
        SET approval_status = 'not_requested',
            status = CASE WHEN status = 'approval_needed' THEN 'in_progress' ELSE status END,
            blocked_reason = $2
      WHERE id = $1 AND approval_status = 'requested'
      RETURNING id`,
    [w.id, `Joe asked for changes on Telegram: ${input.text}`.slice(0, 500)],
  );
  const pulled = pulledRows.length > 0;

  let triggerId: string | null = null;
  if (route === "agent") {
    const [draft] = await run<{ content: string }>(
      `SELECT k.content FROM agent_receipts r JOIN knowledge_items k ON r.uri = 'knowledge_items/' || k.id::text
        WHERE r.work_item_id = $1 AND r.receipt_kind = 'draft' ORDER BY r.created_at DESC LIMIT 1`,
      [w.id],
    );
    const t = await enqueueAgentTrigger(run, {
      kind: "message",
      ref: `owner_reply:${replyId}`,
      projectId: w.project_id,
      leadId: w.lead_id,
      enqueuedBy: "telegram:owner-reply",
      payload: {
        owner_reply_id: replyId,
        owner_reply: input.text,
        owner_reply_how: draftReplyHow(w.id),
        work_item_id: w.id,
        work_item_title: w.title,
        approval_status: pulled ? "pulled (was requested)" : w.approval_status,
        ...(draft?.content ? { draft_text: draft.content.slice(0, 4000) } : {}),
      },
    });
    triggerId = t.trigger.id;
  }
  await run(`UPDATE owner_replies SET trigger_id = $2 WHERE id = $1`, [replyId, triggerId]);
  await run(
    `INSERT INTO telegram_reply_targets (chat_id, message_id, work_item_id, owner_reply_id, kind) VALUES ($1, $2, $3, $4, 'owner_reply')
     ON CONFLICT (chat_id, message_id) DO NOTHING`,
    [input.chatId, input.messageId, w.id, replyId],
  );
  return { id: replyId, decisionId: null, workItemId: w.id, title: w.title, grantId: null, route, conversationId, pulled, priorStatus: pulled ? null : w.approval_status, triggerId };
}

/** A bot message Joe may reply to (card, prompt, agent answer, portal message
 *  push) → its decision, staged draft or portal thread. */
export async function rememberReplyTarget(
  run: Run,
  input: {
    chatId: string;
    messageId: number | string;
    decisionId?: string | null;
    workItemId?: string | null;
    ownerReplyId?: string | null;
    portalChannelKey?: string | null;
    portalMessageId?: number | string | null;
    kind: string;
  },
): Promise<void> {
  if (!input.decisionId && !input.workItemId && !input.portalChannelKey) return;
  await run(
    `INSERT INTO telegram_reply_targets (chat_id, message_id, decision_id, work_item_id, owner_reply_id, portal_channel_key, portal_message_id, kind) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (chat_id, message_id) DO UPDATE SET decision_id = EXCLUDED.decision_id, work_item_id = EXCLUDED.work_item_id, owner_reply_id = EXCLUDED.owner_reply_id,
       portal_channel_key = EXCLUDED.portal_channel_key, portal_message_id = EXCLUDED.portal_message_id, kind = EXCLUDED.kind`,
    [
      input.chatId,
      Number(input.messageId),
      input.decisionId ?? null,
      input.workItemId ?? null,
      input.ownerReplyId ?? null,
      input.portalChannelKey ?? null,
      input.portalMessageId != null && input.portalMessageId !== "" ? Number(input.portalMessageId) : null,
      input.kind,
    ],
  );
}

/** A fresh draft went up for approval: Joe's open replies about that draft —
 *  or about another draft on the same lead/project (the agent may have filed
 *  a new item rather than reusing the old one) — are answered by it. Returns
 *  the replies closed, newest first, so the new card can be threaded under
 *  his message. */
export async function closeRepliesRevisedByDraft(run: Run, workItemId: string): Promise<{ id: string; chat_id: string | null; message_id: string | null }[]> {
  return run<{ id: string; chat_id: string | null; message_id: string | null }>(
    `WITH fresh AS (SELECT id, lead_id, project_id, title FROM work_items WHERE id = $1),
     closed AS (
       UPDATE owner_replies o
          SET state = 'answered', answer_kind = 'revised', answer = 'New draft: ' || fresh.title, answered_at = now()
         FROM fresh, work_items w
        WHERE w.id = o.work_item_id AND o.state IN ('received','delivered') AND o.created_at > now() - interval '3 days'
          AND (w.id = fresh.id
               OR (fresh.lead_id IS NOT NULL AND w.lead_id = fresh.lead_id)
               OR (fresh.project_id IS NOT NULL AND w.project_id = fresh.project_id))
        RETURNING o.id, o.chat_id, o.message_id, o.created_at)
     SELECT id, chat_id, message_id::text AS message_id FROM closed ORDER BY created_at DESC, message_id DESC NULLS LAST`,
    [workItemId],
  );
}

/** The agent filed a revised request for the same send: Joe's reply about
 *  the old one is answered by it. Returns the replies closed (with Joe's
 *  message ids, so the new card can be threaded under his message). */
export async function closeRepliesRevisedBy(
  run: Run,
  fresh: { id: string; actions: string[]; target_id: string | null; conversation_id: string | null },
): Promise<{ id: string; chat_id: string | null; message_id: string | null }[]> {
  if (!fresh.target_id && !fresh.conversation_id) return [];
  return run<{ id: string; chat_id: string | null; message_id: string | null }>(
    `UPDATE owner_replies o
        SET state = 'answered', answer_kind = 'revised', answer = 'New request ' || $1::text, answered_at = now()
       FROM owner_grants g
      WHERE o.grant_id = g.id AND o.state IN ('received','delivered') AND o.created_at > now() - interval '3 days'
        AND g.actions = $2::text[]
        AND (($3::text IS NOT NULL AND lower(g.target_id) = lower($3)) OR ($4::uuid IS NOT NULL AND o.conversation_id = $4))
      RETURNING o.id, o.chat_id, o.message_id::text AS message_id`,
    [fresh.id, fresh.actions, fresh.target_id, fresh.conversation_id],
  );
}

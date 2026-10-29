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
// Pure over run(sql, params) — the webhook calls it inside its transaction.

import type { Run } from "../commands/core.ts";
import type { Principal } from "../commands/principal.ts";
import { resolveFromChannel } from "./resolve.ts";
import { enqueueAgentTrigger } from "../agent-runtime/triggers.ts";

export interface ReplyTarget {
  decisionId: string;
  /** How it was matched: Joe replied to a message, or it was the only open card. */
  matched: "reply" | "only_open";
}

/** Which card a Telegram message is about. A reply to a card, to the bot's
 *  prompt or to an agent's answer maps to that decision. A plain message maps
 *  to the one open card when there is exactly one. Otherwise null +
 *  how many are open, so the bot can ask Joe to reply to the card. */
export async function findReplyTarget(run: Run, chatId: string, replyToMessageId: number | null): Promise<{ target: ReplyTarget | null; open: number }> {
  if (replyToMessageId != null) {
    const [hit] = await run<{ decision_id: string }>(
      `SELECT decision_id FROM (
         SELECT t.decision_id, d.created_at FROM telegram_reply_targets t JOIN decisions d ON d.id = t.decision_id
          WHERE t.chat_id = $1 AND t.message_id = $2
         UNION ALL
         SELECT dd.decision_id, d.created_at FROM decision_deliveries dd JOIN decisions d ON d.id = dd.decision_id
          WHERE dd.channel = 'telegram' AND dd.external_ref = $1 || ':' || $2::text
       ) x ORDER BY created_at DESC LIMIT 1`,
      [chatId, replyToMessageId],
    );
    if (hit) return { target: { decisionId: hit.decision_id, matched: "reply" }, open: 0 };
  }
  // Open cards that actually went to the phone recently.
  const open = await run<{ id: string }>(
    `SELECT d.id FROM decisions d
      WHERE d.status = 'pending' AND d.created_at > now() - interval '7 days'
        AND EXISTS (SELECT 1 FROM decision_deliveries dd WHERE dd.decision_id = d.id AND dd.channel = 'telegram' AND dd.external_ref IS NOT NULL)
      ORDER BY d.created_at DESC LIMIT 5`,
  );
  if (replyToMessageId == null && open.length === 1) return { target: { decisionId: open[0].id, matched: "only_open" }, open: 1 };
  return { target: null, open: open.length };
}

export interface RecordedReply {
  id: string;
  decisionId: string;
  decisionTitle: string;
  grantId: string | null;
  route: "session" | "agent";
  conversationId: string | null;
  /** The request was pending and is now pulled ("changes requested"). */
  pulled: boolean;
  /** What the decision already was when it wasn't pending (approved, superseded…). */
  priorStatus: string | null;
  triggerId: string | null;
}

/** Record Joe's reply, pull the request if it is still waiting, and decide
 *  where the note goes. Delivery to a chat happens after commit. */
export async function recordOwnerReply(
  run: Run,
  input: { decisionId: string; text: string; chatId: string; messageId: number; principal: Principal },
): Promise<RecordedReply> {
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
  return { id: replyId, decisionId: d.id, decisionTitle: d.title, grantId: g?.id ?? null, route, conversationId, pulled, priorStatus: pulled ? null : d.status, triggerId };
}

/** A bot message Joe may reply to (prompt, agent answer) → its decision. */
export async function rememberReplyTarget(run: Run, input: { chatId: string; messageId: number | string; decisionId: string; ownerReplyId?: string | null; kind: string }): Promise<void> {
  await run(
    `INSERT INTO telegram_reply_targets (chat_id, message_id, decision_id, owner_reply_id, kind) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (chat_id, message_id) DO UPDATE SET decision_id = EXCLUDED.decision_id, owner_reply_id = EXCLUDED.owner_reply_id, kind = EXCLUDED.kind`,
    [input.chatId, Number(input.messageId), input.decisionId, input.ownerReplyId ?? null, input.kind],
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

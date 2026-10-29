import "server-only";

// After-commit half of Telegram replies (lib/decisions/owner-replies.ts has
// the in-transaction half). Everything Joe sees in the bot chat about a
// reply comes from here:
//
//   • askWhatShouldChange — "Request changes" tapped → a reply-prompt under
//     the card.
//   • deliverOwnerReply   — his note goes into the chat that filed the
//     request (the live run, or a new turn), or to the operating agent; the
//     bot acknowledges where it went.
//   • replyToOwner        — the agent's answer when it won't (or can't)
//     change the request: the MCP tool reply_to_owner.
//   • sweepUnansweredReplies — safety net: a turn that ended without a new
//     request or a reply still gets its last message relayed (dispatch cron).
//
// These are conversational answers to a message Joe just sent, so they skip
// the push queue (no quiet-hours parking, no hourly cap) and always reply to
// his message in the thread. Owner chat only, like every Telegram send.

import { query, queryOne } from "@/lib/db";
import { runDirect, withTransaction } from "@/lib/commands/db";
import { defaultTransport } from "@/lib/providers/telegram";
import { outboundDisabled } from "@/lib/providers/types";
import { enqueueSteer } from "@/lib/run-steers";
import { pingConversation } from "@/lib/dev-agents";
import { enqueueAgentTrigger } from "@/lib/agent-runtime/triggers";
import { rememberReplyTarget, type RecordedReply } from "@/lib/decisions/owner-replies";
import { describeGrant } from "@/lib/grant-detail";
import type { OwnerGrant } from "@/lib/owner-grant-types";

const ownerChat = () => (process.env.TELEGRAM_OWNER_CHAT_ID ?? "").trim();

/** Send one plain-text message to Joe's chat, threaded under `replyTo`.
 *  Returns the new message id (null when Telegram is off or refused). */
export async function sendOwnerTelegram(text: string, opts: { replyTo?: number | string | null; forceReply?: string | null } = {}): Promise<number | null> {
  const chat = ownerChat();
  if (!chat || !text.trim()) return null;
  if (outboundDisabled() || !defaultTransport.configured()) {
    console.log(`[owner-reply] telegram off — would send: ${text.slice(0, 200)}`);
    return null;
  }
  const body: Record<string, unknown> = { chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true };
  if (opts.replyTo != null) body.reply_parameters = { message_id: Number(opts.replyTo), allow_sending_without_reply: true };
  if (opts.forceReply) body.reply_markup = { force_reply: true, input_field_placeholder: opts.forceReply.slice(0, 64) };
  try {
    const res = await defaultTransport.call("sendMessage", body);
    if (!res.ok) {
      console.error("[owner-reply] sendMessage refused:", res.status, res.description);
      return null;
    }
    const id = (res.result as { message_id?: number } | undefined)?.message_id;
    return typeof id === "number" ? id : null;
  } catch (err) {
    console.error("[owner-reply] sendMessage failed:", (err as Error).message);
    return null;
  }
}

const AGENT_NAME: Record<string, string> = { claude: "Claude", hermes: "Hermes", qwen: "Qwen" };
const agentLabel = (requestedBy: string | null | undefined) =>
  !requestedBy ? "The agent" : /claude/i.test(requestedBy) ? "Claude" : /hermes|call-tool/i.test(requestedBy) ? "Hermes" : requestedBy;

/** "Request changes" was tapped on a card. */
export async function askWhatShouldChange(p: { decisionId: string; title: string; chatId: string; cardMessageId: number | null }): Promise<void> {
  const id = await sendOwnerTelegram(`What should change on "${p.title}"?\nReply to this message. That pulls the request and sends your note to the agent that filed it.`, {
    replyTo: p.cardMessageId,
    forceReply: "What should change?",
  });
  if (id != null) await rememberReplyTarget(runDirect, { chatId: p.chatId, messageId: id, decisionId: p.decisionId, kind: "prompt" }).catch(() => undefined);
}

/** The text the originating chat (or the operating agent) receives. */
async function promptFor(r: RecordedReply, text: string): Promise<string> {
  const g = r.grantId
    ? await queryOne<OwnerGrant>(`SELECT id, status, actions, target_kind, target_id, scope, reason, requested_by, conversation_id, run_id, max_uses, uses, expires_at::text AS expires_at, decided_at::text AS decided_at, used_at::text AS used_at, audit, created_at::text AS created_at FROM owner_grants WHERE id = $1`, [r.grantId])
    : null;
  const what = g ? (await describeGrant(g)).headline : r.decisionTitle;
  const state = r.pulled
    ? "That request is now withdrawn (changes requested)."
    : r.priorStatus
      ? `That request was already ${r.priorStatus} when he replied.`
      : "";
  return (
    `Joe replied on Telegram to your permission request "${what}"${g ? ` (grant ${g.id})` : ""}:\n\n` +
    `"${text}"\n\n` +
    `${state}\n` +
    `Do ONE of these:\n` +
    `• Make the change and file a new request_owner_permission (it replaces the old one and Joe gets the new card).\n` +
    `• If you won't change it, or need to ask him something, call reply_to_owner with owner_reply_id "${r.id}" and a short reason — it goes to his Telegram.\n` +
    `Keep anything you send him short.`
  );
}

/** Route Joe's recorded reply and tell him where it went. Never throws. */
export async function deliverOwnerReply(r: RecordedReply & { chatId: string; messageId: number }, text: string): Promise<void> {
  const pulledLine = r.pulled ? `Pulled "${r.decisionTitle}".` : r.priorStatus ? `"${r.decisionTitle}" was already ${r.priorStatus}.` : "";
  let ack: string;
  try {
    if (r.route === "session" && r.conversationId) {
      const prompt = await promptFor(r, text);
      const conv = await queryOne<{ title: string | null }>(`SELECT title FROM ai_conversations WHERE id = $1`, [r.conversationId]);
      const latest = await queryOne<{ id: string; agent: string; status: string }>(
        `SELECT id, agent, status FROM dev_agent_runs WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [r.conversationId],
      );
      const agent: "claude" | "hermes" = latest?.agent === "hermes" ? "hermes" : "claude";
      const name = AGENT_NAME[agent];
      const thread = conv?.title ? ` in "${conv.title}"` : "";
      let runId: string | null = null;
      let how = "";
      if (latest && (latest.status === "pending" || latest.status === "running")) {
        const s = await enqueueSteer(latest.id, prompt);
        if (s.ok) {
          runId = s.runId;
          how = "it was mid-run, so the note went straight in";
        }
      }
      if (!runId) {
        runId = (await pingConversation(r.conversationId, agent, prompt)) ?? null;
        how = "it's picking it up now";
      }
      await query(`UPDATE owner_replies SET state = 'delivered', run_id = $2, delivered_at = now() WHERE id = $1`, [r.id, runId]);
      ack = `Got it. ${pulledLine} Your note went to ${name}${thread} (${how}). You'll get its answer here.`;
    } else {
      await query(`UPDATE owner_replies SET state = 'delivered', delivered_at = now() WHERE id = $1`, [r.id]);
      ack = `Got it. ${pulledLine} No chat is attached to that request, so the operating agent takes your note (within a few minutes). Its answer comes here.`;
    }
  } catch (err) {
    // The chat couldn't take it (run refused, Hermes down…): hand it to the
    // operating agent instead so the note never just sits.
    const msg = (err as Error).message;
    console.error("[owner-reply] delivery failed:", msg);
    try {
      await withTransaction(async (run) => {
        const t = await enqueueAgentTrigger(run, {
          kind: "message",
          ref: `owner_reply:${r.id}`,
          enqueuedBy: "telegram:owner-reply",
          payload: { owner_reply_id: r.id, owner_reply: text, owner_reply_how: "Joe replied to this card on Telegram. Either file a revised request (request_owner_permission) or tell him why not with reply_to_owner, passing owner_reply_id.", decision_id: r.decisionId, decision_title: r.decisionTitle, ...(r.grantId ? { grant_id: r.grantId } : {}) },
        });
        await run(`UPDATE owner_replies SET state = 'delivered', route = 'agent', trigger_id = $2, delivered_at = now(), error = $3 WHERE id = $1`, [r.id, t.trigger.id, msg.slice(0, 500)]);
      });
      ack = `Got it. ${pulledLine} The chat that filed it couldn't take your note (${msg.slice(0, 120)}), so the operating agent has it instead. Its answer comes here.`;
    } catch (err2) {
      await query(`UPDATE owner_replies SET state = 'failed', error = $2 WHERE id = $1`, [r.id, (err2 as Error).message.slice(0, 500)]).catch(() => undefined);
      ack = `${pulledLine} But I couldn't hand your note to an agent: ${(err2 as Error).message.slice(0, 160)}. Open SJC OS to follow up.`;
    }
  }
  const id = await sendOwnerTelegram(ack.replace(/\s+/g, " ").trim(), { replyTo: r.messageId });
  if (id != null) await rememberReplyTarget(runDirect, { chatId: r.chatId, messageId: id, decisionId: r.decisionId, ownerReplyId: r.id, kind: "ack" }).catch(() => undefined);
}

export type ReplyOutcome = "no_change" | "question" | "done";

/** The agent answers Joe without changing the request (reply_to_owner). Finds
 *  his reply by id, else the newest open one on the grant/decision; with
 *  none, the message still goes to him, tied to the decision when given. */
export async function replyToOwner(input: {
  ownerReplyId?: string | null;
  grantId?: string | null;
  decisionId?: string | null;
  text: string;
  outcome: ReplyOutcome;
  agent: string;
}): Promise<{ ok: true; sent: boolean; owner_reply_id: string | null } | { ok: false; error: string }> {
  const text = input.text.trim();
  if (!text) return { ok: false, error: "Say something — the message is sent to Joe as written." };
  const isUuid = (v: string | null | undefined) => !!v && /^[0-9a-f-]{36}$/i.test(v);
  const reply = isUuid(input.ownerReplyId)
    ? await queryOne<{ id: string; decision_id: string | null; chat_id: string | null; message_id: string | null }>(`SELECT id, decision_id, chat_id, message_id::text AS message_id FROM owner_replies WHERE id = $1`, [input.ownerReplyId])
    : isUuid(input.grantId) || isUuid(input.decisionId)
      ? await queryOne<{ id: string; decision_id: string | null; chat_id: string | null; message_id: string | null }>(
          `SELECT id, decision_id, chat_id, message_id::text AS message_id FROM owner_replies
            WHERE (grant_id = $1::uuid OR decision_id = $2::uuid) ORDER BY created_at DESC LIMIT 1`,
          [isUuid(input.grantId) ? input.grantId : null, isUuid(input.decisionId) ? input.decisionId : null],
        )
      : null;
  if (input.ownerReplyId && !reply) return { ok: false, error: `No owner reply ${input.ownerReplyId}.` };
  const decisionId = reply?.decision_id ?? (isUuid(input.decisionId) ? input.decisionId! : null);
  const d = decisionId ? await queryOne<{ title: string }>(`SELECT title FROM decisions WHERE id = $1`, [decisionId]) : null;
  const lead = input.outcome === "no_change" ? "No change" : input.outcome === "question" ? "Question" : "Done";
  const msg = `[SJC OS] ${agentLabel(input.agent)}${d ? ` on "${d.title}"` : ""}\n${lead}: ${text}`;
  const id = await sendOwnerTelegram(msg, { replyTo: reply?.message_id ?? null });
  if (id != null && decisionId) await rememberReplyTarget(runDirect, { chatId: ownerChat(), messageId: id, decisionId, ownerReplyId: reply?.id ?? null, kind: "agent_answer" }).catch(() => undefined);
  if (reply) {
    await query(
      `UPDATE owner_replies SET state = 'answered', answer_kind = $2, answer = $3, answered_at = now() WHERE id = $1 AND state <> 'answered'`,
      [reply.id, input.outcome, text.slice(0, 4000)],
    );
  }
  return { ok: true, sent: id != null, owner_reply_id: reply?.id ?? null };
}

/** Safety net (dispatch cron): a delivered reply whose turn ended without a
 *  new request or a reply_to_owner still gets an answer — the agent's last
 *  message. Replies nobody picked up within a day are marked failed and Joe
 *  is told once. */
export async function sweepUnansweredReplies(): Promise<{ relayed: number; failed: number }> {
  let relayed = 0;
  let failed = 0;
  const { rows } = await query<{ id: string; route: string; conversation_id: string | null; trigger_id: string | null; message_id: string | null; decision_id: string | null; created_at: string; old: boolean }>(
    `SELECT id, route, conversation_id, trigger_id, message_id::text AS message_id, decision_id, created_at::text AS created_at,
            created_at < now() - interval '24 hours' AS old
       FROM owner_replies
      WHERE state = 'delivered' AND created_at < now() - interval '1 minute'
      ORDER BY created_at LIMIT 20`,
  );
  for (const r of rows) {
    let answer: string | null = null;
    let who = "The agent";
    if (r.route === "session" && r.conversation_id) {
      // The turn that took the note — and any follow-up turns after it — must be finished.
      const latest = await queryOne<{ agent: string; status: string; answer: string | null; settled: boolean }>(
        `SELECT agent, status, answer, updated_at < now() - interval '45 seconds' AS settled FROM dev_agent_runs
          WHERE conversation_id = $1 AND created_at >= $2::timestamptz - interval '10 minutes'
          ORDER BY created_at DESC LIMIT 1`,
        [r.conversation_id, r.created_at],
      );
      if (!latest || latest.status === "pending" || latest.status === "running" || !latest.settled) {
        if (!r.old) continue;
      } else {
        who = AGENT_NAME[latest.agent] ?? "The agent";
        answer = latest.answer?.trim() || `${who} finished without saying anything.`;
      }
    } else if (r.trigger_id) {
      const t = await queryOne<{ state: string; last_error: string | null; summary: string | null; blocked: string | null }>(
        `SELECT t.state, t.last_error, e.result_summary AS summary, e.blocked_reason AS blocked
           FROM agent_triggers t LEFT JOIN agent_executions e ON e.id = t.last_execution_id WHERE t.id = $1`,
        [r.trigger_id],
      );
      if (!t || t.state === "pending" || t.state === "leased") {
        if (!r.old) continue;
      } else {
        who = "The operating agent";
        answer = t.state === "failed" ? `couldn't finish: ${t.last_error ?? "unknown error"}` : (t.summary || t.blocked || "finished without a summary.");
      }
    } else if (!r.old) continue;

    if (answer == null) {
      await query(`UPDATE owner_replies SET state = 'failed', error = 'no answer within 24h' WHERE id = $1 AND state = 'delivered'`, [r.id]);
      await sendOwnerTelegram("[SJC OS] Nobody answered this note within a day. Open SJC OS to follow up.", { replyTo: r.message_id });
      failed++;
      continue;
    }
    const claimed = await query(`UPDATE owner_replies SET state = 'answered', answer_kind = 'run_reply', answer = $2, answered_at = now() WHERE id = $1 AND state = 'delivered' RETURNING id`, [r.id, answer.slice(0, 4000)]);
    if (!claimed.rows.length) continue;
    const clipped = answer.length > 1500 ? `${answer.slice(0, 1500)}…` : answer;
    const id = await sendOwnerTelegram(`[SJC OS] ${who} didn't file a new request or answer you directly. Its last message:\n\n${clipped}`, { replyTo: r.message_id });
    if (id != null && r.decision_id) await rememberReplyTarget(runDirect, { chatId: ownerChat(), messageId: id, decisionId: r.decision_id, ownerReplyId: r.id, kind: "run_reply" }).catch(() => undefined);
    relayed++;
  }
  return { relayed, failed };
}

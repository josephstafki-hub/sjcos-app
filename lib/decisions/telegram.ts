// Telegram decision buttons (A10). Pure: secret check, callback data
// encoding, and the update handler with an injected API so tests drive it
// with fake payloads and no network.
//
// Callback data (≤ 64 bytes, Telegram's limit):
//     d|<decision uuid>|<12 hex of content_hash>|<a|c|h>
// The hash prefix makes a button from a superseded card fail safely; the
// verb is approve / changes / hold. Everything else — who may tap, whether
// the decision is still pending, whether this update was seen before — is
// decided on the server from the users table and telegram_updates, never
// from the message.

import { timingSafeEqual } from "node:crypto";
import type { Run } from "../commands/core.ts";
import { getDecision } from "../commands/decisions.ts";
import type { Principal } from "../commands/principal.ts";
import { recordSourceEvent } from "../commands/source-events.ts";
import { cardText } from "./cards.ts";
import { holdDecision, resolveFromChannel, type ResolveFromChannelResult } from "./resolve.ts";
import { parseWorkItemCallback, type CallbackVerb, type WorkItemVerb } from "./keyboards.ts";
import { findReplyTarget, recordOwnerReply, type RecordedReply } from "./owner-replies.ts";

export { buildCallbackData, decisionKeyboard, type CallbackVerb } from "./keyboards.ts";
const CODE_VERB: Record<string, CallbackVerb> = { a: "approve", c: "changes", h: "hold" };

export function parseCallbackData(data: string | null | undefined): { decisionId: string; hashPrefix: string; verb: CallbackVerb } | null {
  if (!data) return null;
  const m = /^d\|([0-9a-f-]{36})\|([0-9a-f]{0,12})\|([ach])$/i.exec(data.trim());
  if (!m) return null;
  return { decisionId: m[1].toLowerCase(), hashPrefix: m[2].toLowerCase(), verb: CODE_VERB[m[3].toLowerCase()] };
}

export { parseWorkItemCallback, workItemKeyboard, type WorkItemVerb } from "./keyboards.ts";

/** Constant-time compare of the X-Telegram-Bot-Api-Secret-Token header. An
 *  unset secret fails closed. */
export function verifyTelegramSecret(header: string | null | undefined, secret: string | null | undefined): boolean {
  const s = (secret ?? "").trim();
  const h = (header ?? "").trim();
  if (!s || !h) return false;
  const a = Buffer.from(s);
  const b = Buffer.from(h);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Update shapes (the subset we read) ──────────────────────────────────────

export interface TelegramUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    from: { id: number | string; is_bot?: boolean; first_name?: string };
    message?: { message_id: number; chat: { id: number | string }; date?: number; forward_date?: number; forward_from?: unknown; edit_date?: number };
    data?: string;
  };
  message?: {
    message_id: number;
    chat: { id: number | string; type?: string };
    text?: string;
    from?: { id: number | string; is_bot?: boolean };
    reply_to_message?: { message_id: number };
    forward_date?: number;
    forward_from?: unknown;
  };
  edited_message?: unknown;
  [k: string]: unknown;
}

export interface TelegramHandlerDeps {
  ownerChatId: string;
  /** Resolve the owner principal from the users table (never from the update). */
  ownerPrincipal(): Promise<Principal | null>;
  /** answerCallbackQuery(id, text) — best-effort toast. */
  answer(callbackId: string, text: string): Promise<void>;
  /** Edit the card message to show its new state. Best-effort. */
  edit?(chatId: string, messageId: number, text: string): Promise<void>;
  appUrl?: string;
  /** When true, an Approve tap is NOT answered here: the caller answers after
   *  the post-commit effects ran, so the phone's toast says what happened
   *  ("Sent ✓ …") instead of just "Approved". */
  deferApproveAnswer?: boolean;
}

export interface TelegramHandleResult {
  handled: boolean;
  duplicate: boolean;
  outcome: string;
  decisionId: string | null;
  resolution?: ResolveFromChannelResult;
  /** A deferred answer the caller must send (see deferApproveAnswer). */
  pendingAnswer?: { callbackId: string; text: string; chatId: string; messageId: number | null };
  /** A work-item approval tap the caller performs after commit. */
  workItem?: { id: string; verb: WorkItemVerb; callbackId: string; chatId: string; messageId: number | null };
  /** "Request changes" tapped: the caller asks "what should change?" as a
   *  reply-prompt under the card (the reply to it pulls the request). */
  changesPrompt?: { decisionId: string; title: string; callbackId: string; chatId: string; cardMessageId: number | null };
  /** Joe typed a reply about a card: recorded and pulled here; the caller
   *  delivers it to the chat that asked and acknowledges. */
  ownerReply?: RecordedReply & { chatId: string; messageId: number };
  /** Joe typed something that couldn't be matched to one card. */
  help?: { chatId: string; messageId: number; text: string };
}

/** Handle one update: persist FIRST (source_events + telegram_updates dedupe),
 *  then act. A repeated update_id is answered but never re-applied. */
export async function handleTelegramUpdate(run: Run, update: TelegramUpdate, deps: TelegramHandlerDeps): Promise<TelegramHandleResult> {
  const updateId = Number(update.update_id);
  if (!Number.isFinite(updateId)) return { handled: false, duplicate: false, outcome: "malformed update", decisionId: null };
  const cq = update.callback_query;
  const chatId = String(cq?.message?.chat?.id ?? update.message?.chat?.id ?? "");
  const kind = cq ? "callback_query" : update.message ? "message" : "other";

  // 1. persist before acting
  await recordSourceEvent(run, {
    provider: "telegram",
    account: deps.ownerChatId,
    eventId: String(updateId),
    eventType: kind,
    payload: redact(update),
    verified: true,
    ignore: !cq && !update.message?.text,
  });
  const dedupe = await run<{ update_id: string }>(
    `INSERT INTO telegram_updates (update_id, chat_id, kind) VALUES ($1, $2, $3) ON CONFLICT (update_id) DO NOTHING RETURNING update_id`,
    [updateId, chatId || null, kind],
  );
  if (!dedupe.length) {
    const [prev] = await run<{ outcome: string | null; decision_id: string | null }>(`SELECT outcome, decision_id FROM telegram_updates WHERE update_id = $1`, [updateId]);
    if (cq) await deps.answer(cq.id, prev?.outcome ? `Already handled: ${prev.outcome}` : "Already handled.");
    return { handled: true, duplicate: true, outcome: prev?.outcome ?? "duplicate", decisionId: prev?.decision_id ?? null };
  }

  const finish = async (outcome: string, decisionId: string | null, resolution?: ResolveFromChannelResult): Promise<TelegramHandleResult> => {
    await run(`UPDATE telegram_updates SET outcome = $2, decision_id = $3 WHERE update_id = $1`, [updateId, outcome.slice(0, 300), decisionId]);
    return { handled: true, duplicate: false, outcome, decisionId, resolution };
  };

  if (!cq) {
    if (update.message?.text) return handleOwnerMessage(run, update.message, deps, finish);
    return finish("ignored: not a callback", null);
  }

  // 2. only the owner chat, only a human tap on an unforwarded, unedited card
  const fromId = String(cq.from?.id ?? "");
  if (!deps.ownerChatId || chatId !== deps.ownerChatId || fromId !== deps.ownerChatId) {
    await deps.answer(cq.id, "Not allowed.");
    return finish(`refused: chat ${chatId || "?"} / from ${fromId || "?"} is not the owner chat`, null);
  }
  if (cq.from?.is_bot) {
    await deps.answer(cq.id, "Not allowed.");
    return finish("refused: bot sender", null);
  }
  if (cq.message?.forward_date || cq.message?.forward_from) {
    await deps.answer(cq.id, "Forwarded cards cannot be used. Open the original.");
    return finish("refused: forwarded message", null);
  }
  const wi = parseWorkItemCallback(cq.data);
  if (wi) {
    // Performed by the caller after this transaction commits (it sends email
    // through the dispatcher on its own connections).
    const res = await finish(`work item ${wi.verb}: dispatched`, null);
    return { ...res, workItem: { id: wi.workItemId, verb: wi.verb, callbackId: cq.id, chatId, messageId: cq.message?.message_id ?? null } };
  }
  const parsed = parseCallbackData(cq.data);
  if (!parsed) {
    await deps.answer(cq.id, "This button is not recognised.");
    return finish("refused: unrecognised callback data", null);
  }
  const owner = await deps.ownerPrincipal();
  if (!owner) {
    await deps.answer(cq.id, "No active owner account.");
    return finish("refused: no owner principal", parsed.decisionId);
  }
  const decision = await getDecision(run, parsed.decisionId);
  if (!decision) {
    await deps.answer(cq.id, "That decision no longer exists.");
    return finish("refused: unknown decision", parsed.decisionId);
  }
  const hashOk = !parsed.hashPrefix || !decision.content_hash || decision.content_hash.startsWith(parsed.hashPrefix);
  if (!hashOk) {
    await deps.answer(cq.id, "This card is out of date — the package changed. Open the current card in SJC OS.");
    await run(`INSERT INTO decision_events (decision_id, kind, actor, channel, detail) VALUES ($1, 'replay_ignored', 'telegram', 'telegram', '{"reason":"stale button hash"}'::jsonb)`, [decision.id]);
    return finish("refused: stale card hash", decision.id);
  }

  // 3. act
  if (parsed.verb === "changes") {
    // Nothing is pulled yet: the bot asks what should change, and Joe's reply
    // (to that prompt or the card) pulls it with his words attached — the
    // agent gets an instruction, not a bare "changes requested".
    if (decision.status !== "pending") {
      await deps.answer(cq.id, `Already ${decision.status}.`);
      return finish(`changes refused: ${decision.status}`, decision.id);
    }
    await deps.answer(cq.id, "Reply with what should change.");
    const res = await finish("changes: asked what should change", decision.id);
    return { ...res, changesPrompt: { decisionId: decision.id, title: decision.title, callbackId: cq.id, chatId, cardMessageId: cq.message?.message_id ?? null } };
  }
  if (parsed.verb === "hold") {
    const held = await holdDecision(run, decision.id, 4, owner, "Held from Telegram");
    const text = held ? "Held for 4 hours." : `Cannot hold — already ${decision.status}.`;
    await deps.answer(cq.id, text);
    if (held && deps.edit && cq.message) await deps.edit(chatId, cq.message.message_id, cardText({ ...held, status: "pending" }, { appUrl: deps.appUrl }) + "\n(held 4h)");
    return finish(held ? "held 4h" : `hold refused: ${decision.status}`, decision.id);
  }
  const r = await resolveFromChannel(run, {
    decisionId: decision.id,
    contentHash: decision.content_hash,
    via: "telegram",
    principal: owner,
    outcome: "approved",
    note: null,
  });
  const shown = r.decision ?? decision;
  if (deps.deferApproveAnswer && r.ok && r.code === "approved") {
    const res = await finish(r.reply, decision.id, r);
    return { ...res, pendingAnswer: { callbackId: cq.id, text: r.reply, chatId, messageId: cq.message?.message_id ?? null } };
  }
  await deps.answer(cq.id, r.reply);
  if (deps.edit && cq.message) await deps.edit(chatId, cq.message.message_id, cardText(shown, { appUrl: deps.appUrl }));
  return finish(r.reply, decision.id, r);
}

export const REPLY_HELP =
  "To change a request, reply to its card (swipe left on it) and say what should change. " +
  "Your reply pulls the request and goes to the agent that filed it; you'll hear back here.";

type Finish = (outcome: string, decisionId: string | null) => Promise<TelegramHandleResult>;

/** Joe typed into the bot chat. Only the owner, in the owner chat, never a
 *  forward. A reply about a card is recorded and the request pulled in this
 *  transaction; delivery to the agent happens after commit. */
async function handleOwnerMessage(run: Run, m: NonNullable<TelegramUpdate["message"]>, deps: TelegramHandlerDeps, finish: Finish): Promise<TelegramHandleResult> {
  const chatId = String(m.chat?.id ?? "");
  const fromId = String(m.from?.id ?? "");
  if (!deps.ownerChatId || chatId !== deps.ownerChatId || fromId !== deps.ownerChatId || m.from?.is_bot) {
    return finish(`ignored message: chat ${chatId || "?"} / from ${fromId || "?"} is not the owner`, null);
  }
  if (m.forward_date || m.forward_from) return finish("ignored message: forwarded", null);
  const text = String(m.text ?? "").trim().slice(0, 4000);
  const help = async (why: string, line: string) => ({ ...(await finish(why, null)), help: { chatId, messageId: m.message_id, text: line } });
  if (!text || text.startsWith("/")) return help("message: help", REPLY_HELP);

  const { target, open } = await findReplyTarget(run, chatId, m.reply_to_message?.message_id ?? null);
  if (!target) {
    return help(
      "message: no card matched",
      m.reply_to_message
        ? "I can't tie that message to a request. Reply to the request's card itself."
        : open > 1
          ? `${open} requests are open — reply to the card this is about (swipe left on it) so it reaches the right agent.`
          : `Nothing is waiting on you right now. ${REPLY_HELP}`,
    );
  }
  const owner = await deps.ownerPrincipal();
  if (!owner) return help("message: no owner principal", "No active owner account — nothing was changed.");
  const recorded = await recordOwnerReply(run, { decisionId: target.decisionId, text, chatId, messageId: m.message_id, principal: owner });
  const res = await finish(`owner reply ${recorded.id}: ${recorded.route}${recorded.pulled ? ", pulled" : ""}`, recorded.decisionId);
  return { ...res, ownerReply: { ...recorded, chatId, messageId: m.message_id } };
}

/** Store the update without the human-readable message body (the card text
 *  is ours anyway) — ids, verbs and timestamps are what audit needs. */
function redact(u: TelegramUpdate): Record<string, unknown> {
  const cq = u.callback_query;
  return {
    update_id: u.update_id,
    kind: cq ? "callback_query" : u.message ? "message" : "other",
    callback: cq ? { id: cq.id, from: cq.from?.id, chat: cq.message?.chat?.id, message_id: cq.message?.message_id, data: cq.data, forwarded: Boolean(cq.message?.forward_date || cq.message?.forward_from), edited: Boolean(cq.message?.edit_date) } : null,
    // The text itself lives on owner_replies when it is a reply about a card.
    message: u.message ? { message_id: u.message.message_id, from: u.message.from?.id, chat: u.message.chat?.id, reply_to: u.message.reply_to_message?.message_id ?? null, chars: (u.message.text ?? "").length } : null,
  };
}

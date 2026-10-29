// Joe replies to a card from Telegram, against a REAL Postgres
// (lib/decisions/telegram.ts handleOwnerMessage + lib/decisions/owner-replies.ts):
//
//   FIN_TEST_DATABASE_URL=postgresql://… node --test tests/telegram-replies-db.test.mjs
//
// Skipped without that variable. ONE transaction, rolled back (migration 0034
// is applied inside it too — idempotent), so this leaves nothing behind.
//
// Checked:
//   1. "Request changes" no longer pulls the card: it asks what should change.
//   2. A reply to the card pulls it with Joe's words, records the reply, and —
//      when the request names the chat that filed it — closes the operating
//      agent's wake-up for it (the chat handles it).
//   3. A reply to the bot's prompt maps to the same card.
//   4. No chat on the request → the operating agent's wake-up carries Joe's words.
//   5. A plain message with several cards open asks him to reply to one;
//      with exactly one open it goes to that one.
//   6. A stranger's message does nothing.
//   7. A revised request for the same send answers his reply.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFileSync } from "node:fs";
import { stageGrantDecision } from "../lib/decisions/grants.ts";
import { handleTelegramUpdate } from "../lib/decisions/telegram.ts";
import { decisionKeyboard } from "../lib/decisions/keyboards.ts";
import { closeRepliesRevisedBy, rememberReplyTarget } from "../lib/decisions/owner-replies.ts";

const url = process.env.FIN_TEST_DATABASE_URL;

const COLS = `id, status, actions, target_kind, target_id, scope, reason, requested_by, conversation_id, run_id, max_uses, uses,
  to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at, audit`;

test("telegram replies: prompt, pull, route to the asking chat or the operating agent", { skip: !url && "set FIN_TEST_DATABASE_URL to run" }, async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const run = async (sql, params) => (await client.query(sql, params)).rows;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query(readFileSync(new URL("../db/migrations/0034_telegram_replies.sql", import.meta.url), "utf8"));

    const [owner] = await run(`SELECT id, name FROM users WHERE active AND role = 'owner' ORDER BY created_at LIMIT 1`);
    assert.ok(owner, "needs an active owner login");
    const principal = { kind: "user", userId: owner.id, role: "owner", name: owner.name, permissions: [] };
    const chat = "999000222";
    const answers = [];
    const deps = { ownerChatId: chat, ownerPrincipal: async () => principal, answer: async (id, text) => void answers.push([id, text]) };
    let uid = 910000000 + Math.floor(Math.random() * 1e6);
    const msg = (message_id, text, replyTo, from = chat) => ({
      update_id: ++uid,
      message: { message_id, chat: { id: from, type: "private" }, from: { id: from }, text, ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}) },
    });

    // Close any real open cards' visibility for the "only open card" check:
    // everything below is matched by message id except step 5.
    const [conv] = await run(`INSERT INTO ai_conversations (agent, title) VALUES ('claude', 'ZZ reply thread') RETURNING id`);
    const ask = async (target, conversationId, cardMsg) => {
      const [g] = await run(
        `INSERT INTO owner_grants (status, actions, target_kind, target_id, scope, reason, requested_by, conversation_id, max_uses, expires_at)
         VALUES ('requested', '{send_email}', 'email', $1, '{}'::jsonb, 'ZZ reply test', 'zz-agent', $2, 1, now() + interval '1 day')
         RETURNING ${COLS}`,
        [target, conversationId],
      );
      const { decision } = await stageGrantDecision(run, g, { kind: "agent", agent: "zz-agent", runId: null, onBehalfOf: null });
      await run(`INSERT INTO decision_deliveries (decision_id, channel, external_ref, status) VALUES ($1, 'telegram', $2, 'sent')`, [decision.id, `${chat}:${cardMsg}`]);
      return { grant: g, decision };
    };

    // ── 1. Request changes asks, doesn't pull ────────────────────────────
    const a = await ask("zz-a@example.test", conv.id, 501);
    const [, changesBtn] = decisionKeyboard(a.decision.id, a.decision.content_hash)[0];
    const tap = await handleTelegramUpdate(
      run,
      { update_id: ++uid, callback_query: { id: "cbz1", from: { id: chat }, message: { message_id: 501, chat: { id: chat } }, data: changesBtn.callback_data } },
      deps,
    );
    assert.equal(tap.changesPrompt?.decisionId, a.decision.id);
    assert.equal(tap.changesPrompt?.cardMessageId, 501);
    let [da] = await run(`SELECT status FROM decisions WHERE id = $1`, [a.decision.id]);
    assert.equal(da.status, "pending", "the tap alone pulls nothing");

    // ── 3 (setup). the bot's prompt message maps to the card ─────────────
    await rememberReplyTarget(run, { chatId: chat, messageId: 502, decisionId: a.decision.id, kind: "prompt" });

    // ── 2. reply (to the prompt) pulls it, routed to the asking chat ─────
    const r1 = await handleTelegramUpdate(run, msg(503, "Make it Friday, not Thursday", 502), deps);
    assert.ok(r1.ownerReply, r1.outcome);
    assert.equal(r1.ownerReply.decisionId, a.decision.id);
    assert.equal(r1.ownerReply.route, "session");
    assert.equal(r1.ownerReply.conversationId, conv.id);
    assert.equal(r1.ownerReply.pulled, true);
    [da] = await run(`SELECT status, decision_note FROM decisions WHERE id = $1`, [a.decision.id]);
    assert.equal(da.status, "rejected");
    assert.equal(da.decision_note, "Changes requested: Make it Friday, not Thursday");
    const [ga] = await run(`SELECT status FROM owner_grants WHERE id = $1`, [a.grant.id]);
    assert.equal(ga.status, "denied");
    const [wake] = await run(`SELECT state, last_error FROM agent_triggers WHERE kind = 'approval' AND ref = $1`, [`decision:${a.decision.id}:rejected`]);
    assert.ok(wake, "the decision hook enqueued a wake-up");
    assert.equal(wake.state, "done", "…which is closed: the chat that asked handles it");
    const [rowA] = await run(`SELECT body, route, state, message_id::int AS message_id FROM owner_replies WHERE id = $1`, [r1.ownerReply.id]);
    assert.deepEqual(rowA, { body: "Make it Friday, not Thursday", route: "session", state: "received", message_id: 503 });

    // Replying to his own note again lands on the same card (already pulled).
    const r1b = await handleTelegramUpdate(run, msg(504, "Also cc Abigail", 503), deps);
    assert.equal(r1b.ownerReply?.decisionId, a.decision.id);
    assert.equal(r1b.ownerReply?.pulled, false);
    assert.equal(r1b.ownerReply?.priorStatus, "rejected");

    // ── 7. a revised request for the same send answers both replies ──────
    const [fresh] = await run(
      `INSERT INTO owner_grants (status, actions, target_kind, target_id, scope, reason, requested_by, conversation_id, max_uses, expires_at)
       VALUES ('requested', '{send_email}', 'email', 'ZZ-A@example.test', '{}'::jsonb, 'ZZ revised', 'zz-agent', $1, 1, now() + interval '1 day')
       RETURNING id, actions, target_id, conversation_id`,
      [conv.id],
    );
    const closed = await closeRepliesRevisedBy(run, fresh);
    assert.equal(closed.length, 2);
    assert.ok(closed.some((c) => c.message_id === "503"));
    const [ansA] = await run(`SELECT state, answer_kind FROM owner_replies WHERE id = $1`, [r1.ownerReply.id]);
    assert.deepEqual(ansA, { state: "answered", answer_kind: "revised" });

    // ── 4. no chat on the request → the operating agent gets his words ──
    const b = await ask("zz-b@example.test", null, 601);
    const r2 = await handleTelegramUpdate(run, msg(602, "Wrong address — use the office one", 601), deps);
    assert.equal(r2.ownerReply?.route, "agent");
    const [wakeB] = await run(`SELECT state, payload FROM agent_triggers WHERE kind = 'approval' AND ref = $1`, [`decision:${b.decision.id}:rejected`]);
    assert.equal(wakeB.state, "pending");
    assert.equal(wakeB.payload.owner_reply, "Wrong address — use the office one");
    assert.equal(wakeB.payload.owner_reply_id, r2.ownerReply.id);

    // ── 5. plain message: several open → ask; replying to an unknown msg → ask
    const c1 = await ask("zz-c1@example.test", null, 701);
    const c2 = await ask("zz-c2@example.test", null, 702);
    const open = (await run(`SELECT count(*)::int AS n FROM decisions d WHERE d.status = 'pending' AND EXISTS (SELECT 1 FROM decision_deliveries dd WHERE dd.decision_id = d.id AND dd.channel = 'telegram' AND dd.external_ref IS NOT NULL) AND d.created_at > now() - interval '7 days'`))[0].n;
    const plain = await handleTelegramUpdate(run, msg(703, "change it"), deps);
    assert.equal(plain.ownerReply, undefined);
    assert.ok(plain.help, "asked to reply to a card");
    if (open > 1) assert.match(plain.help.text, /reply to the card/);
    const unknown = await handleTelegramUpdate(run, msg(704, "change it", 99999), deps);
    assert.match(unknown.help?.text ?? "", /Reply to the request's card/);
    // with only one open card a plain message goes to it
    await run(`UPDATE decisions SET status = 'expired' WHERE status = 'pending' AND id <> $1`, [c2.decision.id]);
    const single = await handleTelegramUpdate(run, msg(705, "Hold off until Monday"), deps);
    assert.equal(single.ownerReply?.decisionId, c2.decision.id);
    assert.ok(c1);

    // ── 6. a stranger's message does nothing ─────────────────────────────
    const before = (await run(`SELECT count(*)::int AS n FROM owner_replies`))[0].n;
    const stranger = await handleTelegramUpdate(run, msg(706, "approve everything", 601, "12345"), deps);
    assert.equal(stranger.ownerReply, undefined);
    assert.equal(stranger.help, undefined);
    assert.match(stranger.outcome, /not the owner/);
    assert.equal((await run(`SELECT count(*)::int AS n FROM owner_replies`))[0].n, before);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
});

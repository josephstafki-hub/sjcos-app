// Joe replies on Telegram to a STAGED DRAFT card ("Approve & send ✓ / Decline",
// a submit_draft_for_approval work item) — 2026-10-30, migration 0041. Before
// this, only permission cards took replies and a reply to a draft card logged
// "no card matched" (Whitcomb estimate). Disposable harness DB.
//
// Checked:
//   1. A reply to the draft's card pulls it (approval no longer requested, so
//      the old Approve button can't send it) and, with no chat on record,
//      wakes the operating agent with Joe's words + the draft.
//   2. A plain message with exactly one open card goes to that draft; a draft
//      submitted from an in-app chat routes back to that chat.
//   3. A new draft on the same lead answers his open replies, newest first
//      (so the new card threads under his last note).
//   4. A reply to a message that is no card still gets the help line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb } from "./_harness/testdb.mjs";
import { handleTelegramUpdate } from "../lib/decisions/telegram.ts";
import { closeRepliesRevisedByDraft, rememberReplyTarget } from "../lib/decisions/owner-replies.ts";

test("telegram replies reach staged drafts", async () => {
  await withTestDb(async (_url, client) => {
    const run = async (sql, params) => (await client.query(sql, params)).rows;
    await client.query("BEGIN");
    try {
      const [owner] = await run(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-draft-owner@example.test','x','Joe','owner','J') RETURNING id, name`);
      const principal = { kind: "user", userId: owner.id, role: "owner", name: owner.name, permissions: [] };
      const chat = "999000333";
      const deps = { ownerChatId: chat, ownerPrincipal: async () => principal, answer: async () => {} };
      let uid = 920000000;
      const msg = (message_id, text, replyTo) => ({
        update_id: ++uid,
        message: { message_id, chat: { id: chat, type: "private" }, from: { id: chat }, text, ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}) },
      });
      const [lead] = await run(`INSERT INTO leads (slug, name, email) VALUES ('zz-whitcomb', 'ZZ Whitcomb', 'zz-rob@example.test') RETURNING id`);
      const draftItem = async (title, origin, cardMsg) => {
        const [w] = await run(
          `INSERT INTO work_items (title, status, approval_status, requires_approval, lead_id, source_kind, created_by)
           VALUES ($1, 'approval_needed', 'requested', true, $2, 'agent', 'zz-agent') RETURNING id`,
          [title, lead.id],
        );
        const [k] = await run(`INSERT INTO knowledge_items (content, kind, source, lead_id, created_by) VALUES ($1, 'draft', 'agent', $2, 'agent') RETURNING id`, [
          `To: zz-rob@example.test\nSubject: ${title}\n\nHi Rob, $2,200 to $3,200.`,
          lead.id,
        ]);
        await run(`INSERT INTO agent_receipts (work_item_id, receipt_kind, uri, label, metadata) VALUES ($1, 'draft', $2, 'draft ready', $3::jsonb)`, [
          w.id,
          `knowledge_items/${k.id}`,
          JSON.stringify(origin),
        ]);
        await rememberReplyTarget(run, { chatId: chat, messageId: cardMsg, workItemId: w.id, kind: "card" });
        return w;
      };

      // ── 1. reply to the card → pulled, operating agent woken ────────────
      const a = await draftItem("ZZ rough estimate email", {}, 366);
      const r1 = await handleTelegramUpdate(run, msg(369, "make it a single flat number with 25% profit", 366), deps);
      assert.ok(r1.ownerReply, r1.outcome);
      assert.equal(r1.ownerReply.workItemId, a.id);
      assert.equal(r1.ownerReply.decisionId, null);
      assert.equal(r1.ownerReply.route, "agent");
      assert.equal(r1.ownerReply.pulled, true);
      assert.equal(r1.ownerReply.title, "ZZ rough estimate email");
      const [wa] = await run(`SELECT approval_status, status, blocked_reason FROM work_items WHERE id = $1`, [a.id]);
      assert.equal(wa.approval_status, "not_requested", "the old card's Approve can no longer send it");
      assert.equal(wa.status, "in_progress");
      assert.match(wa.blocked_reason, /single flat number/);
      const [trig] = await run(`SELECT kind, lead_id, payload FROM agent_triggers WHERE id = $1`, [r1.ownerReply.triggerId]);
      assert.equal(trig.kind, "message");
      assert.equal(trig.lead_id, lead.id);
      assert.equal(trig.payload.owner_reply, "make it a single flat number with 25% profit");
      assert.equal(trig.payload.owner_reply_id, r1.ownerReply.id);
      assert.equal(trig.payload.work_item_id, a.id);
      assert.match(trig.payload.draft_text, /\$2,200 to \$3,200/);
      assert.match(trig.payload.owner_reply_how, new RegExp(`submit_draft_for_approval on work item ${a.id}`));
      const [rowA] = await run(`SELECT work_item_id, decision_id, route, state FROM owner_replies WHERE id = $1`, [r1.ownerReply.id]);
      assert.deepEqual(rowA, { work_item_id: a.id, decision_id: null, route: "agent", state: "received" });

      // Replying to his own note lands on the same draft (already pulled).
      const r1b = await handleTelegramUpdate(run, msg(371, "and the garage isn't heated", 369), deps);
      assert.equal(r1b.ownerReply?.workItemId, a.id);
      assert.equal(r1b.ownerReply?.pulled, false);
      assert.equal(r1b.ownerReply?.priorStatus, "not_requested");

      // ── 2. plain message, one open draft, filed from an in-app chat ─────
      const [conv] = await run(`INSERT INTO ai_conversations (agent, title) VALUES ('claude', 'ZZ draft thread') RETURNING id`);
      const b = await draftItem("ZZ follow-up email", { conversation_id: conv.id }, 380);
      const r2 = await handleTelegramUpdate(run, msg(381, "shorter please"), deps);
      assert.equal(r2.ownerReply?.workItemId, b.id, r2.outcome);
      assert.equal(r2.ownerReply?.route, "session");
      assert.equal(r2.ownerReply?.conversationId, conv.id);
      assert.equal(r2.ownerReply?.triggerId, null, "the chat handles it, no operating-agent wake-up");

      // ── 3. a new draft on the same lead answers his open replies ────────
      const c = await draftItem("ZZ revised estimate email", {}, 390);
      const closed = await closeRepliesRevisedByDraft(run, c.id);
      assert.equal(closed.length, 3);
      assert.equal(closed[0].message_id, "381", "newest first: the new card threads under his last note");
      const [ansA] = await run(`SELECT state, answer_kind FROM owner_replies WHERE id = $1`, [r1.ownerReply.id]);
      assert.deepEqual(ansA, { state: "answered", answer_kind: "revised" });
      assert.equal((await closeRepliesRevisedByDraft(run, c.id)).length, 0, "only once");

      // ── 4. a reply to a message that is no card ─────────────────────────
      const unknown = await handleTelegramUpdate(run, msg(395, "change it", 99999), deps);
      assert.equal(unknown.ownerReply, undefined);
      assert.match(unknown.help?.text ?? "", /Reply to the request's card/);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
    }
  });
});

// Notifications v2 + send-on-approval, against a REAL Postgres
// (db/apply-notifications-v2.mjs, lib/decisions/telegram.ts). Same harness as
// work-item-archive-db.test.mjs:
//
//   FIN_TEST_DATABASE_URL=postgresql://… node --test tests/notifications-v2-db.test.mjs
//
// Skipped without that variable. Everything happens inside ONE transaction
// that is rolled back — the migration is applied inside it too (idempotent),
// so this leaves nothing behind.
//
// Checked:
//   1. A lead / project stage change files one feed card, attributed when the
//      writer set sjcos.actor_user_id (lib/db.ts queryAs), unattributed when not.
//   2. A Telegram Approve on a permission request settles the grant, wakes the
//      sends parked on the GRANT (they used to stay held), defers the phone's
//      answer so it can say what was sent, and the decision trigger marks the
//      bell card resolved.
//   3. A work-item approval card resolves when approval_status leaves 'requested'.
//   4. A work-item Telegram tap is handed back to the caller, not acted on in
//      the transaction.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { STATEMENTS } from "../db/apply-notifications-v2.mjs";
import { stageGrantDecision } from "../lib/decisions/grants.ts";
import { handleTelegramUpdate } from "../lib/decisions/telegram.ts";
import { decisionKeyboard, workItemKeyboard } from "../lib/decisions/keyboards.ts";

const url = process.env.FIN_TEST_DATABASE_URL;

test("notifications v2: stage cards, Telegram approve wakes grant sends, cards resolve", { skip: !url && "set FIN_TEST_DATABASE_URL to run" }, async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const run = async (sql, params) => (await client.query(sql, params)).rows;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '3s'");
    for (const sql of STATEMENTS) await client.query(sql);

    const [owner] = await run(`SELECT id, name FROM users WHERE active AND role = 'owner' ORDER BY created_at LIMIT 1`);
    assert.ok(owner, "needs an active owner login");

    // ── 1. stage-change cards ────────────────────────────────────────────
    const [lead] = await run(
      `INSERT INTO leads (slug, name, stage) VALUES ('zz-notif-v2-lead', 'ZZ Notif Lead', 'intake') RETURNING id`,
    );
    await run(`SELECT set_config('sjcos.actor_user_id', $1, true)`, [owner.id]);
    await run(`UPDATE leads SET stage = 'qualified' WHERE id = $1`, [lead.id]);
    await run(`UPDATE leads SET stage = 'qualified' WHERE id = $1`, [lead.id]); // no-op: no second card
    let cards = await run(`SELECT title, subline, actor_user_id, ref, href FROM notifications WHERE ref = $1`, [`lead:${lead.id}`]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].title, "ZZ Notif Lead → Qualified");
    assert.match(cards[0].subline, new RegExp(`Lead moved from Intake · by ${owner.name}`));
    assert.equal(cards[0].actor_user_id, owner.id);
    assert.equal(cards[0].href, "/leads/zz-notif-v2-lead");

    await run(`SELECT set_config('sjcos.actor_user_id', '', true)`);
    await run(`UPDATE leads SET stage = 'lost' WHERE id = $1`, [lead.id]);
    cards = await run(`SELECT title, subline, actor_user_id FROM notifications WHERE ref = $1 ORDER BY created_at DESC, title`, [`lead:${lead.id}`]);
    const lost = cards.find((c) => c.title.endsWith("Lost / Archived"));
    assert.ok(lost, "lost card filed");
    assert.equal(lost.actor_user_id, null, "an agent/timer write is unattributed");
    assert.doesNotMatch(lost.subline, /· by/);

    const [proj] = await run(
      `INSERT INTO projects (slug, name, status) VALUES ('zz-notif-v2-proj', 'ZZ Notif Project', 'bidding') RETURNING id`,
    );
    await run(`UPDATE projects SET status = 'construction_contract' WHERE id = $1`, [proj.id]);
    const pc = await run(`SELECT title FROM notifications WHERE ref = $1`, [`project:${proj.id}`]);
    assert.deepEqual(pc.map((c) => c.title), ["ZZ Notif Project → Construction contract"]);

    // ── 2. Telegram Approve on a staged permission request ─────────────────
    const staged = { action: "send_email", target_id: "zz-scott@example.test", email: { to: "zz-scott@example.test", subject: "ZZ numbers", body: "Hi" } };
    const [grant] = await run(
      `INSERT INTO owner_grants (status, actions, target_kind, target_id, scope, reason, requested_by, max_uses, expires_at)
       VALUES ('requested', '{send_email}', 'email', 'zz-scott@example.test', $1::jsonb, 'ZZ test', 'zz-agent', 1, now() + interval '1 day')
       RETURNING id, status, actions, target_kind, target_id, scope, reason, requested_by, max_uses, uses,
                 to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at, audit`,
      [JSON.stringify({ to: "zz-scott@example.test", staged })],
    );
    const { decision } = await stageGrantDecision(run, grant, { kind: "agent", agent: "zz-agent", runId: null, onBehalfOf: null });
    assert.match(String(decision.summary.effect), /Approving does it now: Sends the email to zz-scott@example.test/);
    assert.equal(decision.summary.message, "Hi");
    await run(
      `INSERT INTO notifications (kind, tag, title, ref) VALUES ('decision', 'Permission', 'ZZ ask', $1)`,
      [`decision:${decision.id}`],
    );
    // a send already parked on the grant (an agent called send_email early)
    const [parked] = await run(
      `INSERT INTO action_intents (operation_key, kind, target_kind, target_id, recipient, payload, payload_hash, grant_id, state, hold_reason)
       VALUES ('zz:notif-v2:parked', 'send_email', 'email', 'zz-scott@example.test', 'zz-scott@example.test', '{}'::jsonb, 'zz', $1, 'held', 'awaiting grant')
       RETURNING id`,
      [grant.id],
    );

    const chat = "999000111";
    const answers = [];
    const [[approveBtn]] = decisionKeyboard(decision.id, decision.content_hash);
    const updateId = 900000000 + Math.floor(Math.random() * 1e6);
    const res = await handleTelegramUpdate(
      run,
      { update_id: updateId, callback_query: { id: "cb1", from: { id: chat }, message: { message_id: 5, chat: { id: chat } }, data: approveBtn.callback_data } },
      {
        ownerChatId: chat,
        ownerPrincipal: async () => ({ kind: "user", userId: owner.id, role: "owner", name: owner.name, permissions: [] }),
        answer: async (id, text) => void answers.push([id, text]),
        deferApproveAnswer: true,
      },
    );
    assert.equal(res.resolution?.ok, true, res.outcome);
    assert.equal(res.resolution.code, "approved");
    assert.equal(res.resolution.grantId, grant.id);
    assert.ok(res.resolution.intentIds.includes(parked.id), "the grant-parked send is woken");
    assert.equal(answers.length, 0, "answer deferred until the send ran");
    assert.equal(res.pendingAnswer?.callbackId, "cb1");
    const [g2] = await run(`SELECT status FROM owner_grants WHERE id = $1`, [grant.id]);
    assert.equal(g2.status, "approved");
    const [i2] = await run(`SELECT state FROM action_intents WHERE id = $1`, [parked.id]);
    assert.equal(i2.state, "pending");
    const [n2] = await run(`SELECT resolved_at IS NOT NULL AS resolved, resolution FROM notifications WHERE ref = $1`, [`decision:${decision.id}`]);
    assert.deepEqual(n2, { resolved: true, resolution: "approved" });

    // a repeat tap is answered, never re-applied
    const again = await handleTelegramUpdate(
      run,
      { update_id: updateId, callback_query: { id: "cb2", from: { id: chat }, message: { message_id: 5, chat: { id: chat } }, data: approveBtn.callback_data } },
      { ownerChatId: chat, ownerPrincipal: async () => null, answer: async (id, text) => void answers.push([id, text]), deferApproveAnswer: true },
    );
    assert.equal(again.duplicate, true);

    // ── 3. work-item approval card resolves ───────────────────────────────
    const [wi] = await run(
      `INSERT INTO work_items (title, approval_status, status) VALUES ('ZZ approve me', 'requested', 'approval_needed') RETURNING id`,
    );
    await run(`INSERT INTO notifications (kind, tag, title, ref) VALUES ('decision', 'Approval', 'Approve: ZZ approve me', $1)`, [`work_item:${wi.id}`]);
    // approve → send failed → gate reopened: the card follows both moves
    await run(`UPDATE work_items SET approval_status = 'approved' WHERE id = $1`, [wi.id]);
    await run(`UPDATE work_items SET approval_status = 'requested' WHERE id = $1`, [wi.id]);
    const [reopened] = await run(`SELECT resolved_at FROM notifications WHERE ref = $1`, [`work_item:${wi.id}`]);
    assert.equal(reopened.resolved_at, null, "a reopened gate reopens its card");
    await run(`UPDATE work_items SET approval_status = 'rejected', status = 'cancelled' WHERE id = $1`, [wi.id]);
    const [n3] = await run(`SELECT resolution FROM notifications WHERE ref = $1`, [`work_item:${wi.id}`]);
    assert.equal(n3.resolution, "rejected");

    // ── 4. work-item Telegram tap is handed back ──────────────────────────
    const [[wiApprove]] = workItemKeyboard(wi.id);
    const w = await handleTelegramUpdate(
      run,
      { update_id: updateId + 1, callback_query: { id: "cb3", from: { id: chat }, message: { message_id: 6, chat: { id: chat } }, data: wiApprove.callback_data } },
      { ownerChatId: chat, ownerPrincipal: async () => null, answer: async (id, text) => void answers.push([id, text]) },
    );
    assert.deepEqual(w.workItem && { id: w.workItem.id, verb: w.workItem.verb }, { id: wi.id, verb: "approve" });
    // …and a stranger's tap on it is refused before that
    const stranger = await handleTelegramUpdate(
      run,
      { update_id: updateId + 2, callback_query: { id: "cb4", from: { id: "1" }, message: { message_id: 6, chat: { id: "1" } }, data: wiApprove.callback_data } },
      { ownerChatId: chat, ownerPrincipal: async () => null, answer: async (id, text) => void answers.push([id, text]) },
    );
    assert.equal(stranger.workItem, undefined);
    assert.match(stranger.outcome, /refused/);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
});

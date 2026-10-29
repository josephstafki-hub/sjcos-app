import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { handleTelegramUpdate } from "../lib/decisions/telegram.ts";

// Every Telegram update is filed in source_events before it is acted on, and
// the webhook handler IS its processing: no worker claims provider
// "telegram". The row must be closed ('done') once handled, or it sits
// 'pending' forever and the health monitor reports a stuck queue. That
// happened 2026-10-10..10-29: 15 taps, all handled, all still pending.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

test("a handled Telegram update closes its source_events row; a repeat leaves it closed", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    await client.query(`TRUNCATE telegram_updates`);
    const run = async (s, p) => (await client.query(s, p)).rows;
    const answers = [];
    const deps = {
      ownerChatId: "1000",
      ownerPrincipal: async () => null,
      answer: async (_id, text) => answers.push(text),
      edit: async () => undefined,
      appUrl: "https://os.example.com",
    };
    // A tap from a chat that is not Joe's: refused, but handled.
    const tap = { update_id: 777001, callback_query: { id: "cq1", data: "x", from: { id: 2000 }, message: { message_id: 5, chat: { id: 2000 } } } };
    const r = await handleTelegramUpdate(run, tap, deps);
    assert.equal(r.handled, true);
    assert.match(r.outcome, /^refused/);
    const [row] = await run(`SELECT state, processed_at FROM source_events WHERE provider = 'telegram' AND event_id = '777001'`);
    assert.equal(row.state, "done");
    assert.ok(row.processed_at);

    // Telegram re-delivers the same update: answered, not re-applied, still done.
    const again = await handleTelegramUpdate(run, tap, deps);
    assert.equal(again.duplicate, true);
    const [row2] = await run(`SELECT state FROM source_events WHERE provider = 'telegram' AND event_id = '777001'`);
    assert.equal(row2.state, "done");

    // A non-callback, non-text update is filed as ignored and stays ignored.
    await handleTelegramUpdate(run, { update_id: 777002, edited_message: {} }, deps);
    const [row3] = await run(`SELECT state FROM source_events WHERE provider = 'telegram' AND event_id = '777002'`);
    assert.equal(row3.state, "ignored");

    const [left] = await run(`SELECT count(*)::int n FROM source_events WHERE provider = 'telegram' AND state = 'pending'`);
    assert.equal(left.n, 0, "nothing is left for a worker that will never come");
  });
});

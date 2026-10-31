import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { fileEmailWorkItem, settleEmailReplies } from "../lib/obligations/email.ts";

// Tier 3 A01: an email to-do is keyed on its Gmail message; the same email
// filed twice is one to-do; our reply on the thread resolves the obligation
// and completes the to-do with that as evidence.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

test("email to-dos: one per message; a reply on the thread closes it, a newer message from them doesn't", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (s, p) => (await client.query(s, p)).rows;
    await cleanFoundation(client);
    await client.query(`TRUNCATE obligations RESTART IDENTITY CASCADE`);
    await client.query(`DELETE FROM work_items WHERE source_kind = 'email'`);

    const a = await fileEmailWorkItem(run, { email: { messageId: "m-100", threadId: "t-1", from: "pat@example.test" }, title: "Answer Pat about the tile order" });
    assert.equal(a.duplicate, false);
    const again = await fileEmailWorkItem(run, { email: { messageId: "m-100", threadId: "t-1" }, title: "Answer Pat about the tile order (re-read)" });
    assert.equal(again.duplicate, true);
    assert.equal(again.id, a.id);
    assert.equal((await run(`SELECT count(*)::int AS n FROM work_items WHERE source_kind = 'email'`))[0].n, 1);
    const b = await fileEmailWorkItem(run, { email: { messageId: "m-200", threadId: "t-2" }, title: "Send Lee the schedule" });

    // Thread t-2: the latest message is still theirs → nothing closes.
    let s = await settleEmailReplies(run, [{ id: "t-2", outbound: false, date: Date.now() }], "test");
    assert.deepEqual(s, { resolved: 0, closedItems: 0 });
    // Thread t-1: Joe replied → obligation done, to-do done with a receipt.
    s = await settleEmailReplies(run, [{ id: "t-1", outbound: true, date: Date.now() }, { id: "t-9", outbound: true, date: Date.now() }], "test");
    assert.deepEqual(s, { resolved: 1, closedItems: 1 });
    const [wi] = await run(`SELECT status FROM work_items WHERE id = $1`, [a.id]);
    assert.equal(wi.status, "done");
    const [rc] = await run(`SELECT receipt_kind, label FROM agent_receipts WHERE work_item_id = $1`, [a.id]);
    assert.deepEqual([rc.receipt_kind, rc.label], ["business_response", "Replied by email"]);
    assert.equal((await run(`SELECT status FROM work_items WHERE id = $1`, [b.id]))[0].status !== "done", true);
    // Replaying the same scan changes nothing.
    assert.deepEqual(await settleEmailReplies(run, [{ id: "t-1", outbound: true, date: Date.now() }], "test"), { resolved: 0, closedItems: 0 });
  });
});

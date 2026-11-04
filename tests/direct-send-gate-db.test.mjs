import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { directSendBlocked, ambiguousSendError } from "../lib/direct-send-gate.ts";

// Tier 4: the five direct-to-Gmail paths ask here first. A paused lane or an
// opted-out address gets nothing; an error after Gmail may have sent it is
// "unknown", never retried on its own.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

test("direct sends honour lane pauses and opt-outs", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (s, p) => (await client.query(s, p)).rows;
    await cleanFoundation(client);
    await client.query(`DELETE FROM lane_pauses`);
    await client.query(`DELETE FROM communication_optouts WHERE address LIKE 'zz-%'`);
    assert.equal(await directSendBlocked(run, { lane: "sends", to: "zz-a@example.test" }), null);
    await run(`INSERT INTO lane_pauses (lane, paused_by, reason) VALUES ('sends', 'test', 'audit')`);
    assert.match(await directSendBlocked(run, { lane: "sends", to: "zz-a@example.test" }), /paused \(sends lane: audit\)/);
    assert.equal(await directSendBlocked(run, { lane: "publication", to: "zz-a@example.test" }), null, "another lane is unaffected");
    await run(`INSERT INTO lane_pauses (lane, paused_by, reason) VALUES ('all', 'test', 'everything off')`);
    assert.match(await directSendBlocked(run, { lane: "publication", to: "zz-a@example.test" }), /all lane/);
    await run(`DELETE FROM lane_pauses`);
    await run(`INSERT INTO communication_optouts (channel, address, reason) VALUES ('email', 'zz-b@example.test', 'unsubscribed')`);
    assert.match(await directSendBlocked(run, { lane: "sends", to: "ZZ-B@example.test " }), /asked not to get email \(unsubscribed\)/);
    await run(`UPDATE communication_optouts SET revoked_at = now() WHERE address = 'zz-b@example.test'`);
    assert.equal(await directSendBlocked(run, { lane: "sends", to: "zz-b@example.test" }), null);
  });
});

test("ambiguous send errors: timeouts, resets and 5xx may have sent; a 4xx refusal didn't", () => {
  assert.equal(ambiguousSendError(Object.assign(new Error("connect"), { code: "ECONNRESET" })), true);
  assert.equal(ambiguousSendError(new Error("Request timed out after 30000ms")), true);
  assert.equal(ambiguousSendError(Object.assign(new Error("Backend Error"), { status: 503 })), true);
  assert.equal(ambiguousSendError(Object.assign(new Error("Invalid To header"), { status: 400 })), false);
  assert.equal(ambiguousSendError(new Error("Recipient address rejected")), false);
});

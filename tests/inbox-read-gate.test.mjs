import { test } from "node:test";
import assert from "node:assert/strict";
const { withReadGate } = await import("../lib/inbox-read-gate.ts");

test("no more than two reads run at once per mailbox; others queue and all finish", async () => {
  let running = 0, peak = 0;
  const job = () => withReadGate("html:joe", async () => {
    running++; peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 5));
    running--; return "ok";
  });
  const results = await Promise.all(Array.from({ length: 7 }, job));
  assert.equal(peak, 2);
  assert.deepEqual(results, Array(7).fill("ok"));
});
test("separate mailboxes don't wait on each other, and a failure frees its slot", async () => {
  let peak = 0, running = 0;
  const run = key => withReadGate(key, async () => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 5)); running--; });
  await Promise.all([run("a"), run("a"), run("b"), run("b")]);
  assert.equal(peak, 4);
  await assert.rejects(withReadGate("c", async () => { throw new Error("quota"); }), /quota/);
  assert.equal(await withReadGate("c", async () => "next", 1), "next");
});

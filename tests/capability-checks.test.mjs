// lib/measure/capability-checks.ts — the ledger's automatic evidence, with a
// fake database and probe (no Postgres needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITY_CHECKS, deriveCapabilities } from "../lib/measure/capability-checks.ts";
import { CAPABILITIES } from "../lib/measure/capabilities.ts";

function fakeRun(answers) {
  return async (sql) => {
    for (const [frag, rows] of answers) {
      if (sql.includes(frag)) {
        if (rows instanceof Error) throw rows;
        return rows;
      }
    }
    return [{ n: 0, sample: null, last: null }];
  };
}

const probe = (over = {}) => ({
  deployedVersion: async () => "BUILD123 (main abc1234)",
  timerActive: async () => true,
  configured: () => true,
  migrationFiles: async () => ["0000_a.sql", "0001_b.sql"],
  ...over,
});

test("every catalogue capability has a check entry (even if it has no automatic proof)", () => {
  for (const c of CAPABILITIES) assert.ok(c.key in CAPABILITY_CHECKS, `${c.key} missing from CAPABILITY_CHECKS`);
});

test("not deployed: no deployed or enabled claim at all", async () => {
  const [d] = await deriveCapabilities(fakeRun([]), probe({ deployedVersion: async () => null }), ["A01"]);
  assert.equal(d.deployed, null);
  assert.equal(d.enabled, null);
});

test("no-switch capabilities are enabled when deployed; proof needs real cases", async () => {
  const run = fakeRun([["FROM obligations", [{ n: 3, sample: "ob-1", last: "2026-10-30 10:00" }]]]);
  const [d] = await deriveCapabilities(run, probe(), ["A01"]);
  assert.deepEqual(d.deployed, { on: true, note: "live build BUILD123 (main abc1234)" });
  assert.equal(d.enabled.on, true);
  assert.equal(d.proven.on, true);
  assert.match(d.proven.note, /^3 obligations resolved; e\.g\. ob-1; latest 2026-10-30$/);
  const [none] = await deriveCapabilities(fakeRun([]), probe(), ["A01"]);
  assert.equal(none.proven.on, false, "zero cases is not proof");
});

test("policy switch: off when the policy isn't active, on when it is", async () => {
  const off = fakeRun([["FROM policies", [{ key: "weekly.client_summary", state: "draft", version: 1 }]]]);
  const [d] = await deriveCapabilities(off, probe(), ["A16"]);
  assert.equal(d.enabled.on, false);
  assert.match(d.enabled.note, /not active \(weekly\.client_summary: draft\)/);
  const on = fakeRun([["FROM policies", [{ key: "weekly.client_summary", state: "active", version: 2 }]]]);
  assert.equal((await deriveCapabilities(on, probe(), ["A16"]))[0].enabled.on, true);
});

test("a stopped timer turns enabled off; an unreadable one makes no claim", async () => {
  const [stopped] = await deriveCapabilities(fakeRun([]), probe({ timerActive: async (u) => u !== "sjcos-dispatch.timer" }), ["feature.dispatcher"]);
  assert.equal(stopped.enabled.on, false);
  assert.match(stopped.enabled.note, /sjcos-dispatch\.timer not running/);
  const [unknown] = await deriveCapabilities(fakeRun([]), probe({ timerActive: async () => null }), ["feature.dispatcher"]);
  assert.equal(unknown.enabled, null);
});

test("a query that fails (missing table / no permission) makes no claim", async () => {
  const run = fakeRun([["FROM invoice_payments", new Error("permission denied")]]);
  const [d] = await deriveCapabilities(run, probe(), ["A20"]);
  assert.equal(d.proven, null);
});

test("A00: proven only when every migration file is applied", async () => {
  const some = fakeRun([["FROM schema_migrations", [{ name: "0000_a.sql" }]]]);
  const [d] = await deriveCapabilities(some, probe(), ["A00"]);
  assert.equal(d.proven.on, false);
  assert.match(d.proven.note, /1 migration\(s\) not applied: 0001_b\.sql/);
  const every = fakeRun([["FROM schema_migrations", [{ name: "0000_a.sql" }, { name: "0001_b.sql" }]]]);
  assert.equal((await deriveCapabilities(every, probe(), ["A00"]))[0].proven.on, true);
});

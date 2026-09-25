import { test } from "node:test";
import assert from "node:assert/strict";
import { harnessAvailable } from "./_harness/testdb.mjs";
import { loadScenarios, runScenario, FAKE_RUNNERS, summarize } from "../scripts/run-evals.mjs";

// A24 / V46 harness proof: every scenario seeds, runs through the real worker
// path (instructions + scoped context + task), records versions/trace, and its
// MANDATORY checks reject a runner that "sends", "pays" and decides snags on
// its own. No model runs here; real-model results live in evals/results/.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

test("every eval scenario loads, seeds and fails the naughty runner on a mandatory check", { skip }, async () => {
  const scenarios = await loadScenarios();
  assert.ok(scenarios.length >= 8, `expected ≥8 scenarios, got ${scenarios.length}`);
  const ids = new Set();
  for (const s of scenarios) {
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    ids.add(s.id);
    assert.ok(Array.isArray(s.validation) && s.validation.length, `${s.id} names its VALIDATION checks`);
    assert.ok(s.checks.some((c) => c.mandatory), `${s.id} has a mandatory check`);
    const bad = await runScenario(s, FAKE_RUNNERS.naughty, { model: "fake", dbName: `evalt_bad_${s.id.replace(/[^a-z0-9]/g, "_")}` });
    assert.equal(bad.error, null, `${s.id} seeded/ran without error: ${bad.error}`);
    assert.equal(bad.pass, false, `${s.id}: naughty runner must not pass`);
    assert.ok(bad.mandatory_failed.length > 0, `${s.id}: a MANDATORY check caught the naughty runner (${JSON.stringify(bad.checks)})`);
    assert.equal(bad.execution.runtime, "fake-naughty");
    assert.ok(bad.execution.instruction_versions.operating_block.checksum, `${s.id}: loaded instruction versions recorded`);
    assert.ok(bad.execution.tool_list_checksum, `${s.id}: tool-list checksum recorded`);
    assert.deepEqual(bad.execution.tool_names, ["send_email", "execute_approved_payment", "apply_snag_decision"]);
  }
  const summary = summarize([]);
  assert.equal(summary.suite_pass, false, "an empty run is not a pass");
});

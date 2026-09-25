import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUSINESS_DISALLOWED_TOOLS,
  BUSINESS_DOCS_DIR,
  assertBusinessArgs,
  argsGrantRepoAccess,
  parseThreshold,
  permissionModeFor,
  profileArgs,
  profileFor,
  profilePromptLine,
  runAdmission,
} from "../lib/authority/run-profile.mjs";
import { WORKERS, assertWorkerMay, workerMayUseLane, workerPrincipal, WorkerScopeError } from "../lib/authority/worker-identity.ts";
import { AUTHORITY_ACTIONS, DELEGABLE_ACTIONS, authorityForGatedAction, isAuthorityActionType } from "../lib/authority/catalog.ts";

// A08a / A08b pure checks (V12, V27): what a business-profile run is spawned
// with, who may start what, and the finite limits — none of it prompt text.

const REPO = "/srv/sjcos-app";

test("profileFor: staff and unattended runs are business; only an active owner gets operator", () => {
  assert.equal(profileFor({ role: "staff", active: true }, "operator"), "business", "staff asking for operator still gets business");
  assert.equal(profileFor({ role: "staff", active: true }, undefined), "business");
  assert.equal(profileFor(null, "operator"), "business", "nobody behind the run → business");
  assert.equal(profileFor({ role: "owner", active: false }, undefined), "business", "disabled owner row → business");
  assert.equal(profileFor({ role: "owner", active: true }, undefined), "operator");
  assert.equal(profileFor({ role: "owner", active: true }, "business"), "business", "owner may opt into a business run");
  assert.equal(profileFor({ role: "client", active: true }, "operator"), "business");
});

test("business profile args: --restricted, disallowed tools, docs-only --add-dir, scratch cwd, finite limits", () => {
  const p = profileArgs("business", { repo: REPO, scratchDir: "/tmp/sjcos-agent-x", maxBudgetUsd: 2.5 });
  assert.ok(p.args.includes("--restricted"));
  const i = p.args.indexOf("--disallowedTools");
  assert.ok(i >= 0);
  const disallowed = p.args[i + 1].split(" ");
  for (const t of ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch"]) assert.ok(disallowed.includes(t), `${t} disallowed`);
  assert.deepEqual(disallowed, [...BUSINESS_DISALLOWED_TOOLS]);
  assert.equal(argsGrantRepoAccess(p.args, REPO), false, "no repo-wide --add-dir");
  const d = p.args.indexOf("--add-dir");
  assert.equal(p.args[d + 1], `${REPO}/${BUSINESS_DOCS_DIR}`);
  assert.equal(p.cwd, "/tmp/sjcos-agent-x");
  assert.equal(p.maxTurns, 60);
  assert.equal(p.timeoutMs, 20 * 60 * 1000);
  assert.deepEqual(p.args.slice(p.args.indexOf("--max-budget-usd"), p.args.indexOf("--max-budget-usd") + 2), ["--max-budget-usd", "2.5"]);
  assert.doesNotThrow(() => assertBusinessArgs(p.args, REPO));
});

test("operator profile keeps the repo and no caps; business self-check refuses a repo --add-dir", () => {
  const o = profileArgs("operator", { repo: REPO });
  assert.deepEqual(o.args, ["--add-dir", REPO]);
  assert.equal(o.cwd, REPO);
  assert.equal(o.maxTurns, null);
  assert.equal(o.timeoutMs, null);
  assert.throws(() => assertBusinessArgs([...profileArgs("business", { repo: REPO, scratchDir: "/tmp/x" }).args, "--add-dir", REPO], REPO), /repo --add-dir/);
  assert.throws(() => assertBusinessArgs(["--disallowedTools", "Bash Write Edit"], REPO), /--restricted/);
  assert.throws(() => assertBusinessArgs(["--restricted", "--disallowedTools", "Bash Write"], REPO), /Edit not disallowed/);
});

test("business runs cannot run bypassPermissions / auto / dontAsk; owner modes pass through", () => {
  assert.equal(permissionModeFor("business", "bypassPermissions"), "acceptEdits");
  assert.equal(permissionModeFor("business", "auto"), "acceptEdits");
  assert.equal(permissionModeFor("business", "plan"), "plan");
  assert.equal(permissionModeFor("operator", "bypassPermissions"), "bypassPermissions");
});

test("usage thresholds: business run refused past the hourly cap, owner run only warned, unset = open", () => {
  assert.equal(parseThreshold(""), null);
  assert.equal(parseThreshold("0"), null);
  assert.equal(parseThreshold("abc"), null);
  assert.equal(parseThreshold(" 12 "), 12);
  assert.deepEqual(runAdmission({ profile: "business", runsLastHour: 5, maxRunsPerHour: null }), { ok: true, warning: null });
  const refused = runAdmission({ profile: "business", runsLastHour: 12, maxRunsPerHour: 12 });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /cap reached/);
  const warned = runAdmission({ profile: "operator", runsLastHour: 12, maxRunsPerHour: 12 });
  assert.equal(warned.ok, true);
  assert.match(warned.warning, /cap reached/);
  assert.equal(runAdmission({ profile: "business", runsLastHour: 11, maxRunsPerHour: 12 }).ok, true);
});

test("profile prompt line states the profile (informational only)", () => {
  assert.match(profilePromptLine("business"), /NO shell, NO file editing/);
  assert.match(profilePromptLine("operator"), /operator/);
});

test("worker identities: least privilege per worker, unknown worker refused", () => {
  assert.ok(assertWorkerMay("dispatch", "send_email"));
  assert.throws(() => assertWorkerMay("monitor", "send_email"), WorkerScopeError);
  assert.throws(() => assertWorkerMay("business-agent-worker", "send_invoice"), WorkerScopeError, "the agent worker cannot dispatch sends itself");
  assert.throws(() => assertWorkerMay("nobody", "send_email"), WorkerScopeError);
  assert.equal(workerMayUseLane("backup", "backup"), true);
  assert.equal(workerMayUseLane("backup", "sends"), false);
  assert.deepEqual(workerPrincipal("dispatch"), { kind: "service", name: "worker:dispatch" });
  for (const w of Object.values(WORKERS)) assert.ok(["sjcos_worker", "sjcos_agent", "sjcos_readonly", "sjcos_backup"].includes(w.dbRole));
});

test("authority catalog: DECISIONS.md kinds present, 'grant' never delegable, gated actions map to kinds", () => {
  for (const k of ["package_release", "proposal", "purchase", "payment", "refund", "publication", "schedule", "funding", "markup", "change_order", "design_package", "grant"]) {
    assert.ok(isAuthorityActionType(k), k);
  }
  assert.equal(AUTHORITY_ACTIONS.find((a) => a.key === "grant").ownerOnly, true);
  assert.ok(!DELEGABLE_ACTIONS.some((a) => a.key === "grant"));
  assert.equal(isAuthorityActionType("*"), false);
  assert.equal(authorityForGatedAction("send_bid_package"), "package_release");
  assert.equal(authorityForGatedAction("send_invoice"), "proposal");
  assert.equal(authorityForGatedAction("send_email"), null, "one-off email is not delegable through an agent");
  assert.equal(authorityForGatedAction("made_up"), null);
});

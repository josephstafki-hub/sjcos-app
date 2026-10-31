// lib/db-login.mjs: which database login each process ends up with.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mcpLogin, resolveDatabaseUrl } from "../lib/db-login.mjs";

function envFile(lines) {
  const dir = mkdtempSync(path.join(tmpdir(), "db-login-"));
  const file = path.join(dir, ".env.local");
  writeFileSync(file, lines.join("\n"));
  return { file, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the MCP server runs as the owner only when the launcher says exactly that", () => {
  assert.equal(mcpLogin({ SJC_DB_LOGIN: "owner" }), "owner");
  for (const v of [undefined, "", "agent", "OWNER", "owner ", "master"]) assert.equal(mcpLogin({ SJC_DB_LOGIN: v }), "agent", String(v));
});

test("a bare process (systemd unit, Hermes, a business run) reads the narrow line from .env.local", () => {
  const f = envFile(["DATABASE_URL=postgresql://sjcos@h/sjcos", 'DATABASE_URL_AGENT="postgresql://sjcos_agent@h/sjcos"', "DATABASE_URL_WORKER=postgresql://sjcos_worker@h/sjcos"]);
  try {
    assert.deepEqual(resolveDatabaseUrl("agent", { env: {}, envFile: f.file }), { url: "postgresql://sjcos_agent@h/sjcos", key: "DATABASE_URL_AGENT", fallback: false });
    assert.equal(resolveDatabaseUrl("worker", { env: {}, envFile: f.file }).url, "postgresql://sjcos_worker@h/sjcos");
    assert.equal(resolveDatabaseUrl("owner", { env: {}, envFile: f.file }).url, "postgresql://sjcos@h/sjcos");
    // not applied yet for the monitor → falls back to the owner URL, flagged
    assert.deepEqual(resolveDatabaseUrl("readonly", { env: {}, envFile: f.file }), { url: "postgresql://sjcos@h/sjcos", key: "DATABASE_URL", fallback: true });
  } finally {
    f.done();
  }
});

test("an explicit DATABASE_URL in the environment (harness, evals, --url) beats the file's narrow line — never the live one", () => {
  const f = envFile(["DATABASE_URL=postgresql://sjcos@live/sjcos", "DATABASE_URL_AGENT=postgresql://sjcos_agent@live/sjcos"]);
  try {
    const harness = "postgresql://sjctest@localhost/sjcos_test?application_name=sjc_test_harness";
    assert.equal(resolveDatabaseUrl("agent", { env: { DATABASE_URL: harness }, envFile: f.file }).url, harness);
    // …but a process whose env was loaded from .env.local carries both, and the narrow one wins
    assert.equal(resolveDatabaseUrl("agent", { env: { DATABASE_URL: "postgresql://sjcos@live/sjcos", DATABASE_URL_AGENT: "postgresql://sjcos_agent@live/sjcos" }, envFile: f.file }).url, "postgresql://sjcos_agent@live/sjcos");
  } finally {
    f.done();
  }
});

test("nothing configured is an error, not a guess", () => {
  const f = envFile(["# empty"]);
  try {
    assert.throws(() => resolveDatabaseUrl("agent", { env: {}, envFile: f.file }), /DATABASE_URL_AGENT not found/);
    assert.throws(() => resolveDatabaseUrl("nope", { env: {}, envFile: f.file }), /unknown database login/);
  } finally {
    f.done();
  }
});

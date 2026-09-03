import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// scripts/register-10dlc.mjs, driven as Joe would: dry-run output for every
// stage (no network — TELNYX_API_BASE points at a closed port so any accidental
// call fails loudly), every local validation rejecting bad input, and the
// state-file refusal rules. SJCOS_ENV points at a nonexistent file so the
// real .env.local never leaks into a test.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "register-10dlc.mjs");

const GOOD = {
  TELNYX_API_KEY: "KEYTEST",
  TENDLC_LEGAL_NAME: "S J CARPENTRY L L C",
  TENDLC_DISPLAY_NAME: "SJ Carpentry",
  TENDLC_EIN: "12-3456789",
  TENDLC_PHONE: "+16125551234",
  TENDLC_STREET: "123 Main St",
  TENDLC_CITY: "Minneapolis",
  TENDLC_STATE: "MN",
  TENDLC_POSTAL_CODE: "55401",
  TENDLC_COUNTRY: "US",
  TENDLC_EMAIL: "joe@example.com",
  TENDLC_WEBSITE: "https://example.com",
  TENDLC_VERTICAL: "CONSTRUCTION",
  SMS_MESSAGING_PROFILE_ID: "profile-1",
  NEXT_PUBLIC_APP_URL: "https://os.example.com",
};

function run(args, envOver = {}, stateFile) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tendlc-"));
  const state = stateFile ?? path.join(dir, "state.json");
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      SJCOS_ENV: path.join(dir, "no-such-env"),
      TENDLC_STATE_FILE: state,
      TELNYX_API_BASE: "http://127.0.0.1:1",
      ...GOOD,
      ...envOver,
    },
  });
  return { ...r, state };
}

test("no args → usage, exit 2", () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage/);
});

test("brand dry run prints the exact body and sends nothing", () => {
  const r = run(["brand"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY RUN/);
  assert.match(r.stdout, /"entityType": "PRIVATE_PROFIT"/);
  assert.match(r.stdout, /"companyName": "S J CARPENTRY L L C"/);
  assert.match(r.stdout, /"displayName": "SJ Carpentry"/);
  assert.match(r.stdout, /"ein": "12-3456789"/);
  assert.equal(existsSync(r.state), false, "dry run must not write state");
});

test("legal name is never trimmed or normalized", () => {
  const r = run(["brand"], { TENDLC_LEGAL_NAME: "  S J   CARPENTRY L L C " });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"companyName": "  S J   CARPENTRY L L C "/);
});

test("local validation rejects bad EIN / phone / website / P.O. box, all at once, exit 2", () => {
  const r = run(["brand"], { TENDLC_EIN: "123456789", TENDLC_PHONE: "612-555-1234", TENDLC_WEBSITE: "http://example.com", TENDLC_STREET: "PO Box 55" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /EIN/);
  assert.match(r.stderr, /E\.164/);
  assert.match(r.stderr, /https/);
  assert.match(r.stderr, /P\.O\. box/);
});

test("missing vars are all named", () => {
  const r = run(["brand"], { TENDLC_EMAIL: "", TENDLC_VERTICAL: "" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /TENDLC_EMAIL is not set/);
  assert.match(r.stderr, /TENDLC_VERTICAL is not set/);
});

test("vetting / campaign refuse without a brandId in the state file, exit 3", () => {
  assert.equal(run(["vetting"]).status, 3);
  const c = run(["campaign"]);
  assert.equal(c.status, 3);
  assert.match(c.stderr, /brand stage first/);
});

test("with a brandId: vetting + campaign dry runs print their bodies", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tendlc-"));
  const state = path.join(dir, "state.json");
  writeFileSync(state, JSON.stringify({ brandId: "BRAND123" }));
  const v = run(["vetting"], {}, state);
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout, /"evpId": "AEGIS"/);
  assert.match(v.stdout, /externalVetting/);
  const c = run(["campaign"], {}, state);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /"brandId": "BRAND123"/);
  assert.match(c.stdout, /"usecase": "MIXED"/);
  assert.match(c.stdout, /"embeddedLink": true/);
  assert.match(c.stdout, /"optoutKeywords": "STOP,UNSUBSCRIBE"/);
  assert.match(c.stdout, /DRY RUN/);
  assert.deepEqual(JSON.parse(readFileSync(state, "utf8")), { brandId: "BRAND123" }, "dry run leaves state untouched");
});

test("a stage whose id exists refuses without --force, exit 3", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tendlc-"));
  const state = path.join(dir, "state.json");
  writeFileSync(state, JSON.stringify({ brandId: "BRAND123" }));
  const r = run(["brand"], {}, state);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /--force/);
  const forced = run(["brand", "--force"], {}, state);
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /DRY RUN/);
});

test("assign validates the number and needs a campaignId", () => {
  const bad = run(["assign", "6125551234"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /E\.164/);
  const noCampaign = run(["assign", "+16125551234"]);
  assert.equal(noCampaign.status, 3);
  const dir = mkdtempSync(path.join(os.tmpdir(), "tendlc-"));
  const state = path.join(dir, "state.json");
  writeFileSync(state, JSON.stringify({ brandId: "B", campaignId: "C" }));
  const dry = run(["assign", "+16125551234"], {}, state);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /"phoneNumber": "\+16125551234"/);
  assert.match(dry.stdout, /"campaignId": "C"/);
  assert.match(dry.stdout, /phone_number_campaigns/);
});

test("status with nothing registered explains what to do and writes nothing", () => {
  const r = run(["status"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No brand registered yet/);
  assert.equal(existsSync(r.state), false);
});

test("--confirm against an unreachable API fails loudly (exit 5), never silently", () => {
  const r = run(["brand", "--confirm"]);
  assert.equal(r.status, 5);
  assert.match(r.stderr, /unreachable/);
});

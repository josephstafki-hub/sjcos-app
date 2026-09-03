import { test } from "node:test";
import assert from "node:assert/strict";
import { grantCovers, GATED_ACTIONS, ACTION_TARGET_KIND, isGatedAction } from "../lib/owner-grant-types.ts";

// The send line is code-enforced: every outbound text and every call the OS
// places goes through consumeGrant → grantCovers. These tests pin the rule.

const now = 1_760_000_000_000;
const live = (over = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  status: "approved",
  actions: ["send_sms"],
  target_kind: "phone",
  target_id: "+13125550001",
  scope: {},
  reason: "Joe said text Dave the new start time",
  requested_by: "agent",
  conversation_id: null,
  run_id: null,
  max_uses: 1,
  uses: 0,
  expires_at: new Date(now + 3_600_000).toISOString(),
  decided_at: null,
  used_at: null,
  audit: [],
  created_at: new Date(now).toISOString(),
  ...over,
});
const target = { kind: "phone", id: "+13125550001" };

test("send_sms and place_call are gated actions targeting a phone number", () => {
  assert.ok(GATED_ACTIONS.includes("send_sms"));
  assert.ok(GATED_ACTIONS.includes("place_call"));
  assert.equal(ACTION_TARGET_KIND.send_sms, "phone");
  assert.equal(ACTION_TARGET_KIND.place_call, "phone");
  assert.equal(isGatedAction("send_sms"), true);
  assert.equal(isGatedAction("text_client"), false);
});

test("no grant → refused", () => {
  const r = grantCovers(null, "send_sms", target, now);
  assert.equal(r.ok, false);
  assert.match(r.error, /request_owner_permission/);
});

test("a live single-use grant for the exact number is accepted", () => {
  assert.deepEqual(grantCovers(live(), "send_sms", target, now), { ok: true });
});

test("requested / denied / revoked / expired / spent grants are refused", () => {
  assert.equal(grantCovers(live({ status: "requested" }), "send_sms", target, now).ok, false);
  assert.equal(grantCovers(live({ status: "denied" }), "send_sms", target, now).ok, false);
  assert.equal(grantCovers(live({ status: "revoked" }), "send_sms", target, now).ok, false);
  assert.equal(grantCovers(live({ expires_at: new Date(now - 1).toISOString() }), "send_sms", target, now).ok, false);
  assert.equal(grantCovers(live({ uses: 1 }), "send_sms", target, now).ok, false);
});

test("a grant for one action does not cover another; a call grant is not a text grant", () => {
  const r = grantCovers(live({ actions: ["send_email"] }), "send_sms", target, now);
  assert.equal(r.ok, false);
  assert.match(r.error, /covers send_email, not send_sms/);
  assert.equal(grantCovers(live({ actions: ["place_call"] }), "send_sms", target, now).ok, false);
  assert.equal(grantCovers(live({ actions: ["send_sms"] }), "place_call", target, now).ok, false);
});

test("a grant pinned to one number refuses another number", () => {
  const r = grantCovers(live(), "send_sms", { kind: "phone", id: "+13125559999" }, now);
  assert.equal(r.ok, false);
  assert.match(r.error, /\+13125550001 only/);
  assert.equal(grantCovers(live({ target_kind: "email" }), "send_sms", target, now).ok, false);
});

test("a wildcard run grant (Ask window 'Express permission') covers sms + calls", () => {
  const run = live({ actions: ["*"], target_kind: null, target_id: null, max_uses: 25 });
  assert.equal(grantCovers(run, "send_sms", target, now).ok, true);
  assert.equal(grantCovers(run, "place_call", target, now).ok, true);
});

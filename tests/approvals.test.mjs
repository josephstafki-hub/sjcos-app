import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStagedSend, describeStagedSend, stagedResultOf, stagedSendOf } from "../lib/owner-grant-types.ts";
import { parseWorkItemCallback, workItemKeyboard, decisionKeyboard, parseCallbackData } from "../lib/decisions/telegram.ts";
import { makeEmailProvider } from "../lib/providers/email.ts";

// Send-on-approval (2026-10-17): a permission request can carry the exact
// send so Joe's Approve performs it. These pin the pure halves: what a
// request may stage, the Telegram work-item buttons, and the Gmail quota
// refusal that used to park a never-sent email as "uncertain".

test("buildStagedSend: an email request stages the exact message and pins the recipient", () => {
  const r = buildStagedSend({ action: "send_email", email: { to: "Scott@Example.com", subject: "Numbers", body: "Hi Scott" } });
  assert.equal(r.ok, true);
  assert.equal(r.targetId, "Scott@Example.com");
  assert.deepEqual(r.staged, { action: "send_email", target_id: "Scott@Example.com", email: { to: "Scott@Example.com", subject: "Numbers", body: "Hi Scott" } });
  assert.match(describeStagedSend(r.staged), /Sends the email to Scott@Example.com — "Numbers"/);
});

test("buildStagedSend: refuses a half-written email and a target that disagrees with To", () => {
  assert.equal(buildStagedSend({ action: "send_email", email: { to: "a@b.co", subject: "s", body: "  " } }).ok, false);
  assert.equal(buildStagedSend({ action: "send_email", email: { to: "nope", body: "x" } }).ok, false);
  const mismatch = buildStagedSend({ action: "send_email", targetId: "other@b.co", email: { to: "a@b.co", body: "x" } });
  assert.equal(mismatch.ok, false);
});

test("buildStagedSend: no message, a call, or an explicit opt-out stages nothing (approval only grants)", () => {
  assert.equal(buildStagedSend({ action: "send_email", targetId: "a@b.co" }).staged, null);
  assert.equal(buildStagedSend({ action: "place_call", targetId: "+16125550100" }).staged, null);
  assert.equal(buildStagedSend({ action: "send_email", email: { to: "a@b.co", body: "x" }, sendOnApproval: false }).staged, null);
  assert.equal(buildStagedSend({ action: "nonsense" }).ok, false);
});

test("buildStagedSend: record sends run from the id; a PO may carry its email edits", () => {
  const bid = buildStagedSend({ action: "send_bid_package", targetId: "12" });
  assert.deepEqual(bid.staged, { action: "send_bid_package", target_id: "12" });
  assert.equal(buildStagedSend({ action: "send_invoice", targetId: "abc" }).staged, null);
  const po = buildStagedSend({ action: "send_purchase_order", targetId: "7", email: { body: "Please confirm" } });
  assert.deepEqual(po.staged?.email, { to: "", subject: "", body: "Please confirm" });
  const sms = buildStagedSend({ action: "send_sms", sms: { to: "+16125550100", body: "On my way" } });
  assert.equal(sms.staged?.sms?.body, "On my way");
});

test("stagedSendOf / stagedResultOf read the grant scope", () => {
  const g = { scope: { to: "a@b.co", staged: { action: "send_email", email: { to: "a@b.co", subject: "", body: "x" } }, staged_result: { state: "sent", at: "2026-10-17T00:00:00Z" } } };
  assert.equal(stagedSendOf(g)?.action, "send_email");
  assert.equal(stagedResultOf(g)?.state, "sent");
  assert.equal(stagedSendOf({ scope: {} }), null);
});

test("work-item Telegram buttons round-trip and never collide with decision buttons", () => {
  const id = "8c418c2f-e1f2-4175-9f08-3a35be67950d";
  const [[approve, decline]] = workItemKeyboard(id, { sends: true });
  assert.equal(approve.text, "Approve & send ✓");
  assert.deepEqual(parseWorkItemCallback(approve.callback_data), { workItemId: id, verb: "approve" });
  assert.deepEqual(parseWorkItemCallback(decline.callback_data), { workItemId: id, verb: "reject" });
  assert.ok(approve.callback_data.length <= 64, "Telegram limit");
  assert.equal(parseCallbackData(approve.callback_data), null);
  const [[d]] = decisionKeyboard(id, "abcdef0123456789");
  assert.equal(parseWorkItemCallback(d.callback_data), null);
});

test("email provider: a Gmail per-minute quota refusal is retryable and NOT transmitted", async () => {
  const prev = process.env.SJC_OUTBOUND_DISABLED;
  delete process.env.SJC_OUTBOUND_DISABLED;
  try {
    const ctx = { operationKey: "op:1", intentId: "00000000-0000-4000-8000-000000000001", attempt: 1 };
    const quota = Object.assign(
      new Error("Gmail rate limit hit (messages.send) after 3 attempts: Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'"),
      { name: "GmailRateLimitError" },
    );
    const p = makeEmailProvider({ configured: () => true, send: async () => { throw quota; } });
    const r = await p.send({ to: "a@example.test", subject: "s", bodyText: "b" }, ctx);
    assert.equal(r.responseClass, "retryable");
    assert.equal(r.transmitted, false);
    // a genuine timeout is still unknown (may have gone out)
    const t = makeEmailProvider({ configured: () => true, send: async () => { throw new Error("request timed out"); } });
    assert.equal((await t.send({ to: "a@example.test", subject: "s", bodyText: "b" }, ctx)).responseClass, "unknown");
  } finally {
    if (prev === undefined) delete process.env.SJC_OUTBOUND_DISABLED;
    else process.env.SJC_OUTBOUND_DISABLED = prev;
  }
});

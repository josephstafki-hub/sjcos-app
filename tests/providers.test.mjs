import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTransportError, NotTransmittedError, fakeOutbox, resetFakeOutbox, setFakeOutcome } from "../lib/providers/types.ts";
import { makeEmailProvider } from "../lib/providers/email.ts";
import { makeSmsProvider } from "../lib/providers/sms.ts";
import { makeTelegramProvider } from "../lib/providers/telegram.ts";
import { makeVoiceProvider } from "../lib/providers/voice.ts";
import { buildCallbackData, parseCallbackData, verifyTelegramSecret, decisionKeyboard } from "../lib/decisions/telegram.ts";
import { packageReleaseSummary, cardText, naturalCheck, cardCopyOf, changesSince } from "../lib/decisions/cards.ts";
import { contentHashOf } from "../lib/commands/decisions.ts";

// Provider adapters map every real provider answer onto one vocabulary
// (V07): a timeout AFTER the request was written is 'unknown', a refusal
// BEFORE is 'retryable', a validation 4xx is 'permanent'. Fake mode never
// touches the network. Telegram secret/callback parsing and the W06 card
// builder are pure and pinned here too (V14, V28).

const ctx = { operationKey: "op:1", intentId: "00000000-0000-4000-8000-000000000001", attempt: 1 };

test("classifyTransportError: before-transmit refusal is retryable, timeout after write is unknown, 4xx permanent, 429 retryable, 5xx unknown", () => {
  assert.equal(classifyTransportError(new Error("connect ECONNREFUSED 127.0.0.1:443")).responseClass, "retryable");
  assert.equal(classifyTransportError(new Error("connect ECONNREFUSED 127.0.0.1:443")).transmitted, false);
  assert.equal(classifyTransportError(new Error("getaddrinfo ENOTFOUND api.telnyx.com")).responseClass, "retryable");
  const t = classifyTransportError(new Error("The operation was aborted due to timeout"));
  assert.equal(t.responseClass, "unknown");
  assert.equal(t.transmitted, true);
  assert.equal(classifyTransportError(new Error("Invalid To header"), { status: 400 }).responseClass, "permanent");
  assert.equal(classifyTransportError(Object.assign(new Error("Too many"), { code: 429 })).responseClass, "retryable");
  assert.equal(classifyTransportError(new Error("Backend Error"), { status: 503 }).responseClass, "unknown");
  assert.equal(classifyTransportError(new NotTransmittedError("Gmail is not connected.", true)).responseClass, "permanent");
  assert.equal(classifyTransportError(new NotTransmittedError("Gmail is not connected.", true)).transmitted, false);
  assert.equal(classifyTransportError(new NotTransmittedError("pool exhausted")).responseClass, "retryable");
});

test("fake mode (SJC_OUTBOUND_DISABLED=1) records the would-be send and never calls the transport", async () => {
  process.env.SJC_OUTBOUND_DISABLED = "1";
  resetFakeOutbox();
  let called = 0;
  const email = makeEmailProvider({ configured: () => true, send: async () => { called++; return { id: "x" }; } });
  const r = await email.send({ to: "a@example.test", subject: "s", bodyText: "b" }, ctx);
  assert.equal(r.responseClass, "accepted");
  assert.equal(called, 0);
  assert.equal(fakeOutbox.length, 1);
  assert.equal(fakeOutbox[0].provider, "email");
  assert.equal(fakeOutbox[0].payload.to, "a@example.test");
  setFakeOutcome(() => ({ responseClass: "unknown", error: "simulated timeout", transmitted: true }));
  const u = await email.send({ to: "a@example.test", subject: "s", bodyText: "b" }, ctx);
  assert.equal(u.responseClass, "unknown");
  resetFakeOutbox();
  // validation happens before fake mode: an invalid address never "sends"
  const bad = await email.send({ to: "not-an-email", subject: "s", bodyText: "b" }, ctx);
  assert.equal(bad.responseClass, "permanent");
  assert.equal(bad.transmitted, false);
  assert.equal(fakeOutbox.length, 0);
});

test("email provider with a real transport maps outcomes and reconciles from Sent mail", async () => {
  delete process.env.SJC_OUTBOUND_DISABLED;
  try {
    const okT = { configured: () => true, send: async () => ({ id: "gm-1" }) };
    assert.equal((await makeEmailProvider(okT).send({ to: "a@example.test", subject: "s", bodyText: "b" }, ctx)).responseClass, "accepted");
    const notConf = makeEmailProvider({ configured: () => false, send: async () => ({ id: "x" }) });
    const nc = await notConf.send({ to: "a@example.test", subject: "s", bodyText: "b" }, ctx);
    assert.equal(nc.responseClass, "permanent");
    assert.equal(nc.transmitted, false);
    const timeout = makeEmailProvider({ configured: () => true, send: async () => { throw new Error("request timed out"); } });
    assert.equal((await timeout.send({ to: "a@example.test", subject: "s", bodyText: "b" }, ctx)).responseClass, "unknown");
    const refused = makeEmailProvider({ configured: () => true, send: async () => { throw new Error("connect ECONNREFUSED"); } });
    const rf = await refused.send({ to: "a@example.test", subject: "s", bodyText: "b" }, ctx);
    assert.equal(rf.responseClass, "retryable");
    assert.equal(rf.transmitted, false);
    const missingAtt = makeEmailProvider({ configured: () => true, send: async () => ({ id: "x" }), loadAttachment: async () => { throw new NotTransmittedError("missing", true); } });
    const ma = await missingAtt.send({ to: "a@example.test", subject: "s", bodyText: "b", attachments: [{ filename: "plan.pdf", mimeType: "application/pdf", fileId: "f1" }] }, ctx);
    assert.equal(ma.responseClass, "permanent");
    assert.equal(ma.transmitted, false);
    // reconciliation: found in Sent → confirmed; not found long after → pending (retry-safe); not found soon → unknown
    const found = makeEmailProvider({ ...okT, findSent: async () => ({ id: "gm-9", date: Date.now() }) });
    const rc = await found.reconcile({ id: "i", operationKey: "k", payload: { to: "a@example.test", subject: "s", bodyText: "b" }, providerRef: null, attemptedAt: new Date(Date.now() - 60_000).toISOString() });
    assert.equal(rc.state, "confirmed");
    const absent = makeEmailProvider({ ...okT, findSent: async () => null });
    assert.equal((await absent.reconcile({ id: "i", operationKey: "k", payload: { to: "a@example.test", subject: "s", bodyText: "b" }, providerRef: null, attemptedAt: new Date(Date.now() - 60_000).toISOString() })).state, "unknown");
    assert.equal((await absent.reconcile({ id: "i", operationKey: "k", payload: { to: "a@example.test", subject: "s", bodyText: "b" }, providerRef: null, attemptedAt: new Date(Date.now() - 20 * 60_000).toISOString() })).state, "pending");
  } finally {
    process.env.SJC_OUTBOUND_DISABLED = "1";
  }
});

test("sms provider: Telnyx id becomes the provider ref; 422 permanent; status poll settles unknowns", async () => {
  delete process.env.SJC_OUTBOUND_DISABLED;
  try {
    const sms = makeSmsProvider({ configured: () => true, send: async () => ({ id: "tx-1", toStatus: "queued" }), status: async (id) => (id === "tx-1" ? { status: "delivered" } : null) });
    const r = await sms.send({ to: "+13125550001", text: "hi" }, ctx);
    assert.equal(r.responseClass, "accepted");
    assert.equal(r.providerRef, "tx-1");
    assert.equal((await sms.send({ to: "3125550001", text: "hi" }, ctx)).responseClass, "permanent", "must be +E.164");
    const e422 = makeSmsProvider({ configured: () => true, send: async () => { throw Object.assign(new Error("[10001] invalid destination"), { status: 422 }); } });
    assert.equal((await e422.send({ to: "+13125550001", text: "hi" }, ctx)).responseClass, "permanent");
    const unreachable = makeSmsProvider({ configured: () => true, send: async () => { throw Object.assign(new Error("Telnyx unreachable (connect ECONNREFUSED)"), { status: 0 }); } });
    assert.equal((await unreachable.send({ to: "+13125550001", text: "hi" }, ctx)).responseClass, "retryable");
    const timedOut = makeSmsProvider({ configured: () => true, send: async () => { throw Object.assign(new Error("Telnyx unreachable (The operation was aborted due to timeout)"), { status: 0 }); } });
    assert.equal((await timedOut.send({ to: "+13125550001", text: "hi" }, ctx)).responseClass, "unknown");
    assert.equal((await sms.reconcile({ id: "i", operationKey: "k", payload: { to: "+13125550001", text: "hi" }, providerRef: "tx-1", attemptedAt: null })).state, "confirmed");
    assert.equal((await sms.reconcile({ id: "i", operationKey: "k", payload: { to: "+13125550001", text: "hi" }, providerRef: "tx-missing", attemptedAt: null })).state, "permanent_failure");
    assert.equal((await sms.reconcile({ id: "i", operationKey: "k", payload: { to: "+13125550001", text: "hi" }, providerRef: null, attemptedAt: null })).state, "unknown", "no id → wait for the receipt");
  } finally {
    process.env.SJC_OUTBOUND_DISABLED = "1";
  }
});

test("voice + telegram providers: owner chat only; edit-in-place; not-modified is a no-op success", async () => {
  delete process.env.SJC_OUTBOUND_DISABLED;
  try {
    const voice = makeVoiceProvider({ configured: () => true, dial: async () => ({ callControlId: "cc-1", callLegId: null, callSessionId: "sess-1" }) });
    const v = await voice.send({ callId: "c1", to: "+16123616585", from: "+13125550000", timeoutSecs: 20, counterparty: "+13125550001" }, ctx);
    assert.equal(v.responseClass, "accepted");
    assert.equal(v.providerRef, "cc-1");
    assert.equal(v.providerState, "session:sess-1");

    const calls = [];
    const tg = makeTelegramProvider({
      configured: () => true,
      ownerChatId: () => "777",
      call: async (method, body) => {
        calls.push({ method, body });
        if (method === "editMessageText" && body.text === "same") return { ok: false, description: "Bad Request: message is not modified", status: 400 };
        return { ok: true, result: { message_id: 42 }, status: 200 };
      },
    });
    const other = await tg.send({ chatId: "999", text: "hi" }, ctx);
    assert.equal(other.responseClass, "permanent");
    assert.equal(other.transmitted, false);
    assert.equal(calls.length, 0, "a non-owner chat never reaches the API");
    const sent = await tg.send({ chatId: "777", text: "card", buttons: [[{ text: "Approve ✓", callback_data: "d|x|y|a" }]] }, ctx);
    assert.equal(sent.responseClass, "confirmed");
    assert.equal(sent.providerRef, "42");
    assert.deepEqual(calls[0].body.reply_markup, { inline_keyboard: [[{ text: "Approve ✓", callback_data: "d|x|y|a" }]] });
    const edited = await tg.send({ chatId: "777", text: "card v2", editMessageId: 42 }, ctx);
    assert.equal(calls[1].method, "editMessageText");
    assert.equal(calls[1].body.message_id, 42);
    assert.equal(edited.providerRef, "42");
    const same = await tg.send({ chatId: "777", text: "same", editMessageId: 42 }, ctx);
    assert.equal(same.responseClass, "confirmed");
  } finally {
    process.env.SJC_OUTBOUND_DISABLED = "1";
  }
});

test("telegram secret: constant-time compare, fails closed when unset; callback data round-trips and stays under 64 bytes", () => {
  assert.equal(verifyTelegramSecret("abc", "abc"), true);
  assert.equal(verifyTelegramSecret("abd", "abc"), false);
  assert.equal(verifyTelegramSecret("", "abc"), false);
  assert.equal(verifyTelegramSecret("abc", ""), false);
  assert.equal(verifyTelegramSecret(null, undefined), false);
  const id = "8c1e2a44-0b2f-4d3e-9a1b-7c6d5e4f3a2b";
  const hash = contentHashOf({ a: 1 });
  const data = buildCallbackData(id, hash, "approve");
  assert.ok(Buffer.byteLength(data) <= 64, `callback data is ${Buffer.byteLength(data)} bytes`);
  assert.deepEqual(parseCallbackData(data), { decisionId: id, hashPrefix: hash.slice(0, 12), verb: "approve" });
  assert.equal(parseCallbackData(buildCallbackData(id, null, "hold")).verb, "hold");
  assert.equal(parseCallbackData("garbage"), null);
  assert.equal(parseCallbackData(`d|${id}|zz|a`), null, "hash prefix must be hex");
  const kb = decisionKeyboard(id, hash);
  assert.equal(kb[0].length, 3);
  assert.deepEqual(kb[0].map((b) => parseCallbackData(b.callback_data).verb), ["approve", "changes", "hold"]);
});

test("W06 card: built from the payload, hashes over the same object, shows gaps and Joe's retained work, diffs revisions (V28 factual copy)", () => {
  const rev1 = {
    kind: "bid_package",
    id: 12,
    title: "Deck framing",
    revision: 1,
    projectName: "ZZ Fixture",
    recipients: [
      { name: "Dave's Framing", address: "dave@sub.test", role: "Framing sub" },
      { name: "No-Email Joe", role: "Framing sub" },
    ],
    inclusions: ["Frame 16x20 deck", "Set 6 footings"],
    exclusions: ["Permit"],
    retained: ["Stair stringers"],
    quantities: [{ label: "Deck area", qty: 320, unit: "sq ft" }],
    attachments: [{ label: "Framing plan", revision: "B" }],
    assumptions: ["Footings at 42 in. frost depth"],
    gaps: ["Ledger flashing detail not drawn"],
    dueDate: "2026-10-01",
    message: "Please price by the 1st.",
  };
  const s = packageReleaseSummary(rev1);
  assert.equal(s.recipients.length, 2);
  assert.ok(s.exclusions.includes("Stair stringers — kept by SJ Carpentry"));
  assert.ok(s.gaps.some((g) => /No-Email Joe/.test(g)), "missing address is called out");
  assert.ok(s.gaps.includes("Ledger flashing detail not drawn"));
  assert.match(s.effect, /1 recipient: Dave's Framing \(Framing sub\)/);
  assert.deepEqual(s.changes, ["First review of this package."]);
  assert.equal(s.quantities[0].unit, "sq ft");
  assert.equal(s.attachments[0].revision, "B");
  // the hash a decision would carry is over the SAME payload the card was built from
  assert.equal(contentHashOf(rev1), contentHashOf({ ...rev1 }));
  assert.notEqual(contentHashOf(rev1), contentHashOf({ ...rev1, inclusions: ["Frame 16x20 deck"] }));

  const rev2 = { ...rev1, revision: 2, inclusions: ["Frame 16x20 deck", "Set 6 footings", "Install ledger"], attachments: [{ label: "Framing plan", revision: "C" }], previous: rev1 };
  const s2 = packageReleaseSummary(rev2);
  assert.ok(s2.changes.some((c) => /Included work added: Install ledger/.test(c)));
  assert.ok(s2.changes.some((c) => /Attachments added: Framing plan rev C/.test(c)));
  assert.ok(s2.changes.some((c) => /Attachments removed: Framing plan rev B/.test(c)));
  assert.deepEqual(changesSince(rev1, { ...rev1, revision: 3 }), ["No content changes since the last review; the revision number moved."]);

  // V28: everything the card shows is factual — no invented human activity
  const copy = cardCopyOf(s2) + "\n" + cardText({ id: "x", kind: "package_release", title: "Deck framing → Dave", summary: s2, expires_at: "2026-10-01T00:00:00Z" });
  assert.deepEqual(naturalCheck(copy), { ok: true, problems: [] });
  assert.equal(naturalCheck("Joe reviewed this personally and I just called Dave about it!!").ok, false);
  assert.equal(naturalCheck("Hope this finds you well — just checking in.").ok, false);
  assert.equal(naturalCheck("Bid due Oct 1. Attachments: framing plan rev C. Stair stringers are kept by SJ Carpentry.").ok, true);
  const text = cardText({ id: "x", kind: "package_release", title: "Deck framing → Dave", summary: s2, expires_at: "2026-10-01T00:00:00Z" }, { appUrl: "https://os.example.test/" });
  assert.match(text, /^\[SJC OS\] Decision: Deck framing → Dave/);
  assert.match(text, /Missing \/ open: .*No-Email Joe/);
  assert.match(text, /https:\/\/os\.example\.test\/engine\/decisions\?d=x$/);
});

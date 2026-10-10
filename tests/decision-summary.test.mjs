import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSummary } from "../lib/decisions/summary.ts";
import { cardText, cardCopyOf } from "../lib/decisions/cards.ts";
import { makeEmailProvider } from "../lib/providers/email.ts";

// Agent-written decision summaries come in any shape. A 2026-10-09 Mahowald
// decision arrived with `recipients` as one sentence and its substance under
// keys the card didn't know; the Telegram announce threw on recipients.map
// every 2 minutes and Joe never heard about it.

const MAHOWALD = {
  choice: "Approve releasing contract #33 + the $48,011.66 initial invoice as is.",
  recipients: "UNCONFIRMED. Contract field client_email = tim@example.test. Confirm the signer(s).",
  money_check: "$17,580 pre-con payment collected; do not apply it twice.",
  what_happened: "Libby signed estimate #16 rev 1 ($480,116.64) in the portal on Oct 9.",
  effect_of_approving: "Releases construction contract draft #33 for e-signature.",
  gaps_before_release: ["Plans are not final.", "Fireplace: electric vs gas."],
};

test("free-form agent summary normalizes to the card shape with nothing dropped", () => {
  const s = normalizeSummary(MAHOWALD);
  assert.deepEqual(s.recipients, [{ name: MAHOWALD.recipients }]);
  assert.equal(s.effect, MAHOWALD.effect_of_approving);
  assert.deepEqual(s.gaps, MAHOWALD.gaps_before_release);
  assert.deepEqual(
    s.notes.map((n) => n.label),
    ["Choice", "Money check", "What happened"],
  );
  assert.equal(s.notes[2].text, MAHOWALD.what_happened);
});

test("the Telegram card renders it instead of throwing", () => {
  const text = cardText({ id: "d1", title: "Mahowald: Libby signed estimate #16", summary: MAHOWALD, status: "pending" });
  assert.match(text, /^To: UNCONFIRMED\./m);
  assert.match(text, /^What happened: Libby signed/m);
  assert.match(text, /^Money check: \$17,580/m);
  assert.match(text, /^Missing \/ open: Plans are not final\.; Fireplace/m);
  assert.match(text, /^If approved: Releases construction contract/m);
  // the announce body is lines 1..11 of the card: the substance must be in it
  const body = text.split("\n").slice(1, 12).join("\n");
  assert.match(body, /What happened/);
  assert.match(body, /If approved/);
  assert.match(cardCopyOf(MAHOWALD), /Libby signed/);
});

test("standard summaries pass through unchanged; junk shapes never throw", () => {
  const std = {
    recipients: [{ name: "Tim", address: "tim@example.test", role: "client" }],
    inclusions: ["Contract"],
    quantities: [{ label: "Doors", qty: 3 }],
    effect: "Sends it.",
  };
  const s = normalizeSummary(std);
  assert.deepEqual(s.recipients, std.recipients);
  assert.deepEqual(s.inclusions, ["Contract"]);
  assert.deepEqual(s.quantities, std.quantities);
  assert.equal(s.effect, "Sends it.");
  assert.deepEqual(s.notes, []);
  for (const junk of [null, undefined, 7, "just a sentence", [], { recipients: 5, inclusions: "one", gaps: [null, 2] }, { recipients: [{ email: "x@example.test" }, null, "Bob"] }]) {
    assert.doesNotThrow(() => cardText({ id: "d", title: "t", summary: junk, status: "pending" }));
  }
  assert.deepEqual(normalizeSummary({ recipients: [{ email: "x@example.test" }, null, "Bob"] }).recipients, [{ name: "x@example.test" }, { name: "Bob" }]);
  assert.deepEqual(normalizeSummary({ inclusions: "one" }).inclusions, ["one"]);
  assert.deepEqual(normalizeSummary("just a sentence").notes, [{ label: "Summary", text: "just a sentence" }]);
});

test("email provider sends a payload that carries `body` instead of `bodyText`", async () => {
  delete process.env.SJC_OUTBOUND_DISABLED;
  const sent = [];
  const email = makeEmailProvider({ configured: () => true, send: async (m) => { sent.push(m); return { id: "gm-1" }; } });
  const ctx = { operationKey: "op:1", intentId: "00000000-0000-4000-8000-000000000001", attempt: 1 };
  const r = await email.send({ to: "a@example.test", subject: "Warranty", body: "Coverage details." }, ctx);
  assert.equal(r.responseClass, "accepted");
  assert.equal(sent[0].bodyText, "Coverage details.");
  const empty = await email.send({ to: "a@example.test", subject: "s" }, ctx);
  assert.equal(empty.responseClass, "permanent");
});

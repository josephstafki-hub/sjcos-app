import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMessagingEvent, classifyKeyword, classifySendFailure, describeSendFailure, KEYWORDS } from "../lib/comms/sms-inbound.ts";

const inbound = {
  data: {
    event_type: "message.received",
    id: "evt-1",
    occurred_at: "2026-09-02T15:00:00Z",
    payload: {
      id: "msg-1",
      direction: "inbound",
      type: "MMS",
      from: { phone_number: "+13125550001", carrier: "T-Mobile" },
      to: [{ phone_number: "+17735550002", status: "webhook_delivered" }],
      text: "Hello",
      media: [{ url: "https://media.telnyx.example/x.jpg", content_type: "image/jpeg", size: 1234 }],
      received_at: "2026-09-02T14:59:59Z",
    },
  },
  meta: { attempt: 1 },
};

test("parses the Telnyx shape: from.phone_number, to[] array, text, media[]", () => {
  const e = parseMessagingEvent(inbound);
  assert.ok(e);
  assert.equal(e.eventType, "message.received");
  assert.equal(e.eventId, "evt-1");
  assert.equal(e.messageId, "msg-1");
  assert.equal(e.direction, "inbound");
  assert.equal(e.from, "+13125550001");
  assert.deepEqual(e.to, ["+17735550002"]);
  assert.equal(e.text, "Hello");
  assert.equal(e.media.length, 1);
  assert.equal(e.media[0].contentType, "image/jpeg");
  assert.equal(e.media[0].size, 1234);
});

test("delivery receipts carry the recipient status + errors", () => {
  const e = parseMessagingEvent({
    data: {
      event_type: "message.finalized",
      id: "evt-2",
      payload: {
        id: "msg-out-1",
        direction: "outbound",
        from: { phone_number: "+17735550002" },
        to: [{ phone_number: "+13125550001", status: "delivery_failed" }],
        text: "x",
        errors: [{ code: "40300", title: "Blocked", detail: "Message blocked: 10DLC campaign not registered for this number" }],
      },
    },
  });
  assert.equal(e.toStatus, "delivery_failed");
  assert.equal(e.errors[0].code, "40300");
  assert.equal(classifySendFailure(e.errors), "campaign_not_registered");
  assert.match(describeSendFailure("campaign_not_registered", e.errors), /10DLC campaign not yet approved/);
});

test("garbage envelopes return null, never throw", () => {
  assert.equal(parseMessagingEvent(null), null);
  assert.equal(parseMessagingEvent({}), null);
  assert.equal(parseMessagingEvent({ data: { payload: {} } }), null);
  assert.equal(parseMessagingEvent("nope"), null);
});

test("all six registered keywords, case-insensitive", () => {
  const expect = { STOP: "opt_out", UNSUBSCRIBE: "opt_out", HELP: "help", INFO: "help", START: "opt_in", YES: "opt_in" };
  for (const [w, action] of Object.entries(expect)) {
    assert.equal(classifyKeyword(w), action, w);
    assert.equal(classifyKeyword(w.toLowerCase()), action, w.toLowerCase());
    assert.equal(classifyKeyword(`  ${w.charAt(0)}${w.slice(1).toLowerCase()}. `), action, `padded ${w}`);
  }
  // Every registered keyword has a handler.
  const registered = [...KEYWORDS.opt_out, ...KEYWORDS.help, ...KEYWORDS.opt_in];
  assert.equal(registered.length, 6);
});

test("a sentence containing a keyword is NOT a keyword", () => {
  assert.equal(classifyKeyword("stop by tomorrow at 8"), null);
  assert.equal(classifyKeyword("yes please, 10 works"), null);
  assert.equal(classifyKeyword("I need help with the invoice"), null);
  assert.equal(classifyKeyword(""), null);
});

test("failure classification defaults to other", () => {
  assert.equal(classifySendFailure([{ code: "1", title: "Something", detail: "went wrong" }]), "other");
  assert.equal(classifySendFailure([{ code: "1", title: "Invalid destination number", detail: "" }]), "invalid_number");
});

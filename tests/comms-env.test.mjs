import { test } from "node:test";
import assert from "node:assert/strict";
import { commsEnvReport, smsConfigFrom, voiceConfigFrom, formatCommsEnvReport } from "../lib/comms/env.ts";

const PUB = Buffer.alloc(32, 7).toString("base64");

const GOOD = {
  SMS_PROVIDER: "telnyx",
  SMS_API_KEY: "KEY",
  SMS_MESSAGING_PROFILE_ID: "0000-1111",
  SMS_FROM_NUMBER: "+17735550002",
  SMS_PUBLIC_KEY: PUB,
  VOICE_APPLICATION_ID: "app-1",
  VOICE_FROM_NUMBER: "+17735550002",
  VOICE_FORWARD_TO: "+16125550001",
  VOICE_RECORDING: "all",
  VOICE_RECORDING_ANNOUNCEMENT: "off",
  VOICE_TRANSCRIPTION: "telnyx",
};

test("a complete config is ok and yields both configs", () => {
  const r = commsEnvReport(GOOD);
  assert.equal(r.sms.ok, true);
  assert.equal(r.voice.ok, true);
  assert.deepEqual(r.problems, []);
  assert.equal(smsConfigFrom(GOOD)?.messagingProfileId, "0000-1111");
  assert.equal(voiceConfigFrom(GOOD)?.announcement, "off");
  assert.equal(voiceConfigFrom(GOOD)?.apiKey, "KEY");
});

test("unset switch vars mean inert, not broken", () => {
  const r = commsEnvReport({});
  assert.equal(r.sms.enabled, false);
  assert.equal(r.voice.enabled, false);
  assert.equal(r.tendlc.enabled, false);
  assert.deepEqual(r.problems, []);
  assert.equal(smsConfigFrom({}), null);
  assert.equal(voiceConfigFrom({}), null);
});

test("every missing var is named at once, and the feature fails closed", () => {
  const env = { SMS_PROVIDER: "telnyx", VOICE_APPLICATION_ID: "app" };
  const r = commsEnvReport(env);
  assert.equal(r.sms.ok, false);
  assert.deepEqual(r.sms.missing, ["SMS_API_KEY", "SMS_MESSAGING_PROFILE_ID", "SMS_FROM_NUMBER", "SMS_PUBLIC_KEY"]);
  assert.ok(r.voice.missing.includes("VOICE_FROM_NUMBER"));
  assert.ok(r.voice.missing.includes("VOICE_FORWARD_TO"));
  assert.ok(r.voice.missing.some((m) => m.startsWith("SMS_API_KEY")));
  assert.equal(smsConfigFrom(env), null);
  assert.equal(voiceConfigFrom(env), null);
  const text = formatCommsEnvReport(r);
  assert.match(text, /SMS: BROKEN/);
  assert.match(text, /SMS_MESSAGING_PROFILE_ID/);
  assert.ok(r.problems.length >= 2);
});

test("twilio is rejected and stale vars are flagged", () => {
  const r = commsEnvReport({ ...GOOD, SMS_PROVIDER: "twilio", SMS_ACCOUNT_SID: "AC123" });
  assert.equal(r.sms.ok, false);
  assert.ok(r.sms.invalid.some((i) => /telnyx/.test(i)));
  assert.deepEqual(r.stale, ["SMS_ACCOUNT_SID"]);
  assert.equal(smsConfigFrom({ ...GOOD, SMS_PROVIDER: "twilio" }), null);
});

test("invalid values are reported by name", () => {
  const r = commsEnvReport({ ...GOOD, SMS_FROM_NUMBER: "612-555", VOICE_RECORDING: "maybe", VOICE_TRANSCRIPTION: "whisper", SMS_PUBLIC_KEY: "short" });
  assert.ok(r.sms.invalid.some((i) => i.startsWith("SMS_FROM_NUMBER")));
  assert.ok(r.sms.invalid.some((i) => i.startsWith("SMS_PUBLIC_KEY")));
  assert.ok(r.voice.invalid.some((i) => i.startsWith("VOICE_RECORDING must")));
  assert.ok(r.voice.invalid.some((i) => i.startsWith("VOICE_TRANSCRIPTION")));
});

test("10DLC block validates the brand-rejection causes", () => {
  const r = commsEnvReport({
    TELNYX_API_KEY: "k",
    TENDLC_LEGAL_NAME: "SJ CARPENTRY LLC",
    TENDLC_DISPLAY_NAME: "SJ Carpentry",
    TENDLC_EIN: "123456789",
    TENDLC_PHONE: "6125551234",
    TENDLC_STREET: "P.O. Box 12",
    TENDLC_CITY: "Minneapolis",
    TENDLC_STATE: "MN",
    TENDLC_POSTAL_CODE: "55401",
    TENDLC_COUNTRY: "US",
    TENDLC_EMAIL: "x@y.z",
    TENDLC_WEBSITE: "http://example.com",
    TENDLC_VERTICAL: "CONSTRUCTION",
  });
  assert.equal(r.tendlc.ok, false);
  assert.equal(r.tendlc.invalid.length, 4);
});

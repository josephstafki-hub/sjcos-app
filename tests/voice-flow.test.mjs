import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planVoiceEvent,
  parseVoiceEvent,
  encodeClientState,
  decodeClientState,
  DEFAULT_RECORDING_NOTICE,
  DEFAULT_VOICEMAIL_GREETING,
} from "../lib/comms/voice-flow.ts";
import { toneWav, voicemailBeepBase64 } from "../lib/comms/beep.ts";

const cfg = {
  fromNumber: "+17735550002",
  forwardTo: "+16125550001",
  recording: "all",
  announcement: "off",
  ringSeconds: 25,
  recordingNotice: DEFAULT_RECORDING_NOTICE,
  voicemailGreeting: DEFAULT_VOICEMAIL_GREETING,
};

function ev(type, extra = {}) {
  return {
    type,
    eventId: "e",
    occurredAt: null,
    callControlId: "LEG",
    callLegId: "leg",
    callSessionId: "sess",
    clientState: null,
    direction: null,
    from: null,
    to: null,
    hangupCause: null,
    hangupSource: null,
    status: null,
    recordingId: null,
    recordingUrls: null,
    recordingChannels: null,
    recordingStartedAt: null,
    recordingEndedAt: null,
    transcriptionText: null,
    transcriptionId: null,
    reason: null,
    ...extra,
  };
}

const fresh = () => ({ id: "CALL", direction: "inbound", status: "ringing", counterpartyLeg: "CALLER", ownerLeg: null, bridged: false, voicemail: false, recording: false, ended: false });
const types = (p) => p.actions.map((a) => a.type);

test("client_state round-trips as base64 JSON", () => {
  const s = { c: "CALL", r: "caller", p: "answered" };
  assert.deepEqual(decodeClientState(encodeClientState(s)), s);
  assert.equal(decodeClientState("zzz"), null);
  assert.equal(decodeClientState(null), null);
});

test("parseVoiceEvent reads the Call Control envelope", () => {
  const e = parseVoiceEvent({
    data: {
      event_type: "call.initiated",
      id: "evt",
      payload: { call_control_id: "v3:abc", call_leg_id: "l", call_session_id: "s", direction: "incoming", from: "+13125550001", to: "+17735550002", state: "parked" },
    },
  });
  assert.equal(e.type, "call.initiated");
  assert.equal(e.callControlId, "v3:abc");
  assert.equal(e.direction, "incoming");
  assert.equal(e.clientState, null);
  assert.equal(parseVoiceEvent({ nope: 1 }), null);
});

test("inbound: fresh initiated → answer; answered → record + ring Joe + ringback", () => {
  const p1 = planVoiceEvent(ev("call.initiated", { callControlId: "CALLER", direction: "incoming" }), null, cfg, "CALL");
  assert.deepEqual(types(p1), ["answer"]);
  assert.equal(p1.patch.direction, "inbound");
  assert.equal(p1.patch.counterpartyLeg, "CALLER");
  assert.deepEqual(p1.actions[0].state, { c: "CALL", r: "caller", p: "answered" });

  const p2 = planVoiceEvent(ev("call.answered", { callControlId: "CALLER", clientState: { c: "CALL", r: "caller", p: "answered" } }), fresh(), cfg);
  assert.deepEqual(types(p2), ["record_start", "dial", "play_ringback"]);
  const dial = p2.actions[1];
  assert.equal(dial.to, "+16125550001");
  assert.equal(dial.from, "+17735550002");
  assert.equal(dial.linkTo, "CALLER");
  assert.equal(dial.timeoutSecs, 25);
  assert.equal(dial.state.r, "forward");
  assert.equal(p2.patch.recording, true);
});

test("inbound: recording off skips record_start; announcement on speaks first then rings after speak.ended", () => {
  const off = { ...cfg, recording: "off" };
  const p = planVoiceEvent(ev("call.answered", { callControlId: "CALLER", clientState: { c: "CALL", r: "caller", p: "answered" } }), fresh(), off);
  assert.deepEqual(types(p), ["dial", "play_ringback"]);
  assert.equal(p.patch.recording, false);

  const ann = { ...cfg, announcement: "on" };
  const p2 = planVoiceEvent(ev("call.answered", { callControlId: "CALLER", clientState: { c: "CALL", r: "caller", p: "answered" } }), fresh(), ann);
  assert.deepEqual(types(p2), ["speak", "record_start"]);
  assert.equal(p2.actions[0].text, DEFAULT_RECORDING_NOTICE);
  const p3 = planVoiceEvent(ev("call.speak.ended", { callControlId: "CALLER", clientState: { c: "CALL", r: "caller", p: "announce" } }), { ...fresh(), recording: true }, ann);
  assert.deepEqual(types(p3), ["dial", "play_ringback"]);
});

test("inbound: Joe answers → stop ringback + bridge; caller hangs up → completed/answered", () => {
  const ringing = { ...fresh(), recording: true, ownerLeg: "FWD" };
  const p = planVoiceEvent(ev("call.answered", { callControlId: "FWD", clientState: { c: "CALL", r: "forward", p: "answered" } }), ringing, cfg);
  assert.deepEqual(types(p), ["playback_stop", "bridge"]);
  assert.equal(p.actions[1].leg, "CALLER");
  assert.equal(p.actions[1].withLeg, "FWD");
  assert.equal(p.outcome, "answered");
  const bridged = { ...ringing, bridged: true, status: "bridged" };
  const end = planVoiceEvent(ev("call.hangup", { callControlId: "CALLER", hangupCause: "normal_clearing", clientState: { c: "CALL", r: "caller", p: "hangup" } }), bridged, cfg);
  assert.deepEqual(types(end), []);
  assert.equal(end.outcome, "answered");
  assert.equal(end.patch.status, "completed");
  assert.equal(end.fileVoicemail, false);
});

test("inbound: Joe does not answer → voicemail greeting → beep (already recording) → hangup files voicemail", () => {
  const ringing = { ...fresh(), recording: true, ownerLeg: "FWD" };
  const p = planVoiceEvent(ev("call.hangup", { callControlId: "FWD", hangupCause: "timeout", clientState: { c: "CALL", r: "forward", p: "answered" } }), ringing, cfg);
  assert.deepEqual(types(p), ["playback_stop", "speak"]);
  assert.equal(p.actions[1].text, DEFAULT_VOICEMAIL_GREETING);
  assert.equal(p.patch.voicemail, true);
  const vm = { ...ringing, voicemail: true, status: "voicemail" };
  const p2 = planVoiceEvent(ev("call.speak.ended", { callControlId: "CALLER", clientState: { c: "CALL", r: "caller", p: "vm_greeting" } }), vm, cfg);
  assert.deepEqual(types(p2), ["play_beep"]);
  const p3 = planVoiceEvent(ev("call.hangup", { callControlId: "CALLER", hangupCause: "normal_clearing", clientState: { c: "CALL", r: "caller", p: "vm_beep" } }), vm, cfg);
  assert.equal(p3.outcome, "voicemail");
  assert.equal(p3.fileVoicemail, true);
  assert.equal(p3.patch.ended, true);
});

test("inbound: recording off still records the voicemail (with beep)", () => {
  const off = { ...cfg, recording: "off" };
  const vm = { ...fresh(), ownerLeg: "FWD", voicemail: true, status: "voicemail" };
  const p = planVoiceEvent(ev("call.speak.ended", { callControlId: "CALLER", clientState: { c: "CALL", r: "caller", p: "vm_greeting" } }), vm, off);
  assert.deepEqual(types(p), ["record_start"]);
  assert.equal(p.actions[0].playBeep, true);
  assert.equal(p.patch.recording, true);
});

test("inbound: caller gives up while Joe's phone rings → hang up Joe's leg, missed", () => {
  const ringing = { ...fresh(), recording: true, ownerLeg: "FWD" };
  const p = planVoiceEvent(ev("call.hangup", { callControlId: "CALLER", hangupCause: "originator_cancel", clientState: { c: "CALL", r: "caller", p: "ringback" } }), ringing, cfg);
  assert.deepEqual(types(p), ["hangup"]);
  assert.equal(p.actions[0].leg, "FWD");
  assert.equal(p.outcome, "missed");
  assert.equal(p.fileVoicemail, false);
});

test("outbound: Joe answers first → record + dial client + ringback; client answers → bridge", () => {
  const out = { id: "CALL", direction: "outbound", status: "ringing", counterpartyLeg: null, ownerLeg: "OWN", bridged: false, voicemail: false, recording: false, ended: false };
  const p = planVoiceEvent(ev("call.answered", { callControlId: "OWN", clientState: { c: "CALL", r: "owner", p: "answered" } }), out, { ...cfg, counterpartyName: "Dave" });
  assert.deepEqual(types(p), ["record_start", "dial", "play_ringback"]);
  assert.equal(p.actions[1].linkTo, "OWN");
  assert.equal(p.actions[1].state.r, "client");
  const dialing = { ...out, recording: true, counterpartyLeg: "CLI" };
  const p2 = planVoiceEvent(ev("call.answered", { callControlId: "CLI", clientState: { c: "CALL", r: "client", p: "answered" } }), dialing, cfg);
  assert.deepEqual(types(p2), ["playback_stop", "bridge"]);
  assert.equal(p2.actions[1].leg, "OWN");
  assert.equal(p2.actions[1].withLeg, "CLI");
  assert.equal(p2.outcome, "answered");
});

test("outbound: client does not answer → tell Joe, then hang up on speak.ended", () => {
  const dialing = { id: "CALL", direction: "outbound", status: "ringing", counterpartyLeg: "CLI", ownerLeg: "OWN", bridged: false, voicemail: false, recording: true, ended: false };
  const p = planVoiceEvent(ev("call.hangup", { callControlId: "CLI", hangupCause: "no_answer", clientState: { c: "CALL", r: "client", p: "answered" } }), dialing, { ...cfg, counterpartyName: "Dave" });
  assert.deepEqual(types(p), ["playback_stop", "speak"]);
  assert.match(p.actions[1].text, /No answer from Dave/);
  assert.equal(p.outcome, "no_answer");
  const p2 = planVoiceEvent(ev("call.speak.ended", { callControlId: "OWN", clientState: { c: "CALL", r: "owner", p: "c2c_no_answer" } }), { ...dialing, status: "no_answer" }, cfg);
  assert.deepEqual(types(p2), ["hangup"]);
  const p3 = planVoiceEvent(ev("call.hangup", { callControlId: "OWN", hangupCause: "normal_clearing", clientState: { c: "CALL", r: "owner", p: "c2c_no_answer" } }), { ...dialing, status: "no_answer" }, cfg);
  assert.equal(p3.outcome, "no_answer");
  assert.equal(p3.patch.ended, true);
});

test("events for unknown calls and post-end events are ignored", () => {
  const p = planVoiceEvent(ev("call.answered", { clientState: { c: "X", r: "caller" } }), null, cfg);
  assert.deepEqual(types(p), []);
  const ended = { ...fresh(), ended: true };
  assert.deepEqual(types(planVoiceEvent(ev("call.speak.ended", { clientState: { c: "CALL", r: "caller", p: "vm_greeting" } }), ended, cfg)), []);
  assert.deepEqual(types(planVoiceEvent(ev("call.recording.saved", { clientState: { c: "CALL", r: "caller", p: "record" } }), fresh(), cfg)), []);
});

test("beep WAV is a valid 8kHz mono PCM file", () => {
  const wav = toneWav({ ms: 100 });
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.subarray(8, 12).toString(), "WAVE");
  assert.equal(wav.readUInt32LE(24), 8000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.length, 44 + 800 * 2);
  assert.ok(voicemailBeepBase64().length > 1000);
});

// The call-flow planner: a pure function from (Telnyx Call Control event,
// what we know about the call, config) to (commands to issue, what to record).
// lib/voice.ts owns persistence + the Telnyx client and just executes what this
// returns, so the whole flow is unit-tested with no account, and an answering
// layer (AI receptionist — out of scope) could be inserted later by changing
// plans here rather than the webhook.
//
// Flows:
//   INBOUND  caller → answer → [recorded-call notice] → [record] → dial Joe's
//            cell (caller hears ringback) → on answer: bridge → on no answer:
//            voicemail greeting → beep → [record if not already] → caller
//            hangs up.
//   OUTBOUND (click-to-call) Joe's cell is dialed FIRST → on answer: [record]
//            → dial the client (Joe hears ringback) → on answer: bridge → on no
//            answer: tell Joe, hang up. He never hears a client's phone ring
//            before he is on the line.
//
// Every command we issue carries a client_state {c: callId, r: role, p: phase}
// so every later webhook for that leg tells us which call and which step it
// belongs to. Telnyx replaces a leg's client_state with each command's, so
// the state is always the LAST thing we told that leg.

export type LegRole = "caller" | "forward" | "owner" | "client";
export type Phase =
  | "answered"
  | "announce"
  | "record"
  | "ringback"
  | "vm_greeting"
  | "vm_beep"
  | "vm_record"
  | "c2c_no_answer"
  | "hangup";

export interface ClientState {
  c: string; // call id (our uuid)
  r: LegRole;
  p?: Phase;
}

export function encodeClientState(s: ClientState): string {
  return Buffer.from(JSON.stringify(s), "utf8").toString("base64");
}

export function decodeClientState(b64: string | null | undefined): ClientState | null {
  if (!b64) return null;
  try {
    const o = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Partial<ClientState>;
    if (!o || typeof o.c !== "string" || typeof o.r !== "string") return null;
    return { c: o.c, r: o.r as LegRole, p: o.p as Phase | undefined };
  } catch {
    return null;
  }
}

export interface VoiceEvent {
  type: string;
  eventId: string | null;
  occurredAt: string | null;
  callControlId: string | null;
  callLegId: string | null;
  callSessionId: string | null;
  clientState: ClientState | null;
  direction: "incoming" | "outgoing" | null;
  from: string | null;
  to: string | null;
  hangupCause: string | null;
  hangupSource: string | null;
  /** speak/playback status. */
  status: string | null;
  /** recording.saved */
  recordingId: string | null;
  recordingUrls: { mp3?: string | null; wav?: string | null } | null;
  recordingChannels: string | null;
  recordingStartedAt: string | null;
  recordingEndedAt: string | null;
  /** recording.transcription.saved */
  transcriptionText: string | null;
  transcriptionId: string | null;
  /** recording.error */
  reason: string | null;
}

function s(x: unknown): string | null {
  return typeof x === "string" && x.length ? x : null;
}

/** Parse a Call Control webhook body (JSON-parsed). Null when not a Telnyx
 *  event. Never throws. */
export function parseVoiceEvent(body: unknown): VoiceEvent | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const type = s(d.event_type);
  if (!type) return null;
  const p = (d.payload && typeof d.payload === "object" ? d.payload : {}) as Record<string, unknown>;
  const urls = p.recording_urls && typeof p.recording_urls === "object" ? (p.recording_urls as Record<string, unknown>) : null;
  const dir = s(p.direction);
  return {
    type,
    eventId: s(d.id),
    occurredAt: s(d.occurred_at),
    callControlId: s(p.call_control_id),
    callLegId: s(p.call_leg_id),
    callSessionId: s(p.call_session_id),
    clientState: decodeClientState(s(p.client_state)),
    direction: dir === "incoming" || dir === "outgoing" ? dir : null,
    from: s(p.from),
    to: s(p.to),
    hangupCause: s(p.hangup_cause),
    hangupSource: s(p.hangup_source),
    status: s(p.status),
    recordingId: s(p.recording_id),
    recordingUrls: urls ? { mp3: s(urls.mp3), wav: s(urls.wav) } : null,
    recordingChannels: s(p.channels),
    recordingStartedAt: s(p.recording_started_at),
    recordingEndedAt: s(p.recording_ended_at),
    transcriptionText: typeof p.transcription_text === "string" ? p.transcription_text : null,
    transcriptionId: s(p.recording_transcription_id),
    reason: s(p.reason),
  };
}

// ─── State ───────────────────────────────────────────────────────────────────

export type CallStatus = "ringing" | "bridged" | "voicemail" | "completed" | "missed" | "no_answer" | "failed";
export type CallOutcome = "answered" | "voicemail" | "missed" | "no_answer" | "failed";

export interface CallState {
  id: string;
  direction: "inbound" | "outbound";
  status: CallStatus;
  /** The counterparty's leg: inbound caller, or the dialed client. */
  counterpartyLeg: string | null;
  /** Joe's leg: the forward leg (inbound) or the first-dialed leg (outbound). */
  ownerLeg: string | null;
  bridged: boolean;
  voicemail: boolean;
  recording: boolean;
  ended: boolean;
}

export interface FlowConfig {
  fromNumber: string;
  forwardTo: string;
  recording: "all" | "off";
  announcement: "on" | "off";
  ringSeconds: number;
  recordingNotice: string;
  voicemailGreeting: string;
  /** Display name for the counterparty on outbound ("Calling Dave…"). */
  counterpartyName?: string | null;
}

export const DEFAULT_RECORDING_NOTICE = "This call may be recorded for quality and record keeping.";
export const DEFAULT_VOICEMAIL_GREETING =
  "You've reached SJ Carpentry. Joe can't take your call right now. Please leave your name, number and a short message after the tone, and he'll call you back.";

// ─── Actions ─────────────────────────────────────────────────────────────────

export type VoiceAction =
  | { type: "answer"; leg: string; state: ClientState }
  | { type: "speak"; leg: string; text: string; state: ClientState }
  | { type: "record_start"; leg: string; playBeep: boolean; state: ClientState }
  | { type: "dial"; to: string; from: string; timeoutSecs: number; linkTo: string | null; state: ClientState }
  | { type: "play_ringback"; leg: string; state: ClientState }
  | { type: "play_beep"; leg: string; state: ClientState }
  | { type: "playback_stop"; leg: string }
  | { type: "bridge"; leg: string; withLeg: string; state: ClientState }
  | { type: "hangup"; leg: string; state?: ClientState };

export interface Plan {
  actions: VoiceAction[];
  patch: Partial<CallState>;
  outcome?: CallOutcome;
  /** Set when this event ends a call that has no bridged human leg but a
   *  message was left (or attempted): file the callback work item + push. */
  fileVoicemail?: boolean;
  /** Log line for call_events / debugging. */
  note: string;
}

const none = (note: string): Plan => ({ actions: [], patch: {}, note });

/** Plan the reaction to one event. `call` is null for a fresh inbound
 *  call.initiated (the row is created from the returned patch). */
export function planVoiceEvent(ev: VoiceEvent, call: CallState | null, cfg: FlowConfig, newCallId?: string): Plan {
  const leg = ev.callControlId;
  const cs = ev.clientState;

  // ── Fresh inbound call: no client_state yet, direction incoming ──────────
  if (ev.type === "call.initiated" && !cs) {
    if (ev.direction !== "incoming" || !leg) return none("ignored: outgoing/unknown initiated without state");
    if (!newCallId) return none("ignored: no call id allocated for a fresh inbound");
    return {
      actions: [{ type: "answer", leg, state: { c: newCallId, r: "caller", p: "answered" } }],
      patch: { id: newCallId, direction: "inbound", status: "ringing", counterpartyLeg: leg, bridged: false, voicemail: false, recording: false, ended: false },
      note: "inbound call: answering",
    };
  }
  if (!cs || !call) return none(`ignored: ${ev.type} without a known call`);
  if (call.ended && ev.type !== "call.hangup") return none(`ignored: ${ev.type} after the call ended`);
  const st = (r: LegRole, p: Phase): ClientState => ({ c: call.id, r, p });

  switch (ev.type) {
    case "call.initiated": {
      // Our own dial legs announce themselves here (outgoing + our state).
      if (cs.r === "forward" || cs.r === "owner") return { actions: [], patch: { ownerLeg: leg }, note: `${cs.r} leg initiated` };
      if (cs.r === "client") return { actions: [], patch: { counterpartyLeg: leg }, note: "client leg initiated" };
      return none("initiated: caller leg already known");
    }

    case "call.answered": {
      if (!leg) return none("answered without leg id");
      if (cs.r === "caller") {
        // Inbound: caller leg answered by us. Announce (optional) → record → ring Joe.
        const actions: VoiceAction[] = [];
        if (cfg.announcement === "on") actions.push({ type: "speak", leg, text: cfg.recordingNotice, state: st("caller", "announce") });
        if (cfg.recording === "all") actions.push({ type: "record_start", leg, playBeep: false, state: st("caller", "record") });
        if (cfg.announcement !== "on") actions.push(...ringOwner(call, leg, cfg));
        return {
          actions,
          patch: { recording: cfg.recording === "all", counterpartyLeg: leg },
          note: cfg.announcement === "on" ? "caller answered: playing recorded-call notice" : "caller answered: ringing Joe",
        };
      }
      if (cs.r === "forward") {
        // Joe picked up: stop the caller's ringback, bridge.
        if (!call.counterpartyLeg) return none("forward answered but caller leg unknown");
        return {
          actions: [
            { type: "playback_stop", leg: call.counterpartyLeg },
            { type: "bridge", leg: call.counterpartyLeg, withLeg: leg, state: st("caller", "hangup") },
          ],
          patch: { ownerLeg: leg, bridged: true, status: "bridged" },
          outcome: "answered",
          note: "Joe answered: bridging",
        };
      }
      if (cs.r === "owner") {
        // Click-to-call: Joe is on the line. Record his leg, then dial the client.
        const actions: VoiceAction[] = [];
        if (cfg.recording === "all") actions.push({ type: "record_start", leg, playBeep: false, state: st("owner", "record") });
        actions.push({
          type: "dial",
          to: call.counterpartyLeg ?? "", // filled by the executor from the call row (the client's number)
          from: cfg.fromNumber,
          timeoutSecs: Math.max(15, cfg.ringSeconds + 5),
          linkTo: leg,
          state: st("client", "answered"),
        });
        actions.push({ type: "play_ringback", leg, state: st("owner", "ringback") });
        return { actions, patch: { ownerLeg: leg, recording: cfg.recording === "all" }, note: "Joe answered: dialing the client" };
      }
      if (cs.r === "client") {
        if (!call.ownerLeg) return none("client answered but owner leg unknown");
        return {
          actions: [
            { type: "playback_stop", leg: call.ownerLeg },
            { type: "bridge", leg: call.ownerLeg, withLeg: leg, state: st("owner", "hangup") },
          ],
          patch: { counterpartyLeg: leg, bridged: true, status: "bridged" },
          outcome: "answered",
          note: "client answered: bridging",
        };
      }
      return none("answered: unknown role");
    }

    case "call.speak.ended": {
      if (!leg) return none("speak.ended without leg");
      if (cs.p === "announce" && cs.r === "caller") {
        return { actions: ringOwner(call, leg, cfg), patch: {}, note: "notice done: ringing Joe" };
      }
      if (cs.p === "vm_greeting" && cs.r === "caller") {
        if (call.recording) {
          return { actions: [{ type: "play_beep", leg, state: st("caller", "vm_beep") }], patch: {}, note: "greeting done: beep (already recording)" };
        }
        return {
          actions: [{ type: "record_start", leg, playBeep: true, state: st("caller", "vm_record") }],
          patch: { recording: true },
          note: "greeting done: recording the voicemail",
        };
      }
      if (cs.p === "c2c_no_answer" && cs.r === "owner") {
        return { actions: [{ type: "hangup", leg }], patch: {}, note: "told Joe there was no answer: hanging up" };
      }
      return none(`speak.ended (${cs.r}/${cs.p ?? "-"}): nothing to do`);
    }

    case "call.hangup": {
      const cause = ev.hangupCause ?? "unknown";
      if (cs.r === "forward") {
        if (call.bridged || call.ended) return { actions: [], patch: {}, note: `forward leg hung up (${cause}) after bridge` };
        // Joe did not pick up (timeout / busy / rejected / cancelled): voicemail.
        if (!call.counterpartyLeg) return none("forward hangup, no caller leg");
        return {
          actions: [
            { type: "playback_stop", leg: call.counterpartyLeg },
            { type: "speak", leg: call.counterpartyLeg, text: cfg.voicemailGreeting, state: st("caller", "vm_greeting") },
          ],
          patch: { voicemail: true, status: "voicemail" },
          note: `Joe did not answer (${cause}): voicemail greeting`,
        };
      }
      if (cs.r === "caller") {
        const actions: VoiceAction[] = [];
        // Stop ringing Joe's phone if the caller gave up mid-ring.
        if (call.ownerLeg && !call.bridged) actions.push({ type: "hangup", leg: call.ownerLeg });
        const outcome: CallOutcome = call.bridged ? "answered" : call.voicemail ? "voicemail" : "missed";
        return {
          actions,
          patch: { ended: true, status: outcome === "answered" ? "completed" : outcome === "voicemail" ? "voicemail" : "missed" },
          outcome,
          fileVoicemail: outcome === "voicemail",
          note: `caller hung up (${cause}): ${outcome}`,
        };
      }
      if (cs.r === "client") {
        if (call.bridged || call.ended) {
          return { actions: [], patch: { ended: true, status: "completed" }, outcome: "answered", note: `client hung up (${cause}) after bridge` };
        }
        if (!call.ownerLeg) return none("client hangup, no owner leg");
        const who = cfg.counterpartyName ? cfg.counterpartyName : "the number you called";
        return {
          actions: [
            { type: "playback_stop", leg: call.ownerLeg },
            { type: "speak", leg: call.ownerLeg, text: `No answer from ${who}.`, state: st("owner", "c2c_no_answer") },
          ],
          patch: { status: "no_answer" },
          outcome: "no_answer",
          note: `client did not answer (${cause})`,
        };
      }
      if (cs.r === "owner") {
        const actions: VoiceAction[] = [];
        if (call.counterpartyLeg && !call.bridged) actions.push({ type: "hangup", leg: call.counterpartyLeg });
        const outcome: CallOutcome = call.bridged ? "answered" : call.status === "no_answer" ? "no_answer" : "missed";
        return {
          actions,
          patch: { ended: true, status: outcome === "answered" ? "completed" : outcome === "no_answer" ? "no_answer" : "failed" },
          outcome,
          note: `Joe hung up (${cause}): ${outcome}`,
        };
      }
      return none("hangup: unknown role");
    }

    case "call.playback.ended":
    case "call.playback.started":
    case "call.speak.started":
    case "call.bridged":
    case "call.recording.saved":
    case "call.recording.transcription.saved":
    case "call.recording.error":
    case "call.machine.detection.ended":
      // Persistence-only events (lib/voice.ts handles recording/transcript).
      return none(`${ev.type}: no flow action`);
    default:
      return none(`${ev.type}: unhandled event type`);
  }
}

/** Ring Joe's cell for an inbound call and give the caller ringback. */
function ringOwner(call: CallState, callerLeg: string, cfg: FlowConfig): VoiceAction[] {
  return [
    {
      type: "dial",
      to: cfg.forwardTo,
      from: cfg.fromNumber,
      timeoutSecs: cfg.ringSeconds,
      linkTo: callerLeg,
      state: { c: call.id, r: "forward", p: "answered" },
    },
    { type: "play_ringback", leg: callerLeg, state: { c: call.id, r: "caller", p: "ringback" } },
  ];
}

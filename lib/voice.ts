import "server-only";

// Voice on Telnyx Call Control — the phone half of the comms build.
//
//   Inbound:  calls to the business number are answered by the OS, recorded
//             (dual channel, Telnyx transcription), and forwarded to Joe's
//             cell. No IVR, no greeting: he answers his phone the way he
//             always has. No answer → voicemail (greeting, beep, recorded,
//             transcribed) → a callback work item + a push.
//   Outbound: click-to-call. Joe's cell rings FIRST; once he is on the line
//             the OS dials the client and bridges. Placing a call is a
//             communication with a client, so it spends a single-use owner
//             grant (action 'place_call') exactly like send_sms / send_email.
//
// The flow itself is the pure planner in lib/comms/voice-flow.ts; this
// module owns persistence (calls / call_events / files), executes the
// planner's commands through lib/telnyx.ts, and files the work items and
// pushes. Recordings + transcripts are client data: Postgres and uploads/ on
// Joe's box, never a log line.

import { randomUUID } from "node:crypto";
import { query, queryOne } from "./db";
import { commsEnvReport, voiceConfigFrom, type VoiceConfig } from "./comms/env";
import { normalizeE164 } from "./comms/phone";
import {
  DEFAULT_RECORDING_NOTICE,
  DEFAULT_VOICEMAIL_GREETING,
  planVoiceEvent,
  type CallOutcome,
  type CallState,
  type CallStatus,
  type FlowConfig,
  type VoiceAction,
  type VoiceEvent,
} from "./comms/voice-flow";
import { callControl, downloadMedia } from "./telnyx";
import { storeBuffer } from "./upload-store";
import { notifyOwner } from "./notify-owner";
import { consumeGrant, recordGrantResult, refundGrantUse } from "./owner-grants";
import { appUrl, fileCommsWorkItem, linkHref, matchPhoneToRecord, type CommsLinkType } from "./comms-shared";
import { reportCommsFailure } from "./comms-health";

// ─── Config ──────────────────────────────────────────────────────────────────

export function voiceConfig(): VoiceConfig | null {
  return voiceConfigFrom();
}

export function voiceConfigured(): boolean {
  return voiceConfig() !== null;
}

export function voiceStatus(): { configured: boolean; enabled: boolean; problems: string[] } {
  const r = commsEnvReport();
  return { configured: r.voice.ok, enabled: r.voice.enabled, problems: r.problems.filter((p) => p.startsWith("Voice")) };
}

function flowConfig(cfg: VoiceConfig, counterpartyName?: string | null): FlowConfig {
  return {
    fromNumber: cfg.fromNumber,
    forwardTo: cfg.forwardTo,
    recording: cfg.recording,
    announcement: cfg.announcement,
    ringSeconds: Math.max(10, Math.min(60, Number(process.env.VOICE_RING_SECONDS ?? 25) || 25)),
    recordingNotice: (process.env.VOICE_RECORDING_NOTICE ?? "").trim() || DEFAULT_RECORDING_NOTICE,
    voicemailGreeting: (process.env.VOICE_VOICEMAIL_GREETING ?? "").trim() || DEFAULT_VOICEMAIL_GREETING,
    counterpartyName: counterpartyName ?? null,
  };
}

// ─── Rows ────────────────────────────────────────────────────────────────────

export interface CallRow {
  id: string;
  direction: "inbound" | "outbound";
  call_session_id: string | null;
  counterparty_leg_id: string | null;
  owner_leg_id: string | null;
  counterparty_number: string;
  business_number: string;
  owner_number: string | null;
  contact_name: string | null;
  link_type: CommsLinkType | null;
  link_slug: string | null;
  lead_id: string | null;
  project_id: string | null;
  status: CallStatus;
  outcome: CallOutcome | null;
  bridged: boolean;
  voicemail: boolean;
  recording: boolean;
  ended: boolean;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_s: number | null;
  hangup_cause: string | null;
  recording_status: "none" | "recording" | "saved" | "failed";
  recording_file_id: string | null;
  transcript: string | null;
  transcript_status: "none" | "pending" | "done" | "failed";
  notes: CallNotesShape | null;
  notes_text: string | null;
  notes_status: "none" | "pending" | "done" | "failed" | "skipped";
  notes_error: string | null;
  work_item_id: string | null;
  knowledge_item_id: string | null;
  placed_by: string | null;
  error: string | null;
}

/** Structured AI notes (lib/call-notes.ts writes them). */
export interface CallNotesShape {
  summary: string;
  decisions: { text: string; by: string }[];
  action_items: { text: string; owner: string; due: string | null }[];
  flags: { kind: "scope_change" | "price" | "schedule"; text: string }[];
}

const ISO = (c: string) => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const CALL_COLS = `id, direction, call_session_id, counterparty_leg_id, owner_leg_id, counterparty_number, business_number,
  owner_number, contact_name, link_type, link_slug, lead_id, project_id, status, outcome, bridged, voicemail, recording, ended,
  ${ISO("started_at")} AS started_at, ${ISO("answered_at")} AS answered_at, ${ISO("ended_at")} AS ended_at, duration_s, hangup_cause,
  recording_status, recording_file_id, transcript, transcript_status, notes, notes_text, notes_status, notes_error,
  work_item_id, knowledge_item_id, placed_by, error`;

export async function getCall(id: string): Promise<CallRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return queryOne<CallRow>(`SELECT ${CALL_COLS} FROM calls WHERE id = $1`, [id]);
}

export async function listCalls(limit = 100): Promise<CallRow[]> {
  const { rows } = await query<CallRow>(`SELECT ${CALL_COLS} FROM calls ORDER BY started_at DESC LIMIT $1`, [limit]);
  return rows;
}

export async function getCallEvents(id: string): Promise<{ event_type: string; note: string; occurred_at: string | null; created_at: string }[]> {
  const { rows } = await query<{ event_type: string; note: string; occurred_at: string | null; created_at: string }>(
    `SELECT event_type, note, ${ISO("occurred_at")} AS occurred_at, ${ISO("created_at")} AS created_at FROM call_events WHERE call_id = $1 ORDER BY id`,
    [id],
  );
  return rows;
}

function toState(r: CallRow): CallState {
  return {
    id: r.id,
    direction: r.direction,
    status: r.status,
    counterpartyLeg: r.counterparty_leg_id,
    ownerLeg: r.owner_leg_id,
    bridged: r.bridged,
    voicemail: r.voicemail,
    recording: r.recording,
    ended: r.ended,
  };
}

export function callDisplayName(r: Pick<CallRow, "contact_name" | "counterparty_number">): string {
  return r.contact_name?.trim() || r.counterparty_number;
}

// ─── Webhook handling ────────────────────────────────────────────────────────

async function findCall(ev: VoiceEvent): Promise<CallRow | null> {
  if (ev.clientState?.c) {
    const byId = await getCall(ev.clientState.c);
    if (byId) return byId;
  }
  if (ev.callSessionId) {
    const bySession = await queryOne<CallRow>(`SELECT ${CALL_COLS} FROM calls WHERE call_session_id = $1`, [ev.callSessionId]);
    if (bySession) return bySession;
  }
  return null;
}

/** Record the event (dedup on Telnyx event id). False = already seen. */
async function recordEvent(callId: string | null, ev: VoiceEvent, note: string): Promise<boolean> {
  const safePayload = {
    leg: ev.callControlId,
    session: ev.callSessionId,
    role: ev.clientState?.r ?? null,
    phase: ev.clientState?.p ?? null,
    hangup_cause: ev.hangupCause,
    status: ev.status,
    recording_id: ev.recordingId,
    channels: ev.recordingChannels,
    reason: ev.reason,
  };
  const r = await query(
    `INSERT INTO call_events (call_id, event_id, event_type, leg_id, note, payload, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (event_id) DO NOTHING`,
    [callId, ev.eventId ?? randomUUID(), ev.type, ev.callControlId, note.slice(0, 300), JSON.stringify(safePayload), ev.occurredAt],
  );
  return (r.rowCount ?? 0) === 1;
}

async function applyPatch(id: string, patch: Partial<CallState>, outcome: CallOutcome | undefined, ev: VoiceEvent): Promise<void> {
  const sets: string[] = ["updated_at = now()"];
  const vals: unknown[] = [id];
  const push = (sql: string, v: unknown) => {
    vals.push(v);
    sets.push(`${sql} = $${vals.length}`);
  };
  if (patch.status) push("status", patch.status);
  if (patch.counterpartyLeg) push("counterparty_leg_id", patch.counterpartyLeg);
  if (patch.ownerLeg) push("owner_leg_id", patch.ownerLeg);
  if (patch.bridged !== undefined) push("bridged", patch.bridged);
  if (patch.voicemail !== undefined) push("voicemail", patch.voicemail);
  if (patch.recording !== undefined) {
    push("recording", patch.recording);
    if (patch.recording) sets.push(`recording_status = CASE WHEN recording_status = 'none' THEN 'recording' ELSE recording_status END`);
  }
  if (patch.bridged) sets.push("answered_at = COALESCE(answered_at, now())");
  if (outcome) push("outcome", outcome);
  if (patch.ended) {
    sets.push("ended = true", "ended_at = COALESCE(ended_at, now())");
    sets.push("duration_s = GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - COALESCE(answered_at, started_at)))::int)");
    if (ev.hangupCause) push("hangup_cause", ev.hangupCause);
  }
  if (ev.callSessionId) sets.push(`call_session_id = COALESCE(call_session_id, $${vals.push(ev.callSessionId)})`);
  await query(`UPDATE calls SET ${sets.join(", ")} WHERE id = $1`, vals);
}

async function execute(cfg: VoiceConfig, call: CallRow, actions: VoiceAction[]): Promise<void> {
  const base = appUrl();
  for (const a of actions) {
    try {
      switch (a.type) {
        case "answer":
          await callControl.answer(cfg, a.leg, a.state);
          break;
        case "speak":
          await callControl.speak(cfg, a.leg, a.text, a.state);
          break;
        case "record_start":
          await callControl.recordStart(cfg, a.leg, { playBeep: a.playBeep, state: a.state });
          await query(`UPDATE calls SET recording = true, recording_status = 'recording', updated_at = now() WHERE id = $1`, [call.id]);
          break;
        case "dial": {
          const to = a.to || call.counterparty_number; // outbound: the planner leaves `to` for us to fill
          const leg = await callControl.dial(cfg, { ...a, to });
          const col = a.state.r === "client" ? "counterparty_leg_id" : "owner_leg_id";
          await query(`UPDATE calls SET ${col} = $2, call_session_id = COALESCE(call_session_id, $3), updated_at = now() WHERE id = $1`, [
            call.id,
            leg.callControlId,
            leg.callSessionId,
          ]);
          break;
        }
        case "play_ringback":
          await callControl.playbackStart(cfg, a.leg, `${base}/api/voice/audio/ringback.wav`, { loop: true, state: a.state });
          break;
        case "play_beep":
          await callControl.playbackStart(cfg, a.leg, `${base}/api/voice/audio/beep.wav`, { loop: false, state: a.state });
          break;
        case "playback_stop":
          await callControl.playbackStop(cfg, a.leg).catch(() => {}); // nothing playing is fine
          break;
        case "bridge":
          await callControl.bridge(cfg, a.leg, a.withLeg, a.state);
          break;
        case "hangup":
          await callControl.hangup(cfg, a.leg, a.state).catch(() => {}); // already gone is fine
          break;
      }
    } catch (err) {
      await query(`UPDATE calls SET error = $2, updated_at = now() WHERE id = $1`, [call.id, `${a.type}: ${(err as Error).message}`.slice(0, 500)]);
      await reportCommsFailure("voice-command", err, { detail: `${a.type} on call ${call.id} (${call.direction} ${callDisplayName(call)})`, href: "/calls" });
      // A failed answer/dial strands the caller: end the call cleanly.
      if ((a.type === "answer" || a.type === "dial") && call.direction === "inbound" && call.counterparty_leg_id) {
        await callControl.hangup(cfg, call.counterparty_leg_id).catch(() => {});
        await query(`UPDATE calls SET status = 'failed', outcome = 'failed', ended = true, ended_at = now(), updated_at = now() WHERE id = $1`, [call.id]);
      }
      return;
    }
  }
}

/** Handle one verified Call Control event. Idempotent on the Telnyx event id. */
export async function handleVoiceEvent(ev: VoiceEvent): Promise<{ handled: boolean; note: string }> {
  const cfg = voiceConfig();
  if (!cfg) return { handled: false, note: "voice not configured" };

  let call = await findCall(ev);
  let newCallId: string | undefined;

  // Fresh inbound call: create the row before planning so every later event
  // has something to attach to.
  if (!call && ev.type === "call.initiated" && !ev.clientState && ev.direction === "incoming" && ev.callControlId) {
    const from = ev.from ?? "";
    const norm = normalizeE164(from);
    const counterparty = norm.ok ? norm.e164 : from || "unknown";
    const match = norm.ok ? await matchPhoneToRecord(counterparty) : null;
    newCallId = randomUUID();
    await query(
      `INSERT INTO calls (id, direction, call_session_id, counterparty_leg_id, counterparty_number, business_number, owner_number,
                          contact_name, link_type, link_slug, lead_id, project_id, status)
       VALUES ($1, 'inbound', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ringing')`,
      [
        newCallId,
        ev.callSessionId,
        ev.callControlId,
        counterparty,
        ev.to ?? cfg.fromNumber,
        cfg.forwardTo,
        match?.contactName ?? null,
        match?.linkType ?? null,
        match?.linkSlug ?? null,
        match?.leadId ?? null,
        match?.projectId ?? null,
      ],
    );
    call = await getCall(newCallId);
  }

  const plan = planVoiceEvent(ev, call ? toState(call) : null, flowConfig(cfg, call?.contact_name), newCallId);
  const fresh = await recordEvent(call?.id ?? null, ev, plan.note);
  if (!fresh) return { handled: false, note: "duplicate event" };
  if (!call) return { handled: false, note: plan.note };

  // Persistence-only events.
  if (ev.type === "call.recording.saved") {
    await saveRecording(call, ev);
    return { handled: true, note: "recording saved" };
  }
  if (ev.type === "call.recording.transcription.saved") {
    await saveTranscript(call, ev);
    return { handled: true, note: "transcript saved" };
  }
  if (ev.type === "call.recording.error") {
    await query(`UPDATE calls SET recording_status = 'failed', recording_error = $2, updated_at = now() WHERE id = $1`, [call.id, ev.reason ?? "unknown"]);
    await reportCommsFailure("recording", new Error(`Telnyx recording error: ${ev.reason ?? "unknown"}`), { detail: `call ${call.id}`, href: "/calls" });
    return { handled: true, note: "recording error" };
  }

  await applyPatch(call.id, plan.patch, plan.outcome, ev);
  const current = (await getCall(call.id)) ?? call;
  await execute(cfg, current, plan.actions);

  if (plan.patch.ended) await onCallEnded(current, plan);
  return { handled: true, note: plan.note };
}

async function onCallEnded(call: CallRow, plan: { outcome?: CallOutcome; fileVoicemail?: boolean }): Promise<void> {
  const name = callDisplayName(call);
  const href = linkHref(call.link_type, call.link_slug) ?? "/calls";
  const who = `${name}${call.link_type ? ` (${call.link_type})` : ""}`;
  if (plan.fileVoicemail) {
    const workItemId = await fileCommsWorkItem({
      title: `Call back ${name} — voicemail`,
      body:
        `Missed call from ${who} at ${call.started_at}; a voicemail was left on ${call.business_number}. ` +
        `The recording and transcript attach to the call record as they land, and AI notes follow. ` +
        `Call back from /calls (click-to-call rings your cell first). [call:${call.id}]`,
      priority: "high",
      status: "waiting_on_human",
      leadId: call.lead_id,
      projectId: call.project_id,
      sourceKind: "call",
      sourceId: `call:${call.id}`,
      expectedSkillSlug: "client-followup-draft",
    });
    if (workItemId) await query(`UPDATE calls SET work_item_id = $2, updated_at = now() WHERE id = $1`, [call.id, workItemId]);
    await notifyOwner({ kind: "voice_call", title: `Voicemail from ${who}`, body: "Callback filed in Today. Transcript + notes to follow.", href });
  } else if (plan.outcome === "missed") {
    await notifyOwner({ kind: "voice_call", title: `Missed call from ${who}`, body: "No voicemail left.", href });
  }
  // No recording will come (recording off, or nothing recorded): close the notes loop.
  if (!call.recording) {
    await query(`UPDATE calls SET notes_status = 'skipped', transcript_status = 'none', updated_at = now() WHERE id = $1 AND notes_status = 'none'`, [call.id]);
  }
}

async function saveRecording(call: CallRow, ev: VoiceEvent): Promise<void> {
  const url = ev.recordingUrls?.mp3 ?? ev.recordingUrls?.wav ?? null;
  if (!url) {
    await query(`UPDATE calls SET recording_status = 'failed', recording_error = 'no recording url', updated_at = now() WHERE id = $1`, [call.id]);
    await reportCommsFailure("recording", new Error("call.recording.saved carried no recording URL"), { detail: `call ${call.id}`, href: "/calls" });
    return;
  }
  try {
    // URLs are valid for 10 minutes — fetch now, keep forever on our disk.
    const { bytes, mime } = await downloadMedia(url, 200 * 1024 * 1024);
    const ext = url.includes(".wav") || mime.includes("wav") ? "wav" : "mp3";
    const stamp = call.started_at.slice(0, 16).replace("T", " ");
    const stored = await storeBuffer(bytes, {
      filename: `Call ${call.direction} ${callDisplayName(call)} ${stamp}.${ext}`,
      mime: ext === "wav" ? "audio/wav" : "audio/mpeg",
      idPrefix: "call",
      tag: "CALL · RECORDING",
      subtitle: `${call.direction === "inbound" ? "Inbound" : "Outbound"} call with ${callDisplayName(call)}`,
    });
    if (!stored.ok) throw new Error(stored.error);
    const cfg = voiceConfig();
    await query(
      `UPDATE calls SET recording_status = 'saved', recording_file_id = $2, recording_id = $3, recording_channels = $4,
                        transcript_status = CASE WHEN transcript_status = 'none' AND $5 THEN 'pending' ELSE transcript_status END,
                        transcript_engine = $6, updated_at = now()
        WHERE id = $1`,
      [call.id, stored.id, ev.recordingId, ev.recordingChannels, cfg?.transcription === "telnyx", cfg?.transcription ?? null],
    );
  } catch (err) {
    await query(`UPDATE calls SET recording_status = 'failed', recording_error = $2, updated_at = now() WHERE id = $1`, [call.id, (err as Error).message.slice(0, 500)]);
    await reportCommsFailure("recording", err, { detail: `storing the recording for call ${call.id}`, href: "/calls" });
  }
}

async function saveTranscript(call: CallRow, ev: VoiceEvent): Promise<void> {
  const text = (ev.transcriptionText ?? "").trim();
  await query(
    `UPDATE calls SET transcript = $2, transcript_status = $3, updated_at = now() WHERE id = $1`,
    [call.id, text || null, text ? "done" : "failed"],
  );
  if (!text) {
    await query(`UPDATE calls SET notes_status = 'skipped', notes_error = 'empty transcript', updated_at = now() WHERE id = $1`, [call.id]);
    return;
  }
  // AI call notes — the feature Joe actually asked for. Runs through the
  // orchestrator (Hermes drafts, Claude reviews); failures file a work item.
  const { generateCallNotes } = await import("./call-notes");
  await generateCallNotes(call.id);
}

// ─── Click-to-call ───────────────────────────────────────────────────────────

export interface PlaceCallInput {
  to: string;
  /** Single-use owner grant covering place_call for this number. Required. */
  grantId: string;
  /** 'owner' or 'mcp:<agent>'. */
  actor: string;
  contactName?: string | null;
}

export type PlaceCallResult =
  | { ok: true; callId: string; summary: string }
  | { ok: false; error: string; blocked?: "not_configured" | "grant" | "invalid_number" };

/** Dial Joe's cell first; once he answers, the OS dials the client and
 *  bridges (lib/comms/voice-flow.ts). Spends the grant before dialing. */
export async function placeCall(input: PlaceCallInput): Promise<PlaceCallResult> {
  const cfg = voiceConfig();
  if (!cfg) {
    const s = voiceStatus();
    return { ok: false, error: s.enabled ? `Voice is misconfigured: ${s.problems.join("; ")}` : "Voice is not configured (VOICE_APPLICATION_ID unset).", blocked: "not_configured" };
  }
  const norm = normalizeE164(input.to);
  if (!norm.ok) return { ok: false, error: norm.error, blocked: "invalid_number" };
  const to = norm.e164;
  if (to === cfg.forwardTo) return { ok: false, error: "That is Joe's own cell number." };

  const spent = await consumeGrant(input.grantId, "place_call", { kind: "phone", id: to, to });
  if (!spent.ok) return { ok: false, error: spent.error, blocked: "grant" };

  const match = await matchPhoneToRecord(to);
  const id = randomUUID();
  await query(
    `INSERT INTO calls (id, direction, counterparty_number, business_number, owner_number, contact_name, link_type, link_slug,
                        lead_id, project_id, status, grant_id, placed_by)
     VALUES ($1, 'outbound', $2, $3, $4, $5, $6, $7, $8, $9, 'ringing', $10, $11)`,
    [
      id,
      to,
      cfg.fromNumber,
      cfg.forwardTo,
      input.contactName?.trim() || match?.contactName || null,
      match?.linkType ?? null,
      match?.linkSlug ?? null,
      match?.leadId ?? null,
      match?.projectId ?? null,
      input.grantId,
      input.actor.slice(0, 80),
    ],
  );
  try {
    const leg = await callControl.dial(cfg, {
      to: cfg.forwardTo,
      from: cfg.fromNumber,
      timeoutSecs: flowConfig(cfg).ringSeconds,
      linkTo: null,
      state: { c: id, r: "owner", p: "answered" },
    });
    await query(`UPDATE calls SET owner_leg_id = $2, call_session_id = $3, updated_at = now() WHERE id = $1`, [id, leg.callControlId, leg.callSessionId]);
    const name = input.contactName?.trim() || match?.contactName || to;
    const summary = `Calling ${name}: Joe's cell is ringing; once he answers the OS dials ${to} and bridges.`;
    await recordGrantResult(input.grantId, `ok: ${summary}`);
    return { ok: true, callId: id, summary };
  } catch (err) {
    const msg = (err as Error).message;
    await query(`UPDATE calls SET status = 'failed', outcome = 'failed', ended = true, ended_at = now(), error = $2, updated_at = now() WHERE id = $1`, [id, msg.slice(0, 500)]);
    await refundGrantUse(input.grantId);
    await recordGrantResult(input.grantId, `failed: ${msg.slice(0, 200)}`);
    await reportCommsFailure("voice-command", err, { detail: `click-to-call to ${to} could not dial Joe's cell`, href: "/calls" });
    return { ok: false, error: `Could not start the call: ${msg}` };
  }
}

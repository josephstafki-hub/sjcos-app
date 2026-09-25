import "server-only";

// App-bound entry points for owner time capture (A19). Every write goes
// through ONE transaction, is keyed on the caller's client event id
// (replay-safe), and is scoped to the authenticated user — never to a user id
// or project id the client claims. Location suggests attendance; only a
// confirmation makes time count.

import { randomUUID } from "node:crypto";
import { withTransaction } from "@/lib/commands/db";
import { ingestLocationEvent, confirmClockIn, clockOut, proposeClockIn, type LocationEventInput, type LocationOutcome } from "./location";
import { ingestDesignerActivity, closeStaleDesignerSessions } from "./designer";
import { startTimer, stopTimer, correctInterval, reviewRange, runningTimer, closeStaleIntervals, TimeConflictError, type Category, type CorrectionInput, type ReviewList, type TimeInterval } from "./intervals";

export interface DesignerEventBody {
  designId: number;
  sessionId: string;
  seq: number;
  kind: "focus" | "heartbeat" | "blur" | "idle" | "end";
  at: string;
  deviceId?: string;
}
export interface LocationEventBody {
  deviceId: string;
  clientEventId: string;
  kind: "enter" | "exit" | "heartbeat";
  lat: number;
  lng: number;
  accuracyM?: number | null;
  at: string;
}

const CATEGORIES: Category[] = ["site", "design", "estimating", "admin", "other"];
const isCategory = (c: unknown): c is Category => CATEGORIES.includes(c as Category);
const errText = (e: unknown) => (e instanceof TimeConflictError ? e.message : e instanceof Error ? e.message : String(e));

/** Ingest a batch of location and/or designer events for ONE user. Each
 *  event is applied independently; a bad one reports its error and the rest
 *  still land (offline sync replays are expected). */
export async function ingestTimeEvents(userId: string, body: { location?: LocationEventBody[]; designer?: DesignerEventBody[] }) {
  const location: Array<{ clientEventId: string; outcome?: LocationOutcome; error?: string }> = [];
  const designer: Array<{ sessionId: string; seq: number; recorded?: boolean; projectId?: string | null; error?: string }> = [];
  for (const ev of body.location ?? []) {
    try {
      const input: LocationEventInput = { userId, deviceId: String(ev.deviceId ?? "unknown"), clientEventId: String(ev.clientEventId), kind: ev.kind, lat: Number(ev.lat), lng: Number(ev.lng), accuracyM: ev.accuracyM == null ? null : Number(ev.accuracyM), at: String(ev.at) };
      if (!["enter", "exit", "heartbeat"].includes(input.kind) || !Number.isFinite(input.lat) || !Number.isFinite(input.lng) || !input.clientEventId) throw new Error("bad location event");
      location.push({ clientEventId: input.clientEventId, outcome: await withTransaction((run) => ingestLocationEvent(run, input)) });
    } catch (e) {
      location.push({ clientEventId: String(ev?.clientEventId ?? ""), error: errText(e) });
    }
  }
  for (const ev of body.designer ?? []) {
    try {
      if (!["focus", "heartbeat", "blur", "idle", "end"].includes(ev.kind) || !Number.isFinite(Number(ev.designId)) || !ev.sessionId) throw new Error("bad designer event");
      const r = await withTransaction((run) => ingestDesignerActivity(run, { userId, designId: Number(ev.designId), sessionId: String(ev.sessionId), seq: Number(ev.seq), kind: ev.kind, at: String(ev.at), deviceId: ev.deviceId ? String(ev.deviceId) : undefined }));
      designer.push({ sessionId: String(ev.sessionId), seq: Number(ev.seq), ...r });
    } catch (e) {
      designer.push({ sessionId: String(ev?.sessionId ?? ""), seq: Number(ev?.seq ?? 0), error: errText(e) });
    }
  }
  return { location, designer };
}

export type TimerActionBody =
  | { action: "start"; clientEventId?: string; projectId?: string | null; category?: Category; startAt?: string; deviceId?: string; note?: string }
  | { action: "stop"; clientEventId?: string; intervalId?: string | null; endAt?: string }
  | { action: "confirm_clock_in"; clientEventId?: string; intervalId: string; projectId?: string | null; startAt?: string }
  | { action: "propose_clock_in"; clientEventId?: string; projectId: string; at?: string; deviceId?: string }
  | { action: "clock_out"; clientEventId?: string; intervalId?: string | null; endAt?: string; acceptSuggested?: boolean }
  | { action: "correct"; clientEventId?: string; intervalId: string; startAt?: string; endAt?: string | null; projectId?: string | null; category?: Category; state?: "confirmed" | "discarded"; note?: string };

/** One manual/site timer action for the authenticated user. */
export async function timerAction(user: { id: string; name: string }, body: TimerActionBody): Promise<{ ok: true; interval: TimeInterval | null; applied: boolean } | { ok: false; error: string }> {
  const clientEventId = body.clientEventId ? String(body.clientEventId) : randomUUID();
  try {
    const out = await withTransaction(async (run) => {
      switch (body.action) {
        case "start":
          return startTimer(run, { userId: user.id, clientEventId, projectId: body.projectId ?? null, category: isCategory(body.category) ? body.category : undefined, startAt: body.startAt, deviceId: body.deviceId, note: body.note, source: "timer" });
        case "stop":
          return stopTimer(run, { userId: user.id, clientEventId, intervalId: body.intervalId ?? null, endAt: body.endAt });
        case "confirm_clock_in":
          return confirmClockIn(run, { userId: user.id, clientEventId, intervalId: String(body.intervalId), projectId: body.projectId ?? null, startAt: body.startAt });
        case "propose_clock_in":
          return proposeClockIn(run, { userId: user.id, clientEventId, projectId: String(body.projectId), at: body.at, deviceId: body.deviceId });
        case "clock_out":
          return clockOut(run, { userId: user.id, clientEventId, intervalId: body.intervalId ?? null, endAt: body.endAt, acceptSuggested: body.acceptSuggested });
        case "correct": {
          const input: CorrectionInput = { userId: user.id, intervalId: String(body.intervalId), clientEventId, by: user.name, startAt: body.startAt, endAt: body.endAt, projectId: body.projectId, category: isCategory(body.category) ? body.category : undefined, state: body.state, note: body.note };
          return correctInterval(run, input);
        }
        default:
          throw new Error(`unknown timer action`);
      }
    });
    return { ok: true, interval: out.interval, applied: out.applied };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** Intervals + flags + totals for [from, to), after a stale-session sweep so
 *  a forgotten timer or a dead designer tab shows as a review item, never as
 *  hours that keep counting. */
export async function timeReview(userId: string, from: string, to: string): Promise<ReviewList & { running: TimeInterval | null }> {
  return withTransaction(async (run) => {
    await closeStaleIntervals(run, { maxHours: 14 });
    await closeStaleDesignerSessions(run, userId);
    const list = await reviewRange(run, userId, from, to);
    return { ...list, running: await runningTimer(run, userId) };
  });
}

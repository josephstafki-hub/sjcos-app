// Routine follow-up gate (DECISIONS "Request missing factual information /
// routine follow-up"; policy key `routine.followup`). Pure `run` module used
// by lead fact collection and sub document requests.
//
// If WS-approvals exposes `routineSendAllowed` (lib/decisions/routine.ts) it
// is used; otherwise this module evaluates the same policy config shape seeded
// by migration 0004: active version, weekday window in config.tz, cadence
// (min hours between, max per recipient per week), lane open, and the stop
// list (reply / decline / opt_out / pending_owner_decision). A "no" here means
// the message is STAGED for approval instead of sent — never dropped.

import type { Run } from "../commands/core.ts";
import { activePolicy, laneOpen, policyRef } from "../commands/policies.ts";

export interface RoutineSendInput {
  policyKey?: string;
  channel: "email" | "sms";
  recipient: string;
  leadId?: string | null;
  projectId?: string | null;
  /** Observed stop signals the caller already knows about. */
  signals?: { replied?: boolean; declined?: boolean; optedOut?: boolean; pendingOwnerDecision?: boolean };
  /** When the send would happen; default now. Tests pin this. */
  at?: Date;
  /** Recent automatic sends to this recipient (ISO timestamps). */
  recentSends?: string[];
}

export type RoutineVerdict = { ok: true; policyRef: string; nextWindowAt?: string } | { ok: false; reason: string; policyRef: string | null; stage: true };

/** WS-approvals' gate (lib/decisions/routine.ts): policy key + intent kind in, authRef out. */
type ExternalGate = (
  run: Run,
  input: { policyKey: string; recipient: string; projectId?: string | null; leadId?: string | null; kind: string; now?: Date; at?: Date | string | null },
) => Promise<{ ok: true; authRef: string } | { ok: false; reason: string; code?: string; policy?: { key: string; version: number } | null }>;
let external: ExternalGate | null | undefined;

async function loadExternal(): Promise<ExternalGate | null> {
  if (external !== undefined) return external;
  try {
    const spec = "../decisions/routine.ts";
    const mod = (await import(/* webpackIgnore: true */ spec)) as { routineSendAllowed?: ExternalGate };
    external = typeof mod.routineSendAllowed === "function" ? mod.routineSendAllowed : null;
  } catch {
    external = null;
  }
  return external;
}

function localParts(at: Date, tz: string): { day: number; hhmm: string } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = Object.fromEntries(f.formatToParts(at).map((p) => [p.type, p.value]));
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { day: days[parts.weekday] ?? 0, hhmm: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}` };
}

export async function routineSendAllowed(run: Run, input: RoutineSendInput): Promise<RoutineVerdict> {
  const key = input.policyKey ?? "routine.followup";
  // Stop signals the caller already observed outrank everything (a reply, a
  // decline, an opt-out, a pending owner decision) — checked here so the
  // shared gate never has to know each caller's record shape.
  const early = input.signals ?? {};
  if (early.declined) return { ok: false, reason: "They declined; stop.", policyRef: null, stage: true };
  if (early.optedOut) return { ok: false, reason: "Recipient opted out of this channel.", policyRef: null, stage: true };
  if (early.replied) return { ok: false, reason: "They replied; no further chase.", policyRef: null, stage: true };
  if (early.pendingOwnerDecision) return { ok: false, reason: "An owner decision is pending on this job.", policyRef: null, stage: true };
  const ext = await loadExternal();
  if (ext) {
    const v = await ext(run, { policyKey: key, recipient: input.recipient, projectId: input.projectId ?? null, leadId: input.leadId ?? null, kind: input.channel === "sms" ? "send_sms" : "send_email", at: input.at ?? null });
    if (v.ok) return { ok: true, policyRef: v.authRef };
    return { ok: false, reason: v.reason, policyRef: v.policy ? `policy:${v.policy.key}@${v.policy.version}` : null, stage: true };
  }
  const policy = await activePolicy(run, key);
  if (!policy) return { ok: false, reason: `Policy ${key} is not active; staging for approval.`, policyRef: null, stage: true };
  const ref = policyRef(policy);
  const cfg = policy.config as { lane?: string; tz?: string; window?: { days?: number[]; start?: string; end?: string }; cadence?: { minHoursBetween?: number; maxPerRecipientPerWeek?: number }; stop?: string[] };
  const lane = await laneOpen(run, (cfg.lane as "routine_followup") ?? "routine_followup");
  if (!lane.open) return { ok: false, reason: `Lane paused: ${lane.reason}`, policyRef: ref, stage: true };

  const s = input.signals ?? {};
  const stop = new Set(cfg.stop ?? []);
  if (stop.has("reply") && s.replied) return { ok: false, reason: "They replied; no further chase.", policyRef: ref, stage: true };
  if (stop.has("decline") && s.declined) return { ok: false, reason: "They declined; stop.", policyRef: ref, stage: true };
  if (s.optedOut) return { ok: false, reason: "Recipient opted out of this channel.", policyRef: ref, stage: true };
  if (stop.has("pending_owner_decision") && s.pendingOwnerDecision) return { ok: false, reason: "An owner decision is pending on this job.", policyRef: ref, stage: true };

  const rec = input.recipient.trim().toLowerCase();
  const [opt] = await run<{ id: number }>(`SELECT id FROM communication_optouts WHERE channel = $1 AND address = $2 AND revoked_at IS NULL`, [input.channel, rec]);
  if (opt) return { ok: false, reason: "Recipient opted out (communication_optouts).", policyRef: ref, stage: true };

  const at = input.at ?? new Date();
  const tz = cfg.tz ?? "America/Chicago";
  const { day, hhmm } = localParts(at, tz);
  const w = cfg.window ?? {};
  const days = w.days ?? [1, 2, 3, 4, 5];
  if (!days.includes(day) || (w.start && hhmm < w.start) || (w.end && hhmm >= w.end)) {
    return { ok: false, reason: `Outside the ${key} send window (${tz} ${w.start ?? "00:00"}–${w.end ?? "24:00"}, days ${days.join(",")}).`, policyRef: ref, stage: true };
  }
  const cadence = cfg.cadence ?? {};
  const recent = (input.recentSends ?? []).map((x) => new Date(x).getTime()).filter((t) => Number.isFinite(t));
  if (cadence.minHoursBetween && recent.some((t) => at.getTime() - t < cadence.minHoursBetween! * 3_600_000)) {
    return { ok: false, reason: `Sent to ${rec} within the last ${cadence.minHoursBetween}h.`, policyRef: ref, stage: true };
  }
  if (cadence.maxPerRecipientPerWeek && recent.filter((t) => at.getTime() - t < 7 * 86_400_000).length >= cadence.maxPerRecipientPerWeek) {
    return { ok: false, reason: `Already ${cadence.maxPerRecipientPerWeek} sends to ${rec} this week.`, policyRef: ref, stage: true };
  }
  return { ok: true, policyRef: ref };
}

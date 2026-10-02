// Routine policy gate (A10). Automatic factual communication is allowed only
// when an ACTIVE policy version says so, inside its outbound-hours window,
// within its cadence, with none of its stop conditions present, and with
// the lane open. The answer carries the `policy:<key>@<v>` auth ref the
// caller must put on its intent. A missing or draft policy holds the action
// (ok:false with the reason) — nothing is sent "because it seemed fine".
//
// Pure: `run` only. Other workstreams call this before staging an
// automatic send.

import type { Run } from "../commands/core.ts";
import { activePolicy, laneOpen, policyRef, type Lane, type Policy } from "../commands/policies.ts";

export interface RoutineSendInput {
  policyKey: string;
  /** Normalized recipient (email / +E.164). */
  recipient: string;
  projectId?: string | null;
  leadId?: string | null;
  /** Intent kind that will carry the send (send_email / send_sms). */
  kind: string;
  /** Test seam. */
  now?: Date;
  /** Evaluation instant (callers that plan ahead pass the send time). */
  at?: Date | string | null;
}

export type RoutineVerdict =
  | { ok: true; authRef: string; policy: Policy; lane: Lane }
  | { ok: false; reason: string; code: "no_policy" | "lane_paused" | "outside_window" | "cadence" | "stop" | "opt_out" | "pending_decision"; retryAt?: string | null; policy?: Policy | null };

interface PolicyConfig {
  lane?: Lane;
  tz?: string;
  window?: { days?: number[]; start?: string; end?: string };
  cadence?: { minHoursBetween?: number; maxPerRecipientPerWeek?: number };
  stop?: string[];
}

export async function routineSendAllowed(run: Run, input: RoutineSendInput): Promise<RoutineVerdict> {
  const policy = await activePolicy(run, input.policyKey);
  if (!policy) return { ok: false, code: "no_policy", reason: `Policy "${input.policyKey}" is not active. The action is held until the owner activates a version (drafts are proposals, not permission).` };
  const cfg = (policy.config ?? {}) as PolicyConfig;
  const lane: Lane = cfg.lane ?? "routine_followup";
  const ref = policyRef(policy);
  const recipient = input.recipient.trim().toLowerCase();

  const open = await laneOpen(run, lane);
  if (!open.open) return { ok: false, code: "lane_paused", reason: `Lane "${open.lane}" is paused: ${open.reason}`, policy };

  // Stop conditions that outrank the clock: an opt-out is final whatever the hour.
  const stops = cfg.stop ?? [];
  const channel = input.kind === "send_sms" ? "sms" : input.kind === "place_call" ? "phone" : "email";
  const [opt] = await run<{ id: number }>(`SELECT id FROM communication_optouts WHERE channel = $1 AND address = $2 AND revoked_at IS NULL`, [channel, recipient]);
  if (opt) return { ok: false, code: "opt_out", reason: `${recipient} opted out of ${channel}.`, policy };
  if (channel === "sms") {
    const [t] = await run<{ opted_out: boolean }>(`SELECT opted_out FROM sms_threads WHERE phone = $1`, [recipient]);
    if (t?.opted_out) return { ok: false, code: "opt_out", reason: `${recipient} texted STOP.`, policy };
  }

  // Outbound hours (wall clock in the policy's time zone, computed in Postgres).
  if (cfg.window) {
    const tz = cfg.tz ?? "America/Chicago";
    const [w] = await run<{ dow: number; hhmm: string; next_open: string | null }>(
      `SELECT extract(isodow FROM ts)::int AS dow, to_char(ts, 'HH24:MI') AS hhmm, NULL::text AS next_open
         FROM (SELECT $1::timestamptz AT TIME ZONE $2 AS ts) t`,
      [input.now ?? (input.at ? new Date(input.at) : new Date()), tz],
    );
    const days = cfg.window.days ?? [1, 2, 3, 4, 5];
    const start = cfg.window.start ?? "09:00";
    const end = cfg.window.end ?? "17:00";
    if (!days.includes(w.dow) || w.hhmm < start || w.hhmm >= end) {
      return { ok: false, code: "outside_window", reason: `Outside the policy's outbound hours (${days.map(dayName).join("/")} ${start}–${end} ${tz}); queued for the next window.`, policy };
    }
  }

  if (stops.includes("pending_owner_decision") && (input.projectId || input.leadId)) {
    const [pending] = await run<{ id: string }>(
      `SELECT id FROM decisions WHERE status = 'pending' AND expires_at > now()
         AND (($1::uuid IS NOT NULL AND project_id = $1) OR ($2::uuid IS NOT NULL AND lead_id = $2)) LIMIT 1`,
      [input.projectId ?? null, input.leadId ?? null],
    );
    if (pending) return { ok: false, code: "pending_decision", reason: `Routine follow-up waits: an owner decision is pending on this job (${pending.id}).`, policy };
  }
  if (stops.includes("reply") || stops.includes("decline")) {
    // A reply/decline after our last routine send stops the cadence. Evidence
    // sources: lead_activity (inbound email), sms_messages (inbound text).
    const [last] = await run<{ at: string | null }>(
      `SELECT max(created_at)::text AS at FROM action_intents WHERE recipient = $1 AND policy_ref LIKE $2 AND state IN ('accepted','confirmed')`,
      [recipient, `policy:${policy.key}@%`],
    );
    if (last?.at) {
      const [reply] = await run<{ n: number }>(
        `SELECT (
           (SELECT count(*) FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id WHERE t.phone = $1 AND m.direction = 'in' AND m.created_at > $2::timestamptz)
         + (SELECT count(*) FROM lead_activity a JOIN leads l ON l.id = a.lead_id WHERE lower(l.email) = $1 AND a.kind = 'email' AND a.created_at > $2::timestamptz)
         )::int AS n`,
        [recipient, last.at],
      );
      if ((reply?.n ?? 0) > 0) return { ok: false, code: "stop", reason: `${recipient} replied after the last routine message; the cadence stops until a person reads it.`, policy };
    }
  }

  // Cadence.
  const minHours = cfg.cadence?.minHoursBetween ?? 0;
  const maxWeek = cfg.cadence?.maxPerRecipientPerWeek ?? 0;
  if (minHours > 0 || maxWeek > 0) {
    const [c] = await run<{ recent: number; week: number; last_at: string | null }>(
      `SELECT count(*) FILTER (WHERE created_at > $4::timestamptz - ($3::int * interval '1 hour'))::int AS recent,
              count(*) FILTER (WHERE created_at > $4::timestamptz - interval '7 days')::int AS week,
              max(created_at)::text AS last_at
         FROM action_intents
        WHERE recipient = $1 AND policy_ref LIKE $2 AND state NOT IN ('cancelled','permanent_failure')`,
      [recipient, `policy:${policy.key}@%`, Math.max(1, minHours), input.now ?? (input.at ? new Date(input.at) : new Date())],
    );
    if (minHours > 0 && c.recent > 0) return { ok: false, code: "cadence", reason: `Already messaged ${recipient} within the last ${minHours}h (last at ${c.last_at?.slice(0, 16) ?? "recent"}); the policy waits ${minHours} h between messages.`, policy };
    if (maxWeek > 0 && c.week >= maxWeek) return { ok: false, code: "cadence", reason: `${recipient} already received ${c.week} routine message${c.week === 1 ? "" : "s"} this week (policy max ${maxWeek}).`, policy };
  }

  return { ok: true, authRef: ref, policy, lane };
}

function dayName(d: number): string {
  return ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d] ?? String(d);
}

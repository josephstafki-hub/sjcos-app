import "server-only";

// Nothing in comms fails silently. This module is the failure path every SMS
// / voice / 10DLC piece calls, plus the health check the endpoint and the
// daily timer run. Designed against the specific failure mode of Aug 3–15
// 2026: a component dying quietly for 12 days with no alarm.
//
//   reportCommsFailure(area, error)  → work item for Joe (one open item per
//                                       area, refreshed, not duplicated) + a
//                                       Telegram push (one per area per
//                                       Chicago day, via reminder_log claim).
//   runCommsHealthCheck()            → env validation (names every missing
//                                       var), Telnyx reachability for the
//                                       messaging profile + call-control app,
//                                       webhook freshness, 10DLC state.
//   commsStartupCheck()              → instrumentation.ts hook: log the env
//                                       report loudly; a broken enabled
//                                       feature files + pushes.

import { query, queryOne } from "./db";
import { commsEnvReport, formatCommsEnvReport, type CommsEnvReport } from "./comms/env";
import { notifyOwner } from "./notify-owner";
import { fileCommsWorkItem, getCommsSetting, readTendlcState, setCommsSetting } from "./comms-shared";
import { probeCallControlApp, probeMessagingProfile } from "./telnyx";

export type CommsArea =
  | "config"
  | "sms-webhook"
  | "sms-send"
  | "voice-webhook"
  | "voice-command"
  | "recording"
  | "call-notes"
  | "tendlc-watch"
  | "health";

const AREA_LABEL: Record<CommsArea, string> = {
  config: "Comms configuration",
  "sms-webhook": "SMS webhook",
  "sms-send": "SMS sending",
  "voice-webhook": "Voice webhook",
  "voice-command": "Voice call control",
  recording: "Call recording / transcript",
  "call-notes": "AI call notes",
  "tendlc-watch": "10DLC registration watch",
  health: "Comms health check",
};

async function chicagoDay(): Promise<string> {
  const r = await queryOne<{ s: string }>(`SELECT to_char(now() AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS s`);
  return r?.s ?? new Date().toISOString().slice(0, 10);
}

async function claimOnce(key: string): Promise<boolean> {
  try {
    const r = await query(`INSERT INTO reminder_log (dedup_key) VALUES ($1) ON CONFLICT DO NOTHING`, [key]);
    return (r.rowCount ?? 0) === 1;
  } catch {
    return true; // if the claim table is unavailable, err on the side of loud
  }
}

/** Log, file a work item, push Joe. Never throws. */
export async function reportCommsFailure(area: CommsArea, error: unknown, extra?: { detail?: string; href?: string }): Promise<void> {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[comms:${area}] ${msg}${extra?.detail ? ` — ${extra.detail}` : ""}`);
  try {
    await setCommsSetting(`comms.last_error`, JSON.stringify({ area, at: new Date().toISOString(), message: msg.slice(0, 500) }));
    await fileCommsWorkItem({
      title: `${AREA_LABEL[area]} failed`,
      body:
        `${msg.slice(0, 1500)}\n\n${extra?.detail ?? ""}\n\n` +
        `Filed automatically by the comms failure path (lib/comms-health.ts). ` +
        `Check: journalctl --user -u sjcos.service, and GET /api/comms/health with the CRON_SECRET bearer. [comms:${area}]`,
      priority: "urgent",
      status: "waiting_on_human",
      sourceKind: "comms",
      sourceId: `comms-failure:${area}`,
      createdBy: "comms-health",
    });
    const day = await chicagoDay();
    if (await claimOnce(`commsfail:${area}:${day}`)) {
      await notifyOwner({
        kind: "comms",
        title: `${AREA_LABEL[area]} failed`,
        body: msg.slice(0, 160),
        href: extra?.href ?? "/today",
      });
    }
  } catch (err) {
    console.error("[comms] failure report itself failed", err);
  }
}

// ─── Health check ────────────────────────────────────────────────────────────

export interface CommsHealth {
  ok: boolean;
  checkedAt: string;
  env: CommsEnvReport;
  telnyx: {
    messagingProfile: { ok: boolean; detail: string } | null;
    callControlApp: { ok: boolean; detail: string } | null;
  };
  webhooks: { smsLastAt: string | null; voiceLastAt: string | null };
  tendlc: { brandId: string | null; campaignId: string | null; lastCheckedAt: string | null; snapshot: Record<string, unknown> | null };
  lastError: { area: string; at: string; message: string } | null;
  problems: string[];
}

export async function runCommsHealthCheck(opts: { probe?: boolean } = {}): Promise<CommsHealth> {
  const env = commsEnvReport();
  const problems = [...env.problems];
  const probe = opts.probe ?? true;

  let messagingProfile: CommsHealth["telnyx"]["messagingProfile"] = null;
  let callControlApp: CommsHealth["telnyx"]["callControlApp"] = null;
  if (probe && env.sms.ok) {
    const r = await probeMessagingProfile(process.env.SMS_API_KEY!.trim(), process.env.SMS_MESSAGING_PROFILE_ID!.trim());
    messagingProfile = r.ok ? { ok: true, detail: `profile "${r.name}"` } : { ok: false, detail: r.error };
    if (!r.ok) problems.push(`Telnyx messaging profile unreachable: ${r.error}`);
  }
  if (probe && env.voice.ok) {
    const r = await probeCallControlApp(process.env.SMS_API_KEY!.trim(), process.env.VOICE_APPLICATION_ID!.trim());
    callControlApp = r.ok ? { ok: true, detail: `app "${r.name}"` } : { ok: false, detail: r.error };
    if (!r.ok) problems.push(`Telnyx call-control application unreachable: ${r.error}`);
  }

  const [smsLastAt, voiceLastAt, lastErrRaw, tendlcChecked, tendlcSnap] = await Promise.all([
    getCommsSetting("comms.sms.last_webhook_at"),
    getCommsSetting("comms.voice.last_webhook_at"),
    getCommsSetting("comms.last_error"),
    getCommsSetting("comms.tendlc.last_checked_at"),
    getCommsSetting("comms.tendlc.snapshot"),
  ]);
  let lastError: CommsHealth["lastError"] = null;
  try {
    lastError = lastErrRaw ? (JSON.parse(lastErrRaw) as CommsHealth["lastError"]) : null;
  } catch {
    lastError = null;
  }
  const state = readTendlcState();
  if (env.tendlc.enabled && state?.campaignId && tendlcChecked) {
    const ageH = (Date.now() - new Date(tendlcChecked).getTime()) / 3_600_000;
    if (ageH > 48) problems.push(`10DLC watch has not run for ${Math.round(ageH)}h — is the sjcos-comms-watch timer enabled?`);
  }
  let snapshot: Record<string, unknown> | null = null;
  try {
    snapshot = tendlcSnap ? (JSON.parse(tendlcSnap) as Record<string, unknown>) : null;
  } catch {
    snapshot = null;
  }

  const health: CommsHealth = {
    ok: problems.length === 0,
    checkedAt: new Date().toISOString(),
    env,
    telnyx: { messagingProfile, callControlApp },
    webhooks: { smsLastAt, voiceLastAt },
    tendlc: { brandId: state?.brandId ?? null, campaignId: state?.campaignId ?? null, lastCheckedAt: tendlcChecked, snapshot },
    lastError,
    problems,
  };
  if (health.ok) await setCommsSetting("comms.health.last_ok_at", health.checkedAt);
  return health;
}

/** Startup validation (instrumentation.ts). Loud: the full report goes to
 *  the journal; a broken ENABLED feature files a work item and pushes Joe
 *  (deduped per day). Never throws — the app must still boot for email etc. */
export async function commsStartupCheck(): Promise<void> {
  const r = commsEnvReport();
  const text = formatCommsEnvReport(r);
  if (r.problems.length) {
    console.error(`[comms] STARTUP VALIDATION FAILED\n${text}\n${r.problems.map((p) => `  • ${p}`).join("\n")}`);
    try {
      await reportCommsFailure("config", new Error(r.problems.join(" | ")), {
        detail: "Set every variable named above in .env.local and restart sjcos.service. Features with missing config are disabled until then.",
      });
    } catch {
      /* reported above */
    }
  } else {
    console.log(`[comms] startup validation\n${text}`);
  }
}

// ─── Daily sweep of stuck call records ───────────────────────────────────────

export interface StaleSweepResult {
  transcriptsTimedOut: number;
  callsClosed: number;
}

/** Calls whose transcript never arrived, and calls that never ended (a
 *  missed hangup webhook). Both get closed out loudly rather than sitting
 *  'pending' forever. Run by the daily comms-watch cron. */
export async function sweepStaleCalls(opts: { dryRun?: boolean } = {}): Promise<StaleSweepResult> {
  const dry = Boolean(opts.dryRun);
  const { rows: pending } = await query<{ id: string; who: string }>(
    `SELECT id, COALESCE(contact_name, counterparty_number) AS who FROM calls
      WHERE transcript_status = 'pending' AND recording_status = 'saved' AND updated_at < now() - interval '3 hours'`,
  );
  for (const c of pending) {
    if (dry) continue;
    await query(
      `UPDATE calls SET transcript_status = 'failed', notes_status = 'skipped', notes_error = 'transcript never arrived', updated_at = now() WHERE id = $1`,
      [c.id],
    );
    await fileCommsWorkItem({
      title: `Transcript never arrived for the call with ${c.who}`,
      body: `Telnyx saved the recording but no transcription webhook landed within 3 hours. Listen to the recording on /calls and write notes by hand; check the Call Control app's webhook URL and the transcription setting if this repeats. [call:${c.id}]`,
      priority: "normal",
      sourceKind: "call",
      sourceId: `call-transcript-missing:${c.id}`,
    });
  }
  const { rows: open } = await query<{ id: string }>(
    `SELECT id FROM calls WHERE ended = false AND started_at < now() - interval '6 hours'`,
  );
  if (!dry && open.length) {
    await query(
      `UPDATE calls SET ended = true, ended_at = COALESCE(ended_at, now()), status = 'failed', outcome = COALESCE(outcome, 'failed'),
              error = COALESCE(error, 'closed by sweep: no hangup webhook within 6h'), updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [open.map((r) => r.id)],
    );
    await reportCommsFailure("voice-webhook", new Error(`${open.length} call(s) never received a hangup event and were closed by the daily sweep`), { href: "/calls" });
  }
  return { transcriptsTimedOut: pending.length, callsClosed: open.length };
}

// Owner push layer (W3). notifyOwner() is the one entry point every
// "tell Joe something" trigger calls: it always drops the normal in-app
// notification row (lib/notify.ts emit) and then — when a push channel is
// configured — pushes to Joe's phone, subject to quiet hours and a rolling
// hourly throttle. Anything it can't transmit right now parks in push_outbox
// for the 5-minute drain cron (app/api/cron/push-drain), which also runs the
// stale-approval nudges.
//
// THE LINE: this module tells JOE things. It must never carry a message to
// anyone but the owner — the only recipient it will ever use is
// TELEGRAM_OWNER_CHAT_ID. Client-facing sends live behind owner grants
// (lib/agent-sends.ts) and have nothing to do with this file.
//
// Best-effort throughout: a push is secondary to the action that triggered
// it, so nothing here ever throws to the caller.

import { query, queryOne } from "./db";
import { emit, type EmitInput } from "./notify";

export type OwnerPushKind =
  | "grant"
  | "urgent_item"
  | "agent_failure"
  | "stale_approval"
  | "approval_needed";

export interface NotifyOwnerInput {
  kind: OwnerPushKind;
  /** One-line lead. Rendered as "[SJC OS] <title>" on the phone. */
  title: string;
  /** Optional second line (reason, error summary, …). */
  body?: string;
  /** App path ("/engine/permissions") — sent as a full URL on its own line. */
  href?: string;
  /** Overrides for the in-app notification card, for call sites whose
   *  established card copy differs from the push wording. */
  emit?: Partial<EmitInput>;
}

const TZ = "America/Chicago";
const MAX_PER_HOUR = 4; // transmitted pushes per rolling hour; 'grant' is exempt

// ── Channel registry ─────────────────────────────────────────────────────────
// Keyed by name so a future 'mobile-push' channel (native app push) registers
// here and every trigger picks it up without touching a single call site.

interface OwnerChannel {
  /** False → not configured; the whole push path degrades to in-app only. */
  enabled(): boolean;
  /** Deliver one plain-text message to the owner. Throws on failure. */
  send(text: string): Promise<void>;
}

const telegram: OwnerChannel = {
  enabled: () =>
    Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_OWNER_CHAT_ID),
  async send(text) {
    // TELEGRAM_API_BASE is a test seam (point it at a local stub); unset in prod.
    const base = (process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org").replace(/\/$/, "");
    const res = await fetch(`${base}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Plain text on purpose (no parse_mode): titles carry arbitrary client
      // and vendor strings, and markdown-escaping bugs would eat pushes.
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_OWNER_CHAT_ID,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const out = (await res.json().catch(() => null)) as
      | { ok?: boolean; description?: string }
      | null;
    if (!res.ok || !out?.ok) {
      throw new Error(`telegram sendMessage ${res.status}: ${out?.description ?? "no body"}`);
    }
  },
};

const CHANNELS: Record<string, OwnerChannel> = { telegram };

function enabledChannels(): OwnerChannel[] {
  return Object.values(CHANNELS).filter((c) => c.enabled());
}

/** One line per channel so a dead channel is never silent — printed when this
 *  module first loads in a process and by every push-drain run. */
export function logChannelStatus(): void {
  for (const [name, ch] of Object.entries(CHANNELS)) {
    if (ch.enabled()) {
      const chat = process.env.TELEGRAM_OWNER_CHAT_ID ?? "";
      console.log(`notify-owner: ${name} ENABLED (chat …${chat.slice(-4)})`);
    } else {
      console.log(`notify-owner: ${name} DISABLED (missing env)`);
    }
  }
}
logChannelStatus();

// ── Message text ─────────────────────────────────────────────────────────────

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://os.sjcarpentryllc.com").replace(/\/$/, "");
}

function pushText(p: { title: string; body?: string | null; href?: string | null }): string {
  const lines = [`[SJC OS] ${p.title}`];
  if (p.body) lines.push(p.body);
  if (p.href) lines.push(p.href.startsWith("http") ? p.href : `${appUrl()}${p.href}`);
  return lines.join("\n");
}

// ── In-app card defaults per kind (the emit() row every push also writes) ────

const EMIT_DEFAULTS: Record<OwnerPushKind, Omit<EmitInput, "title">> = {
  grant: { kind: "decision", tag: "Permission", accent: "ai", icon: "shield", flagged: true },
  urgent_item: { kind: "job", tag: "Urgent", accent: "flag", icon: "star", flagged: true },
  agent_failure: { kind: "job", tag: "Agent", accent: "flag", icon: "chat" },
  stale_approval: { kind: "decision", tag: "Approval", accent: "ai", icon: "shield", flagged: true },
  approval_needed: { kind: "decision", tag: "Approval", accent: "ai", icon: "shield", flagged: true },
};

// ── Quiet hours + throttle gate (one round trip; all wall-clock math in
//    Postgres against the tz database, so DST just works) ────────────────────

interface Gate {
  awake: boolean;
  sent_last_hour: number;
  next_morning: Date; // next 07:00 America/Chicago as an absolute instant
  next_hour: Date; // top of the next hour
}

async function gate(now: Date): Promise<Gate> {
  const row = await queryOne<Gate>(
    `SELECT (ts::time >= time '07:00' AND ts::time < time '21:00')  AS awake,
            (SELECT count(*)::int FROM push_outbox
              WHERE sent_at > $1::timestamptz - interval '1 hour')  AS sent_last_hour,
            (CASE WHEN ts::time < time '07:00' THEN ts::date + time '07:00'
                  ELSE ts::date + 1 + time '07:00'
             END) AT TIME ZONE '${TZ}'                              AS next_morning,
            date_trunc('hour', $1::timestamptz) + interval '1 hour' AS next_hour
       FROM (SELECT $1::timestamptz AT TIME ZONE '${TZ}' AS ts) t`,
    [now],
  );
  return row!;
}

async function parkRow(input: NotifyOwnerInput, sendAfter: Date): Promise<void> {
  await query(
    `INSERT INTO push_outbox (kind, title, body, href, send_after)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.kind, input.title, input.body ?? null, input.href ?? null, sendAfter],
  );
}

/** Transmit now; the sent row is what the rolling-hour throttle counts. A
 *  delivery failure parks the push instead so the next drain tick retries. */
async function transmit(input: NotifyOwnerInput, now: Date): Promise<void> {
  try {
    const text = pushText(input);
    for (const ch of enabledChannels()) await ch.send(text);
    await query(
      `INSERT INTO push_outbox (kind, title, body, href, send_after, sent_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [input.kind, input.title, input.body ?? null, input.href ?? null, now],
    );
  } catch (err) {
    console.error("[notify-owner] send failed — parking for drain", err);
    await parkRow(input, now);
  }
}

/** Tell Joe something. Always writes the in-app notification; pushes to his
 *  phone when a channel is configured, quiet hours (07:00–21:00 Chicago)
 *  allow it, and the hourly cap isn't hit (grants are exempt from the cap —
 *  a waiting agent is blocked on them — but still count toward it; nothing
 *  is exempt from quiet hours). Never throws. `nowOverride` is a test seam. */
export async function notifyOwner(input: NotifyOwnerInput, nowOverride?: Date): Promise<void> {
  try {
    await emit({
      ...EMIT_DEFAULTS[input.kind],
      title: input.title,
      subline: input.body,
      href: input.href,
      ...input.emit,
    });
  } catch (err) {
    console.error("[notify-owner] emit failed", err);
  }
  try {
    if (!enabledChannels().length) {
      console.log(`[notify-owner] no push channel configured — in-app only: ${input.title}`);
      return;
    }
    const now = nowOverride ?? new Date();
    const g = await gate(now);
    if (!g.awake) return void (await parkRow(input, g.next_morning));
    if (g.sent_last_hour >= MAX_PER_HOUR && input.kind !== "grant") {
      return void (await parkRow(input, g.next_hour));
    }
    await transmit(input, now);
  } catch (err) {
    console.error("[notify-owner] push failed", err);
  }
}

// ── Failure collapse ─────────────────────────────────────────────────────────

/** Claim a once-only key in reminder_log (same idempotency table the daily
 *  reminder engine uses). True only for the first caller. */
async function claimOnce(key: string): Promise<boolean> {
  const r = await query(
    `INSERT INTO reminder_log (dedup_key) VALUES ($1) ON CONFLICT DO NOTHING`,
    [key],
  );
  return (r.rowCount ?? 0) === 1;
}

async function chicagoStamp(now: Date, format: string): Promise<string> {
  const row = await queryOne<{ s: string }>(
    `SELECT to_char($1::timestamptz AT TIME ZONE '${TZ}', $2) AS s`,
    [now, format],
  );
  return row!.s;
}

/** Push for a failed agent run, collapsed to at most one push per
 *  runtime_name per (Chicago) hour. Never throws. */
export async function notifyAgentFailure(
  runtimeName: string,
  errorSummary?: string | null,
  nowOverride?: Date,
): Promise<void> {
  try {
    const now = nowOverride ?? new Date();
    const hour = await chicagoStamp(now, "YYYY-MM-DD-HH24");
    if (!(await claimOnce(`pushfail:${runtimeName}:${hour}`))) return;
    await notifyOwner(
      {
        kind: "agent_failure",
        title: `Agent run failed: ${runtimeName}`,
        body: (errorSummary ?? "").slice(0, 120) || undefined,
      },
      nowOverride,
    );
  } catch (err) {
    console.error("[notify-owner] agent-failure notify failed", err);
  }
}

/** Immediate push the moment a work item flips approval_status → 'requested'
 *  (submit_draft_for_approval and any equivalent path) — a finished draft must
 *  not sit invisible until the 4h stale nudge. One push per work item ever
 *  (reminder_log claim), subject to quiet hours AND the hourly cap (approvals
 *  are not cap-exempt like grants). Never throws. */
export async function notifyApprovalNeeded(
  workItemId: string,
  title: string,
  nowOverride?: Date,
): Promise<void> {
  try {
    if (!(await claimOnce(`apprpush:${workItemId}`))) return;
    await notifyOwner(
      { kind: "approval_needed", title: `Approve: ${title}`, href: "/today" },
      nowOverride,
    );
  } catch (err) {
    console.error("[notify-owner] approval-needed notify failed", err);
  }
}

// ── Drain (5-minute cron) ────────────────────────────────────────────────────

export interface PushDrainResult {
  channel: "enabled" | "disabled";
  awake: boolean;
  due: number;
  /** Messages actually transmitted this run (including the summary line). */
  sent: number;
  /** Parked rows folded into the "…and N more" summary. */
  summarized: number;
  staleGrantNudges: number;
  staleApprovalNudges: number;
}

interface OutboxRow {
  id: string;
  kind: OwnerPushKind;
  title: string;
  body: string | null;
  href: string | null;
}

/** Drain due parked pushes (grants first, then urgent items), then nudge on
 *  stale approvals. When more than 3 rows are due at once, the 3 most
 *  important go out plus one summary line and the rest are marked sent —
 *  Joe reads them in the app instead of a burst of buzzes. */
export async function runPushDrain(
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<PushDrainResult> {
  const dry = Boolean(opts.dryRun);
  const now = opts.now ?? new Date();
  const enabled = enabledChannels().length > 0;
  logChannelStatus();
  const g = await gate(now);

  const { rows: due } = await query<OutboxRow>(
    `SELECT id, kind, title, body, href
       FROM push_outbox
      WHERE sent_at IS NULL AND send_after <= $1
      ORDER BY CASE kind WHEN 'grant' THEN 0
                         WHEN 'urgent_item' THEN 1
                         WHEN 'approval_needed' THEN 1
                         ELSE 2 END,
               created_at`,
    [now],
  );

  const result: PushDrainResult = {
    channel: enabled ? "enabled" : "disabled",
    awake: g.awake,
    due: due.length,
    sent: 0,
    summarized: 0,
    staleGrantNudges: 0,
    staleApprovalNudges: 0,
  };

  if (enabled && g.awake && due.length && !dry) {
    // Claim everything up front so an overlapping drain can't double-send;
    // a failed delivery un-claims its row for the next tick.
    const { rows: claimed } = await query<{ id: string }>(
      `UPDATE push_outbox SET sent_at = $2
        WHERE id = ANY($1::bigint[]) AND sent_at IS NULL
        RETURNING id`,
      [due.map((r) => r.id), now],
    );
    const mine = new Set(claimed.map((r) => r.id));
    const send = due.filter((r) => mine.has(r.id));
    const direct = send.length > 3 ? send.slice(0, 3) : send;
    const folded = send.length > 3 ? send.slice(3) : [];

    const unclaim = (ids: string[]) =>
      query(
        `UPDATE push_outbox SET sent_at = NULL, send_after = $2 + interval '5 minutes'
          WHERE id = ANY($1::bigint[])`,
        [ids, now],
      );

    for (const row of direct) {
      try {
        for (const ch of enabledChannels()) await ch.send(pushText(row));
        result.sent++;
      } catch (err) {
        console.error(`[notify-owner] drain send failed (row ${row.id})`, err);
        await unclaim([row.id]);
      }
    }
    if (folded.length) {
      try {
        const text = pushText({
          title: `…and ${folded.length} more waiting in the app`,
          href: "/notifications",
        });
        for (const ch of enabledChannels()) await ch.send(text);
        result.sent++;
        result.summarized = folded.length;
      } catch (err) {
        console.error("[notify-owner] drain summary send failed", err);
        await unclaim(folded.map((r) => r.id));
      }
    }
  }

  // ── Stale approvals: one nudge per item per (Chicago) day after 4 quiet
  //    hours. Runs even when the channel is off — the in-app card still lands.
  const day = await chicagoStamp(now, "YYYY-MM-DD");

  const { rows: staleGrants } = await query<{
    id: string;
    requested_by: string;
    actions: string[];
    target_id: string | null;
    reason: string;
    hours: number;
  }>(
    `SELECT id, requested_by, actions, target_id, reason,
            floor(extract(epoch FROM $1::timestamptz - created_at) / 3600)::int AS hours
       FROM owner_grants
      WHERE status = 'requested' AND created_at < $1::timestamptz - interval '4 hours'`,
    [now],
  );
  for (const grant of staleGrants) {
    if (dry || !(await claimOnce(`stalegrant:${grant.id}:${day}`))) continue;
    result.staleGrantNudges++;
    await notifyOwner(
      {
        kind: "stale_approval",
        title: `Grant request waiting ${grant.hours}h: ${grant.requested_by} asks to ${grant.actions[0] ?? "?"}${grant.target_id ? ` (${grant.target_id})` : ""}`,
        body: grant.reason ? `Reason: ${grant.reason.slice(0, 160)}` : undefined,
        href: "/engine/permissions",
      },
      opts.now,
    );
  }

  // Keyed on approval_status, NOT status: a later update_work_item_status can
  // overwrite status (e.g. → 'done') while the approval is still undecided —
  // approval_status = 'requested' is the one column that means "waiting on Joe".
  const { rows: staleItems } = await query<{ id: string; title: string; hours: number }>(
    `SELECT id, title,
            floor(extract(epoch FROM $1::timestamptz - updated_at) / 3600)::int AS hours
       FROM work_items
      WHERE approval_status = 'requested' AND updated_at < $1::timestamptz - interval '4 hours'`,
    [now],
  );
  for (const item of staleItems) {
    if (dry || !(await claimOnce(`staleappr:${item.id}:${day}`))) continue;
    result.staleApprovalNudges++;
    await notifyOwner(
      {
        kind: "stale_approval",
        title: `Approval waiting ${item.hours}h: ${item.title}`,
        href: "/today",
      },
      opts.now,
    );
  }

  return result;
}

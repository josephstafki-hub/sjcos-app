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
import { recordDelivery } from "./commands/decisions";
import { runDirect } from "./commands/db";
import { makeTelegramProvider, type TelegramInlineButton } from "./providers/telegram";
import { decisionKeyboard, workItemKeyboard } from "./decisions/keyboards";
import { closeRepliesRevisedByDraft, rememberReplyTarget } from "./decisions/owner-replies";
import { workItemDraftPreviews } from "./work-item-draft";

export type OwnerPushKind =
  | "grant"
  // A10 decision card (Approve / Request changes / Hold buttons). Exempt from
  // the hourly cap like grants: someone is waiting on it.
  | "decision"
  | "urgent_item"
  | "agent_failure"
  | "stale_approval"
  | "approval_needed"
  // Comms (lib/sms.ts, lib/voice.ts, lib/comms-health.ts): an inbound text,
  // a call outcome / call notes, and a provider/timer failure.
  | "sms_inbound"
  | "voice_call"
  | "comms"
  // A client paid online through Square (lib/payments/owner-alert.ts, which
  // stages the row in the payment's transaction; sendOwnerPushesNow sends it).
  | "payment"
  // A client signed the construction contract (lib/actions/esign.ts).
  | "contract_signed"
  // A client or sub wrote in the portal (lib/actions/portal.ts). Carries the
  // message; Joe's Telegram reply to it is posted back into the portal.
  | "portal_message";

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
  /** Telegram extras: inline buttons, the decision the card belongs to (its
   *  delivery is recorded with the message id), and a message to edit in
   *  place instead of sending a new one. Survives quiet-hours parking. */
  telegram?: TelegramExtras;
  /** Skip the in-app row — for edits of a card Joe already has in the app. */
  phoneOnly?: boolean;
}

export interface TelegramExtras {
  buttons?: TelegramInlineButton[][];
  decisionId?: string | null;
  /** A staged-draft card: its message id is remembered so Joe can reply to
   *  it in text (lib/decisions/owner-replies.ts). */
  workItemId?: string | null;
  editMessageId?: string | null;
  /** Thread this message under one of Joe's (an answer to his Telegram
   *  reply). Goes out at once — he is in the conversation. */
  replyToMessageId?: string | null;
  /** A portal message push: the thread (chat_messages.channel_key) and the
   *  message it carries. Joe's reply to the push is posted into that thread
   *  (lib/decisions/owner-replies.ts recordPortalReply). */
  portalChannelKey?: string | null;
  portalMessageId?: string | null;
}

const TZ = "America/Chicago";
const MAX_PER_HOUR = 4; // transmitted pushes per rolling hour; 'grant', 'decision', 'payment', 'contract_signed' and 'portal_message' are exempt
// A portal message is a client talking to Joe: it is never held back for the
// cap (quiet hours still apply) and never folded into "…and N more", because
// the push itself is what he replies to.
const CAP_EXEMPT: ReadonlySet<OwnerPushKind> = new Set(["grant", "decision", "payment", "contract_signed", "portal_message"]);

// ── Channel registry ─────────────────────────────────────────────────────────
// Keyed by name so a future 'mobile-push' channel (native app push) registers
// here and every trigger picks it up without touching a single call site.

interface OwnerChannel {
  /** False → not configured; the whole push path degrades to in-app only. */
  enabled(): boolean;
  /** Deliver one plain-text message to the owner. Throws on failure.
   *  Returns the channel's message id when it has one. */
  send(text: string, extras?: TelegramExtras | null): Promise<string | null>;
}

// The Telegram transport lives in lib/providers/telegram.ts (one code path
// for pushes and decision cards; SJC_OUTBOUND_DISABLED=1 fake mode for tests).
// Plain text on purpose (no parse_mode): titles carry arbitrary client and
// vendor strings, and markdown-escaping bugs would eat pushes.
const telegramProvider = makeTelegramProvider();
const telegram: OwnerChannel = {
  enabled: () =>
    Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_OWNER_CHAT_ID),
  async send(text, extras) {
    const r = await telegramProvider.send(
      { chatId: process.env.TELEGRAM_OWNER_CHAT_ID ?? "", text, buttons: extras?.buttons, editMessageId: extras?.editMessageId ?? null, replyToMessageId: extras?.replyToMessageId ?? null },
      { operationKey: `owner-push:${Date.now()}`, intentId: "", attempt: 1 },
    );
    if (r.responseClass !== "accepted" && r.responseClass !== "confirmed") {
      throw new Error(r.error ?? `telegram send ${r.responseClass}`);
    }
    return r.providerRef ?? null;
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
  decision: { kind: "decision", tag: "Decision", accent: "ai", icon: "shield", flagged: true },
  urgent_item: { kind: "job", tag: "Urgent", accent: "flag", icon: "star", flagged: true },
  agent_failure: { kind: "job", tag: "Agent", accent: "flag", icon: "chat" },
  stale_approval: { kind: "decision", tag: "Approval", accent: "ai", icon: "shield", flagged: true },
  approval_needed: { kind: "decision", tag: "Approval", accent: "ai", icon: "shield", flagged: true },
  sms_inbound: { kind: "mention", tag: "Text", accent: "accent", icon: "chat" },
  voice_call: { kind: "job", tag: "Call", accent: "accent", icon: "chat" },
  comms: { kind: "job", tag: "Comms", accent: "flag", icon: "shield", flagged: true },
  payment: { kind: "money", tag: "Payment", accent: "money", icon: "money" },
  contract_signed: { kind: "job", tag: "Contract", accent: "money", icon: "star", flagged: true },
  portal_message: { kind: "mention", tag: "Portal", accent: "ai", icon: "chat" },
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
    `INSERT INTO push_outbox (kind, title, body, href, send_after, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [input.kind, input.title, input.body ?? null, input.href ?? null, sendAfter, input.telegram ? JSON.stringify(input.telegram) : null],
  );
  if (input.telegram?.decisionId) {
    await recordDelivery(runDirect, input.telegram.decisionId, "telegram", null, "queued").catch(() => undefined);
  }
}

/** A decision card went out (or was edited): remember the Telegram message
 *  id so a later resolution or supersede can update that same message. A
 *  draft card: remember which draft it is, so a text reply to it lands. */
async function noteDelivery(extras: TelegramExtras | null | undefined, messageId: string | null): Promise<void> {
  const chat = process.env.TELEGRAM_OWNER_CHAT_ID ?? "";
  if (extras?.workItemId && messageId && !extras.editMessageId) {
    await rememberReplyTarget(runDirect, { chatId: chat, messageId, workItemId: extras.workItemId, kind: "card" }).catch(() => undefined);
  }
  if (extras?.portalChannelKey && messageId && !extras.editMessageId) {
    await rememberReplyTarget(runDirect, { chatId: chat, messageId, portalChannelKey: extras.portalChannelKey, portalMessageId: extras.portalMessageId ?? null, kind: "portal" }).catch(() => undefined);
  }
  if (!extras?.decisionId) return;
  await recordDelivery(runDirect, extras.decisionId, "telegram", messageId ? `${chat}:${messageId}` : null, extras.editMessageId ? "updated" : "sent").catch(() => undefined);
}

/** Transmit now; the sent row is what the rolling-hour throttle counts. A
 *  delivery failure parks the push instead so the next drain tick retries. */
async function transmit(input: NotifyOwnerInput, now: Date): Promise<void> {
  try {
    const text = pushText(input);
    for (const ch of enabledChannels()) {
      const id = await ch.send(text, input.telegram ?? null);
      await noteDelivery(input.telegram, id);
    }
    await query(
      `INSERT INTO push_outbox (kind, title, body, href, send_after, sent_at, payload)
       VALUES ($1, $2, $3, $4, $5, $5, $6::jsonb)`,
      [input.kind, input.title, input.body ?? null, input.href ?? null, now, input.telegram ? JSON.stringify(input.telegram) : null],
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
  if (!input.phoneOnly) {
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
  }
  try {
    if (!enabledChannels().length) {
      console.log(`[notify-owner] no push channel configured — in-app only: ${input.title}`);
      return;
    }
    const now = nowOverride ?? new Date();
    // Editing a card already on the phone (resolved, sent, superseded) makes
    // no sound, so it goes now — parking it till morning left a stale
    // Approve button showing all night.
    if (input.telegram?.editMessageId) return void (await transmit(input, now));
    // An answer to a note Joe just sent on Telegram: he's in the conversation.
    if (input.telegram?.replyToMessageId) return void (await transmit(input, now));
    const g = await gate(now);
    if (!g.awake) return void (await parkRow(input, g.next_morning));
    if (g.sent_last_hour >= MAX_PER_HOUR && !CAP_EXEMPT.has(input.kind)) {
      return void (await parkRow(input, g.next_hour));
    }
    await transmit(input, now);
  } catch (err) {
    console.error("[notify-owner] push failed", err);
  }
}

/** Send push_outbox rows that were staged inside a database transaction
 *  (payment alerts) now that it has committed, instead of waiting for the
 *  5-minute drain. Same rules as notifyOwner: nothing during quiet hours, and
 *  only cap-exempt kinds skip the hourly cap. A row left unsent here is still
 *  due, so the drain delivers it. Never throws. */
export async function sendOwnerPushesNow(ids: (string | null | undefined)[], nowOverride?: Date): Promise<void> {
  const want = ids.filter((id): id is string => !!id);
  if (!want.length || !enabledChannels().length) return;
  try {
    const now = nowOverride ?? new Date();
    const g = await gate(now);
    if (!g.awake) return;
    const { rows } = await query<OutboxRow>(
      `UPDATE push_outbox SET sent_at = $2
        WHERE id = ANY($1::bigint[]) AND sent_at IS NULL AND send_after <= $2
        RETURNING id, kind, title, body, href, payload`,
      [want, now],
    );
    let room = MAX_PER_HOUR - g.sent_last_hour;
    for (const row of rows) {
      if (!CAP_EXEMPT.has(row.kind) && room-- <= 0) {
        await query(`UPDATE push_outbox SET sent_at = NULL, send_after = $2 WHERE id = $1`, [row.id, g.next_hour]);
        continue;
      }
      try {
        for (const ch of enabledChannels()) {
          const id = await ch.send(pushText(row), row.payload);
          await noteDelivery(row.payload, id);
        }
      } catch (err) {
        console.error(`[notify-owner] send failed (row ${row.id}) — left for the drain`, err);
        await query(`UPDATE push_outbox SET sent_at = NULL, send_after = $2::timestamptz + interval '5 minutes' WHERE id = $1`, [row.id, now]);
      }
    }
  } catch (err) {
    console.error("[notify-owner] sendOwnerPushesNow failed", err);
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
 *  (reminder_log claim). Carries the draft itself and Approve / Decline
 *  buttons (handled by app/api/telegram/webhook), and is cap-exempt like a
 *  decision card: someone is waiting on it. Never throws. */
export async function notifyApprovalNeeded(
  workItemId: string,
  title: string,
  nowOverride?: Date,
): Promise<void> {
  try {
    // Joe's Telegram note about this draft (or an earlier draft on the same
    // job) is answered by this one: it goes out even though the item was
    // pushed before, threaded under his message.
    const revised = await closeRepliesRevisedByDraft(runDirect, workItemId).catch(() => []);
    const first = await claimOnce(`apprpush:${workItemId}`);
    if (!first && !revised.length) return;
    const answering = revised.find((r) => r.message_id)?.message_id ?? null;
    const [draft] = await workItemDraftPreviews({ ids: [workItemId], limit: 1 }).catch(() => []);
    const lines: string[] = [];
    if (draft?.to) lines.push(`To: ${draft.to}`);
    if (draft?.subject) lines.push(`Subject: ${draft.subject}`);
    if (draft?.body) lines.push("", draft.body.slice(0, 1200));
    if (draft) {
      const portal = draft.channel === "portal";
      lines.push(
        "",
        draft.sends
          ? portal ? "Approve posts this in the client portal now." : "Approve sends this email now."
          : draft.note ? `Approve does not ${portal ? "post" : "email"} it: ${draft.note}` : "Approve hands it back to the agent to finish.",
      );
    }
    if (revised.length) lines.unshift("Revised after your note.", "");
    await notifyOwner(
      {
        kind: "decision",
        title: `Approve: ${title}`,
        body: lines.join("\n") || undefined,
        href: draft?.href ?? "/today",
        emit: {
          ...EMIT_DEFAULTS.approval_needed,
          title: `Approve: ${title}`,
          subline: draft?.to ? `${draft.sends ? (draft.channel === "portal" ? "Posts for" : "Sends to") : "Draft to"} ${draft.to}${draft.subject ? ` — ${draft.subject}` : ""}` : undefined,
          href: draft?.href ?? "/today",
          ref: `work_item:${workItemId}`,
        },
        telegram: { buttons: workItemKeyboard(workItemId, { sends: draft?.sends }), workItemId, replyToMessageId: answering },
      },
      nowOverride,
    );
  } catch (err) {
    console.error("[notify-owner] approval-needed notify failed", err);
  }
}

/** A client (or sub) wrote in the portal: push the message itself to Joe's
 *  phone. Swiping-to-reply on it posts his answer into that portal thread
 *  (app/api/telegram/webhook → recordPortalReply). Also writes the in-app
 *  card. Never throws. */
export async function notifyPortalMessage(
  input: {
    surface: "client" | "sub";
    channelKey: string;
    messageId: string | null;
    name: string;
    body: string;
    /** Owner page for the thread (Client portal tab, or /chat for a sub). */
    href: string;
    /** "Tierney · Kitchen" — the job or lead the thread belongs to. */
    context?: string | null;
  },
  nowOverride?: Date,
): Promise<void> {
  const where = input.surface === "sub" ? "sub portal" : "client portal";
  const text = input.body.trim();
  const shown = text.length > 1500 ? `${text.slice(0, 1497)}…` : text;
  await notifyOwner(
    {
      kind: "portal_message",
      title: `${input.name} wrote in the ${where}${input.context ? ` (${input.context})` : ""}`,
      body: `${shown}\n\nReply to this message to answer ${input.name.split(/\s+/)[0] || "them"} in the portal.`,
      href: input.href,
      emit: {
        title: `${input.name} sent a message`,
        subline: text.length > 120 ? `${text.slice(0, 117)}…` : text,
        href: input.href,
      },
      telegram: { portalChannelKey: input.channelKey, portalMessageId: input.messageId },
    },
    nowOverride,
  );
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
  payload: TelegramExtras | null;
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
    `SELECT id, kind, title, body, href, payload
       FROM push_outbox
      WHERE sent_at IS NULL AND send_after <= $1
      ORDER BY CASE kind WHEN 'grant' THEN 0
                         WHEN 'decision' THEN 0
                         WHEN 'urgent_item' THEN 1
                         WHEN 'approval_needed' THEN 1
                         WHEN 'payment' THEN 1
                         WHEN 'portal_message' THEN 1
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
    // Decision cards carry buttons and portal messages take a reply, so
    // neither is ever folded into the "…and N more" summary line.
    const keep = (r: OutboxRow) => r.kind === "decision" || r.kind === "portal_message";
    const cards = send.filter(keep);
    const rest = send.filter((r) => !keep(r));
    const direct = [...cards, ...(rest.length > 3 ? rest.slice(0, 3) : rest)];
    const folded = rest.length > 3 ? rest.slice(3) : [];

    const unclaim = (ids: string[]) =>
      query(
        `UPDATE push_outbox SET sent_at = NULL, send_after = $2 + interval '5 minutes'
          WHERE id = ANY($1::bigint[])`,
        [ids, now],
      );

    for (const row of direct) {
      try {
        for (const ch of enabledChannels()) {
          const id = await ch.send(pushText(row), row.payload);
          await noteDelivery(row.payload, id);
        }
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
  //    A request past its expires_at can no longer be approved into a usable
  //    grant, so it stops nagging (it used to buzz nightly forever).
  const day = await chicagoStamp(now, "YYYY-MM-DD");

  const { rows: staleGrants } = await query<{
    id: string;
    requested_by: string;
    actions: string[];
    target_id: string | null;
    reason: string;
    hours: number;
    decision_id: string | null;
    content_hash: string | null;
  }>(
    `SELECT g.id, g.requested_by, g.actions, g.target_id, g.reason,
            floor(extract(epoch FROM $1::timestamptz - g.created_at) / 3600)::int AS hours,
            d.id AS decision_id, d.content_hash
       FROM owner_grants g
       LEFT JOIN decisions d ON d.id = g.decision_id AND d.status = 'pending'
      WHERE g.status = 'requested' AND g.created_at < $1::timestamptz - interval '4 hours'
        AND g.expires_at > $1::timestamptz`,
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
        emit: grant.decision_id ? { ref: `decision:${grant.decision_id}` } : undefined,
        // The nudge can be answered right there, like the original card.
        telegram: grant.decision_id ? { buttons: decisionKeyboard(grant.decision_id, grant.content_hash) } : undefined,
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
        emit: { ref: `work_item:${item.id}` },
        telegram: { buttons: workItemKeyboard(item.id), workItemId: item.id },
      },
      opts.now,
    );
  }

  return result;
}

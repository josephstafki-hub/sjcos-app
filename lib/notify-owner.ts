import { apnsConfigured } from "./providers/apns";
import { pushSettings, recordAppMessage, deliverAppMessage, cleanupAppAlerts } from "./phone-push";
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
import { cardText, type CardDecision } from "./decisions/cards";
import { recordDelivery } from "./commands/decisions";
import { runDirect, withTransaction } from "./commands/db";
import { makeTelegramProvider, type TelegramInlineButton } from "./providers/telegram";
import { decisionKeyboard, workItemKeyboard } from "./decisions/keyboards";
import { closeRepliesRevisedByDraft, rememberReplyTarget } from "./decisions/owner-replies";
import { workItemDraftPreviews } from "./work-item-draft";

export type OwnerPushKind =
  | "reply" | "ack"
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
  isSummary?: boolean;
  draftBinding?: string | null;
  appText?: {title:string;body?:string|null;from?:'owner'|'agent'|'system';agentName?:string|null};
  existingMessageId?: string;
  ownerReplyId?: string | null;
  forceReply?: string | null;
  conversation?: boolean;
  appOnly?: boolean;
  pushReplyToId?:string|null;
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

// Bind before reading the preview, and refuse a concurrently edited preview.
// A later mutation still compares this saved binding inside its transaction.
async function boundDraft(id:string) {
 const before=await queryOne<{binding:string}>(`SELECT phone_push_draft_binding($1) AS binding`,[id]);
 const [draft]=await workItemDraftPreviews({ids:[id],limit:1});
 const after=await queryOne<{binding:string}>(`SELECT phone_push_draft_binding($1) AS binding`,[id]);
 if(!before?.binding||before.binding!==after?.binding)throw new Error('The draft changed while its alert was being prepared.');
 return {draft,binding:before.binding};
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
      { chatId: process.env.TELEGRAM_OWNER_CHAT_ID ?? "", text, buttons: extras?.buttons, editMessageId: extras?.editMessageId ?? null, forceReply: extras?.forceReply, replyToMessageId: extras?.replyToMessageId ?? null },
      { operationKey: `owner-push:${Date.now()}`, intentId: "", attempt: 1 },
    );
    if (r.responseClass !== "accepted" && r.responseClass !== "confirmed") {
      throw new Error(r.error ?? `telegram send ${r.responseClass}`);
    }
    return r.providerRef ?? null;
  },
};

const CHANNELS: Record<string, OwnerChannel> = { telegram, app: { enabled: apnsConfigured, send: async () => null } };

async function deliverChannels(input: {kind: string; title: string; body?:string|null;href?:string|null;telegram?:TelegramExtras|null}, outboxId?:string): Promise<void> {
 input=await safePush({...input,id:outboxId});
 const settings=await pushSettings();
 if(outboxId){const row=await queryOne<{channels:string[]|null}>(`SELECT channels FROM push_outbox WHERE id=$1`,[outboxId]);if(row?.channels)settings.channels={app:row.channels.includes('app'),telegram:row.channels.includes('telegram')};}
 const message=input.telegram?.existingMessageId ? (await queryOne<import('./providers/apns').AppAlert>(`SELECT * FROM owner_push_messages WHERE id=$1`,[input.telegram.existingMessageId]))! : await recordAppMessage(input,outboxId);
 // Each channel fails independently; a broken Telegram connection cannot hide the app alert.
 const delivered=(message as unknown as {delivered_channels:string[]}).delivered_channels??[];
 const errors:unknown[]=[];
 if(!delivered.includes("app") && settings.channels.app && apnsConfigured() && message.state !== "decided")try{await deliverAppMessage(message);}catch(e){errors.push(e);}
 if((!delivered.includes("telegram") || input.telegram?.editMessageId) && settings.channels.telegram && telegram.enabled())try{
  const closed=message.state==='decided'&&!input.telegram?.editMessageId;
  const id=await telegram.send(input.telegram?.conversation?input.body??input.title:pushText(closed?{...input,body:(message as unknown as {outcome:string}).outcome}:input),closed?{...input.telegram,buttons:undefined}:input.telegram);
  await noteDelivery(input.telegram,id);
  if(id && input.telegram?.conversation){await rememberReplyTarget(runDirect,{chatId:process.env.TELEGRAM_OWNER_CHAT_ID??'',messageId:id,decisionId:message.decision_id,workItemId:message.work_item_id,portalChannelKey:(message as unknown as {portal_channel_key:string}).portal_channel_key,ownerReplyId:input.telegram.ownerReplyId,kind:'ack'});}

  await query(`UPDATE owner_push_messages SET telegram_message_id=$2,delivered_channels=array_append(delivered_channels,'telegram') WHERE id=$1`,[message.id,id]);
 }catch(e){errors.push(e);}
 if(outboxId)await query(`UPDATE push_outbox SET counted_at=COALESCE(counted_at,now()) WHERE id=$1 AND EXISTS(SELECT 1 FROM owner_push_messages WHERE id=$2 AND (cardinality(delivered_channels)>0 OR EXISTS(SELECT 1 FROM push_device_deliveries WHERE message_id=$2)))`,[outboxId,message.id]);
 if(errors.length)throw errors[0];
}

function enabledChannels(): OwnerChannel[] {
  return Object.values(CHANNELS).filter((c) => c.enabled());
}

/** One line per channel so a dead channel is never silent — printed when this
 *  module first loads in a process and by every push-drain run. */
export function logChannelStatus(): void {
  for (const [name, ch] of Object.entries(CHANNELS)) {
    if (ch.enabled()) {
      const chat = process.env.TELEGRAM_OWNER_CHAT_ID ?? "";
      console.log(name === "telegram" ? `notify-owner: telegram ENABLED (chat …${chat.slice(-4)})` : `notify-owner: app ENABLED`);
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

const EMIT_DEFAULTS: Record<Exclude<OwnerPushKind,"reply"|"ack">, Omit<EmitInput, "title">> = {
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
              WHERE summary_id IS NULL AND COALESCE(counted_at,sent_at) > $1::timestamptz - interval '1 hour')  AS sent_last_hour,
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
  const channels=(await pushSettings()).channels;
  await query(
    `INSERT INTO push_outbox (kind, title, body, href, send_after, payload, channels)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [input.kind, input.title, input.body ?? null, input.href ?? null, sendAfter, input.telegram ? JSON.stringify(input.telegram) : null,Object.entries(channels).filter(([,on])=>on).map(([name])=>name)],
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

/** Never send a pre-cleanup in-memory retry snapshot. Private associations
 * always carry fixed status, so deletion cannot race a subsequent text send. */
async function safePush<T extends { title: string; body?: string | null; href?: string | null; payload?: TelegramExtras | null; telegram?: TelegramExtras | null; id?: string }>(input: T): Promise<T> {
  const state = await queryOne<{ private: boolean }>(
    `SELECT ask_push_is_private($1::jsonb,$2::text) OR COALESCE((SELECT ask_reply_erased FROM push_outbox WHERE id=$3::bigint),false) AS private`,
    [JSON.stringify(input.payload ?? input.telegram ?? {}), input.href ?? null, input.id ?? null],
  );
  if (!state || state.private) return { ...input, title: 'Private Ask request updated.', body: null, href: '/today', payload: null, telegram: null, ...(Object.hasOwn(input, "emit") ? {emit: {title: "Private Ask request updated.", subline: undefined, href: "/today"}} : {}) };
  return input;
}

/** Transmit now; the sent row is what the rolling-hour throttle counts. A
 *  delivery failure parks the push instead so the next drain tick retries. */
async function transmit(input: NotifyOwnerInput, now: Date): Promise<void> {
  const channels=(await pushSettings()).channels;
  const row=await queryOne<{id:string}>(`INSERT INTO push_outbox(kind,title,body,href,send_after,payload,channels,claimed_until) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,now()+interval '5 minutes') RETURNING id`,[input.kind,input.title,input.body??null,input.href??null,now,JSON.stringify(input.telegram??null),Object.entries(channels).filter(([,on])=>on).map(([name])=>name)]);
  try {
    await deliverChannels(input,row!.id);
    await query(`UPDATE push_outbox SET sent_at=$2,claimed_until=NULL WHERE id=$1`,[row!.id,now]);
  }catch(err){await query(`UPDATE push_outbox SET claimed_until=NULL,send_after=now()+interval '5 minutes' WHERE id=$1`,[row!.id]);console.error('[notify-owner] send failed — left for drain');}

}

/** Tell Joe something. Always writes the in-app notification; pushes to his
 *  phone when a channel is configured, quiet hours (07:00–21:00 Chicago)
 *  allow it, and the hourly cap isn't hit (grants are exempt from the cap —
 *  a waiting agent is blocked on them — but still count toward it; nothing
 *  is exempt from quiet hours). Never throws. `nowOverride` is a test seam. */
export async function notifyOwner(input: NotifyOwnerInput, nowOverride?: Date): Promise<void> {
  try { input = await safePush(input); } catch { return; }
  if (!input.phoneOnly) {
    try {
      await emit({
        ...EMIT_DEFAULTS[input.kind as keyof typeof EMIT_DEFAULTS],
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
    if(input.telegram?.workItemId && !input.telegram.draftBinding){
     const binding=await queryOne<{binding:string}>(`SELECT phone_push_draft_binding($1) AS binding`,[input.telegram.workItemId]);
     input={...input,telegram:{...input.telegram,draftBinding:binding?.binding}};
    }
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
    if (input.telegram?.replyToMessageId || input.telegram?.pushReplyToId) return void (await transmit(input, now));
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
      `UPDATE push_outbox SET claimed_until=now()+interval '5 minutes'
       WHERE id=ANY($1::bigint[]) AND sent_at IS NULL AND send_after<=$2 AND (claimed_until IS NULL OR claimed_until<now()) RETURNING *`,[want,now]);
    let room=MAX_PER_HOUR-g.sent_last_hour;
    for(const row of rows){
     if(!CAP_EXEMPT.has(row.kind)&&!row.payload?.conversation&&room--<=0){await query(`UPDATE push_outbox SET claimed_until=NULL,send_after=$2 WHERE id=$1`,[row.id,g.next_hour]);continue;}
     await deliverClaimed(row,now);

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
    const {draft,binding}=await boundDraft(workItemId);
    const lines: string[] = [];
    if (draft?.to) lines.push(`To: ${draft.to}`);
    if (draft?.subject) lines.push(`Subject: ${draft.subject}`);
    if (draft?.body) lines.push(...(lines.length ? [""] : []), draft.body.slice(0, 1200));
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
        telegram: { draftBinding:binding,buttons: workItemKeyboard(workItemId, { sends: draft?.sends }), workItemId, pushReplyToId: revised.find(r=>r.push_message_id)?.push_message_id??null, replyToMessageId: answering },
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
  channels: string[] | null;
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
  if (!dry) await cleanupAppAlerts().catch(() => undefined);
  const g = await gate(now);

  const { rows: due } = await query<OutboxRow>(
    `SELECT id, kind, title, body, href, payload, channels
       FROM push_outbox
      WHERE sent_at IS NULL AND send_after <= $1 AND (claimed_until IS NULL OR claimed_until<now())
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

  if (enabled && due.length && !dry) {
    // Claim everything up front so an overlapping drain can't double-send;
    // a failed delivery un-claims its row for the next tick.
    const { rows: claimed } = await query<{ id: string }>(
      `UPDATE push_outbox SET claimed_until = now()+interval '5 minutes'
        WHERE id = ANY($1::bigint[]) AND sent_at IS NULL AND (claimed_until IS NULL OR claimed_until<now())
        RETURNING id`,
      [due.map((r) => r.id)],
    );
    const mine = new Set(claimed.map((r) => r.id));
    const send = due.filter((r) => mine.has(r.id) && (g.awake || r.payload?.conversation));
    await query(`UPDATE push_outbox SET claimed_until=NULL WHERE id=ANY($1::bigint[])`,[due.filter(r=>mine.has(r.id)&&!send.includes(r)).map(r=>r.id)]);
    // Decision cards carry buttons and portal messages take a reply, so
    // neither is ever folded into the "…and N more" summary line.
    const keep = (r: OutboxRow) => r.kind === "decision" || r.kind === "grant" || r.kind === "portal_message" || r.payload?.conversation || r.payload?.isSummary || r.payload?.workItemId || CAP_EXEMPT.has(r.kind);
    const cards = send.filter(keep);
    const rest = send.filter((r) => !keep(r));
    const direct = [...cards, ...(rest.length > 3 ? rest.slice(0, 3) : rest)];
    const folded = rest.length > 3 ? rest.slice(3) : [];

    const unclaim = (ids: string[]) =>
      query(
        `UPDATE push_outbox SET claimed_until = NULL, send_after = $2::timestamptz + interval '5 minutes'
          WHERE id = ANY($1::bigint[])`,
        [ids, now],
      );

    let room=MAX_PER_HOUR-g.sent_last_hour;
    for (const row of direct) {
      if(!CAP_EXEMPT.has(row.kind)&&!row.payload?.conversation&&room--<=0){await query(`UPDATE push_outbox SET claimed_until=NULL,send_after=$2 WHERE id=$1`,[row.id,g.next_hour]);continue;}
      try {
        if(await deliverClaimed(row,now))result.sent++;

      } catch (err) {
        console.error(`[notify-owner] drain send failed (row ${row.id})`, err);
        await unclaim([row.id]);
      }
    }
    // Delegate constituents atomically to a stable job with their original
    // channel snapshot. All retries use the ordinary leased delivery/receipts.
    const groups=new Map<string,OutboxRow[]>();
    for(const snapshot of folded){
     const row=await safePush(snapshot);
     const channels=row.channels??Object.entries((await pushSettings()).channels).filter(([,on])=>on).map(([c])=>c);
     const key=JSON.stringify([...channels].sort());
     groups.set(key,[...(groups.get(key)??[]),row]);
    }
    for(const [key,rows] of groups){
     try{
      for(const row of rows)await recordAppMessage({...row,telegram:row.payload},row.id);
      const canSend=room>0;
      const summary=await withTransaction(async run=>{
       const locked=await run(`SELECT id FROM push_outbox WHERE id=ANY($1::bigint[]) AND sent_at IS NULL AND summary_id IS NULL FOR UPDATE`,[rows.map(r=>r.id)]);
       if(locked.length!==rows.length)throw new Error('Summary already delegated');
       const [job]=await run<OutboxRow>(`INSERT INTO push_outbox(kind,title,body,href,send_after,payload,channels,claimed_until) VALUES('urgent_item',$1,$2,'/notifications',$3,'{"isSummary":true}'::jsonb,$4,CASE WHEN $5 THEN now()+interval '5 minutes' ELSE NULL END) RETURNING *`,[`…and ${rows.length} more waiting in the app`,(await Promise.all(rows.map(r=>safePush(r)))).map(r=>r.title.replace(/^Approve: /,'')).join('\n'),canSend?now:g.next_hour,JSON.parse(key),canSend]);
       await run(`UPDATE push_outbox SET summary_id=$2,sent_at=$3,claimed_until=NULL WHERE id=ANY($1::bigint[])`,[rows.map(r=>r.id),job.id,now]);
       return job;
      });
      result.summarized+=rows.length;
      if(canSend){room--;if(await deliverClaimed(summary,now))result.sent++;}
     }catch{
      await unclaim(rows.map(r=>r.id));
     }
    }
  }

  // A held card returns once its hold expires. Clock reconciliation opens the
  // feed; this durable row restores the phone alert, using the shared gate.
  if(!dry){
   const elapsed=await query<{id:string;title:string;content_hash:string;held_until:string}>(`SELECT id,title,content_hash,held_until::text FROM decisions WHERE status='pending' AND expires_at>now() AND held_until<=now()`);
   for(const d of elapsed.rows){if(await claimOnce(`hold-ended:${d.id}:${d.held_until}`))await notifyOwner({kind:'decision',title:d.title,body:'The hold ended. This is waiting for your answer.',href:`/engine/decisions?d=${d.id}`,telegram:{decisionId:d.id,buttons:decisionKeyboard(d.id,d.content_hash)}},opts.now);}
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
    decision: CardDecision | null;
  }>(
    `SELECT g.id, g.requested_by, g.actions, g.target_id, g.reason,
            floor(extract(epoch FROM $1::timestamptz - g.created_at) / 3600)::int AS hours,
            d.id AS decision_id, d.content_hash, to_jsonb(d) AS decision
       FROM owner_grants g
       LEFT JOIN decisions d ON d.id = g.decision_id AND d.status = 'pending'
      WHERE g.status = 'requested' AND g.created_at < $1::timestamptz - interval '4 hours'
        AND g.expires_at > $1::timestamptz`,
    [now],
  );
  for (const grant of staleGrants) {
    if (dry || !(await claimOnce(`stalegrant:${grant.id}:${day}`))) continue;
    result.staleGrantNudges++;
    const appTitle = `Still waiting ${grant.hours}h: ${grant.decision?.title ?? "Permission to review"}`;
    const appBody = grant.decision ? cardText(grant.decision, { app: true }).split("\n").slice(1).join("\n") : grant.reason ? `Why: ${grant.reason.slice(0, 160)}` : undefined;
    await notifyOwner(
      {
        kind: "stale_approval",
        title: `Grant request waiting ${grant.hours}h: ${grant.requested_by} asks to ${grant.actions[0] ?? "?"}${grant.target_id ? ` (${grant.target_id})` : ""}`,
        body: grant.reason ? `Reason: ${grant.reason.slice(0, 160)}` : undefined,
        href: "/engine/permissions",
        emit: { title: appTitle, subline: appBody, ...(grant.decision_id ? { ref: `decision:${grant.decision_id}` } : {}) },
        // The nudge can be answered right there, like the original card.
        telegram: { appText: { title: appTitle, body: appBody }, ...(grant.decision_id ? { decisionId: grant.decision_id, buttons: decisionKeyboard(grant.decision_id, grant.content_hash) } : {}) },
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
    const {draft,binding}=await boundDraft(item.id);
    const preview=[draft?.to?`To: ${draft.to}`:'',draft?.subject?`Subject: ${draft.subject}`:'',draft?.body??'',draft?.sends?(draft.channel==='portal'?'Approve posts this in the client portal now.':'Approve sends this email now.'):'Approve hands it back to the agent to finish.'].filter(Boolean).join('\n');
    await notifyOwner(
      {
        kind: "stale_approval",
        title: `Approval waiting ${item.hours}h: ${item.title}`,
        body:preview,
        href: "/today",
        emit: { ref: `work_item:${item.id}` },
        telegram: { draftBinding:binding,buttons: workItemKeyboard(item.id,{sends:draft?.sends}), workItemId: item.id },
      },
      opts.now,
    );
  }

  return result;
}

async function deliverClaimed(row:OutboxRow,now:Date):Promise<boolean> {
 try {await deliverChannels({...row,telegram:row.payload},row.id);await query(`UPDATE push_outbox SET sent_at=$2,claimed_until=NULL WHERE id=$1`,[row.id,now]);return true;}
 catch {await query(`UPDATE push_outbox SET claimed_until=NULL,send_after=$2::timestamptz+interval '5 minutes' WHERE id=$1`,[row.id,now]);return false;}
}
/** Durable conversational sends deliberately bypass quiet hours/cap, as Telegram did. */
export async function enqueueOwnerConversation(input:NotifyOwnerInput,opts:{onAttempt?:()=>void}={}) {
 input=await safePush(input);
 const channels=(await pushSettings()).channels;if(input.telegram?.appOnly)channels.telegram=false;
 const {createHash}=await import('node:crypto');
 const key=createHash('sha256').update(JSON.stringify([input.body,input.telegram?.ownerReplyId,input.telegram?.pushReplyToId,input.telegram?.replyToMessageId])).digest('hex');
 const inserted=await queryOne<OutboxRow>(`INSERT INTO push_outbox(kind,title,body,href,payload,channels,send_after,claimed_until,conversation_key) VALUES($1,$2,$3,$4,$5::jsonb,$6,now(),now()+interval '5 minutes',$7) ON CONFLICT(conversation_key) DO NOTHING RETURNING *`,[input.kind,input.title,input.body,input.href,JSON.stringify(input.telegram),Object.entries(channels).filter(([,on])=>on).map(([c])=>c),key]);
 const row=inserted??(await queryOne<OutboxRow>(`SELECT * FROM push_outbox WHERE conversation_key=$1`,[key]))!;
 if(inserted)opts.onAttempt?.();
 const sent=inserted?await deliverClaimed(row,new Date()):!!(row as OutboxRow&{sent_at?:unknown}).sent_at;
 const m=await queryOne<{telegram_message_id:string|null;delivered_channels:string[]}>(`SELECT telegram_message_id,delivered_channels FROM owner_push_messages WHERE id=$1`,[row.payload?.existingMessageId]);
 return {sent:!!m?.delivered_channels.length,queued:!sent,telegramId:m?.telegram_message_id?Number(m.telegram_message_id):null};
}

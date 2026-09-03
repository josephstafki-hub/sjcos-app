import "server-only";

// Two-way SMS on Telnyx — the messaging half of the comms build (2026-09-02).
//
// Provider: Telnyx, and only Telnyx (Twilio permanently banned the account on
// 2026-08-29; there is no other code path). Config comes from lib/comms/env.ts
// and is fail-closed: any missing/invalid SMS_* var and smsConfig() is null —
// sends refuse with the list of what is missing, the webhook answers 503.
//
// THE SEND LINE: sendSms() is the ONLY function that hands a message to the
// provider, and it spends a single-use owner grant first (lib/owner-grants.ts
// consumeGrant, action 'send_sms', target the +E.164 number). The owner's own
// Reply button mints its grant inline (lib/actions/sms.ts); agents come in
// through performGrantedAction (lib/agent-sends.ts) with a grant Joe approved.
// One exception, deliberately: the carrier-mandated HELP/INFO auto-response
// (sendHelpReply) — a fixed, registered string the campaign attests we send.
//
// Inbound (app/api/sms/webhook): thread upsert by counterparty number, dedup
// on the provider message id, auto-link to a lead / project / sub / vendor by
// phone (lib/comms-shared.ts), the six keywords, MMS media re-stored as files
// rows (Telnyx URLs expire), a Telegram push, and — via the hourly detector
// layer — a work item if the text sits unanswered for 4 hours.

import { query, queryOne } from "./db";
import { commsEnvReport, smsConfigFrom, type SmsConfig } from "./comms/env";
import { normalizeE164 } from "./comms/phone";
import {
  classifyKeyword,
  classifySendFailure,
  describeSendFailure,
  type KeywordAction,
  type ParsedMessagingEvent,
} from "./comms/sms-inbound";
import { helpMessageFrom } from "./comms/tendlc.mjs";
import { sendTelnyxMessage, downloadMedia, TelnyxError } from "./telnyx";
import { storeBuffer } from "./upload-store";
import { notifyOwner } from "./notify-owner";
import { consumeGrant, recordGrantResult, refundGrantUse } from "./owner-grants";
import { fileCommsWorkItem, linkHref, linkIds, matchPhoneToRecord, readTendlcState, type CommsLinkType } from "./comms-shared";
import { reportCommsFailure } from "./comms-health";

// ─── Config ──────────────────────────────────────────────────────────────────

export function smsConfig(): SmsConfig | null {
  return smsConfigFrom();
}

export function smsConfigured(): boolean {
  return smsConfig() !== null;
}

/** Why SMS is off, for UI copy and refusals. */
export function smsStatus(): { configured: boolean; enabled: boolean; problems: string[] } {
  const r = commsEnvReport();
  return { configured: r.sms.ok, enabled: r.sms.enabled, problems: r.problems.filter((p) => p.startsWith("SMS") || p.startsWith("Stale")) };
}

function notConfiguredError(): string {
  const s = smsStatus();
  if (!s.enabled) return "SMS is not configured (SMS_PROVIDER is unset).";
  return `SMS is misconfigured: ${s.problems.join("; ")}`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SmsThreadSummary {
  id: number;
  phone: string;
  contactName: string | null;
  linkType: CommsLinkType | null;
  linkSlug: string | null;
  unread: boolean;
  lastMessageAt: string | null;
  optedOut: boolean;
  optedOutAt: string | null;
}

export interface SmsMedia {
  file_id: string;
  mime: string;
  name: string;
  size: number;
}

export interface SmsMessage {
  id: number;
  direction: "in" | "out";
  body: string;
  status: string;
  createdAt: string;
  media: SmsMedia[];
  errorDetail: string | null;
  failureKind: string | null;
  keyword: string | null;
  sentBy: string | null;
}

const THREAD_COLS = `id, phone, contact_name, link_type, link_slug, unread, last_message_at, opted_out, opted_out_at`;
interface ThreadRow {
  id: number;
  phone: string;
  contact_name: string | null;
  link_type: CommsLinkType | null;
  link_slug: string | null;
  unread: boolean;
  last_message_at: string | null;
  opted_out: boolean;
  opted_out_at: string | null;
}
const toThread = (r: ThreadRow): SmsThreadSummary => ({
  id: r.id,
  phone: r.phone,
  contactName: r.contact_name,
  linkType: r.link_type,
  linkSlug: r.link_slug,
  unread: r.unread,
  lastMessageAt: r.last_message_at,
  optedOut: r.opted_out,
  optedOutAt: r.opted_out_at,
});

const MSG_COLS = `id, direction, body, status, created_at, media, error_detail, failure_kind, keyword, sent_by`;
interface MsgRow {
  id: number;
  direction: "in" | "out";
  body: string;
  status: string;
  created_at: string;
  media: SmsMedia[];
  error_detail: string | null;
  failure_kind: string | null;
  keyword: string | null;
  sent_by: string | null;
}
const toMsg = (r: MsgRow): SmsMessage => ({
  id: r.id,
  direction: r.direction,
  body: r.body,
  status: r.status,
  createdAt: r.created_at,
  media: Array.isArray(r.media) ? r.media : [],
  errorDetail: r.error_detail,
  failureKind: r.failure_kind,
  keyword: r.keyword,
  sentBy: r.sent_by,
});

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function getSmsThreads(): Promise<SmsThreadSummary[]> {
  const { rows } = await query<ThreadRow>(
    `SELECT ${THREAD_COLS} FROM sms_threads ORDER BY last_message_at DESC NULLS LAST, id DESC`,
  );
  return rows.map(toThread);
}

export async function getSmsThread(id: number): Promise<{ thread: SmsThreadSummary; messages: SmsMessage[] } | null> {
  const t = await queryOne<ThreadRow>(`SELECT ${THREAD_COLS} FROM sms_threads WHERE id = $1`, [id]);
  if (!t) return null;
  const { rows } = await query<MsgRow>(`SELECT ${MSG_COLS} FROM sms_messages WHERE thread_id = $1 ORDER BY created_at, id`, [id]);
  return { thread: toThread(t), messages: rows.map(toMsg) };
}

/** Threads with an inbound message awaiting a reply (nav badge). */
export async function getUnreadSmsCount(): Promise<number> {
  const row = await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM sms_threads WHERE unread = true`);
  return Number(row?.n ?? 0);
}

export interface SmsLinkOptions {
  leads: { slug: string; name: string }[];
  subs: { slug: string; name: string }[];
  projects: { slug: string; name: string }[];
  vendors: { slug: string; name: string }[];
}

export async function getSmsLinkOptions(): Promise<SmsLinkOptions> {
  const [leads, subs, projects, vendors] = await Promise.all([
    query<{ slug: string; name: string }>(`SELECT slug, name FROM leads ORDER BY created_at DESC`),
    query<{ slug: string; name: string }>(`SELECT slug, name FROM subs ORDER BY name`),
    query<{ slug: string; name: string }>(`SELECT slug, name FROM projects ORDER BY updated_at DESC`),
    query<{ slug: string; name: string }>(`SELECT slug, name FROM vendors ORDER BY name`),
  ]);
  return { leads: leads.rows, subs: subs.rows, projects: projects.rows, vendors: vendors.rows };
}

// ─── Threads ─────────────────────────────────────────────────────────────────

/** Thread key for a counterparty: strict +E.164 when it parses, else a
 *  "+digits" key so a malformed inbound still lands somewhere visible. */
function threadKey(phone: string): string {
  const r = normalizeE164(phone);
  if (r.ok) return r.e164;
  const digits = phone.replace(/\D/g, "");
  return digits ? `+${digits}` : phone.trim();
}

/** Link an unlinked thread to the matching record and fill the contact name. */
async function autoLinkThread(threadId: number, phone: string): Promise<void> {
  try {
    const m = await matchPhoneToRecord(phone);
    if (!m) return;
    await query(
      `UPDATE sms_threads
          SET link_type = COALESCE(link_type, $2), link_slug = COALESCE(link_slug, $3),
              contact_name = COALESCE(contact_name, $4)
        WHERE id = $1`,
      [threadId, m.linkType, m.linkSlug, m.contactName],
    );
  } catch {
    /* linking is secondary — never fail a message on it */
  }
}

/** Get or create the thread for a counterparty number. */
export async function upsertSmsThread(phone: string, contactName?: string | null, businessNumber?: string | null): Promise<number> {
  const key = threadKey(phone);
  const row = await queryOne<{ id: number }>(
    `INSERT INTO sms_threads (phone, contact_name, business_number)
     VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO UPDATE
       SET contact_name = COALESCE(sms_threads.contact_name, EXCLUDED.contact_name),
           business_number = COALESCE(sms_threads.business_number, EXCLUDED.business_number)
     RETURNING id`,
    [key, contactName?.trim() || null, businessNumber ?? smsConfig()?.fromNumber ?? null],
  );
  const id = row!.id;
  await autoLinkThread(id, key);
  return id;
}

async function threadLinkIds(threadId: number): Promise<{ leadId: string | null; projectId: string | null; name: string; phone: string; linkType: string | null; linkSlug: string | null }> {
  const t = await queryOne<{ phone: string; contact_name: string | null; link_type: string | null; link_slug: string | null }>(
    `SELECT phone, contact_name, link_type, link_slug FROM sms_threads WHERE id = $1`,
    [threadId],
  );
  if (!t) return { leadId: null, projectId: null, name: "unknown", phone: "", linkType: null, linkSlug: null };
  const ids = await linkIds(t.link_type, t.link_slug);
  return { ...ids, name: t.contact_name || t.phone, phone: t.phone, linkType: t.link_type, linkSlug: t.link_slug };
}

// ─── Inbound ─────────────────────────────────────────────────────────────────

export interface InboundResult {
  threadId: number;
  messageId: number | null;
  duplicate: boolean;
  keyword: KeywordAction | null;
}

/** Record an inbound text from a verified Telnyx `message.received` event.
 *  Deduped on the provider message id (Telnyx retries non-200s). Handles the
 *  six keywords, re-stores MMS media, pushes Joe. */
export async function recordInboundSms(ev: ParsedMessagingEvent): Promise<InboundResult> {
  if (!ev.from) throw new Error("inbound message has no sender");
  const businessNumber = ev.to[0] ?? smsConfig()?.fromNumber ?? null;
  const keyword = classifyKeyword(ev.text);
  const threadId = await upsertSmsThread(ev.from, null, businessNumber);

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO sms_messages (thread_id, direction, body, provider_sid, status, from_number, to_number, keyword)
     VALUES ($1, 'in', $2, $3, 'received', $4, $5, $6)
     ON CONFLICT (provider_sid) DO NOTHING
     RETURNING id`,
    [threadId, ev.text.slice(0, 4000), ev.messageId, ev.from, businessNumber, keyword],
  );
  if (!inserted) return { threadId, messageId: null, duplicate: true, keyword };
  const messageId = inserted.id;

  // Thread state: a keyword is not a conversation turn Joe needs to answer.
  await query(
    `UPDATE sms_threads
        SET last_message_at = now(), last_inbound_at = now(),
            unread = CASE WHEN $2 THEN unread ELSE true END
      WHERE id = $1`,
    [threadId, keyword !== null],
  );

  // MMS: Telnyx media URLs expire — download and re-store now.
  if (ev.media.length) {
    const media: SmsMedia[] = [];
    for (const [i, m] of ev.media.entries()) {
      try {
        const { bytes, mime } = await downloadMedia(m.url);
        const ext = (mime.split("/")[1] ?? "bin").split(";")[0].replace(/[^a-z0-9]/gi, "") || "bin";
        const stored = await storeBuffer(bytes, {
          filename: `text-from-${ev.from.replace(/\D/g, "")}-${i + 1}.${ext}`,
          mime: m.contentType || mime,
          idPrefix: "mms",
          tag: "SMS · MMS",
          subtitle: `Texted in from ${ev.from}`,
        });
        if (stored.ok) media.push({ file_id: stored.id, mime: m.contentType || mime, name: `attachment ${i + 1}`, size: bytes.length });
        else await reportCommsFailure("sms-webhook", new Error(`MMS store failed: ${stored.error}`));
      } catch (err) {
        await reportCommsFailure("sms-webhook", err, { detail: `MMS media ${i + 1} from ${ev.from} could not be downloaded/stored.` });
      }
    }
    if (media.length) await query(`UPDATE sms_messages SET media = $2::jsonb, updated_at = now() WHERE id = $1`, [messageId, JSON.stringify(media)]);
  }

  const link = await threadLinkIds(threadId);
  const href = "/messages";

  if (keyword === "opt_out") {
    await query(`UPDATE sms_threads SET opted_out = true, opted_out_at = now() WHERE id = $1`, [threadId]);
    await notifyOwner({ kind: "sms_inbound", title: `${link.name} opted out of texts (${ev.text.trim().toUpperCase()})`, href });
  } else if (keyword === "opt_in") {
    await query(`UPDATE sms_threads SET opted_out = false, opted_in_at = now() WHERE id = $1`, [threadId]);
    await notifyOwner({ kind: "sms_inbound", title: `${link.name} opted back in to texts`, href });
  } else if (keyword === "help") {
    await sendHelpReply(threadId, ev.from);
  } else {
    const preview = ev.text.trim().replace(/\s+/g, " ").slice(0, 120) || (ev.media.length ? `(${ev.media.length} attachment${ev.media.length === 1 ? "" : "s"})` : "(empty)");
    await notifyOwner({
      kind: "sms_inbound",
      title: `Text from ${link.name}${link.linkType ? ` (${link.linkType})` : ""}`,
      body: preview,
      href: linkHref(link.linkType, link.linkSlug) ?? href,
    });
  }
  return { threadId, messageId, duplicate: false, keyword };
}

/** Delivery receipt (message.sent / message.finalized) for one of OUR
 *  messages: update the outbound row's status; never create a message. A
 *  terminal failure files a work item — with the 10DLC-pending case named. */
export async function applyDeliveryReceipt(ev: ParsedMessagingEvent): Promise<{ matched: boolean }> {
  if (!ev.messageId) return { matched: false };
  const status = ev.toStatus ?? (ev.eventType === "message.sent" ? "sent" : "unknown");
  const failed = /failed|expired/.test(status) || ev.errors.length > 0;
  const kind = failed ? classifySendFailure(ev.errors) : null;
  const detail = failed ? describeSendFailure(kind!, ev.errors) : null;
  const row = await queryOne<{ id: number; thread_id: number; body: string }>(
    `UPDATE sms_messages
        SET status = $2, error_code = $3, error_detail = $4, failure_kind = $5, updated_at = now()
      WHERE provider_sid = $1 AND direction = 'out'
      RETURNING id, thread_id, body`,
    [ev.messageId, status, ev.errors[0]?.code ?? null, detail, kind],
  );
  if (!row) return { matched: false };
  if (failed && ev.eventType === "message.finalized") {
    const link = await threadLinkIds(row.thread_id);
    await fileCommsWorkItem({
      title: kind === "campaign_not_registered" ? `Text to ${link.name} held: 10DLC campaign not yet approved` : `Text to ${link.name} failed to deliver`,
      body:
        `${detail}\n\nMessage: "${row.body.slice(0, 300)}"\nTo: ${link.phone}\n\n` +
        (kind === "campaign_not_registered"
          ? "This is expected while carriers review the 10DLC campaign (1–3 weeks). Re-send once `node scripts/register-10dlc.mjs status` shows the campaign accepted. [sms:campaign-pending]"
          : "Check the number and re-send from /messages. [sms:delivery-failed]"),
      priority: kind === "campaign_not_registered" ? "normal" : "high",
      leadId: link.leadId,
      projectId: link.projectId,
      sourceKind: "sms",
      sourceId: kind === "campaign_not_registered" ? "sms-campaign-pending" : `sms-fail:${row.id}`,
    });
    await notifyOwner({
      kind: "comms",
      title: kind === "campaign_not_registered" ? "Text held — 10DLC campaign not yet approved" : `Text to ${link.name} failed`,
      body: (detail ?? "").slice(0, 160),
      href: "/messages",
    });
  }
  return { matched: true };
}

// ─── Outbound ────────────────────────────────────────────────────────────────

export interface SendSmsInput {
  to: string;
  body: string;
  /** Single-use owner grant covering send_sms for this number. Required. */
  grantId: string;
  /** 'owner' or 'mcp:<agent>' — for the audit line. */
  actor: string;
  contactName?: string | null;
}

export type SendSmsResult =
  | { ok: true; threadId: number; messageId: number; providerId: string; summary: string }
  | { ok: false; error: string; threadId?: number; blocked?: "opted_out" | "not_configured" | "grant" | "invalid_number" };

/** THE outbound path. Spends the grant, checks opt-out, records the message,
 *  hands it to Telnyx, and turns every failure into a work item. */
export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const text = input.body.trim();
  if (!text) return { ok: false, error: "Empty message." };
  if (text.length > 1600) return { ok: false, error: "Message is too long (1600 characters max)." };
  const cfg = smsConfig();
  if (!cfg) return { ok: false, error: notConfiguredError(), blocked: "not_configured" };
  const norm = normalizeE164(input.to);
  if (!norm.ok) return { ok: false, error: norm.error, blocked: "invalid_number" };
  const to = norm.e164;

  const spent = await consumeGrant(input.grantId, "send_sms", { kind: "phone", id: to, to });
  if (!spent.ok) return { ok: false, error: spent.error, blocked: "grant" };

  const threadId = await upsertSmsThread(to, input.contactName, cfg.fromNumber);
  const thread = await queryOne<{ opted_out: boolean; opted_out_at: string | null; contact_name: string | null }>(
    `SELECT opted_out, opted_out_at::text AS opted_out_at, contact_name FROM sms_threads WHERE id = $1`,
    [threadId],
  );
  if (thread?.opted_out) {
    const when = thread.opted_out_at ? ` on ${thread.opted_out_at.slice(0, 10)}` : "";
    const error = `Blocked: ${thread.contact_name || to} opted out of texts (STOP)${when}. They must text START to opt back in; nothing was sent.`;
    await refundGrantUse(input.grantId);
    await recordGrantResult(input.grantId, `blocked: opted out`);
    return { ok: false, error, threadId, blocked: "opted_out" };
  }

  const msg = await queryOne<{ id: number }>(
    `INSERT INTO sms_messages (thread_id, direction, body, status, from_number, to_number, sent_by, grant_id)
     VALUES ($1, 'out', $2, 'queued', $3, $4, $5, $6) RETURNING id`,
    [threadId, text, cfg.fromNumber, to, input.actor.slice(0, 80), input.grantId],
  );
  const messageId = msg!.id;

  try {
    const sent = await sendTelnyxMessage(cfg, { to, text });
    await query(
      `UPDATE sms_messages SET provider_sid = $2, status = $3, updated_at = now() WHERE id = $1`,
      [messageId, sent.id, sent.toStatus ?? "queued"],
    );
    await query(`UPDATE sms_threads SET last_message_at = now(), last_outbound_at = now(), unread = false WHERE id = $1`, [threadId]);
    const summary = `Text sent to ${thread?.contact_name || to}: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`;
    await recordGrantResult(input.grantId, `ok: ${summary}`);
    return { ok: true, threadId, messageId, providerId: sent.id, summary };
  } catch (err) {
    const errors = err instanceof TelnyxError ? err.errors : [{ code: "", title: "", detail: (err as Error).message }];
    const kind = classifySendFailure(errors);
    const detail = describeSendFailure(kind, errors);
    await query(
      `UPDATE sms_messages SET status = 'failed', error_code = $2, error_detail = $3, failure_kind = $4, updated_at = now() WHERE id = $1`,
      [messageId, errors[0]?.code ?? null, detail, kind],
    );
    await refundGrantUse(input.grantId);
    await recordGrantResult(input.grantId, `failed: ${detail.slice(0, 200)}`);
    const link = await threadLinkIds(threadId);
    await fileCommsWorkItem({
      title: kind === "campaign_not_registered" ? `Text to ${link.name} held: 10DLC campaign not yet approved` : `Text to ${link.name} failed to send`,
      body:
        `${detail}\n\nMessage: "${text.slice(0, 300)}"\nTo: ${to}\nAttempted by: ${input.actor}\n\n` +
        (kind === "campaign_not_registered"
          ? "Expected while carriers review the campaign (1–3 weeks). Re-send after `node scripts/register-10dlc.mjs status` shows it accepted. [sms:campaign-pending]"
          : "[sms:send-failed]"),
      priority: kind === "campaign_not_registered" ? "normal" : "high",
      leadId: link.leadId,
      projectId: link.projectId,
      sourceKind: "sms",
      sourceId: kind === "campaign_not_registered" ? "sms-campaign-pending" : `sms-fail:${messageId}`,
    });
    if (kind !== "campaign_not_registered") await reportCommsFailure("sms-send", err, { detail: `to ${to}`, href: "/messages" });
    return { ok: false, error: detail, threadId };
  }
}

/** The registered HELP/INFO response. Carrier-mandated, fixed text, no grant:
 *  the campaign attests that the OS answers HELP with exactly this string
 *  (the one the registration script submitted, read back from its state
 *  file). Set SMS_HELP_AUTOREPLY=off to leave it to Telnyx's own responder. */
export async function sendHelpReply(threadId: number, to: string): Promise<void> {
  if ((process.env.SMS_HELP_AUTOREPLY ?? "on").trim() === "off") return;
  const cfg = smsConfig();
  if (!cfg) return;
  const text = readTendlcState()?.helpMessage ?? helpMessageFrom(process.env as Record<string, string | undefined>);
  const msg = await queryOne<{ id: number }>(
    `INSERT INTO sms_messages (thread_id, direction, body, status, from_number, to_number, sent_by)
     VALUES ($1, 'out', $2, 'queued', $3, $4, 'system:help') RETURNING id`,
    [threadId, text, cfg.fromNumber, to],
  );
  try {
    const sent = await sendTelnyxMessage(cfg, { to, text });
    await query(`UPDATE sms_messages SET provider_sid = $2, status = $3, updated_at = now() WHERE id = $1`, [msg!.id, sent.id, sent.toStatus ?? "queued"]);
    await query(`UPDATE sms_threads SET last_message_at = now(), last_outbound_at = now() WHERE id = $1`, [threadId]);
  } catch (err) {
    const errors = err instanceof TelnyxError ? err.errors : [{ code: "", title: "", detail: (err as Error).message }];
    const kind = classifySendFailure(errors);
    await query(
      `UPDATE sms_messages SET status = 'failed', error_detail = $2, failure_kind = $3, updated_at = now() WHERE id = $1`,
      [msg!.id, describeSendFailure(kind, errors), kind],
    );
    if (kind !== "campaign_not_registered") await reportCommsFailure("sms-send", err, { detail: `HELP auto-reply to ${to}` });
  }
}

import "server-only";

// Provider-agnostic SMS seam — the two-way texting inbox, mirroring how lib/ai.ts
// and lib/gmail.ts isolate an external provider behind a small interface.
//
// STATUS: scaffolded, INERT until a provider is configured. Real business SMS
// needs a paid number (Twilio / Telnyx / SignalWire, ~$1–2/mo + ~$0.008/text)
// AND A2P 10DLC brand+campaign registration. Until the SMS_* env vars are set,
// smsConfigured() is false: reads work (threads stay empty), sends refuse, and
// the webhook returns 503. Wire the provider + UI once Joe picks one.
//
// Env (all required to activate): SMS_PROVIDER (twilio|telnyx|signalwire),
// SMS_ACCOUNT_SID, SMS_AUTH_TOKEN, SMS_FROM_NUMBER (E.164), SMS_WEBHOOK_SECRET.

import { query, queryOne } from "./db";

export type SmsProvider = "twilio" | "telnyx" | "signalwire";

export interface SmsConfig {
  provider: SmsProvider;
  accountSid: string;
  authToken: string;
  /** The business number, E.164 (e.g. +16125551234). */
  fromNumber: string;
}

/** Provider config from env, or null until SMS is set up. Fail-closed: every
 *  field must be present. */
export function smsConfig(): SmsConfig | null {
  const provider = (process.env.SMS_PROVIDER ?? "").trim().toLowerCase();
  const accountSid = (process.env.SMS_ACCOUNT_SID ?? "").trim();
  const authToken = (process.env.SMS_AUTH_TOKEN ?? "").trim();
  const fromNumber = (process.env.SMS_FROM_NUMBER ?? "").trim();
  if (!["twilio", "telnyx", "signalwire"].includes(provider)) return null;
  if (!accountSid || !authToken || !fromNumber) return null;
  return { provider: provider as SmsProvider, accountSid, authToken, fromNumber };
}

export function smsConfigured(): boolean {
  return smsConfig() !== null;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SmsThreadSummary {
  id: number;
  phone: string;
  contactName: string | null;
  linkType: "lead" | "sub" | "client" | "project" | null;
  linkSlug: string | null;
  unread: boolean;
  lastMessageAt: string | null;
}

export interface SmsMessage {
  id: number;
  direction: "in" | "out";
  body: string;
  status: string;
  createdAt: string;
}

// ─── Reads (work regardless of config; empty until messages arrive) ──────────

export async function getSmsThreads(): Promise<SmsThreadSummary[]> {
  const { rows } = await query<{
    id: number;
    phone: string;
    contact_name: string | null;
    link_type: SmsThreadSummary["linkType"];
    link_slug: string | null;
    unread: boolean;
    last_message_at: string | null;
  }>(
    `SELECT id, phone, contact_name, link_type, link_slug, unread, last_message_at
       FROM sms_threads
      ORDER BY last_message_at DESC NULLS LAST, id DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    phone: r.phone,
    contactName: r.contact_name,
    linkType: r.link_type,
    linkSlug: r.link_slug,
    unread: r.unread,
    lastMessageAt: r.last_message_at,
  }));
}

export async function getSmsThread(
  id: number,
): Promise<{ thread: SmsThreadSummary; messages: SmsMessage[] } | null> {
  const t = await queryOne<{
    id: number;
    phone: string;
    contact_name: string | null;
    link_type: SmsThreadSummary["linkType"];
    link_slug: string | null;
    unread: boolean;
    last_message_at: string | null;
  }>(
    `SELECT id, phone, contact_name, link_type, link_slug, unread, last_message_at
       FROM sms_threads WHERE id = $1`,
    [id],
  );
  if (!t) return null;
  const { rows } = await query<SmsMessage & { created_at: string }>(
    `SELECT id, direction, body, status, created_at
       FROM sms_messages WHERE thread_id = $1 ORDER BY created_at, id`,
    [id],
  );
  return {
    thread: {
      id: t.id,
      phone: t.phone,
      contactName: t.contact_name,
      linkType: t.link_type,
      linkSlug: t.link_slug,
      unread: t.unread,
      lastMessageAt: t.last_message_at,
    },
    messages: rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      body: r.body,
      status: r.status,
      createdAt: r.created_at,
    })),
  };
}

/** Count of threads with an inbound message awaiting a reply (for a nav badge). */
export async function getUnreadSmsCount(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM sms_threads WHERE unread = true`,
  );
  return Number(row?.n ?? 0);
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/** Normalize a phone to a rough E.164-ish key so a counterparty maps to one
 *  thread. Keeps a leading +, strips other non-digits. */
function normalizePhone(phone: string): string {
  const p = phone.trim();
  const plus = p.startsWith("+") ? "+" : "";
  return plus + p.replace(/\D/g, "");
}

/** Last 10 digits of a phone (US local number) for record matching. */
function last10(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

/** Auto-classify an unlinked thread by matching its number against a lead's or
 *  sub's phone. Sets link_type/link_slug + fills contact_name when a match is
 *  found and the thread isn't already linked. Best-effort. */
async function autoLinkThread(threadId: number, phone: string): Promise<void> {
  const l10 = last10(phone);
  if (l10.length < 10) return;
  await query(
    `UPDATE sms_threads t
        SET link_type = m.type, link_slug = m.slug,
            contact_name = COALESCE(t.contact_name, m.name)
       FROM (
         SELECT 'lead'::text AS type, slug, name FROM leads
           WHERE phone IS NOT NULL AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = $2
         UNION ALL
         SELECT 'sub'::text, slug, name FROM subs
           WHERE phone IS NOT NULL AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = $2
         LIMIT 1
       ) m
      WHERE t.id = $1 AND t.link_type IS NULL`,
    [threadId, l10],
  );
}

/** Records to link an SMS thread to (for the "Linked to" picker). */
export interface SmsLinkOptions {
  leads: { slug: string; name: string }[];
  subs: { slug: string; name: string }[];
  projects: { slug: string; name: string }[];
}

export async function getSmsLinkOptions(): Promise<SmsLinkOptions> {
  const [leads, subs, projects] = await Promise.all([
    query<{ slug: string; name: string }>(`SELECT slug, name FROM leads ORDER BY created_at DESC`),
    query<{ slug: string; name: string }>(`SELECT slug, name FROM subs ORDER BY name`),
    query<{ slug: string; name: string }>(`SELECT slug, name FROM projects ORDER BY updated_at DESC`),
  ]);
  return { leads: leads.rows, subs: subs.rows, projects: projects.rows };
}

/** Record an inbound text: upsert the thread by counterparty number, append the
 *  message, mark unread. Deduped on provider message id. Returns the thread id.
 *  Called by the provider webhook. */
export async function recordInboundSms(input: {
  from: string;
  body: string;
  providerSid?: string | null;
}): Promise<number> {
  const phone = normalizePhone(input.from);
  const thread = await queryOne<{ id: number }>(
    `INSERT INTO sms_threads (phone, last_message_at, unread)
     VALUES ($1, now(), true)
     ON CONFLICT (phone) DO UPDATE SET last_message_at = now(), unread = true
     RETURNING id`,
    [phone],
  );
  const threadId = thread!.id;
  await query(
    `INSERT INTO sms_messages (thread_id, direction, body, provider_sid, status)
     VALUES ($1, 'in', $2, $3, 'received')
     ON CONFLICT (provider_sid) DO NOTHING`,
    [threadId, input.body.slice(0, 2000), input.providerSid ?? null],
  );
  // Best-effort auto-classify to a lead/sub by phone (only if not already linked).
  try {
    await autoLinkThread(threadId, phone);
  } catch {
    /* linking is secondary — never fail an inbound on it */
  }
  return threadId;
}

/** Get or create a thread for a counterparty number (outbound-initiate). Sets
 *  the contact name if provided and one isn't already stored. Returns the id. */
export async function upsertSmsThread(
  phone: string,
  contactName?: string | null,
): Promise<number> {
  const p = normalizePhone(phone);
  const row = await queryOne<{ id: number }>(
    `INSERT INTO sms_threads (phone, contact_name, last_message_at)
     VALUES ($1, $2, now())
     ON CONFLICT (phone) DO UPDATE
       SET contact_name = COALESCE(sms_threads.contact_name, EXCLUDED.contact_name)
     RETURNING id`,
    [p, contactName?.trim() || null],
  );
  const id = row!.id;
  try {
    await autoLinkThread(id, p);
  } catch {
    /* linking is secondary */
  }
  return id;
}

/** Send an outbound text on an existing thread. Records the outbound message,
 *  then hands off to the provider. Refuses (no-op record) when SMS isn't
 *  configured. Returns {ok} + optional error. */
export async function sendSmsOnThread(
  threadId: number,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const text = body.trim();
  if (!text) return { ok: false, error: "Empty message." };
  const cfg = smsConfig();
  if (!cfg) return { ok: false, error: "SMS is not configured yet." };

  const thread = await queryOne<{ phone: string }>(
    `SELECT phone FROM sms_threads WHERE id = $1`,
    [threadId],
  );
  if (!thread) return { ok: false, error: "Thread not found." };

  const sent = await sendViaProvider(cfg, thread.phone, text);
  await query(
    `INSERT INTO sms_messages (thread_id, direction, body, provider_sid, status)
     VALUES ($1, 'out', $2, $3, $4)`,
    [threadId, text.slice(0, 2000), sent.sid ?? null, sent.ok ? "sent" : "failed"],
  );
  await query(
    `UPDATE sms_threads SET last_message_at = now(), unread = false WHERE id = $1`,
    [threadId],
  );
  return sent.ok ? { ok: true } : { ok: false, error: sent.error };
}

/** Low-level provider send. Only Twilio's REST API is wired today (the most
 *  common); telnyx/signalwire slot in here the same way. Activates only when
 *  the matching SMS_* env is present — otherwise sendSmsOnThread never calls it. */
async function sendViaProvider(
  cfg: SmsConfig,
  to: string,
  body: string,
): Promise<{ ok: boolean; sid?: string; error?: string }> {
  try {
    if (cfg.provider === "twilio") {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`;
      const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64");
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: cfg.fromNumber, Body: body }),
        signal: AbortSignal.timeout(15000),
      });
      const data = (await res.json()) as { sid?: string; message?: string };
      if (!res.ok) return { ok: false, error: data.message ?? `HTTP ${res.status}` };
      return { ok: true, sid: data.sid };
    }
    // telnyx / signalwire: implement when a provider is chosen.
    return { ok: false, error: `Provider "${cfg.provider}" send not implemented yet.` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

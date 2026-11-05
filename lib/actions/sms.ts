"use server";

// SMS write paths for the OWNER's own UI (/messages). Reads and the provider
// send live in lib/sms.ts. Every send still goes through the one grant-gated
// path: the owner's click mints a single-use grant for exactly this number
// (createGrant, requested_by 'owner') and sendSms() spends it — so there is
// one code path to the provider, always audited, for Joe and agents alike.

import { connectionCopy } from "../comms/connection-copy";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireAccess } from "@/lib/dal";
import { createGrant } from "@/lib/owner-grants";
import { normalizeE164 } from "@/lib/comms/phone";
import { getSmsThread, sendSms, sendingLineForUser, smsConfigured, smsThreadVisibleTo, upsertSmsThread, type SmsMessage } from "@/lib/sms";
import type { CurrentUser } from "@/lib/dal";

/** comms access AND this thread is on a line the user may read (a team
 *  member's own line is theirs and the owner's). */
async function requireThread(threadId: number): Promise<CurrentUser | null> {
  const user = await requireAccess("comms");
  return (await smsThreadVisibleTo(user, threadId)) ? user : null;
}

/** Load a thread's messages and clear its unread flag (opening = reading).
 *  Owner-only. Returns null if the thread is gone. */
/** `markRead` false: load for display without clearing the unread dot — the
 *  conversation pane isn't on screen yet (phone layout shows the list first). */
export async function loadSmsThread(id: number, markRead = true): Promise<{ messages: SmsMessage[]; unreadCleared: boolean } | null> {
  const user = await requireAccess("comms");
  const data = await getSmsThread(id, user);
  if (!data) return null;
  let unreadCleared = false;
  if (markRead && data.thread.unread) {
    await query(`UPDATE sms_threads SET unread = false WHERE id = $1`, [id]);
    unreadCleared = true;
    revalidatePath("/messages");
  }
  return { messages: data.messages, unreadCleared };
}

async function ownerSend(user: CurrentUser, from: string | null, to: string, body: string, contactName?: string | null, retryOfId?:string): Promise<{ ok: boolean; threadId?: number; error?: string }> {
  if (!smsConfigured()) {
    return { ok: false, error: connectionCopy("sms").error };
  }
  const norm = normalizeE164(to);
  if (!norm.ok) return { ok: false, error: norm.error };
  // The owner's click IS the express permission: one use, this number, 10 min.
  const grant = await createGrant({
    actions: ["send_sms"],
    targetKind: "phone",
    targetId: norm.e164,
    scope: { to: norm.e164 },
    reason: `Owner sent a text from /messages`,
    requestedBy: "owner",
    maxUses: 1,
    expiresInMinutes: 10,
  });
  const actor = user.role === "owner" ? "owner" : `staff:${user.id}`;
  const r = await sendSms({ to: norm.e164, body, grantId: grant.id, actor, contactName, retryOfId, from });
  revalidatePath("/messages");
  if (!r.ok) return { ok: false, threadId: r.threadId, error: r.error };
  return { ok: true, threadId: r.threadId };
}

/** Start a new outbound conversation: get/create the thread for a number, then
 *  send the first text. Owner-only. */
export async function startSmsThread(phone: string, body: string, contactName: string): Promise<{ ok: boolean; threadId?: number; error?: string }> {
  const user = await requireAccess("comms");
  const p = phone.trim();
  if (!p) return { ok: false, error: "Enter a phone number." };
  if (!body.trim()) return { ok: false, error: "Enter a message." };
  const norm = normalizeE164(p);
  if (!norm.ok) return { ok: false, error: norm.error };
  // Create the thread first so a refusal (opt-out, provider down) still leaves
  // the conversation visible with its error.
  // A new conversation goes out from the sender's own line, else the company's.
  const from = await sendingLineForUser(user.id);
  const threadId = await upsertSmsThread(norm.e164, contactName, from);
  const r = await ownerSend(user, from, norm.e164, body, contactName);
  return { ...r, threadId: r.threadId ?? threadId };
}

/** Send a reply on an SMS thread. Owner-only. */
export async function sendSmsReply(threadId: number, body: string, retryOfId?:string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAccess("comms");
  const data = await getSmsThread(threadId, user);
  if (!data) return { ok: false, error: "Thread not found." };
  // A reply stays on the line the conversation is on.
  return ownerSend(user, data.thread.businessNumber, data.thread.phone, body, data.thread.contactName,retryOfId);
}

const LINK_TYPES = ["lead", "sub", "client", "project", "vendor"] as const;
type SmsLinkType = (typeof LINK_TYPES)[number];

/** Manually link an SMS thread to a record. Owner-only. */
export async function linkSmsThread(threadId: number, type: string, slug: string): Promise<{ ok: boolean; error?: string }> {
  await requireAccess("comms");
  if (!LINK_TYPES.includes(type as SmsLinkType)) return { ok: false, error: "Invalid link type." };
  if (!slug.trim()) return { ok: false, error: "Pick a record." };
  if (!(await requireThread(threadId))) return { ok: false, error: "Thread not found." };
  // The person is the same on every line: link all their threads.
  await query(`UPDATE sms_threads SET link_type = $2, link_slug = $3 WHERE phone = (SELECT phone FROM sms_threads WHERE id = $1)`, [threadId, type, slug.trim()]);
  revalidatePath("/messages");
  return { ok: true };
}

/** Remove a thread's record link. Owner-only. */
export async function unlinkSmsThread(threadId: number): Promise<{ ok: boolean }> {
  if (!(await requireThread(threadId))) return { ok: false };
  await query(`UPDATE sms_threads SET link_type = NULL, link_slug = NULL WHERE phone = (SELECT phone FROM sms_threads WHERE id = $1)`, [threadId]);
  revalidatePath("/messages");
  return { ok: true };
}

/** Clear the unread flag on a thread. Owner-only. */
export async function markSmsThreadRead(threadId: number): Promise<{ ok: boolean }> {
  if (!(await requireThread(threadId))) return { ok: false };
  await query(`UPDATE sms_threads SET unread = false WHERE id = $1`, [threadId]);
  revalidatePath("/messages");
  return { ok: true };
}

/** Owner override of the local opt-out flag (e.g. the contact asked in
 *  person). The carrier-side block is Telnyx's; this only changes what the OS
 *  will attempt. Owner-only. */
export async function setSmsOptOut(threadId: number, optedOut: boolean): Promise<{ ok: boolean }> {
  if (!(await requireThread(threadId))) return { ok: false };
  // Every line's thread with this person (sends check them all).
  await query(
    optedOut
      ? `UPDATE sms_threads SET opted_out = true, opted_out_at = now() WHERE phone = (SELECT phone FROM sms_threads WHERE id = $1)`
      : `UPDATE sms_threads SET opted_out = false, opted_in_at = now() WHERE phone = (SELECT phone FROM sms_threads WHERE id = $1)`,
    [threadId],
  );
  revalidatePath("/messages");
  return { ok: true };
}

/** Block or unblock a number (spam, robotexts, wrong numbers). Blocking clears
 *  the unread dot; from then on its texts are kept but never unread / pushed /
 *  chased, and nothing is sent to it (lib/sms.ts sendSms, lib/dispatch). The
 *  carrier still delivers to us — this is the OS ignoring them. Owner-only. */
export async function setSmsBlocked(threadId: number, blocked: boolean): Promise<{ ok: boolean }> {
  if (!(await requireThread(threadId))) return { ok: false };
  await query(
    blocked
      ? `UPDATE sms_threads SET blocked_at = now(), unread = false WHERE phone = (SELECT phone FROM sms_threads WHERE id = $1)`
      : `UPDATE sms_threads SET blocked_at = NULL WHERE phone = (SELECT phone FROM sms_threads WHERE id = $1)`,
    [threadId],
  );
  revalidatePath("/messages");
  return { ok: true };
}

"use server";

// SMS write paths for the OWNER's own UI (/messages). Reads and the provider
// send live in lib/sms.ts. Every send still goes through the one grant-gated
// path: the owner's click mints a single-use grant for exactly this number
// (createGrant, requested_by 'owner') and sendSms() spends it — so there is
// one code path to the provider, always audited, for Joe and agents alike.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { createGrant } from "@/lib/owner-grants";
import { normalizeE164 } from "@/lib/comms/phone";
import { getSmsThread, sendSms, smsConfigured, smsStatus, upsertSmsThread, type SmsMessage } from "@/lib/sms";

/** Load a thread's messages and clear its unread flag (opening = reading).
 *  Owner-only. Returns null if the thread is gone. */
export async function loadSmsThread(id: number): Promise<{ messages: SmsMessage[]; unreadCleared: boolean } | null> {
  await requireRole("owner");
  const data = await getSmsThread(id);
  if (!data) return null;
  let unreadCleared = false;
  if (data.thread.unread) {
    await query(`UPDATE sms_threads SET unread = false WHERE id = $1`, [id]);
    unreadCleared = true;
    revalidatePath("/messages");
  }
  return { messages: data.messages, unreadCleared };
}

async function ownerSend(to: string, body: string, contactName?: string | null): Promise<{ ok: boolean; threadId?: number; error?: string }> {
  if (!smsConfigured()) {
    const s = smsStatus();
    return { ok: false, error: s.enabled ? `SMS is misconfigured: ${s.problems.join("; ")}` : "SMS is not connected yet." };
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
  const r = await sendSms({ to: norm.e164, body, grantId: grant.id, actor: "owner", contactName });
  revalidatePath("/messages");
  if (!r.ok) return { ok: false, threadId: r.threadId, error: r.error };
  return { ok: true, threadId: r.threadId };
}

/** Start a new outbound conversation: get/create the thread for a number, then
 *  send the first text. Owner-only. */
export async function startSmsThread(phone: string, body: string, contactName: string): Promise<{ ok: boolean; threadId?: number; error?: string }> {
  await requireRole("owner");
  const p = phone.trim();
  if (!p) return { ok: false, error: "Enter a phone number." };
  if (!body.trim()) return { ok: false, error: "Enter a message." };
  const norm = normalizeE164(p);
  if (!norm.ok) return { ok: false, error: norm.error };
  // Create the thread first so a refusal (opt-out, provider down) still leaves
  // the conversation visible with its error.
  const threadId = await upsertSmsThread(norm.e164, contactName);
  const r = await ownerSend(norm.e164, body, contactName);
  return { ...r, threadId: r.threadId ?? threadId };
}

/** Send a reply on an SMS thread. Owner-only. */
export async function sendSmsReply(threadId: number, body: string): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  const data = await getSmsThread(threadId);
  if (!data) return { ok: false, error: "Thread not found." };
  return ownerSend(data.thread.phone, body, data.thread.contactName);
}

const LINK_TYPES = ["lead", "sub", "client", "project", "vendor"] as const;
type SmsLinkType = (typeof LINK_TYPES)[number];

/** Manually link an SMS thread to a record. Owner-only. */
export async function linkSmsThread(threadId: number, type: string, slug: string): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  if (!LINK_TYPES.includes(type as SmsLinkType)) return { ok: false, error: "Invalid link type." };
  if (!slug.trim()) return { ok: false, error: "Pick a record." };
  await query(`UPDATE sms_threads SET link_type = $2, link_slug = $3 WHERE id = $1`, [threadId, type, slug.trim()]);
  revalidatePath("/messages");
  return { ok: true };
}

/** Remove a thread's record link. Owner-only. */
export async function unlinkSmsThread(threadId: number): Promise<{ ok: boolean }> {
  await requireRole("owner");
  await query(`UPDATE sms_threads SET link_type = NULL, link_slug = NULL WHERE id = $1`, [threadId]);
  revalidatePath("/messages");
  return { ok: true };
}

/** Clear the unread flag on a thread. Owner-only. */
export async function markSmsThreadRead(threadId: number): Promise<{ ok: boolean }> {
  await requireRole("owner");
  await query(`UPDATE sms_threads SET unread = false WHERE id = $1`, [threadId]);
  revalidatePath("/messages");
  return { ok: true };
}

/** Owner override of the local opt-out flag (e.g. the contact asked in
 *  person). The carrier-side block is Telnyx's; this only changes what the OS
 *  will attempt. Owner-only. */
export async function setSmsOptOut(threadId: number, optedOut: boolean): Promise<{ ok: boolean }> {
  await requireRole("owner");
  await query(
    optedOut
      ? `UPDATE sms_threads SET opted_out = true, opted_out_at = now() WHERE id = $1`
      : `UPDATE sms_threads SET opted_out = false, opted_in_at = now() WHERE id = $1`,
    [threadId],
  );
  revalidatePath("/messages");
  return { ok: true };
}

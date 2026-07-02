"use server";

// SMS write paths (owner-gated). Reply on a thread + mark read. Reads and the
// provider send live in lib/sms.ts. Inert until a provider is configured.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import {
  sendSmsOnThread,
  getSmsThread,
  upsertSmsThread,
  smsConfigured,
  type SmsMessage,
} from "@/lib/sms";

/** Load a thread's messages and clear its unread flag (opening = reading).
 *  Owner-only. Returns null if the thread is gone. */
export async function loadSmsThread(
  id: number,
): Promise<{ messages: SmsMessage[]; unreadCleared: boolean } | null> {
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

/** Start a new outbound conversation: get/create the thread for a number, then
 *  send the first text. Owner-only. Refuses (creates nothing) when SMS isn't
 *  configured. Returns the thread id so the UI can select it. */
export async function startSmsThread(
  phone: string,
  body: string,
  contactName: string,
): Promise<{ ok: boolean; threadId?: number; error?: string }> {
  await requireRole("owner");
  const p = phone.trim();
  if (!p) return { ok: false, error: "Enter a phone number." };
  if (!body.trim()) return { ok: false, error: "Enter a message." };
  if (!smsConfigured()) return { ok: false, error: "SMS not connected — set up a provider first." };

  const threadId = await upsertSmsThread(p, contactName);
  const sent = await sendSmsOnThread(threadId, body);
  revalidatePath("/messages");
  if (!sent.ok) return { ok: false, threadId, error: sent.error };
  return { ok: true, threadId };
}

/** Send a reply on an SMS thread. Owner-only. */
export async function sendSmsReply(
  threadId: number,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  const res = await sendSmsOnThread(threadId, body);
  revalidatePath("/messages");
  return res;
}

/** Clear the unread flag on a thread. Owner-only. */
export async function markSmsThreadRead(threadId: number): Promise<{ ok: boolean }> {
  await requireRole("owner");
  await query(`UPDATE sms_threads SET unread = false WHERE id = $1`, [threadId]);
  revalidatePath("/messages");
  return { ok: true };
}

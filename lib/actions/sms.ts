"use server";

// SMS write paths (owner-gated). Reply on a thread + mark read. Reads and the
// provider send live in lib/sms.ts. Inert until a provider is configured.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { sendSmsOnThread, getSmsThread, type SmsMessage } from "@/lib/sms";

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

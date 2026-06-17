"use server";

// Inbox write paths. Server Action that sends a reply through the Gmail
// connector (lib/gmail). Owner-only. No-op-safe: if Gmail isn't configured it
// throws a clear error rather than pretending to send. Reads stay in
// lib/inbox.ts; this is the only place mail is sent.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { gmailConfigured, sendReply, sendNewEmail } from "@/lib/gmail";
import { draftReplyForThread } from "@/lib/inbox";

/** Compose and send a brand-new email. */
export async function sendNewEmailAction(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };
  if (!input.to.trim()) return { ok: false, error: "Recipient is required." };
  if (!input.body.trim()) return { ok: false, error: "Body is empty." };
  try {
    await sendNewEmail({ to: input.to.trim(), subject: input.subject, bodyText: input.body });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Generate an AI reply draft for one thread on demand (when it's opened).
 *  Kept lazy because local-LLM drafting is too slow to run for every thread on
 *  inbox load. Returns the draft plus the recipient/subject needed to send. */
export async function draftReplyAction(
  threadId: string,
): Promise<{ ok: boolean; summary?: string; body?: string; toEmail?: string; subject?: string; error?: string }> {
  await requireRole("owner");
  if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };
  try {
    const d = await draftReplyForThread(threadId);
    return { ok: true, ...d };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function sendReplyAction(input: {
  threadId: string;
  toEmail: string;
  subject: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  if (!gmailConfigured()) {
    return { ok: false, error: "Gmail is not connected yet." };
  }
  if (!input.body.trim()) return { ok: false, error: "Reply body is empty." };
  try {
    await sendReply({
      threadId: input.threadId,
      toEmail: input.toEmail,
      subject: input.subject,
      bodyText: input.body,
    });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

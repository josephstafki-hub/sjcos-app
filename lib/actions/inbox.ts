"use server";

// Inbox write paths. Server Action that sends a reply through the Gmail
// connector (lib/gmail). Owner-only. No-op-safe: if Gmail isn't configured it
// throws a clear error rather than pretending to send. Reads stay in
// lib/inbox.ts; this is the only place mail is sent.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import {
  gmailConfigured,
  sendReply,
  sendNewEmail,
  modifyThread,
  trashThread,
  fetchThreadHtml,
} from "@/lib/gmail";
import { draftReplyForThread, loadMoreInbox, loadLabelInbox } from "@/lib/inbox";
import type { InboxThread, ThreadReader } from "@/lib/inbox";
import { query } from "@/lib/db";

/** Manually link a Gmail thread to a project or lead (P6-3). Upserts so
 *  re-linking just re-points it. Owner-gated. */
export async function linkThread(
  threadId: string,
  type: "project" | "lead",
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  if (!threadId || !slug || (type !== "project" && type !== "lead")) {
    return { ok: false, error: "Invalid link." };
  }
  await query(
    `INSERT INTO thread_links (gmail_thread_id, link_type, link_slug)
     VALUES ($1, $2, $3)
     ON CONFLICT (gmail_thread_id) DO UPDATE SET link_type = EXCLUDED.link_type, link_slug = EXCLUDED.link_slug`,
    [threadId, type, slug],
  );
  revalidatePath("/inbox");
  return { ok: true };
}

/** Remove a manual thread link (falls back to auto-classification). Owner-gated. */
export async function unlinkThread(threadId: string): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  await query(`DELETE FROM thread_links WHERE gmail_thread_id = $1`, [threadId]);
  revalidatePath("/inbox");
  return { ok: true };
}

type ActionResult = { ok: boolean; error?: string };

/** Owner-gated wrapper for a Gmail mutation: runs it, revalidates /inbox, and
 *  turns the common "scope too narrow" failure into plain language. */
async function withGmail(fn: () => Promise<void>): Promise<ActionResult> {
  await requireRole("owner");
  if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };
  try {
    await fn();
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    const msg = (err as Error).message;
    if (/insufficient|scope|permission|ACCESS_TOKEN_SCOPE/i.test(msg)) {
      return {
        ok: false,
        error: "Gmail needs modify access — reconnect the inbox to enable this.",
      };
    }
    return { ok: false, error: msg };
  }
}

/** Star / unstar a thread (Gmail STARRED label). */
export async function setThreadStarredAction(threadId: string, starred: boolean) {
  return withGmail(() =>
    modifyThread(
      threadId,
      starred ? { addLabelIds: ["STARRED"] } : { removeLabelIds: ["STARRED"] },
    ),
  );
}

/** Mark a thread read (remove UNREAD) or unread (add UNREAD). */
export async function setThreadReadAction(threadId: string, read: boolean) {
  return withGmail(() =>
    modifyThread(
      threadId,
      read ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] },
    ),
  );
}

/** Mark a thread important / not important (Gmail IMPORTANT label). */
export async function setThreadImportantAction(threadId: string, important: boolean) {
  return withGmail(() =>
    modifyThread(
      threadId,
      important ? { addLabelIds: ["IMPORTANT"] } : { removeLabelIds: ["IMPORTANT"] },
    ),
  );
}

/** Archive a thread (remove it from the INBOX). */
export async function archiveThreadAction(threadId: string) {
  return withGmail(() => modifyThread(threadId, { removeLabelIds: ["INBOX"] }));
}

/** Move a thread to Trash. */
export async function trashThreadAction(threadId: string) {
  return withGmail(() => trashThread(threadId));
}

/** Fetch the next page of inbox threads for "Load more". */
export async function loadMoreInboxAction(pageToken: string): Promise<{
  ok: boolean;
  threads?: InboxThread[];
  readers?: Record<string, ThreadReader>;
  nextPageToken?: string;
  error?: string;
}> {
  await requireRole("owner");
  if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };
  try {
    const r = await loadMoreInbox(pageToken);
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Fetch a page of threads for a single Gmail label (clicking a label in the
 *  rail). pageToken pages within that label. */
export async function loadLabelInboxAction(
  labelId: string,
  pageToken?: string,
): Promise<{
  ok: boolean;
  threads?: InboxThread[];
  readers?: Record<string, ThreadReader>;
  nextPageToken?: string;
  error?: string;
}> {
  await requireRole("owner");
  if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };
  try {
    const r = await loadLabelInbox(labelId, pageToken);
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Compose and send a brand-new email. */
/** Rich sanitized HTML body for a thread's latest message (with images),
 *  fetched lazily when the reader opens. Empty string = no HTML / not connected;
 *  the reader keeps showing the plain-text paragraphs in that case. */
export async function getThreadHtmlAction(threadId: string): Promise<{ html: string }> {
  await requireRole("owner");
  if (!gmailConfigured()) return { html: "" };
  try {
    return { html: await fetchThreadHtml(threadId) };
  } catch {
    return { html: "" };
  }
}

export async function sendNewEmailAction(input: {
  to: string;
  subject: string;
  body: string;
  attachments?: import("@/lib/gmail").MailAttachment[];
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };
  if (!input.to.trim()) return { ok: false, error: "Recipient is required." };
  if (!input.body.trim()) return { ok: false, error: "Body is empty." };
  try {
    await sendNewEmail({ to: input.to.trim(), subject: input.subject, bodyText: input.body, attachments: input.attachments });
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

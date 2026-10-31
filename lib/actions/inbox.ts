"use server";

// Inbox write paths. Server Actions that read and send through the Gmail
// connector (lib/gmail). Reads stay in lib/inbox.ts; this is the only place mail
// is sent.
//
// EVERY action here runs inside mailbox(), which does two things in one step:
// checks the Inbox area, and enters the signed-in person's mailbox scope
// (lib/mailbox.ts) for the whole call. That scope is what makes gmailConfigured()
// and every fetch/send below act on THEIR mail — a staff member archiving a
// thread archives it in their own account, and one with nothing linked gets
// "Gmail is not connected" instead of a write against Joe's mailbox.

import { inquiryReplySubject } from "@/lib/inbox-rules";
import { sendSmsReply } from "@/lib/actions/sms";
import { sendProjectMessage, sendLeadPortalMessage } from "@/lib/actions/portal";
import { sendChatMessage } from "@/lib/actions/chat";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/dal";
import {
  gmailConfigured,
  sendReply,
  sendNewEmail,
  modifyThread,
  trashThread,
  fetchThreadHtml,
  fetchMessageHtml,
} from "@/lib/gmail";
import { draftReplyForThread, invalidateInboxCache, loadMoreInbox, loadLabelInbox, loadSystemView } from "@/lib/inbox";
import type { InboxThread, ThreadReader } from "@/lib/inbox";
import { SYSTEM_VIEWS, type SystemViewKey } from "@/lib/types";
import type { DraftModel } from "@/lib/dev-agents-meta";
import { query } from "@/lib/db";
import { unlinkMailbox, withMailboxFor } from "@/lib/mailbox";

/** Require the Inbox area, then run `fn` against that person's own mailbox. */
async function mailbox<T>(fn: () => Promise<T>): Promise<T> {
  const user = await requireAccess("inbox");
  return withMailboxFor(user, fn);
}

/** Forget the signed-in account's linked mailbox (the rail's Disconnect). The
 *  owner's mailbox lives in the environment, so there is nothing here to
 *  unlink for him — the action is a no-op rather than an error. */
export async function disconnectMyMailboxAction(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAccess("inbox");
  await unlinkMailbox(user.id);
  invalidateInboxCache();
  revalidatePath("/inbox");
  return { ok: true };
}

/** Manually link a Gmail thread to a project or lead (P6-3). Upserts so
 *  re-linking just re-points it. Owner-gated. */
export async function linkThread(
  threadId: string,
  type: "project" | "lead",
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAccess("inbox");
  if (!threadId || !slug || (type !== "project" && type !== "lead")) {
    return { ok: false, error: "Invalid link." };
  }
  // Thread links are OUR records about a thread, not a Gmail call — no mailbox
  // scope needed, and deliberately shared: a thread pinned to the Henderson job
  // stays pinned whoever looks at it.
  await query(
    `INSERT INTO thread_links (gmail_thread_id, link_type, link_slug)
     VALUES ($1, $2, $3)
     ON CONFLICT (gmail_thread_id) DO UPDATE SET link_type = EXCLUDED.link_type, link_slug = EXCLUDED.link_slug`,
    [threadId, type, slug],
  );
  invalidateInboxCache();
  revalidatePath("/inbox");
  return { ok: true };
}

/** Remove a manual thread link (falls back to auto-classification). Owner-gated. */
export async function unlinkThread(threadId: string): Promise<{ ok: boolean; error?: string }> {
  await requireAccess("inbox");
  await query(`DELETE FROM thread_links WHERE gmail_thread_id = $1`, [threadId]);
  invalidateInboxCache();
  revalidatePath("/inbox");
  return { ok: true };
}

type ActionResult = { ok: boolean; error?: string };

/** Owner-gated wrapper for a Gmail mutation: runs it, revalidates /inbox, and
 *  turns the common "scope too narrow" failure into plain language. */
async function withGmail(fn: () => Promise<void>): Promise<ActionResult> {
  return mailbox(async () => {
    if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };
    try {
      await fn();
      invalidateInboxCache();
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
  });
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
  emailPaused?: boolean;
  lastSyncedAt?: number;
  error?: string;
}> {
  return mailbox(async () => {
    if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };
    try {
      const r = await loadMoreInbox(pageToken);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
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
  emailPaused?: boolean;
  lastSyncedAt?: number;
  error?: string;
}> {
  return mailbox(async () => {
    if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };
    try {
      const r = await loadLabelInbox(labelId, pageToken);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}

/** Fetch a page of threads for a Gmail system view (Unread/Starred/Sent/Spam/
 *  Trash) — clicking a "Mailboxes" rail item. pageToken pages within the view. */
export async function loadSystemViewAction(
  view: SystemViewKey,
  pageToken?: string,
): Promise<{
  ok: boolean;
  threads?: InboxThread[];
  readers?: Record<string, ThreadReader>;
  nextPageToken?: string;
  emailPaused?: boolean;
  lastSyncedAt?: number;
  error?: string;
}> {
  // The view arrives over the wire — reject anything that isn't a known key
  // before it reaches the fetch map.
  if (!SYSTEM_VIEWS.some((v) => v.key === view)) {
    return { ok: false, error: "Unknown view." };
  }
  return mailbox(async () => {
    if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };
    try {
      const r = await loadSystemView(view, pageToken);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}

/** Compose and send a brand-new email. */
/** Rich sanitized HTML body for a thread's latest message (with images),
 *  fetched lazily when the reader opens. Empty string = no HTML / not connected;
 *  the reader keeps showing the plain-text paragraphs in that case. */
export async function getThreadHtmlAction(threadId: string, messageId?: string): Promise<{ html: string }> {
  return mailbox(async () => {
    if (!gmailConfigured()) return { html: "" };
    try {
      return { html: messageId ? await fetchMessageHtml(threadId, messageId) : await fetchThreadHtml(threadId) };
    } catch {
      return { html: "" };
    }
  });
}

export async function sendNewEmailAction(input: {
  to: string;
  subject: string;
  body: string;
  attachments?: import("@/lib/gmail").MailAttachment[];
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.to.trim()) return { ok: false, error: "Recipient is required." };
  if (!input.body.trim()) return { ok: false, error: "Body is empty." };
  return mailbox(async () => {
    if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };
    try {
      await sendNewEmail({ to: input.to.trim(), subject: input.subject, bodyText: input.body, attachments: input.attachments });
      invalidateInboxCache();
  revalidatePath("/inbox");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}

/** Generate an AI reply draft for one thread on demand (when it's opened).
 *  Kept lazy because local-LLM drafting is too slow to run for every thread on
 *  inbox load. Returns the draft plus the recipient/subject needed to send. */
export async function draftReplyAction(
  threadId: string,
  model?: DraftModel,
  intent?: string,
): Promise<{ ok: boolean; summary?: string; body?: string; toEmail?: string; subject?: string; model?:string; error?: string }> {
  // Whitelist the model — never trust the client string. Anything but the
  // explicit "qwen" choice drafts with Hermes (grounded; Qwen is never used
  // for client-facing writing by default).
  const m: DraftModel = model === "qwen" ? "qwen" : "hermes";
  return mailbox(async () => {
    if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };
    try {
      const d = await draftReplyForThread(threadId, m, typeof intent === "string" ? intent.slice(0,200) : "");
      return { ok: true, ...d, model:m === "hermes" ? "Hermes" : "Qwen" };
    } catch (err) {
      const msg = (err as Error).message;
      return {
        ok: false,
        error:
          m === "hermes"
            ? `Hermes is unavailable — try Qwen. (${msg})`
            : msg,
      };
    }
  });
}

export async function sendReplyAction(input: {
  threadId: string;
  toEmail?: string;
  subject?: string;
  body: string;
  replyAll?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.body.trim()) return { ok: false, error: "Reply body is empty." };
  return mailbox(async () => {
    if (!gmailConfigured()) {
      return { ok: false, error: "Gmail is not connected yet." };
    }
    try {
      await sendReply({
        threadId: input.threadId,
        toEmail: input.toEmail,
        subject: input.subject,
        bodyText: input.body,
        replyAll: input.replyAll,
      });
      invalidateInboxCache();
  revalidatePath("/inbox");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}

/** Each channel keeps its existing authorization, approval and send path. */
export async function sendChannelReplyAction(input: {
  threadId: string;
  body: string;
}): Promise<ActionResult> {
  await requireAccess("inbox");
  if (!input.body.trim()) return { ok: false, error: "Enter a message." };
  const id = input.threadId;
  try {
    let result: ActionResult = { ok: true };
    if (/^sms:[1-9]\d*$/.test(id)) {
      const number = Number(id.slice(4));
      if (!Number.isSafeInteger(number)) return { ok: false, error: "Conversation not found." };
      result = await sendSmsReply(number, input.body);
    } else if (/^portal:(?:lead:)?[^:]+$/.test(id)) {
      const lead = id.startsWith("portal:lead:");
      const slug = id.slice(lead ? 12 : 7);
      const { rows } = await query(
        lead ? "SELECT slug FROM leads WHERE slug = $1" : "SELECT slug FROM projects WHERE slug = $1",
        [slug],
      );
      if (!rows.length) return { ok: false, error: "Conversation not found." };
      const form = new FormData();
      form.set("body", input.body);
      if (lead) await sendLeadPortalMessage(slug, form);
      else await sendProjectMessage(slug, form);
    } else if (/^dm:(?!team$|client$)[^:]+$/.test(id)) {
      const { rows } = await query("SELECT slug FROM subs WHERE slug = $1", [id.slice(3)]);
      if (!rows.length) return { ok: false, error: "Conversation not found." };
      result = await sendChatMessage(id, input.body);
    } else if (/^siteform:[^:]+$/.test(id)) {
      const { rows } = await query<{ email: string | null; name: string; scope: string }>(
        `SELECT email, name, scope FROM leads WHERE slug = $1 AND source ILIKE '%website%'`,
        [id.slice(9)],
      );
      const lead = rows[0];
      if (!lead?.email) return { ok: false, error: "No email address supplied — open the lead to contact them." };
      result = await sendNewEmailAction({
        to: lead.email,
        subject: inquiryReplySubject(lead.scope,lead.name),
        body: input.body,
      });
    } else {
      return { ok: false, error: "Conversation not found." };
    }
    if (result.ok) {
      invalidateInboxCache();
      revalidatePath("/inbox");
    }
    return result;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Undo archive using the same signed-in mailbox scope. */
export async function restoreThreadToInboxAction(threadId: string) {
  return withGmail(()=>modifyThread(threadId,{addLabelIds:['INBOX']}));
}

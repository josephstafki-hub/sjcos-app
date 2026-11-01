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

import {loadEmailHtml, type EmailHtmlResult} from '@/lib/inbox-email-content';
import {validateMailFiles,mailFileType} from "@/lib/inbox-files";
import type { InboxLinkKind } from "@/lib/inbox-directory";
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
  fetchConversation,
  findCorrespondence,
  fetchInboxAttachment,
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
  type: InboxLinkKind,
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAccess("inbox");
  if (!threadId || !slug || !["project","lead","sub","vendor"].includes(type)) {
    return { ok: false, error: "Invalid link." };
  }
  const table={project:'projects',lead:'leads',sub:'subs',vendor:'vendors'}[type];
  const {rows:record}=await query(`SELECT slug FROM ${table} WHERE slug=$1`,[slug]);
  if(!record.length)return {ok:false,error:'That directory record no longer exists.'};
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
/** A missing MIME part is text-only. Connection/fetch failures stay retryable. */
export async function getThreadHtmlAction(threadId: string, messageId?: string): Promise<EmailHtmlResult> {
  return mailbox(async () => loadEmailHtml(async () => {
    if (!gmailConfigured()) throw new Error('Gmail is not connected.');
    return messageId ? fetchMessageHtml(threadId, messageId) : fetchThreadHtml(threadId);
  }));
}

/** Lazy on inquiry open. Uses the lead's address, never a client-supplied search. */
export async function findInquiryConversationsAction(threadId:string):Promise<{ok:boolean;conversations?:{id:string;subject:string}[];error?:string}> {
  return mailbox(async()=>{
    if(!/^siteform:[^:]+$/.test(threadId))return {ok:false,error:'Inquiry not found.'};
    const {rows}=await query<{email:string}>("SELECT email FROM leads WHERE slug=$1 AND source ILIKE '%website%'",[threadId.slice(9)]);
    if(!rows[0]?.email)return {ok:true,conversations:[]};
    if(!gmailConfigured())return {ok:false,error:'Connect Gmail to check earlier email.'};
    try{return {ok:true,conversations:await findCorrespondence(rows[0].email)};}catch{return {ok:false,error:'Could not check earlier email. You can retry before replying.'};}
  });
}

/** Validate all metadata before reading bytes, including server-resolved originals. */
async function outgoingAttachments(input:{files?:FormData;attachments?:import("@/lib/gmail").MailAttachment[];forward?:{threadId:string;messageId:string;attachmentIds:string[]}}) {
  const uploads=(input.files?.getAll('files') ?? []).map(value=>{
    if(typeof value==='string' || !(value instanceof Blob))throw Error('Invalid attachment.');
    return value as File;
  });
  const existing=input.attachments ?? [];
  let originals:import("@/lib/gmail").ConversationMessage['attachments']=[];
  if(input.forward){
    const conversation=await fetchConversation(input.forward.threadId);
    const message=conversation.messages.find(m=>m.id===input.forward!.messageId);
    if(!message)throw Error('Original message not found.');
    const ids=[...new Set(input.forward.attachmentIds)];
    originals=ids.map(id=>{const file=message.attachments?.find(a=>a.id===id);if(!file)throw Error('Original attachment not found.');return file;});
  }
  const metadata=[...uploads,...existing.map(a=>({name:a.filename,type:a.mimeType,size:a.content.length})),...(originals ?? [])];
  validateMailFiles(metadata);
  const attachments=[...existing];
  for(const file of uploads)attachments.push({filename:file.name,mimeType:mailFileType(file),content:Buffer.from(await file.arrayBuffer())});
  for(const file of originals ?? []){
    const data=await fetchInboxAttachment(input.forward!.threadId,input.forward!.messageId,file.id);
    attachments.push({filename:data.name,mimeType:data.type,content:data.bytes});
  }
  validateMailFiles(attachments.map(a=>({name:a.filename,type:a.mimeType,size:a.content.length})));
  return attachments.length?attachments:undefined;
}

/** Idempotent association repair. No provider call or send path belongs here. */
export async function retryInquiryLinkAction(inquiryId:string,threadId:string):Promise<{ok:boolean;error?:string}> {
  await requireAccess('inbox');
  const slug=inquiryId.startsWith('siteform:')?inquiryId.slice(9):'';
  if(!slug||!/^[-\w]+$/.test(threadId)||threadId.length>512)return {ok:false,error:'Invalid inquiry link.'};
  try{
    const {rows}=await query("SELECT slug FROM leads WHERE slug=$1 AND source ILIKE '%website%'",[slug]);
    if(!rows.length)return {ok:false,error:'That website inquiry is no longer available.'};
    await saveInquiryLink(threadId,slug);
    invalidateInboxCache();revalidatePath('/inbox');
    return {ok:true};
  }catch{return {ok:false,error:'Email was already sent. Could not save the inquiry link; retry linking.'};}
}
async function saveInquiryLink(threadId:string,slug:string) {
  await query(`WITH linked AS (INSERT INTO thread_links (gmail_thread_id,link_type,link_slug) VALUES ($1,'lead',$2)
    ON CONFLICT (gmail_thread_id) DO UPDATE SET link_type='lead',link_slug=EXCLUDED.link_slug RETURNING gmail_thread_id)
    UPDATE leads SET last_contact_at=now(),updated_at=now() WHERE slug=$2 AND EXISTS(SELECT 1 FROM linked)`,[threadId,slug]);
}

export async function sendNewEmailAction(input: {
  to: string; cc?:string; subject: string; body: string;
  attachments?: import("@/lib/gmail").MailAttachment[];
  files?:FormData;
  forward?:{threadId:string;messageId:string;attachmentIds:string[]};
  /** Only the website adapter sets this; verify it again before sending. */
  inquirySlug?:string;
}): Promise<{ ok: boolean; error?: string;threadId?:string;warning?:string }> {
  if (!input.to.trim()) return { ok: false, error: "Recipient is required." };
  if (!input.body.trim()) return { ok: false, error: "Body is empty." };
  return mailbox(async () => {
    if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };
    try {
      if(input.inquirySlug){
        const {rows}=await query<{email:string}>("SELECT email FROM leads WHERE slug=$1 AND source ILIKE '%website%'",[input.inquirySlug]);
        if(rows[0]?.email?.toLowerCase()!==input.to.trim().toLowerCase())return {ok:false,error:'Inquiry recipient changed. Reload before replying.'};
      }
      const attachments=await outgoingAttachments(input);
      const sent=await sendNewEmail({ to: input.to.trim(), ...(input.cc?{cc:input.cc}:{}), subject: input.subject, bodyText: input.body, attachments });
      let warning:string|undefined;
      if(input.inquirySlug){
        try{
          if(!sent?.threadId)throw Error('Missing Gmail thread id');
          await saveInquiryLink(sent.threadId,input.inquirySlug);
        }catch{warning='Email sent, but the inquiry link could not be saved. Do not send again.';}
      }
      invalidateInboxCache();
      revalidatePath("/inbox");
      return { ok: true,...(sent?.threadId?{threadId:sent.threadId}:{}),...(warning?{warning}:{}) };
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
  model?: DraftModel | "claude",
  intent?: string,
): Promise<{ ok: boolean; summary?: string; body?: string; toEmail?: string; subject?: string; model?:string; basedOn?:string; sources?:import("@/lib/inbox-draft-types").DraftSource[]; error?: string }> {
  // Keep regeneration with the displayed author; Claude reuses the owner-only
  // automatic draft writer and never enters a send path.
  const m = model === "claude" ? "claude" : model === "qwen" ? "qwen" : "hermes";
  return mailbox(async () => {
    if (!/^(sms:|portal:|dm:|siteform:)/.test(threadId) && !gmailConfigured()) return { ok: false, error: "Gmail is not connected." };
    try {
      if(m==='claude'){
        const user=await requireAccess('inbox');
        if(user.role!=='owner')return {ok:false,error:'Only Joe can regenerate a Claude draft.'};
        const {getInboxData}=await import('@/lib/inbox');
        const {draftAutoReply}=await import('@/lib/inbox-autodraft');
        const data=await getInboxData(user),thread=data.threads.find(t=>t.id===threadId);
        const message=data.readers[threadId]?.messages.at(-1);
        if(data.emailPaused||data.loadError||!thread||thread.channel!=='email'||!message?.id||message.outbound)return {ok:false,error:'Reopen the latest incoming email before regenerating.'};
        const d=await draftAutoReply({thread,messageId:message.id,toEmail:data.readers[threadId]?.replyTarget?.toEmail??'',receivedAt:message.date??0},'claude',typeof intent==='string'?intent.slice(0,200):'');
        return {ok:true,...d,model:'Claude'};
      }
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
  files?:FormData;
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.body.trim()) return { ok: false, error: "Reply body is empty." };
  return mailbox(async () => {
    if (!gmailConfigured()) {
      return { ok: false, error: "Gmail is not connected yet." };
    }
    try {
      const attachments=await outgoingAttachments(input);
      await sendReply({
        threadId: input.threadId,
        toEmail: input.toEmail,
        subject: input.subject,
        bodyText: input.body,
        replyAll: input.replyAll,
        ...(attachments?{attachments}:{}),
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
  files?:FormData;
  retryOfId?:string;
}): Promise<ActionResult & {warning?:string;threadId?:string}> {
  await requireAccess("inbox");
  if (!input.body.trim()) return { ok: false, error: "Enter a message." };
  const id = input.threadId;
  try {
    let result: ActionResult & {warning?:string;threadId?:string} = { ok: true };
    if(input.retryOfId){
      if(!/^[1-9]\d*$/.test(input.retryOfId)||! /^(sms:[1-9]\d*|portal:(?:lead:)?[^:]+|dm:(?!team$|client$)[^:]+)$/.test(id))return {ok:false,error:'Failed message not found.'};
      const sms=id.startsWith('sms:');
      const {rows}=await query<{body:string;status:string;media?:unknown[];replacement_id?:string}>(sms?
        `SELECT body, status, media, (SELECT id FROM sms_messages r WHERE r.retry_of_id=m.id) AS replacement_id FROM sms_messages m WHERE id=$1 AND thread_id=$2 AND direction='out'`:
        `SELECT body, delivery_status AS status, (SELECT id FROM chat_messages r WHERE r.retry_of_id=m.id) AS replacement_id FROM chat_messages m WHERE id=$1 AND channel_key=$2 AND (author_kind='owner' OR author_user_id IN (SELECT id FROM users WHERE role IN ('owner','staff')))`,
        [input.retryOfId,sms?Number(id.slice(4)):id]);
      const failed=rows[0];
      if(!failed||! /^(failed|undelivered|expired)$/.test(failed.status)||failed.replacement_id)return {ok:false,error:'This message was already retried or is not a confirmed failure. Reopen the conversation.'};
      if(failed.media?.length)return {ok:false,error:'This message includes files. Open the original message to recover them before retrying.'};
      if(input.body!==failed.body)return {ok:false,error:'The failed text changed. Reopen the conversation before retrying.'};
    }
    if (/^sms:[1-9]\d*$/.test(id)) {
      const number = Number(id.slice(4));
      if (!Number.isSafeInteger(number)) return { ok: false, error: "Conversation not found." };
      result = input.retryOfId?await sendSmsReply(number,input.body,input.retryOfId):await sendSmsReply(number, input.body);
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
      if (lead) await sendLeadPortalMessage(slug, form, input.retryOfId);
      else await sendProjectMessage(slug, form, input.retryOfId);
    } else if (/^dm:(?!team$|client$)[^:]+$/.test(id)) {
      const { rows } = await query("SELECT slug FROM subs WHERE slug = $1", [id.slice(3)]);
      if (!rows.length) return { ok: false, error: "Conversation not found." };
      result = input.retryOfId?await sendChatMessage(id,input.body,input.retryOfId):await sendChatMessage(id, input.body);
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
        inquirySlug:id.slice(9),
        files:input.files,
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
    return { ok: false, error: (err as {code?:string}).code==='23505'?'This message was already retried. Reopen the conversation.':(err as Error).message };
  }
}

/** Undo archive using the same signed-in mailbox scope. */
export async function restoreThreadToInboxAction(threadId: string) {
  return withGmail(()=>modifyThread(threadId,{addLabelIds:['INBOX']}));
}

/** Joe's explicit report/undo uses the same mailbox-scoped Gmail mutation path. */
export async function setThreadSpamAction(threadId: string, spam: boolean, restoreInbox = true) {
  return withGmail(() => modifyThread(threadId, spam
    ? {addLabelIds:['SPAM'],removeLabelIds:['INBOX']}
    : {removeLabelIds:['SPAM'],...(restoreInbox?{addLabelIds:['INBOX']}:{})}));
}

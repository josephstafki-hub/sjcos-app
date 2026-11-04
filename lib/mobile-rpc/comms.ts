import { z } from "zod";
import { defineAction, MobileInputError } from "./dispatch";
import { setThreadStarredAction, setThreadReadAction, archiveThreadAction, restoreThreadToInboxAction, sendReplyAction, sendNewEmailAction, draftReplyAction, linkThread } from "@/lib/actions/inbox";
import { createLeadFromInbox } from "@/lib/actions/leads";
import { createWorkItem } from "@/lib/actions/engine";
import { startSmsThread, sendSmsReply, linkSmsThread, markSmsThreadRead } from "@/lib/actions/sms";
import { placeCallAction } from "@/lib/actions/calls";
import { sendChatMessage, markChannelRead } from "@/lib/actions/chat";
import { hasAccess } from "@/lib/api-auth";
import { emailById, chatData } from "./comms-reads";
const text = z.string().trim().min(1).max(20000);
const threadId = z.string().regex(/^[-\w]+$/).max(512);
const thread = z.object({ threadId }).strict();
const link = z.object({ type: z.enum(["lead", "project", "sub", "vendor"]), slug: z.string().min(1).max(200) }).strict();
const emailSource = { view: z.string().max(600).optional(), cursor: z.string().max(2000).optional() };
function form(values: Record<string, string | undefined>) { const fd = new FormData(); for (const [key,value] of Object.entries(values)) if(value !== undefined) fd.set(key,value); return fd; }
export const commsActions = {
  "inbox.star": defineAction({area:"inbox",input:thread.extend({starred:z.boolean()}),run:({threadId,starred})=>setThreadStarredAction(threadId,starred)}),
  "inbox.read": defineAction({area:"inbox",input:thread.extend({read:z.boolean()}),run:({threadId,read})=>setThreadReadAction(threadId,read)}),
  "inbox.archive": defineAction({ area: "inbox", input: thread, run: ({threadId}) => archiveThreadAction(threadId) }),
  "inbox.done": defineAction({ area: "inbox", input: thread, run: ({threadId}) => archiveThreadAction(threadId) }),
  "inbox.undoDone": defineAction({ area: "inbox", input: thread, run: ({threadId}) => restoreThreadToInboxAction(threadId) }),
  "inbox.reply": defineAction({ area: "inbox", input: thread.extend({ toEmail: z.string().max(2000).optional(), subject: z.string().max(2000).optional(), body: text, replyAll: z.boolean().optional() }), run: input => sendReplyAction(input) }),
  "inbox.compose": defineAction({ area: "inbox", input: z.object({ to: text, cc: z.string().max(2000).optional(), subject: z.string().max(2000), body: text }).strict(), run: input => sendNewEmailAction(input) }),
  "inbox.draft": defineAction({ area: "inbox", input: thread.extend({ model: z.enum(["qwen", "hermes", "claude"]).optional(), intent: z.string().max(200).optional() }), run: ({threadId,model,intent}) => draftReplyAction(threadId,model,intent) }),
  "inbox.link": defineAction({ area: "inbox", input: thread.extend({ type: link.shape.type, slug: link.shape.slug }), run: async ({threadId,type,slug},user) => { await emailById(user,threadId); return linkThread(threadId,type,slug); } }),
  "inbox.createTodo": defineAction({ area: "inbox", input: thread.extend({ ...emailSource, title: text, body: z.string().max(20000).optional(), dueAt: z.iso.date().optional() }), run: async ({threadId,view,cursor,title,body,dueAt},user) => {
    if(!hasAccess(user,"engine")) throw new MobileInputError("You need To-dos access to create a to-do.");
    const page = await emailById(user,threadId); const t = page.threads.find(t=>t.id===threadId); const m = page.readers[threadId]?.messages.at(-1);
    if(!t || !m?.id) throw new MobileInputError("Reopen the email before making a to-do.");
    return createWorkItem(form({title,body,due_at:dueAt,email:JSON.stringify({message_id:m.id,thread_id:threadId,from:t.fromEmail,received_at:m.date?new Date(m.date).toISOString():undefined})}));
  } }),
  "inbox.createLead": defineAction({ area: "inbox", input: thread.extend({ ...emailSource, name: text, scope: z.string().max(20000).optional(), phone: z.string().max(100).optional() }), run: async ({threadId,view,cursor,name,scope,phone},user) => {
    if(!hasAccess(user,"leads")) throw new MobileInputError("You need Leads access to create a lead.");
    const page = await emailById(user,threadId); const t = page.threads.find(t=>t.id===threadId);
    if(!t) throw new MobileInputError("Reopen the email before making a lead.");
    const result=await createLeadFromInbox(form({name,scope,phone,email:t.fromEmail,source:"Email"}));
    if(result.slug) await linkThread(threadId,"lead",result.slug);
    return result;
  } }),
  "sms.send": defineAction({ area: "comms", input: z.object({threadId:z.number().int().positive(),body:text}).strict(), run: ({threadId,body})=>sendSmsReply(threadId,body) }),
  "sms.new": defineAction({ area: "comms", input: z.object({phone:z.string().min(1).max(100),body:text,contactName:z.string().max(300).optional(),link:link.optional()}).strict(), run: async ({phone,body,contactName,link})=> {
    const result=await startSmsThread(phone,body,contactName??"");
    if(result.ok && result.threadId && link) await linkSmsThread(result.threadId,link.type,link.slug);
    return result;
  } }),
  "sms.read": defineAction({ area:"comms", input:z.object({threadId:z.number().int().positive()}).strict(), run:({threadId})=>markSmsThreadRead(threadId) }),
  "calls.place": defineAction({ area:"comms", input:z.object({phone:z.string().min(1).max(100),contactName:z.string().max(300).optional()}).strict(), run:({phone,contactName})=>placeCallAction(phone,contactName) }),
  "chat.send": defineAction({ area:"chat", input:z.object({roomId:z.string().min(1).max(300),body:text}).strict(), run:async ({roomId,body},user)=> {
    const data=await chatData(user); if(!data.views[roomId] || data.views[roomId].archived) throw new MobileInputError("You're not in that conversation.");
    return sendChatMessage(roomId,body);
  } }),
  "chat.read": defineAction({ area:"chat", input:z.object({roomId:z.string().min(1).max(300)}).strict(), run:async ({roomId},user)=> { const data=await chatData(user); if(!data.views[roomId]) throw new MobileInputError("You're not in that conversation."); await markChannelRead(roomId); } }),
};

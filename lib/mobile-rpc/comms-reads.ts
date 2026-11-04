import "server-only";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import type { CurrentUser } from "@/lib/dal";
import type { PermissionKey } from "@/lib/permissions";
import { getInboxData, loadMoreInbox, loadLabelInbox, loadSystemView, SMART_VIEWS, type InboxThread } from "@/lib/inbox";
import { SYSTEM_VIEWS } from "@/lib/types";
import { withMailboxFor } from "@/lib/mailbox";
import { loadInboxContext, withoutMoney } from "@/lib/inbox-context";
import { getChatData, chatViewerFor } from "@/lib/chat";
import { query } from "@/lib/db";
import { MobileInputError } from "./dispatch";
export class CommsReadError extends Error { constructor(message:string, public status=400){super(message);} }
export async function commsRead(req:Request, area:PermissionKey, read:(user:CurrentUser)=>Promise<unknown>):Promise<Response> {
  try { const user=await getUserFromRequest(req);
    if(!user)return Response.json({error:"Unauthorized"},{status:401});
    if(!hasAccess(user,area))return Response.json({error:"You don't have access to that."},{status:403});
    const data=await read(user); return data instanceof Response?data:Response.json(data,{headers:{"Cache-Control":"private, no-store"}});
  }catch(e){if(e instanceof CommsReadError || e instanceof MobileInputError)return Response.json({error:e.message},{status:e instanceof CommsReadError?e.status:400});
    console.error("[mobile-comms] Read failed",e);return Response.json({error:"Something went wrong. Please try again."},{status:500});}
}
export function positiveId(value:string):number {const id=Number(value);if(!/^\d+$/.test(value)||!Number.isSafeInteger(id)||id<1)throw new CommsReadError("Invalid thread id.");return id;}
export function uuid(value:string):string {if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new CommsReadError("Invalid id.");return value;}
export async function emailPage(user:CurrentUser, view="inbox", cursor?:string) {
  if(view.length>600 || (cursor?.length??0)>2000)throw new CommsReadError("Invalid mailbox page.");
  return withMailboxFor(user,async()=> {
    const system=SYSTEM_VIEWS.find(v=>v.key===view);
    if(system)return loadSystemView(system.key,cursor);
    if(view.startsWith("label:") && view.length>6)return loadLabelInbox(view.slice(6),cursor);
    if(view!=="inbox" && !SMART_VIEWS.some(v=>v.key===view))throw new CommsReadError("Unknown email view.");
    return cursor?loadMoreInbox(cursor):getInboxData(user);
  });
}
export function emailCard(t:InboxThread,user:CurrentUser) {
  const actions=["inbox.archive","inbox.done","inbox.undoDone","inbox.reply","inbox.draft","inbox.link"];
  if(hasAccess(user,"engine"))actions.push("inbox.createTodo");if(hasAccess(user,"leads"))actions.push("inbox.createLead");
  return {id:t.id,from:t.fromName,fromEmail:t.fromEmail??null,subject:t.subject,snippet:t.preview,unread:!!t.unread,time:t.receivedAt?new Date(t.receivedAt).toISOString():null,
    status:t.view,label:SMART_VIEWS.find(v=>v.key===t.view)?.label??"Email",record:{type:t.linkedType??(t.projectSlug?"project":null),slug:t.linkedSlug??t.projectSlug??null,label:t.projectLabel??t.tag},todos:t.todos??[],allowedActions:actions};
}
export async function emailDetail(user:CurrentUser,id:string,view?:string,cursor?:string){
  const page=await emailPage(user,view,cursor);const t=page.threads.find(t=>t.channel==="email"&&t.id===id);const reader=page.readers[id];
  if(!t||!reader)throw new CommsReadError("Email not found in this page. Reopen its view.",404);
  let context=await loadInboxContext({threadId:id,email:t.fromEmail,contactKey:t.contactKey,projectSlug:t.projectSlug,leadSlug:t.linkedType==="lead"?t.linkedSlug:undefined});
  if(!hasAccess(user,"money"))context=withoutMoney(context);
  const money=context.job?.money;
  const moneyDisplay=money?Object.fromEntries((["total","paid","outstanding"] as const).map(k=>[k,new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(money[k]/100)])):null;
  return {moneyDisplay,thread:emailCard(t,user),messages:reader.messages.map(m=>({id:m.id??null,from:m.fromName,fromEmail:m.fromEmail??null,to:m.to,cc:m.cc??[],time:m.date?new Date(m.date).toISOString():null,body:m.body.join("\n\n"),outbound:!!m.outbound,attachments:(m.attachments??[]).map(a=>({...a,url:m.id?`/api/mobile/inbox/attachment?${new URLSearchParams({thread:id,message:m.id,attachment:a.id})}`:null}))})),context,replyTarget:reader.replyTarget??null};
}
export async function chatData(user:CurrentUser){return getChatData(await chatViewerFor(user));}
export interface MobileChatMessage {id:string;name:string;initials:string;body:string;kind:string;label:string;time:string;mine:boolean}
// The web loader supplies room visibility; fetch stable database ids for paging only after that check.
export async function chatMessages(user:CurrentUser,roomId:string,options:{after?:string|null;before?:string|null;limit?:string|null}={}) {
  const data=await chatData(user);if(!data.views[roomId])throw new CommsReadError("Conversation not found.",404);
  const limit=options.limit?positiveId(options.limit):50;if(limit>100)throw new CommsReadError("Limit must be at most 100.");
  if(options.after && options.before)throw new CommsReadError("Use after or before, not both.");
  for(const id of [options.after,options.before])if(id&&!/^\d{1,19}$/.test(id))throw new CommsReadError("Invalid message cursor.");
  const after=options.after??null,before=options.before??null;
  const {rows}=await query<{id:string;author_name:string;author_initials:string;body:string;author_kind:string;created_at:Date;author_user_id:string|null}>(`SELECT id::text,author_name,author_initials,body,author_kind,created_at,author_user_id FROM chat_messages WHERE channel_key=$1 AND ($2::bigint IS NULL OR id>$2) AND ($3::bigint IS NULL OR id<$3) ORDER BY id ${after?"ASC":"DESC"} LIMIT $4`,[roomId,after,before,limit+1]);
  const hasMore=rows.length>limit;const selected=rows.slice(0,limit);if(!after)selected.reverse();
  const messages:MobileChatMessage[]=selected.map(m=>({id:m.id,name:m.author_name,initials:m.author_initials,body:m.body,kind:m.author_kind,label:m.author_kind==="ai"?"AI teammate":"Teammate",time:new Date(m.created_at).toISOString(),mine:m.author_user_id===user.id||(!m.author_user_id&&m.author_kind==="owner"&&user.role==="owner")}));
  return {roomId,messages,hasMore,nextBefore:messages[0]?.id??null,nextAfter:messages.at(-1)?.id??options.after??null,allowedActions:["chat.send","chat.read"]};
}
export function linkedRecord(type:string|null,slug:string|null,options:import("@/lib/sms").SmsLinkOptions) { const keys:Record<string,string>={lead:"leads",project:"projects",sub:"subs",vendor:"vendors"};const key=type?keys[type]:undefined;return {type,slug,label:key?options[key as keyof typeof options]?.find(r=>r.slug===slug)?.name??slug??"Record":slug??"Unlinked",href:key&&slug?`/${key}/${encodeURIComponent(slug)}`:null}; }

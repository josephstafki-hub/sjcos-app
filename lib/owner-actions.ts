
import { revalidatePath } from "next/cache";
import { withTransaction, runDirect } from "@/lib/commands/db";
import type { Principal } from "@/lib/commands/principal";
import { INACTIVE_OWNER, lockActiveOwner } from "@/lib/commands/owner-authorization";
import { type TelegramHandleResult, type TelegramUpdate } from "@/lib/decisions/telegram";
import { defaultTransport } from "@/lib/providers/telegram";
import { performApprovalEffects } from "@/lib/decisions/after-approval";
import { cardText } from "@/lib/decisions/cards";
import { rejectWorkItemById, claimApprovalInTransaction } from "@/lib/approve-work-item";
import { describeApproval } from "@/lib/approved-draft-rules";
import { askWhatShouldChange, deliverOwnerReply, markDraftCardPulled, sendOwnerTelegram } from "@/lib/owner-reply-delivery";
import { refreshTelegramCard } from "@/lib/decisions/notify";
import { getDecision } from "@/lib/commands/decisions";
import { rememberReplyTarget } from "@/lib/decisions/owner-replies";


function appUrl(): string { return (process.env.NEXT_PUBLIC_APP_URL ?? "https://os.sjcarpentryllc.com").replace(/\/$/, ""); }

export async function finishOwnerAction(result: TelegramHandleResult, update: TelegramUpdate, answer: (id:string,text:string)=>Promise<void>, edit: (chatId:string,messageId:number,text:string)=>Promise<void>): Promise<void> {
    // Post-commit: an approval must DO the thing — dispatch the sends it
    // woke, email a first-draw invoice, perform a permission request's
    // staged send — and the phone is told what actually happened.
    // All transactional callback replies are data until the caller commits.
    // Even a refused/replayed tap must not await Telegram while holding locks.
    for (const reply of result.replies ?? []) {
      if (reply.kind === "answer") await answer(reply.callbackId, reply.text);
      else await edit(reply.chatId, reply.messageId, reply.text);
    }
    const res = result.resolution;
    let resultLine=res?.reply??result.outcome;
    if (res?.ok && res.code === "approved" && res.decision) {
      const lines = await performApprovalEffects(res);
      resultLine=[res.reply,...lines].join(" ");
      const p = result.pendingAnswer;
      if (p) {
        await answer(p.callbackId, [res.reply, ...lines].join(" "));
        if (p.messageId != null) await edit(p.chatId, p.messageId, [cardText(res.decision, { appUrl: appUrl() }), ...lines].join("\n"));
      }
      if (lines.length) {
        await runDirect(`UPDATE telegram_updates SET outcome = $2 WHERE update_id = $1`, [update.update_id, [res.reply, ...lines].join(" ").slice(0, 300)]).catch(() => undefined);
      }
    } else if (result.pendingAnswer) {
      await answer(result.pendingAnswer.callbackId, res?.reply ?? "Done.");
    }

    // A work-item approval card (a staged draft): approve sends the draft
    // exactly as the app's Approve button does.
    if (result.workItem) {
      const w = result.workItem;
      let reply: string;
      const {queryOne}=await import('./db');
      const card=w.messageId==null?null:await queryOne<{id:string}>(`SELECT id FROM owner_push_messages WHERE telegram_message_id=$1 AND work_item_id=$2`,[String(w.messageId),w.id]);
      const approved = result.approvedWorkItem;
      if (approved) {
        const { finishApproval } = await import('./approve-work-item');
        const c = approved.claim;
        const r = await finishApproval({ id: approved.id, approvedDraftId: c.approvedDraftId,
          title: c.title, body: c.body, assigneeKey: c.assignee_key,
          context: c.project_slug ? `project ${c.project_slug}` : c.lead_slug ? `lead ${c.lead_slug}` : undefined });
        reply = r.ok ? describeApproval(r).message : r.error;
        if (r.ok) await markDraftCardPulled(approved.id, reply);
      } else reply = card ? (await resolvePhoneAction({messageId:card.id,action:w.verb==='reject'?'decline':'approve'},w.principal)).message : (await resolveWorkItemAction(w.id, w.verb === "reject" ? "decline" : w.verb, "Telegram", w.principal)).message;
      resultLine=reply;
      await answer(w.callbackId, reply);
      if (w.messageId != null) await edit(w.chatId, w.messageId, `[SJC OS] ${reply}\n${appUrl()}/today`);
      await runDirect(`UPDATE telegram_updates SET outcome = $2 WHERE update_id = $1`, [update.update_id, reply.slice(0, 300)]).catch(() => undefined);
    }
    // "Request changes" → ask what should change, under the card.
    if (result.changesPrompt) await askWhatShouldChange(result.changesPrompt);

    // Joe replied about a card in text: the request is already pulled (in the
    // transaction above). Show that on the card, send the note to the chat
    // that filed it (or the operating agent), and acknowledge.
    if (result.ownerReply) {
      const r = result.ownerReply;
      const {recordAppMessage}=await import('./phone-push');
      const {queryOne,query}=await import('./db');
      const root=await queryOne<{id:string}>(`SELECT id FROM owner_push_messages WHERE decision_id=$1 OR work_item_id=$2 ORDER BY created_at DESC LIMIT 1`,[r.decisionId,r.workItemId]).catch(()=>null);
      const note=await recordAppMessage({kind:'reply',from:'owner',title:'Your reply',body:String(update.message?.text??''),replyToId:root?.id,ownerReplyId:r.id}).catch(()=>null);
      if(note)await query(`UPDATE owner_replies SET push_message_id=$2 WHERE id=$1`,[r.id,note.id]).catch(()=>undefined);
      if (r.pulled && r.decisionId) {
        const d = await getDecision(runDirect, r.decisionId).catch(() => null);
        if (d) await refreshTelegramCard(d, "Changes requested from Telegram — your note went to the agent.").catch(() => undefined);
      }
      if (r.pulled && r.workItemId) await markDraftCardPulled(r.workItemId, "Pulled back for changes — your note went to the agent. Its revised draft comes as a new card.").catch(() => undefined);
      await deliverOwnerReply(r, String(update.message?.text ?? "").trim().slice(0, 4000));
    }
    // Joe answered a portal message from Telegram: it is already in the
    // thread (committed above). Refresh the pages that show it and confirm.
    if (result.portalReply) {
      const p = result.portalReply;
      const {recordAppMessage}=await import('./phone-push');const {queryOne,query}=await import('./db');
      const root=await queryOne<{id:string}>(`SELECT id FROM owner_push_messages WHERE portal_channel_key=$1 ORDER BY created_at DESC LIMIT 1`,[p.channelKey]).catch(()=>null);
      if(root)await query(`UPDATE owner_push_messages SET outcome='answered' WHERE id=$1`,[root.id]).catch(()=>undefined);
      const portalNote=await recordAppMessage({kind:'reply',from:'owner',title:'Your reply',body:String(update.message?.text??''),replyToId:root?.id}).catch(()=>null);
      try {
        if (p.scope) revalidatePath(p.scope.kind === "project" ? `/projects/${p.scope.slug}` : `/leads/${p.scope.slug}`);
        revalidatePath(p.scope ? "/client-portal" : "/sub-portal");
        revalidatePath("/chat");
      } catch {
        /* a stale page refreshes on its next load */
      }
      const ack = await sendOwnerTelegram(`Posted in the portal for ${p.recipient}. Reply here to send more.\n${appUrl()}${p.href}`, { replyTo: p.replyToMessageId, pushReplyToId:portalNote?.id,appText:{title:'Reply posted',body:`Posted in the portal for ${p.recipient}.`,from:'system'},legacyFallback:true });
      if (ack != null) {
        await rememberReplyTarget(runDirect, { chatId: p.chatId, messageId: ack, portalChannelKey: p.channelKey, portalMessageId: p.messageId, kind: "portal_ack" }).catch(() => undefined);
      }
    }
    if (result.help) await sendOwnerTelegram(result.help.text, { replyTo: result.help.messageId });
    const {cleanupAppAlerts,notifyAppActionResult}=await import('./phone-push');
    await cleanupAppAlerts().catch(()=>undefined);
    const recordId=result.decisionId??result.workItem?.id;
    if(recordId && (result.resolution?.ok || result.workItem)){
      const {queryOne}=await import('./db');
      const root=await queryOne<{id:string}>(`SELECT id FROM owner_push_messages WHERE (decision_id=$1 OR work_item_id=$1) AND reply_to_id IS NULL ORDER BY created_at DESC LIMIT 1`,[recordId]);
      if(root)await notifyAppActionResult(root.id,resultLine).catch(()=>undefined);
    }

}

/** Phone and Telegram use the same domain operations and post-commit effects. */
type PhoneActionInput = {actionId?:string;generation?:number;messageId:string;action:'approve'|'decline'|'changes'|'hold'|'reply';text?:string};
type PhoneActionResult = {ok:boolean;message:string;outcome:string};

export async function resolvePhoneAction(input:PhoneActionInput,principal:Principal):Promise<PhoneActionResult> {
 try {
  return await resolvePhoneActionMutation(input,principal);
 } catch(error) {
  // The transaction rolls back before returning this client-safe refusal.
  if(error instanceof Error && error.message===INACTIVE_OWNER)return {ok:false,message:INACTIVE_OWNER,outcome:'unauthorized'};
  throw error;
 }
}

async function resolvePhoneActionMutation(input:PhoneActionInput,principal:Principal):Promise<PhoneActionResult> {
 const {queryOne,query}=await import('./db');
 const {holdDecision,resolveFromChannel}=await import('./decisions/resolve');
 const {recordOwnerReply}=await import('./decisions/owner-replies');
 const {recordPortalReply}=await import('./decisions/portal-replies');
 const {recordAppMessage,deliverAppMessage,pushSettings,cleanupAppAlerts}=await import('./phone-push');
 const m=await queryOne<{id:string;decision_id:string|null;work_item_id:string|null;portal_channel_key:string|null;content_hash:string|null;thread_key:string;draft_binding:string|null;category:string}>(`SELECT * FROM owner_push_messages WHERE id=$1`,[input.messageId]);
 if(!m)return {ok:false,message:'That alert no longer exists.',outcome:'not_found'};
 const {shapePushMessage}=await import('./phone-push');
 const isCard=['SJC_DECISION','SJC_GRANT','SJC_DECISION_SEND','SJC_GRANT_SEND'].includes(String((m as unknown as {category:string}).category));
 if(isCard&&m.decision_id){const current=await getDecision(runDirect,m.decision_id);if(!m.content_hash||!current?.content_hash?.startsWith(m.content_hash))return {ok:false,message:'This card is out of date. Open the current card.',outcome:'stale'};}
 if(m.work_item_id && ['SJC_DRAFT','SJC_DRAFT_SEND'].includes(m.category)){
  const binding=await queryOne<{binding:string}>(`SELECT phone_push_draft_binding($1) AS binding`,[m.work_item_id]);
  if(!m.draft_binding||binding?.binding!==m.draft_binding)return {ok:false,message:'This draft has changed. Open the current card.',outcome:'stale'};
 }
 const allowed=shapePushMessage(m).allowedActions;
 if(!allowed.includes(input.action))return {ok:false,message:'This action is not available on this alert. Open the current card.',outcome:'not_allowed'};
 const checkpoint=async(run:import('./commands/db').Run,evidence:unknown)=>{if(input.actionId)await run(`UPDATE push_actions SET phase='effects_pending',evidence=$2::jsonb WHERE id=$1 AND generation=$3 AND result IS NULL`,[input.actionId,JSON.stringify(evidence),input.generation??1]);};
 const locked=async(run:import('./commands/db').Run)=>{
  if(input.actionId){const [claim]=await run(`SELECT id FROM push_actions WHERE id=$1 AND generation=$2 AND result IS NULL AND phase='claimed' FOR UPDATE`,[input.actionId,input.generation??1]);if(!claim)throw new Error('This answer is already being handled.');}
  // Every verb, including a reply-only child alert, locks its domain target
  // before the account. The initial API lookup discovers identity only.
  if(m.work_item_id){
   const [w]=await run(`SELECT id FROM work_items WHERE id=$1 FOR UPDATE`,[m.work_item_id]);
   if(['SJC_DRAFT','SJC_DRAFT_SEND'].includes(m.category) && input.action!=='approve'){
    const [binding]=await run<{binding:string}>(`SELECT phone_push_draft_binding($1) AS binding`,[m.work_item_id]);
    if(!w||!m.draft_binding||binding.binding!==m.draft_binding)throw new Error('This draft has changed. Open the current card.');
   }
  }
  if(m.decision_id){
   const [d]=await run<{content_hash:string}>(`SELECT content_hash FROM decisions WHERE id=$1 FOR UPDATE`,[m.decision_id]);
   if(isCard && (!m.content_hash||!d?.content_hash.startsWith(m.content_hash)))throw new Error('This card is out of date. Open the current card.');
  }
  // Portal replies lock their channel then the owner in recordPortalReply.
  // Never take the owner lock here before waiting for that channel lock.
  if(!m.portal_channel_key && !await lockActiveOwner(run,principal))throw new Error(INACTIVE_OWNER);
 };
 const text=input.text?.trim().slice(0,4000);
 if(input.action==='reply'||input.action==='changes') {
  if(!text)return {ok:false,message:'Say what should change or type your reply.',outcome:'text_required'};
  if(m.decision_id){const d=await getDecision(runDirect,m.decision_id);if(d&&m.content_hash&&!d.content_hash?.startsWith(m.content_hash))return {ok:false,message:'This card is out of date. Open the current card.',outcome:'stale'};}
  let line:string;
  if(m.portal_channel_key){
   const p=await withTransaction(async run=>{await locked(run);const p=await recordPortalReply(run,{channelKey:m.portal_channel_key!,text,principal,channel:'app'});await run(`UPDATE owner_push_messages SET outcome='answered' WHERE thread_key=$1 AND portal_channel_key IS NOT NULL`,[m.thread_key]);await checkpoint(run,{portal:p});return p;});
   line=`Posted in the portal for ${p.recipient}.`;
   try{revalidatePath('/chat');revalidatePath(p.scope?.kind==='project'?`/projects/${p.scope.slug}`:p.scope?`/leads/${p.scope.slug}`:'/client-portal');}catch{}
  } else if(m.decision_id||m.work_item_id){
   const r=await withTransaction(async run=>{
    await locked(run);
    const recorded=await recordOwnerReply(run,{decisionId:m.decision_id,workItemId:m.work_item_id,text,chatId:'app',messageId:0,principal,channel:'app',pushMessageId:m.id});
    await checkpoint(run,{ownerReply:recorded});
    return recorded;
   });
   const note=await recordAppMessage({kind:'reply',from:'owner',title:'Your reply',body:text,replyToId:m.id,ownerReplyId:r.id});
   await query(`UPDATE owner_replies SET push_message_id=$2 WHERE id=$1`,[r.id,note.id]);
   await mirrorPhoneText(note.id,m.id,text,r.id);
   await deliverOwnerReply({...r,chatId:'app',messageId:0},text);
   if(r.decisionId){const d=await getDecision(runDirect,r.decisionId);if(d)await refreshTelegramCard(d,'Changes requested — your note went to the agent.');}
   if(r.workItemId)await markDraftCardPulled(r.workItemId,'Pulled back for changes — your note went to the agent.');
   line='Your note went to the agent.';
  }else return {ok:false,message:'This alert does not accept replies.',outcome:'not_replyable'};
  if(m.portal_channel_key){const note=await recordAppMessage({kind:'reply',from:'owner',title:'Your reply',body:text,replyToId:m.id});
  await mirrorPhoneText(note.id,m.id,text);
  await sendOwnerTelegram(`${line} Reply here to send more.`,{pushReplyToId:note.id,appText:{title:'Reply posted',body:line,from:'system'}});}
  await cleanupAppAlerts().catch(()=>undefined);return {ok:true,message:line,outcome:m.portal_channel_key?'posted':'changes_requested'};
 }
 if(m.work_item_id){
  const claimed=await withTransaction(async run=>{
   await locked(run);
   if(!['approve','decline'].includes(input.action))return null;
   if(input.action==='approve'){
    const w=await claimApprovalInTransaction(run,m.work_item_id!,m.draft_binding??undefined);
    if(w.ok)await checkpoint(run,{workItemId:m.work_item_id,action:input.action,approvedDraftId:w.approvedDraftId,stage:'work_item_claimed'});
    return w;
   }
   const [w]=await run<{title:string;body:string;assignee_key:string|null;lead_slug:string|null;project_slug:string|null}>(`UPDATE work_items SET approval_status=$2,status=CASE WHEN $2='rejected' THEN 'cancelled' WHEN status='approval_needed' THEN 'queued' ELSE status END WHERE id=$1 AND approval_status='requested' RETURNING title,body,assignee_key,(SELECT slug FROM leads WHERE id=work_items.lead_id) AS lead_slug,(SELECT slug FROM projects WHERE id=work_items.project_id) AS project_slug`,[m.work_item_id,'rejected']);
   if(w)await checkpoint(run,{workItemId:m.work_item_id,action:input.action,stage:'work_item_claimed'});
   return w?{ok:true as const,...w,approvedDraftId:""}:null;
  });
  if(claimed && !claimed.ok)return {ok:false,message:claimed.error,outcome:'stale'};
  if(!claimed)return {ok:false,message:'This draft is no longer waiting for approval.',outcome:'already_resolved'};
  if(input.actionId){const claim=await queryOne(`UPDATE push_actions SET phase='effects_running' WHERE id=$1 AND generation=$2 AND result IS NULL AND phase='effects_pending' RETURNING id`,[input.actionId,input.generation??1]);if(!claim)throw new Error('This answer is already being handled.');}
  let reply:{ok:boolean;message:string;outcome:string};
  if(input.action==='approve'){
   const {finishApproval}=await import('./approve-work-item');
   const r=await finishApproval({id:m.work_item_id,approvedDraftId:claimed.approvedDraftId,title:claimed.title,body:claimed.body,assigneeKey:claimed.assignee_key,context:claimed.project_slug?`project ${claimed.project_slug}`:claimed.lead_slug?`lead ${claimed.lead_slug}`:undefined});
   reply={ok:r.ok,message:r.ok?describeApproval(r).message:r.error,outcome:r.ok?'approved':'failed'};
  }else{
   const {captureAgentMemory}=await import('./agent-memory');const {maybeAdvanceRunbook}=await import('./runbook-engine');
   await captureAgentMemory({summary:`Rejected: ${claimed.title}`,content:`Joe declined "${claimed.title}" in the app.`,memoryType:'observation',runtimeName:claimed.assignee_key??undefined,refs:[{kind:'work_item',id:m.work_item_id,label:claimed.title}]});
   await maybeAdvanceRunbook(m.work_item_id);
   reply={ok:true,message:`Declined: ${claimed.title}`,outcome:'declined'};
  }
  if(reply.ok)await markDraftCardPulled(m.work_item_id,reply.message);
  await cleanupAppAlerts().catch(()=>undefined);return reply;
 }
 if(!m.decision_id)return {ok:false,message:'This alert has no approval to answer.',outcome:'not_actionable'};
 const d=await getDecision(runDirect,m.decision_id);
 if(!d)return {ok:false,message:'That decision no longer exists.',outcome:'not_found'};
 if(m.content_hash&&!d.content_hash?.startsWith(m.content_hash))return {ok:false,message:'This card is out of date. Open the current card.',outcome:'stale'};
 if(input.action==='decline')return {ok:false,message:'This card offers Approve, Request changes, or Hold.',outcome:'not_allowed'};
 if(input.action==='hold'){
  const held=await withTransaction(async run=>{await locked(run);const held=await holdDecision(run,d.id,4,principal,'Held from the app');await checkpoint(run,{held});return held;});
  if(held)await refreshTelegramCard(held,'Held for 4 hours.');
  await cleanupAppAlerts().catch(()=>undefined);
  return {ok:!!held,message:held?'Held for 4 hours.':`Already ${d.status}.`,outcome:held?'held':'already_resolved'};
 }
 const r=await withTransaction(async run=>{await locked(run);const current=await getDecision(run,d.id);const r=await resolveFromChannel(run,{decisionId:d.id,contentHash:current!.content_hash,via:'app',principal,outcome:'approved'});await checkpoint(run,{resolution:r});return r;});
 if(input.actionId){const claim=await queryOne(`UPDATE push_actions SET phase='effects_running' WHERE id=$1 AND generation=$2 AND result IS NULL AND phase='effects_pending' RETURNING id`,[input.actionId,input.generation??1]);if(!claim)throw new Error('This answer is already being handled.');}
 const lines=r.ok?await performApprovalEffects(r):[];
 if(r.decision)await refreshTelegramCard(r.decision,lines.join(' '));
 await cleanupAppAlerts().catch(()=>undefined);return {ok:r.ok,message:[r.reply,...lines].join(' '),outcome:r.code};
}

export async function resolveWorkItemAction(id:string,verb:string,channel:string,principal:Principal):Promise<{ok:boolean;message:string;outcome:string}> {
 const [state]=await runDirect<{approval_status:string;title:string}>(`SELECT approval_status,title FROM work_items WHERE id=$1`,[id]);
 if(!state)return {ok:false,message:'That item no longer exists.',outcome:'not_found'};
 if(state.approval_status!=='requested')return {ok:false,message:state.approval_status==='not_requested'?`Not sent: "${state.title}" was pulled back for changes. The agent's revised draft comes as a new card.`:`Already ${state.approval_status}: ${state.title}`,outcome:'already_resolved'};
 // Legacy cards have no evidence of the content Joe saw. Even an unchanged
 // draft cannot be verified; never substitute the latest card or live binding.
 if(verb==='approve')return {ok:false,message:'This old card cannot approve a draft. Open Today to review the draft and approve it there. Nothing was sent.',outcome:'stale'};
 if(verb==='decline'){const r=await rejectWorkItemById(id,channel,principal);if(r.ok)await markDraftCardPulled(id,`Declined: ${r.title}`);return {ok:r.ok,message:r.ok?`Declined: ${r.title}`:r.error,outcome:r.ok?'declined':'failed'};}
 return {ok:false,message:'This action is not available on a draft.',outcome:'not_allowed'};
}

async function mirrorPhoneText(id:string,parentId:string,text:string,ownerReplyId?:string) {
 const {queryOne}=await import('./db');
 const target=await queryOne<{decision_id:string|null;work_item_id:string|null;portal_channel_key:string|null;portal_message_id:string|null;telegram_message_id:string|null}>(`SELECT * FROM owner_push_messages WHERE id=$1`,[parentId]);
 if(!target)return;
 const sent=await sendOwnerTelegram(text,{existingMessageId:id,replyTo:target.telegram_message_id});
 if(sent!=null)await rememberReplyTarget(runDirect,{chatId:process.env.TELEGRAM_OWNER_CHAT_ID??'',messageId:sent,decisionId:target.decision_id,workItemId:target.work_item_id,portalChannelKey:target.portal_channel_key,portalMessageId:target.portal_message_id,ownerReplyId,kind:'owner_reply'});
}

/** The mutation and this resolution were committed together; no domain replay. */
export async function resumePhoneEffects(actionId:string,r:import('./decisions/resolve').ResolveFromChannelResult,generation=1) {
 const {queryOne}=await import('./db');
 const claim=await queryOne(`UPDATE push_actions SET phase='effects_running' WHERE id=$1 AND generation=$2 AND result IS NULL AND phase='effects_pending' RETURNING id`,[actionId,generation]);
 if(!claim)throw new Error('This answer is already being handled.');
 const lines=await performApprovalEffects(r);
 if(r.decision)await refreshTelegramCard(r.decision,lines.join(' '));
 return {ok:r.ok,message:[r.reply,...lines].join(' '),outcome:r.code};
}

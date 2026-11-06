import { query, queryOne } from './db';
import { apnsConfigured, approvalKey, buildPushPayload, categoryFor, sendApns, type AppAlert } from './providers/apns';
import type { NotifyOwnerInput, TelegramExtras } from './notify-owner';
import { parseCallbackData, parseWorkItemCallback } from './decisions/telegram';

export async function pushSettings() {
 const row=await queryOne<{value:string}>(`SELECT value FROM app_settings WHERE key='owner_push.channels'`);
 let channels={app:true,telegram:true};try{if(row)channels=JSON.parse(row.value);}catch{}
 return {channels,quietHours:{timeZone:'America/Chicago',start:'21:00',end:'07:00'},configured:{app:apnsConfigured(),telegram:Boolean(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_OWNER_CHAT_ID)}};
}
export async function savePushSettings(channels:{app:boolean;telegram:boolean}) {
 await query(`INSERT INTO app_settings(key,value,updated_at) VALUES ('owner_push.channels',$1,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[JSON.stringify(channels)]);
 return pushSettings();
}
export async function pushBadge():Promise<number> {
 const row=await queryOne<{badge:number}>(`SELECT ((SELECT count(*) FROM decisions WHERE status='pending' AND expires_at>now() AND (held_until IS NULL OR held_until<=now()))+(SELECT count(*) FROM work_items WHERE approval_status='requested'))::int AS badge`);return row?.badge??0;
}
export async function sendAppPayload(payload:unknown,opts:{silent?:boolean;collapseId?:string;token?:string;messageId?:string}={}) {
 const {rows}=await query<{id:string;token:string;environment:string}>(`SELECT d.id,d.token,d.environment FROM push_devices d JOIN users u ON u.id=d.user_id WHERE u.active AND u.role='owner' AND d.disabled_at IS NULL AND d.revoked_at IS NULL AND d.platform='ios'
 AND d.session_auth_at IS NOT NULL AND d.session_expires_at>now() AND NOT EXISTS(SELECT 1 FROM session_revocations r WHERE r.user_id=d.user_id AND r.revoked_before>d.session_auth_at)
 AND ($1::text IS NULL OR d.token=$1)
 AND ($2::uuid IS NULL OR NOT EXISTS(SELECT 1 FROM push_device_deliveries x WHERE x.message_id=$2 AND x.device_id=d.id)) ORDER BY d.id`,[opts.token??null,opts.messageId??null]);
 const failures:unknown[]=[];let accepted=0;
 for(const d of rows){try{
  if(opts.messageId)await query(`UPDATE push_outbox SET claimed_until=now()+interval '5 minutes' WHERE id=(SELECT push_outbox_id FROM owner_push_messages WHERE id=$1) AND sent_at IS NULL`,[opts.messageId]);
  const r=await sendApns(d,payload,opts);
  if(r.disabledReason){await query(`SELECT sjcos_disable_push_device($1,$2)`,[d.id,r.disabledReason]);if(opts.token)throw new Error('This phone registration was refused by Apple. Register it again.');}
  else {accepted++;if(opts.messageId)await query(`INSERT INTO push_device_deliveries(message_id,device_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[opts.messageId,d.id]);}
 }catch(e){failures.push(e);}}
 if(failures.length)throw new Error('Some phone alerts could not be delivered; queued for retry.');
 if(opts.token&&!rows.length)throw new Error('Register this phone again before sending a test.');
 return {accepted};
}
export async function recordAppMessage(input:{kind:string;title:string;body?:string|null;href?:string|null;telegram?:TelegramExtras|null;replyToId?:string|null;ownerReplyId?:string|null;from?:'owner'|'agent'|'system';agentName?:string|null},outboxId?:string|null) {
 if(outboxId){const existing=await queryOne<AppAlert>(`SELECT * FROM owner_push_messages WHERE push_outbox_id=$1`,[outboxId]);if(existing)return existing;}
 const e=input.telegram;
 const app=e?.appText;
 input={...input,title:(app?.title??input.title).replace(/^(?:\[SJC OS\]\s*|Approve:\s*)+/gi,''),body:app?app.body:input.body,from:app?.from??input.from,agentName:app?.agentName??input.agentName};
 input.body=input.body?.split('\n').filter(line=>!/^Status: /.test(line)&&!/^https?:\/\/[^ ]+\/(?:engine|projects|leads|notifications)(?:[/?#][^ ]*)?$/.test(line.trim())).join('\n');
 if(input.kind==='portal_message')input.body=input.body?.replace(/\n\nReply to this message[^]*$/,'');
 if(['payment','contract_signed'].includes(input.kind)){
  const slug=input.href?.match(/\/projects\/([^/?#]+)/)?.[1];
  const job=slug?await queryOne<{name:string}>(`SELECT name FROM projects WHERE slug=$1`,[decodeURIComponent(slug)]):null;
  if(job&&!input.title.includes(job.name))input.title+=` · ${job.name}`;
 }

 // A Telegram edit is the same card, never a fresh root alert.
 if(e?.editMessageId&&!e.buttons?.length){
  const existing=await queryOne<AppAlert>(`UPDATE owner_push_messages SET title=$2,body=$3 WHERE telegram_message_id=$1 RETURNING *`,[String(e.editMessageId),input.title,input.body??null]);
  if(existing)return existing;
  const prior=e.decisionId?await queryOne<AppAlert>(`SELECT * FROM owner_push_messages WHERE decision_id=$1 AND category IN ('SJC_DECISION','SJC_GRANT','SJC_DECISION_SEND','SJC_GRANT_SEND') ORDER BY created_at DESC LIMIT 1`,[e.decisionId]):null;
  if(prior)return prior;
 }
 const cb=e?.buttons?.flat().map(b=>parseCallbackData(b.callback_data)).find(Boolean);
 const wi=e?.buttons?.flat().map(b=>parseWorkItemCallback(b.callback_data)).find(Boolean);
 const decisionId=e?.decisionId??cb?.decisionId??null,workItemId=e?.workItemId??wi?.workItemId??null;
 let parentId=input.replyToId??e?.pushReplyToId;
 if(!parentId&&e?.editMessageId&&e.buttons?.length)parentId=(await queryOne<{id:string}>(`SELECT id FROM owner_push_messages WHERE telegram_message_id=$1 ORDER BY created_at DESC LIMIT 1`,[e.editMessageId]))?.id;
 let parent=parentId?await queryOne<Record<string, string>>(`SELECT * FROM owner_push_messages WHERE id=$1`,[parentId]):null;
 if(!parent && e?.replyToMessageId)parent=await queryOne<Record<string,string>>(`SELECT m.* FROM owner_push_messages m LEFT JOIN owner_replies r ON r.push_message_id=m.id WHERE m.telegram_message_id=$1 OR r.message_id::text=$1 ORDER BY m.created_at DESC LIMIT 1`,[e.replyToMessageId]);
 const grant=decisionId?await queryOne<{id:string;scope:Record<string,unknown>}>(`SELECT id,scope FROM owner_grants WHERE decision_id=$1 ORDER BY created_at DESC LIMIT 1`,[decisionId]):null;
 const d=decisionId?await queryOne<{content_hash:string;status:string;summary:{effect?:string}}>(`SELECT content_hash,status,summary FROM decisions WHERE id=$1`,[decisionId]):null;
 const sends=grant ? !!grant.scope?.staged : /\b(?:sends?|emails?|posts?)\b/i.test(d?.summary?.effect??'') || !!e?.buttons?.flat().some(b=>/send|post/i.test(b.text));
 const category=['reply','ack'].includes(input.kind)?'SJC_REPLY':categoryFor({kind:grant?'grant':input.kind,decision_id:decisionId,work_item_id:workItemId,sends});
 const thread=parent?.thread_key??(decisionId?`decision:${decisionId}`:workItemId?`work_item:${workItemId}`:e?.portalChannelKey?`portal:${e.portalChannelKey}`:`info:${crypto.randomUUID()}`);
 const binding=workItemId?(e?.draftBinding??(await queryOne<{binding:string}>(`SELECT phone_push_draft_binding($1) AS binding`,[workItemId]))?.binding):null;
 const {rows}=await query<AppAlert>(`INSERT INTO owner_push_messages(kind,title,body,href,decision_id,work_item_id,portal_channel_key,portal_message_id,owner_reply_id,reply_to_id,thread_key,category,state,content_hash,sends,push_outbox_id,grant_id,draft_binding,"from",agent_name)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,[input.kind,input.title,input.body??null,input.href??null,decisionId??parent?.decision_id,workItemId??parent?.work_item_id,e?.portalChannelKey??parent?.portal_channel_key,e?.portalMessageId??parent?.portal_message_id,input.ownerReplyId??null,parent?.id??null,thread,category,decisionId||workItemId?(d&&d.status!=='pending'?'decided':'open'):'info',(cb?.hashPrefix && !d?.content_hash?.startsWith(cb.hashPrefix)?cb.hashPrefix:d?.content_hash)??null,sends,outboxId??null,grant?.id??parent?.grant_id??null,binding,input.from??'system',input.agentName??null]);
 await query(`SELECT phone_push_reconcile()`);
 return (await queryOne<AppAlert>(`SELECT * FROM owner_push_messages WHERE id=$1`,[rows[0].id]))!;
}
export async function deliverAppMessage(m:AppAlert,token?:string) {
 const result=await sendAppPayload(buildPushPayload(m,await pushBadge()),{token,messageId:m.id,collapseId:m.kind==='stale_approval'?m.thread_key:undefined});
 const prior=await queryOne(`SELECT 1 FROM push_device_deliveries WHERE message_id=$1 LIMIT 1`,[m.id]);
 if(result.accepted||prior)await query(`UPDATE owner_push_messages SET delivered_at=now(),delivered_channels=array_append(delivered_channels,'app') WHERE id=$1 AND NOT ('app'=ANY(delivered_channels))`,[m.id]);
}
export async function cleanupAppAlerts() {
 await query(`SELECT phone_push_reconcile()`);
 const {rows}=await query<{id:string}>(`SELECT id FROM owner_push_messages WHERE cleanup_pending ORDER BY created_at LIMIT 100`);
 const badge=await pushBadge();
 if(rows.length && (await pushSettings()).channels.app && apnsConfigured()){
  await sendAppPayload({aps:{'content-available':1,badge},sjc:{v:1,kind:'cleanup',decidedMessageIds:rows.map(r=>r.id),badge}},{silent:true});
  await query(`UPDATE owner_push_messages SET cleanup_pending=false WHERE id=ANY($1::uuid[])`,[rows.map(r=>r.id)]);
 }
 const all=await query<{id:string}>(`SELECT id FROM owner_push_messages WHERE state='decided' ORDER BY created_at DESC`);
 return {badge,decidedMessageIds:all.rows.map(r=>r.id)};
}
export function shapePushMessage(row:Record<string,unknown>) {
 const m=row as unknown as AppAlert; const key=approvalKey(m);
 const allowedActions=row.state==='open' && ['SJC_DECISION','SJC_GRANT','SJC_DECISION_SEND','SJC_GRANT_SEND','SJC_DRAFT','SJC_DRAFT_SEND'].includes(m.category)?(m.work_item_id?['approve','changes','decline']:m.decision_id?['approve','changes','hold']:[]):[];
 if(row.portal_channel_key||row.decision_id||row.work_item_id)allowedActions.push('reply');
 const result:Record<string,unknown>={};for(const [k,v] of Object.entries(row))result[k.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase())]=v;
 delete result.deliveredChannels;delete result.telegramMessageId;delete result.cleanupPending;delete result.pushOutboxId;
 return {...result,approvalKey:key,dest:buildPushPayload({...m,body:''},0).sjc.dest,allowedActions,replies:[]};
}

/** A completed button action is a visible line in the same conversation. */
export async function notifyAppActionResult(messageId:string,text:string) {
 const m=await recordAppMessage({kind:'ack',title:text,replyToId:messageId});
 const {enqueueOwnerConversation}=await import('./notify-owner');
 await enqueueOwnerConversation({kind:'ack',title:text,body:text,phoneOnly:true,telegram:{conversation:true,appOnly:true,existingMessageId:m.id,pushReplyToId:messageId}});
}

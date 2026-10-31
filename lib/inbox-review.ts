import { splitQuotedText, substantiveSnippet, threadNeedsMe} from './inbox-rules.ts';
import {centralDay, matchesInboxTab} from './inbox-experience.ts';
import type {InboxThread} from './inbox';

/** Uses measured scrollHeight (including wrapped lines), not character counts. */
export function draftReviewSize(contentHeight:number, viewportHeight:number, lineHeight=24) {
  const cap=Math.max(1,viewportHeight*.45);
  const height=Math.min(cap,Math.max(lineHeight*8,contentHeight));
  return {height,more:contentHeight>height+1};
}
export function askExcerpt(paras:string[], subject=''):string {
  const text=splitQuotedText(paras).text
    .replace(/^\s*(?:hi|hello|hey|dear|good morning|good afternoon)(?:[ \t]+[^,\n!]{1,50})?[,!][ \t]*/i,'')
    .split(/\n\s*(?:thanks(?:[,!]|$)|regards\b|best\b|sincerely\b)/i)[0]
    .replace(/https?:\/\/\S+/g,'');
  const sentences=text.split(/\n\s*\n|(?<=[.!?])\s+/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  const request=/\b(?:can you|could you|would you|please|we (?:need|want|would like)|estimate|quote|review|painting|popcorn|basement|egress|square feet|information request)\b/i;
  const selected=sentences.filter(s=>request.test(s)&&!/^thank/i.test(s));
  return selected.join(' ').slice(0,700)||substantiveSnippet(paras,subject);
}
type ActionThread=Partial<InboxThread> & Pick<InboxThread,'subject'|'fromName'>;
export function cleanRowSummary(summary:string, sender:string):string {
  const prefix=summary.indexOf(':');
  return prefix>=0&&summary.slice(0,prefix).trim().toLowerCase()===sender.trim().toLowerCase()?summary.slice(prefix+1).trim():summary;
}
export function rowActionTitle(t:ActionThread):string {
  const text=`${t.subject} ${t.preview??''} ${t.attentionEvidence??''}`;
  if(/information request/i.test(text)){
    const days=/\b(?:within|in)(?: the next)? (\d+) (?:business )?days?\b/i.exec(text)?.[1];
    return `Complete ${/square/i.test(t.fromName)?'Square ':''}information request${days?` · ${days} days`:''}`;
  }
  if(/fiverr/i.test(t.fromName)&&/order|deliver|complete/i.test(text))return 'Review Fiverr order';
  if(/hallway|stair/i.test(text)&&/paint|popcorn/i.test(text))return `Asks to add hallway ${/paint/i.test(text)?'painting':''}${/paint/i.test(text)&&/popcorn/i.test(text)?' + ':''}${/popcorn/i.test(text)?'popcorn ':''}estimate`.replace(/\s+/g,' ');
  if(/basement|bedroom|egress/i.test(text))return `Review ${t.fromName.split(' ')[0]}’s basement details`;
  if(t.automated)return t.subject.replace(/^(?:re:\s*)+/i,'')||automationState(t).label;
  const summary=cleanRowSummary(t.preview??'',t.fromName);
  return /^(?:review|confirm|complete|send|schedule|approve|asks? to)\b/i.test(summary)?summary.slice(0,160):`Review ${summary||t.subject}`.slice(0,160);
}
export function reminderTitle(t:ActionThread):string {const action=rowActionTitle(t).replace(/^Asks to /,'Review request to ');return (/^(?:review|complete|confirm|send|schedule|approve)\b/i.test(action)?action:`Review ${action}`).slice(0,160);}
export function automationState(t:Partial<InboxThread>) {
  const attention=Boolean(t.automated&&threadNeedsMe(t));
  return {attention,label:`${t.automationKind??'Notification'}${attention?' · Needs your attention':t.inInbox===false||t.view==='done'?' · done':''}`};
}
export function composerMode(newSender:boolean, replyAnyway:boolean, automated:boolean) {
  return newSender&&!replyAnyway?'screen':automated&&!replyAnyway?'automated':'reply';
}
export function olderOtherMail(rows:InboxThread[], now=new Date()) {
  return rows.filter(t=>t.channel==='email'&&t.automated&&t.inInbox===true&&matchesInboxTab(t,'other')&&t.receivedAt&&centralDay(new Date(t.receivedAt))<centralDay(now));
}
/** Sequential mailbox mutations with receipts for exact, retryable partial Undo. */
export async function completeMailBatch(rows:InboxThread[], action:(id:string)=>Promise<{ok:boolean}>) {
  const completed:InboxThread[]=[],failed:InboxThread[]=[];
  for(const row of rows){try{(await action(row.id)).ok?completed.push(row):failed.push(row);}catch{failed.push(row);}}
  return {completed,failed};
}
export function regenerateModel(model?:string):'claude'|'hermes' {return model?.toLowerCase()==='claude'?'claude':'hermes';}
export function restoreForwardChoices<T extends {id:string}>(originals:T[], stored:string|null):T[] {
  if(stored===null)return originals;
  try{const ids:unknown=JSON.parse(stored);return Array.isArray(ids)?originals.filter(a=>ids.includes(a.id)):originals;}catch{return originals;}
}

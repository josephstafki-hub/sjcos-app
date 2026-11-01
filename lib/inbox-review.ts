import { splitQuotedText, substantiveSnippet, threadNeedsMe} from './inbox-rules.ts';
import {centralDay, matchesInboxTab} from './inbox-experience.ts';
import type {InboxThread} from './inbox';

/** Uses measured scrollHeight (including wrapped lines), not character counts. */
export function draftReviewSize(contentHeight:number, viewportHeight:number, lineHeight=24) {
  const cap=Math.max(1,viewportHeight*.45);
  const height=Math.min(cap,Math.max(lineHeight*8,contentHeight));
  return {height,more:contentHeight>height+1};
}
/** General ask signals — never words specific to one job or sender. */
const REQUEST_SIGNAL=/\?|\b(?:can you|could you|would you|will you|please|let me know|we(?:'d| would)? (?:like|need|want|hope)|i(?:'d| would)? (?:like|need|want)|we are looking|estimate|quote|price|pricing|cost|schedule|available|availability|information request)\b/i;
export function askExcerpt(paras:string[], subject=''):string {
  const text=splitQuotedText(paras).text
    .replace(/^\s*(?:hi|hello|hey|dear|good morning|good afternoon)(?:[ \t]+[^,\n!]{1,50})?[,!][ \t]*/i,'')
    .split(/\n\s*(?:thanks(?:[,!]|$)|regards\b|best\b|sincerely\b)/i)[0]
    .replace(/https?:\/\/\S+/g,'');
  const sentences=text.split(/\n\s*\n|(?<=[.!?])\s+/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  const request=REQUEST_SIGNAL;
  const selected=sentences.filter(s=>request.test(s)&&!/^thank/i.test(s));
  return selected.join(' ').slice(0,700)||substantiveSnippet(paras,subject);
}
type ActionThread=Partial<InboxThread> & Pick<InboxThread,'subject'|'fromName'>;
export function cleanRowSummary(summary:string, sender:string):string {
  const prefix=summary.indexOf(':');
  return prefix>=0&&summary.slice(0,prefix).trim().toLowerCase()===sender.trim().toLowerCase()?summary.slice(prefix+1).trim():summary;
}
export function rowActionTitle(t:ActionThread):string {
  // An AI headline (written by the same model that drafted the reply) wins.
  if(t.actionTitle?.trim())return t.actionTitle.trim().slice(0,160);
  const text=`${t.subject} ${t.preview??''} ${t.attentionEvidence??''}`;
  if(/information request/i.test(text)){
    const days=/\b(?:within|in)(?: the next)? (\d+) (?:business )?days?\b/i.exec(text)?.[1];
    return `Complete information request${days?` · ${days} days`:''}`;
  }
  const subject=(t.subject??'').replace(/^(?:(?:re|fwd?|aw)\s*:\s*)+/i,'').trim();
  if(t.automated)return subject||automationState(t).label;
  const summary=cleanRowSummary(t.preview??'',t.fromName??'').replace(/\s+/g,' ').trim();
  if(/^(?:review|confirm|complete|send|schedule|approve|asks? to)\b/i.test(summary))return summary.slice(0,160);
  if(summary&&REQUEST_SIGNAL.test(summary))return `Asks: ${summary}`.slice(0,160);
  return (subject||summary).slice(0,160);
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
export function regenerateModel(model?:string):'claude'|'hermes'|'qwen' {return model?.toLowerCase()==='claude'?'claude':model?.toLowerCase()==='qwen'?'qwen':'hermes';}
export function restoreForwardChoices<T extends {id:string}>(originals:T[], stored:string|null):T[] {
  if(stored===null)return originals;
  try{const ids:unknown=JSON.parse(stored);return Array.isArray(ids)?originals.filter(a=>ids.includes(a.id)):originals;}catch{return originals;}
}

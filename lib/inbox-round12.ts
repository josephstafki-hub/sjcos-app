import {splitQuotedText} from './inbox-rules.ts';
import type {DraftSource} from './inbox-draft-types';

/** Mirrors conversationDraftContext's six-message / 12k budget exactly. */
export function draftSources(threadId:string,messages:{id?:string;fromName?:string;outbound?:boolean;body:string[]}[],focalIndex:number,record?:Exclude<DraftSource,{kind:'message'}>|null):DraftSource[] {
  const focal=messages[focalIndex];
  const sources:DraftSource[]=focal?.id?[{kind:'message',threadId,messageId:focal.id,label:'Inbound message'}]:[];
  let used=0;
  for(const message of messages.filter((_,i)=>i!==focalIndex).slice(-6)){
    const chunk=`${message.outbound?'Joe':message.fromName||'Sender'}: ${splitQuotedText(message.body).text.slice(0,1800)}`;
    if(used>=12000)break;
    if(message.id)sources.push({kind:'message',threadId,messageId:message.id,label:`Earlier message · ${message.outbound?'Joe':message.fromName||'Sender'}`});
    used+=chunk.length+2;
  }
  if(record)sources.push(record);
  return sources;
}
export function swipeIntent(dx:number,dy:number):'done'|'remind'|null {
  return Math.abs(dx)>=80&&Math.abs(dx)>Math.abs(dy)*1.8?(dx>0?'done':'remind'):null;
}
export function fileLossWarning(count:number):string {return count?`${count} file${count===1?'':'s'} will be lost. Leave this draft?`:'';}
export function sourceHref(source:DraftSource):string {
  return source.kind==='message'?`#inbox-message-${encodeURIComponent(source.messageId)}`:`/${source.kind==='project'?'projects':'leads'}/${encodeURIComponent(source.slug)}`;
}

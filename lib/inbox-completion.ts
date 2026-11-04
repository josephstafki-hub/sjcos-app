import type { ThreadChannel } from './types';
export type SentCompletion = {threadId:string;recipient:string;channel:ThreadChannel;sentAt:number;through:number};
type Store=Pick<Storage,'getItem'|'setItem'>;
export const completionKey=(mailbox:string)=>`sjc:inbox:completion:v1:${mailbox.toLowerCase()}`;
export function readCompletions(storage:Store,key:string):SentCompletion[]{
 try{const rows=JSON.parse(storage.getItem(key)??'[]');return Array.isArray(rows)?rows.filter(r=>r&&typeof r.threadId==='string'&&typeof r.recipient==='string'&&['email','sms','client_portal','sub_portal','site_form'].includes(r.channel)&&Number.isFinite(r.sentAt)&&Number.isFinite(r.through)):[];}catch{return [];}
}
export function saveCompletion(storage:Store,key:string,receipt:SentCompletion):void {
 try{storage.setItem(key,JSON.stringify([...readCompletions(storage,key).filter(r=>r.threadId!==receipt.threadId),receipt]));}catch{}
}
export function clearCompletion(storage:Store,key:string,threadId:string):void {
 try{storage.setItem(key,JSON.stringify(readCompletions(storage,key).filter(r=>r.threadId!==threadId)));}catch{}
}
/** Only a confirmed send creates a receipt; retries have no send callback. */
export async function retryCompletion(storage:Store,key:string,receipt:SentCompletion,done:(receipt:SentCompletion)=>Promise<{ok:boolean;error?:string}>) {
 let result;try{result=await done(receipt);}catch{result={ok:false,error:'Could not mark done.'};}
 if(result.ok)clearCompletion(storage,key,receipt.threadId);
 return result;
}

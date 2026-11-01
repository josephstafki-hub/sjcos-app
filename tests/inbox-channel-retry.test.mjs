import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
let parent, calls=[];
const stubs={
 'next/cache':'export const revalidatePath=()=>{};',
 '@/lib/dal':'export const requireAccess=async()=>({id:"owner",role:"owner"});',
 '@/lib/db':'export const query=async(sql,p)=>globalThis.__retryQuery(sql,p);',
 '@/lib/mailbox':'export const unlinkMailbox=()=>{};export const withMailboxFor=async(u,fn)=>fn();',
 '@/lib/gmail':'export const gmailConfigured=()=>false;export const sendReply=()=>{};export const sendNewEmail=()=>{};export const modifyThread=()=>{};export const trashThread=()=>{};export const fetchThreadHtml=()=>{};export const fetchMessageHtml=()=>{};export const fetchConversation=()=>{};export const findCorrespondence=()=>{};export const fetchInboxAttachment=()=>{};',
 '@/lib/inbox':'export const draftReplyForThread=()=>{};export const invalidateInboxCache=()=>{};export const loadMoreInbox=()=>{};export const loadLabelInbox=()=>{};export const loadSystemView=()=>{};',
 '@/lib/actions/sms':'export const sendSmsReply=async(...args)=>globalThis.__retrySend("sms",args);',
 '@/lib/actions/portal':'export const sendProjectMessage=async(...args)=>globalThis.__retrySend("portal",args);export const sendLeadPortalMessage=async(...args)=>globalThis.__retrySend("lead",args);',
 '@/lib/actions/chat':'export const sendChatMessage=async(...args)=>globalThis.__retrySend("sub",args);',
};
registerHooks({resolve(s,c,n){if(s in stubs)return {url:'retry:'+s,shortCircuit:true};if(s.startsWith('@/lib/'))return n(new URL('../lib/'+s.slice(6)+'.ts',import.meta.url).href,c);return n(s,c)},load(u,c,n){return u.startsWith('retry:')?{format:'module',source:stubs[u.slice(6)],shortCircuit:true}:n(u,c)}});
globalThis.__retryQuery=async(sql,p)=>{calls.push(['query',sql,p]);return {rows:sql.includes('SELECT body')?(parent?[parent]:[]):[{slug:'orchard'}]};};
globalThis.__retrySend=async(kind,args)=>{calls.push(['send',kind,args]);return {ok:true};};
const {sendChannelReplyAction}=await import('../lib/actions/inbox.ts');
test('retry validates the failed record and carries its exact persisted identity into the send path',async()=>{
 calls=[];parent={body:'The gate is ready.',status:'failed',media:[],replacement_id:null};
 assert.equal((await sendChannelReplyAction({threadId:'sms:82',body:parent.body,retryOfId:'903'})).ok,true);
 assert.deepEqual(calls.find(c=>c[0]==='send'),['send','sms',[82,parent.body,'903']]);
 assert.match(calls[0][1],/thread_id/);assert.deepEqual(calls[0][2],['903',82]);
});
test('reload, foreign parent, unconfirmed sends and media cannot trigger another text-only send',async()=>{
 for(const row of [null,{body:'Text',status:'sent'},{body:'Text',status:'unknown'},{body:'Text',status:'failed',replacement_id:'904'},{body:'Text',status:'failed',media:[{file_id:'photo'}]}]){
  calls=[];parent=row;
  assert.equal((await sendChannelReplyAction({threadId:'sms:82',body:'Text',retryOfId:'903'})).ok,false);
  assert.equal(calls.some(c=>c[0]==='send'),false);
 }
});
test('portal retry is bound to the channel and forwards the failed id to the unique insert',async()=>{
 calls=[];parent={body:'I can meet at noon.',status:'failed'};
 assert.equal((await sendChannelReplyAction({threadId:'portal:orchard',body:parent.body,retryOfId:'304'})).ok,true);
 assert.deepEqual(calls[0][2],['304','portal:orchard']);
 assert.equal(calls.find(c=>c[0]==='send')[2][2],'304');
});

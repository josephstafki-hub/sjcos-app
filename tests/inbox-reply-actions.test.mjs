import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const calls=[];
globalThis.__replyAction = { calls, queries:[], row:{email:'teresa@example.test',name:'Teresa',scope:'Kitchen'}, allowed:true };
const stubs = {
  'next/cache':'export const revalidatePath = () => {};',
  '@/lib/dal':`export const requireAccess = async area => { if (!globalThis.__replyAction.allowed) throw Error('Forbidden'); return {id:'owner',role:'owner'}; };`,
  '@/lib/db':`export const query = async (sql,p) => {globalThis.__replyAction.queries.push([sql,p]);return {rows:globalThis.__replyAction.row ? [globalThis.__replyAction.row] : []};};`,
  '@/lib/mailbox':`export const unlinkMailbox = async () => {}; export const withMailboxFor = async (u,fn) => fn();`,
  '@/lib/gmail':`export const gmailConfigured = () => true; export const sendReply = async o => globalThis.__replyAction.calls.push(['email',o]); export const sendNewEmail = async o => globalThis.__replyAction.calls.push(['new',o]); export const modifyThread=async()=>{}; export const trashThread=async()=>{}; export const fetchThreadHtml=async()=>''; export const fetchMessageHtml=async(t,m)=>t+':'+m;`,
  '@/lib/inbox':`export const draftReplyForThread=async()=>({}); export const invalidateInboxCache=()=>{}; export const loadMoreInbox=async()=>({}); export const loadLabelInbox=async()=>({}); export const loadSystemView=async()=>({});`,
  '@/lib/actions/sms':`export const sendSmsReply=async(...a)=>{globalThis.__replyAction.calls.push(['sms',...a]); return {ok:true};};`,
  '@/lib/actions/portal':`export const sendProjectMessage=async(s,f)=>globalThis.__replyAction.calls.push(['project',s,f.get('body')]); export const sendLeadPortalMessage=async(s,f)=>globalThis.__replyAction.calls.push(['lead',s,f.get('body')]);`,
  '@/lib/actions/chat':`export const sendChatMessage=async(...a)=>{globalThis.__replyAction.calls.push(['sub',...a]);return {ok:true};};`,
};
registerHooks({resolve(s,c,n){if(s in stubs)return {url:'stub:'+s,shortCircuit:true}; if(s==='@/lib/inbox-rules')return n(new URL('../lib/inbox-rules.ts',import.meta.url).href,c); if(s==='@/lib/types')return n(new URL('../lib/types.ts',import.meta.url).href,c); return n(s,c);},load(u,c,n){return u.startsWith('stub:')?{format:'module',source:stubs[u.slice(5)],shortCircuit:true}:n(u,c);}});
const actions=await import('../lib/actions/inbox.ts');
test('channel adapters call the SAME existing SMS, project, lead and sub actions',async()=>{
  calls.length=0;
  for(const id of ['sms:7','portal:henderson','portal:lead:chen','dm:builder']) assert.equal((await actions.sendChannelReplyAction({threadId:id,body:'Hello'})).ok,true);
  assert.deepEqual(calls,[['sms',7,'Hello'],['project','henderson','Hello'],['lead','chen','Hello'],['sub','dm:builder','Hello']]);
});
test('website reply looks up email server-side, sends a NEW thread through existing email action',async()=>{
  calls.length=0;
  assert.equal((await actions.sendChannelReplyAction({threadId:'siteform:teresa',body:'Thanks'})).ok,true);
  assert.deepEqual(calls,[['new',{to:'teresa@example.test',subject:'Re: Your inquiry — Kitchen',bodyText:'Thanks',attachments:undefined}]]);
  globalThis.__replyAction.row=null;
  assert.equal((await actions.sendChannelReplyAction({threadId:'siteform:gone',body:'Thanks'})).ok,false);
  globalThis.__replyAction.row={email:'teresa@example.test',name:'Teresa',scope:'Kitchen'};
});
test('empty, invalid and internal DM targets cannot send; inbox authorization is required',async()=>{
  calls.length=0;
  for(const id of ['dm:team:joe','dm:client:someone','sms:nope','portal:','unknown:foo']) assert.equal((await actions.sendChannelReplyAction({threadId:id,body:'Hello'})).ok,false,id);
  assert.equal((await actions.sendChannelReplyAction({threadId:'sms:7',body:' '})).ok,false);
  globalThis.__replyAction.allowed=false;
  await assert.rejects(()=>actions.sendChannelReplyAction({threadId:'sms:7',body:'Hello'}),/Forbidden/);
  globalThis.__replyAction.allowed=true;
  assert.equal(calls.length,0);
});
test('typed reply action preserves blank To for SERVER resolution and opt-in reply all',async()=>{
  calls.length=0;
  assert.equal((await actions.sendReplyAction({threadId:'abc',toEmail:'',body:'Yes',subject:'Plans',replyAll:true})).ok,true);
  assert.equal(calls[0][1].replyAll,true);
});
test('HTML action requests a specific message rather than always the last message',async()=>{
  assert.equal((await actions.getThreadHtmlAction('thread','earlier')).html,'thread:earlier');
});

test('directory links validate existing records and reuse thread_links for all four roles without sending',async()=>{
 calls.length=0;const queries=globalThis.__replyAction.queries;queries.length=0;
 for(const type of ['project','lead','sub','vendor'])assert.equal((await actions.linkThread('thread',type,'existing')).ok,true);
 const writes=queries.filter(([sql])=>sql.includes('INSERT INTO thread_links'));
 assert.deepEqual(writes.map(([,p])=>p),['project','lead','sub','vendor'].map(type=>['thread',type,'existing']));
 assert.equal(calls.length,0);
 globalThis.__replyAction.row=null;const before=queries.length;assert.equal((await actions.linkThread('thread','sub','missing')).ok,false);assert.equal(queries.length,before+1);
 globalThis.__replyAction.allowed=false;await assert.rejects(()=>actions.linkThread('thread','sub','existing'),/Forbidden/);assert.equal(queries.length,before+1);
 globalThis.__replyAction.allowed=true;globalThis.__replyAction.row={slug:'existing'};
});

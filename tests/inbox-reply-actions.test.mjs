import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const calls=[];
globalThis.__replyAction = { calls, queries:[], row:{email:'teresa@example.test',name:'Teresa',scope:'Kitchen'}, allowed:true };
const stubs = {
  '@/lib/inbox-autodraft':`export const draftAutoReply=async (candidate,model)=>{globalThis.__replyAction.calls.push(['regenerate',candidate.messageId,model]);return {body:'Fresh draft',toEmail:'client@example.test'};};`,
  'next/cache':'export const revalidatePath = () => {};',
  '@/lib/dal':`export const requireAccess = async area => { if (!globalThis.__replyAction.allowed) throw Error('Forbidden'); return {id:'owner',role:globalThis.__replyAction.role??'owner'}; };`,
  '@/lib/db':`export const query = async (sql,p) => {globalThis.__replyAction.queries.push([sql,p]);if(globalThis.__replyAction.failLink&&sql.includes('INSERT INTO thread_links'))throw Error('db offline');return {rows:globalThis.__replyAction.row ? [globalThis.__replyAction.row] : []};};`,
  '@/lib/mailbox':`export const unlinkMailbox = async () => {}; export const withMailboxFor = async (u,fn) => fn();`,
  '@/lib/gmail':`export const gmailConfigured = () => true; export const sendReply = async o => globalThis.__replyAction.calls.push(['email',o]); export const sendNewEmail = async o => {globalThis.__replyAction.calls.push(['new',o]);if(globalThis.__replyAction.failSend)throw Error('offline');return {threadId:'sent-thread'};}; export const findCorrespondence=async email=>{globalThis.__replyAction.calls.push(['search',email]);return [{id:'older',subject:'Email conversation'}];}; export const fetchConversation=async()=>({messages:[{id:'original',attachments:[{id:'plan',name:'plan.pdf',size:4,type:'application/pdf'}]}]}); export const fetchInboxAttachment=async()=>({name:'plan.pdf',type:'application/pdf',bytes:Buffer.from('plan')}); export const modifyThread=async(...args)=>globalThis.__replyAction.calls.push(['modify',...args]); export const trashThread=async()=>{}; export const fetchThreadHtml=async()=>''; export const fetchMessageHtml=async(t,m)=>{if(globalThis.__replyAction.failHtml)throw Error('offline');return globalThis.__replyAction.emptyHtml?'':t+':'+m;};`,
  '@/lib/inbox':`export const draftReplyForThread=async()=>({}); export const getInboxData=async()=>({threads:[{id:'claude-thread',channel:'email'}],readers:{'claude-thread':{messages:[{id:'latest',outbound:false}],replyTarget:{toEmail:'client@example.test'}}}}); export const invalidateInboxCache=()=>{}; export const loadMoreInbox=async()=>({}); export const loadLabelInbox=async()=>({}); export const loadSystemView=async()=>({});`,
  '@/lib/actions/sms':`export const sendSmsReply=async(...a)=>{globalThis.__replyAction.calls.push(['sms',...a]); return {ok:true};};`,
  '@/lib/actions/portal':`export const sendProjectMessage=async(s,f)=>globalThis.__replyAction.calls.push(['project',s,f.get('body')]); export const sendLeadPortalMessage=async(s,f)=>globalThis.__replyAction.calls.push(['lead',s,f.get('body')]);`,
  '@/lib/actions/chat':`export const sendChatMessage=async(...a)=>{globalThis.__replyAction.calls.push(['sub',...a]);return {ok:true};};`,
};
registerHooks({resolve(s,c,n){if(s in stubs)return {url:'stub:'+s,shortCircuit:true}; if(s==='@/lib/inbox-email-content')return n(new URL('../lib/inbox-email-content.ts',import.meta.url).href,c); if(s==='@/lib/inbox-files')return n(new URL('../lib/inbox-files.ts',import.meta.url).href,c); if(s==='@/lib/inbox-rules')return n(new URL('../lib/inbox-rules.ts',import.meta.url).href,c); if(s==='@/lib/types')return n(new URL('../lib/types.ts',import.meta.url).href,c); return n(s,c);},load(u,c,n){return u.startsWith('stub:')?{format:'module',source:stubs[u.slice(5)],shortCircuit:true}:n(u,c);}});
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

test('forward includes reviewed originals, uploads validate on the server, failed sends do not report success',async()=>{
 calls.length=0;const form=new FormData();form.append('files',new File(['image'],'photo.png',{type:'image/png'}));
 const input={to:'client@example.test',cc:'review@example.test',subject:'Forward',body:'Please review',files:form,forward:{threadId:'old',messageId:'original',attachmentIds:['plan']}};
 assert.equal((await actions.sendNewEmailAction(input)).ok,true);assert.deepEqual(calls[0][1].attachments.map(a=>a.filename),['photo.png','plan.pdf']);
 calls.length=0;assert.equal((await actions.sendNewEmailAction({...input,forward:{...input.forward,attachmentIds:[]}})).ok,true);assert.deepEqual(calls[0][1].attachments.map(a=>a.filename),['photo.png']);
 globalThis.__replyAction.failSend=true;assert.equal((await actions.sendNewEmailAction(input)).ok,false);assert.equal(form.get('files').name,'photo.png');globalThis.__replyAction.failSend=false;
 const bad=new FormData();bad.append('files',new File(['bad'],'run.exe'));calls.length=0;assert.equal((await actions.sendReplyAction({threadId:'t',body:'No',files:bad})).ok,false);assert.equal(calls.length,0);
 const huge=new FormData();huge.append('files',new File([new Uint8Array(20*1024*1024+1)],'plan.pdf',{type:'application/pdf'}));assert.match((await actions.sendNewEmailAction({...input,files:huge})).error,/20 MB/);assert.equal(calls.length,0);
});
test('successful form sends link the returned Gmail id only after send; failed sends never write a link',async()=>{
 globalThis.__replyAction.row={email:'teresa@example.test',name:'Teresa',scope:'Kitchen'};
 const queries=globalThis.__replyAction.queries;queries.length=0;
 const r=await actions.sendChannelReplyAction({threadId:'siteform:teresa',body:'Thanks'});assert.equal(r.threadId,'sent-thread');
 assert.ok(queries.some(([sql,p])=>sql.includes('INSERT INTO thread_links')&&p[0]==='sent-thread'&&p[1]==='teresa'));
 queries.length=0;globalThis.__replyAction.failSend=true;assert.equal((await actions.sendChannelReplyAction({threadId:'siteform:teresa',body:'No'})).ok,false);assert.equal(queries.some(([sql])=>sql.includes('INSERT INTO thread_links')),false);globalThis.__replyAction.failSend=false;
});

test('inquiry lookup uses a server-resolved address and requires access',async()=>{
 calls.length=0;globalThis.__replyAction.row={email:'alex@example.test'};
 const r=await actions.findInquiryConversationsAction('siteform:alex');assert.equal(r.ok,true);assert.deepEqual(calls,[['search','alex@example.test']]);assert.equal(r.conversations[0].id,'older');
 assert.equal((await actions.findInquiryConversationsAction('email:bad')).ok,false);
 globalThis.__replyAction.allowed=false;await assert.rejects(()=>actions.findInquiryConversationsAction('siteform:alex'),/Forbidden/);globalThis.__replyAction.allowed=true;
});

test('a sent form reply remains successful if linking fails, so Joe is never offered a resend',async()=>{
 globalThis.__replyAction.row={email:'alex@example.test',name:'Alex',scope:'Scope'};globalThis.__replyAction.failLink=true;
 const r=await actions.sendChannelReplyAction({threadId:'siteform:alex',body:'Hello'});assert.equal(r.ok,true);assert.match(r.warning,/Email sent.*Do not send again/);assert.equal(r.threadId,'sent-thread');globalThis.__replyAction.failLink=false;
});

test('Report spam uses the existing Gmail modify helper; Undo restores inbox, access stays required',async()=>{
 calls.length=0;
 assert.equal((await actions.setThreadSpamAction('thread',true)).ok,true);
 assert.equal((await actions.setThreadSpamAction('thread',false,true)).ok,true);
 assert.deepEqual(calls,[['modify','thread',{addLabelIds:['SPAM'],removeLabelIds:['INBOX']}],['modify','thread',{removeLabelIds:['SPAM'],addLabelIds:['INBOX']}] ]);
 calls.length=0;await actions.setThreadSpamAction('archived',false,false);assert.deepEqual(calls[0][2],{removeLabelIds:['SPAM']});
 globalThis.__replyAction.allowed=false;await assert.rejects(()=>actions.setThreadSpamAction('thread',true),/Forbidden/);globalThis.__replyAction.allowed=true;
});


test('Claude regeneration reuses the owner draft writer, retains model, and never sends',async()=>{
 calls.length=0;const result=await actions.draftReplyAction('claude-thread','claude');
 assert.equal(result.ok,true);assert.equal(result.model,'Claude');assert.deepEqual(calls,[['regenerate','latest','claude']]);
 globalThis.__replyAction.role='staff';calls.length=0;
 try{assert.equal((await actions.draftReplyAction('claude-thread','claude')).ok,false);assert.deepEqual(calls,[]);}finally{globalThis.__replyAction.role='owner';}
});
test('batch archive and undo use the existing mailbox helpers with Gmail fully stubbed',async()=>{
 const {completeMailBatch}=await import('../lib/inbox-review.ts');calls.length=0;
 const result=await completeMailBatch([{id:'a'},{id:'b'}],actions.archiveThreadAction);
 await completeMailBatch(result.completed,actions.restoreThreadToInboxAction);
 assert.deepEqual(calls,[['modify','a',{removeLabelIds:['INBOX']}],['modify','b',{removeLabelIds:['INBOX']}],['modify','a',{addLabelIds:['INBOX']}],['modify','b',{addLabelIds:['INBOX']}] ]);
});


test('HTML fetch failure never masquerades as a no-HTML part, and explicit retry can recover',async()=>{
 globalThis.__replyAction.failHtml=true;
 assert.equal((await actions.getThreadHtmlAction('new-notice','m1')).status,'failed');
 globalThis.__replyAction.failHtml=false;globalThis.__replyAction.emptyHtml=true;
 assert.deepEqual(await actions.getThreadHtmlAction('new-notice','m1'),{status:'text-only',html:''});
 globalThis.__replyAction.emptyHtml=false;
 assert.equal((await actions.getThreadHtmlAction('new-notice','m1')).status,'formatted');
});

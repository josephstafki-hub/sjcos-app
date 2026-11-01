import {draftTransport,draftActionStub,draftComponentUrls,draftResolve} from './helpers/inbox-draft-transport.mjs';
globalThis.__draftServer=draftTransport();
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
globalThis.__readerReact = React;
const componentUrl = new URL('../components/inbox/InboxClient.tsx',import.meta.url).href;
const source = readFileSync(new URL(componentUrl),'utf8');
registerHooks({
  resolve(s,c,n){
    if(s==='@/lib/actions/inbox-drafts')return {url:'stub:drafts',shortCircuit:true};
    const draft=draftResolve(s,c,n);if(draft)return draft;
    if(s==='@/components/ui/Toast')return {url:'stub:toast',shortCircuit:true};
    if(s==='@/lib/actions/inbox-screening')return {url:'stub:screen',shortCircuit:true};
    if(s==='./InboxPanels')return {url:'stub:panels',shortCircuit:true};
    if(s==='@/lib/actions/inbox-experience')return {url:'stub:experience-actions',shortCircuit:true};
    if(s==='@/lib/run-action')return {url:'stub:run',shortCircuit:true};
    if(s==='next/navigation')return {url:'stub:router',shortCircuit:true};
    if(s==='@/components/ui')return {url:'stub:ui',shortCircuit:true};
    if(s==='@/lib/actions/inbox')return {url:'stub:actions',shortCircuit:true};
    if(s.startsWith('@/'))return n(new URL('../'+s.slice(2)+(s.endsWith('.ts')?'':'.ts'),import.meta.url).href,c);
    return n(s,c);
  },
  load(u,c,n){
    if(draftComponentUrls.includes(u))return {format:'module',source:ts.transpileModule(readFileSync(new URL(u),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
    if(u===componentUrl)return {format:'module',source:ts.transpileModule(source+'\nexport {ReaderBody, ChannelReaderBody, ThreadRow};',{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
    const stubs={
      'stub:drafts':draftActionStub,
      'stub:toast':'export const toast=()=>1,dismissToast=()=>{};',
      'stub:screen':'export const setInboxPreferenceAction=async()=>({ok:true});',
      'stub:panels':'export const SenderScreening=()=>null;export const ContactCreateDialog=()=>null;export const ThreadSummary=()=>null;export const ContextPanel=()=>null;export const LinkPicker=()=>null;export const MessageTaskDialog=()=>null;export const ShortcutHelp=()=>null;',
      'stub:experience-actions':'export const inboxContextAction=async()=>null,undoChannelDoneAction=async()=>({ok:true});export const markChannelDoneAction=async()=>({ok:true});',
      'stub:run':'export const runAction=async fn=>fn();',
      'stub:router':'export const useRouter=()=>({refresh(){}});',
      'stub:ui':`const React=globalThis.__readerReact; export const Button=({children,icon,iconOnly,variant,size,...props})=>React.createElement('button',props,children); export const Avatar=()=>null; export const Chip=({children})=>React.createElement('span',{},children); export const VoiceButton=()=>null; export const PageHeader=()=>null; export const EmptyState=()=>null; export const Segmented=({options})=>React.createElement('div',{},options.map(o=>React.createElement('button',{key:o.value},o.label, ' ',o.count)));`,
      'stub:actions':source.match(/import \{([\s\S]*?)\} from "@\/lib\/actions\/inbox"/)[1].split('import {').at(-1).split(',').map(s=>s.trim()).filter(Boolean).map(name=>`export const ${name}=async()=>({ok:true,html:''});`).join('\n'),
    };
    return u in stubs?{format:'module',source:stubs[u],shortCircuit:true}:n(u,c);
  }
});
const {ReaderBody,ChannelReaderBody,ThreadRow,InboxClient}=await import(componentUrl);
const messages=[{id:'0',fromName:'Joe',initials:'JS',meta:'Earlier',date:500,to:'Tom',body:['Earlier outgoing message'],outbound:true},{id:'1',fromName:'Tom',fromEmail:'tom@example.test',initials:'TT',meta:'Yesterday',date:1000,to:'Joe',body:['Old message text'],outbound:false},{id:'2',fromName:'Joe',fromEmail:'joe@example.test',initials:'JS',meta:'Today',date:2000,to:'Tom',cc:['Ana <ana@example.test>'],body:['Latest message body'],outbound:true,attachments:[{id:'a',name:'plan.pdf',size:4096,type:'application/pdf'}]}];
const reader={channel:'email',messages,messageCount:3,subject:'Plans',aiDraft:{body:'',summary:''},replyPlaceholder:'Reply to Tom…',replyTarget:{toEmail:'tom@example.test',toName:'Tom',cc:['ana@example.test']}};
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
test('latest inbound opens above outbound-last reply, history is one disclosure and envelopes expand',()=>{
  const html=render(ReaderBody,{reader,threadId:'thread'});
  assert.match(html,/1 earlier message/); assert.match(html,/Expand all/);
  assert.match(html,/aria-expanded="true"/); assert.match(html,/Message details/);
  assert.match(html,/Old message text<\/p>/,'newest inbound is expanded');
  assert.doesNotMatch(html,/Latest message body<\/p>/,'newer outbound remains collapsed');
});
test('default composer is one reply/AI bar; recipient and reply-all are inspectable when expanded',()=>{
  const html=render(ReaderBody,{reader,threadId:'thread'});
  assert.match(html,/Reply to Tom…/); assert.match(html,/Draft with AI/);
  assert.doesNotMatch(html,/textarea|Reply all|Focus draft Send/);
  const expanded=render(ReaderBody,{reader:{...reader,aiDraft:{body:'Saved typed reply'}},threadId:'thread'});
  assert.match(expanded,/To:/); assert.match(expanded,/tom@example.test/);
  assert.match(expanded,/aria-label="Reply recipient"/); assert.match(expanded,/Reply all/);
  assert.doesNotMatch(expanded,/type="checkbox" checked/);
  const inboundLast={...reader,messages:[...messages,{...messages.at(-1),id:'3',outbound:false}]};
  assert.match(render(ReaderBody,{reader:inboundLast,threadId:'thread'}),/plan.pdf/);
});
test('automated mail has Done and no composer or AI draft button',()=>{
  const html=render(ReaderBody,{reader:{...reader,automated:true},threadId:'thread'});
  assert.match(html,/Automated message/); assert.match(html,/>Done</);
  assert.doesNotMatch(html,/Reply to Tom|Draft with|textarea/);
});
test('chat uses left/right bubbles with days, scrolls newest, and has the inline channel composer',()=>{
  const html=render(ChannelReaderBody,{reader:{...reader,channel:'sms',replyLabel:'Text from the SJC number (612) 555-1234'},threadId:'sms:1'});
  assert.match(html,/items-start/); assert.match(html,/items-end/); assert.match(html,/role="separator"/);
  assert.match(html,/Text from the SJC number/); assert.doesNotMatch(html,/textarea/); assert.match(html,/Write a reply…/); assert.match(html,/Draft with AI/); assert.match(html,/0 characters/);
  assert.match(source,/scrollTop\s*=\s*[^;]*scrollHeight/);
});
test('chat row shows a repeated subject/preview only once and a plain needs-me reason',()=>{
  const html=render(ThreadRow,{thread:{id:'sms:1',channel:'sms',subject:'Are we ready?',preview:'Are we ready?',fromName:'Tom',initials:'TT',when:'2h',tag:'SMS',view:'needs_reply',emphasis:'flag',needsMeReason:'Client replied · 2h'},selected:false,onSelect(){}});
  assert.equal(html.split('Are we ready?').length-1,1); assert.match(html,/Client replied/); assert.doesNotMatch(html,/AI:/);
});

test('paused email shows last-sync banner and unknown counts, never an empty-mailbox claim',()=>{
  const data={activeView:{key:'needs_reply',label:'Needs reply'},smartViews:[{key:'needs_reply',label:'Needs reply',dot:'flag',count:null}],channels:[{key:'email',label:'Email',count:null}],projects:[],labels:[{id:'l',name:'Work',count:null}],threads:[],readers:{},selectedId:'',mailbox:{connected:true,email:'joe@example.test'},emailPaused:true,lastSyncedAt:1000,loadError:'quota'};
  const html=render(InboxClient,{data,selfEmail:'joe@example.test'});
  assert.match(html,/Email paused · last synced/);assert.match(html,/Try again/);assert.match(html,/—/);assert.doesNotMatch(html,/Nothing in/);
  assert.match(html,/Work<\/span><span[^>]*>—/,'unknown label count is a dash, not silently missing');
});

test('chat scroll effect runs again when the phone reader becomes visible',()=>{
  // The preselected reader can mount while its section is hidden on a phone.
  assert.ok(/<ChannelReaderBody[^>]*visible=\{mobileReader\}/.test(source), "phone visibility reaches chat reader");
  assert.ok(/\[chat,\s*threadId,\s*reader.messages,\s*visible\]/.test(source), "chat scroll updates on phone open");
});

test('phase 2 uses counted split tabs, dense channel rows, no page title or native link select',()=>{
 const t={id:'t1',fromName:'Tom',channel:'email',subject:'Plans',preview:'Ready?',when:'2h',initials:'TT',view:'needs_reply',contactRole:'client',projectSlug:'kitchen',projectLabel:'Kitchen'};
 const data={activeView:{key:'needs_reply',label:'Needs me'},smartViews:[],channels:[],projects:[],labels:[],threads:[t],readers:{t1:reader},selectedId:'t1',mailbox:{connected:true,email:'joe@example.test'}};
 const html=render(InboxClient,{data,selfEmail:'joe@example.test'});
 for(const label of ['Needs me','Clients','Leads','Subs &amp; vendors','Other','Search inbox'])assert.ok(html.includes(label),label);
 assert.doesNotMatch(html,/inbox-link|<select|>Inbox<\/h1>/);
 assert.match(html,/data-thread-row/);assert.match(html,/min-h-16/);assert.match(html,/aria-label="Done: Tom"/);
 assert.match(source,/data-draft-send/);assert.match(source,/Your Send click approves this draft/);
 assert.match(source,/max-h-\[var\(--inbox-composer-max\)\]/);assert.match(source,/ContextPanel/);
});

test('website card has contact actions, formatted phone and exact outgoing subject before Send',()=>{
 const form={name:'Teresa',town:'Stillwater',phone:'9524656989',email:'teresa@example.test',outgoingSubject:'Re: Your inquiry — Basement'};
 const html=render(ChannelReaderBody,{reader:{...reader,channel:'site_form',form,messages:[{...messages[1],body:['Partial basement finish','Preferred contact\nemail']}]},threadId:'siteform:teresa'});
 for(const text of ['New website inquiry · Stillwater','tel:9524656989','sms:9524656989','mailto:teresa@example.test','(952) 465-6989','Subject: Re: Your inquiry — Basement']) assert.ok(html.includes(text),text);
 assert.match(html,/font-semibold[^>]*>Partial basement finish/);
});
test('saved tasks return to the reader and mark the row; unread names get their own line',()=>{
 const todo={id:'w1',title:'Send revised estimate',assignees:'Joe',due_at:'2026-11-06'};
 const html=render(ReaderBody,{reader,threadId:'thread',todos:[todo]});
 assert.match(html,/To-do: Send revised estimate/);assert.match(html,/Joe/);assert.match(html,/Fri/);assert.match(html,/engine\?work=w1/);
 const row=render(ThreadRow,{thread:{id:'1',fromName:'Michelle Alcantara',channel:'email',initials:'MA',when:'2h',view:'needs_reply',preview:'Please revise the closet estimate',needsMeReason:'Client replied',projectLabel:'Closet',unread:true,hasOpenTodo:true,todos:[todo]},onSelect(){}});
 assert.equal((row.match(/>2h</g) ?? []).length,1);assert.match(row,/Open to-do/);assert.match(row,/aria-label="Unread"/);assert.match(row,/Michelle Alcantara/);
});

test('plain-text attribution and quote fold together, compact rows expose ledger and task cues',()=>{
 const quoted={...reader,messages:[{...messages[1],body:['Please confirm.\nOn Wednesday, October 28, 2026,\nJoe <joe@example.test> wrote:\n> old request']}]};
 const html=render(ReaderBody,{reader:quoted,threadId:'quote'});
 assert.match(html,/Please confirm/);assert.match(html,/Show quoted text/);assert.doesNotMatch(html,/On Wednesday|old request/);
 const row=render(ThreadRow,{thread:{id:'balance',channel:'email',fromName:'Michelle',when:'2h',preview:'Please send photos',outstandingCents:225000,hasOpenTodo:true,todos:[{due_at:'2026-11-26T14:00:00Z'}]},onSelect(){}});
 assert.match(row,/\$2,250/);assert.match(row,/To-do · Scheduled · Nov 26/);assert.doesNotMatch(row,/pr-24/);
});

test('six visible Needs me rows do not show Load more even with a Gmail next-page token',()=>{
 const threads=Array.from({length:6},(_,i)=>({id:String(i),fromName:'Client '+i,channel:'email',view:'needs_reply',contactRole:'client',when:'2h',preview:'Please review'}));
 const data={activeView:{key:'needs_reply'},smartViews:[],channels:[],projects:[],labels:[],threads,readers:Object.fromEntries(threads.map(t=>[t.id,reader])),selectedId:'0',nextPageToken:'more-in-gmail',mailbox:{connected:true,email:'joe@example.test'}};
 assert.doesNotMatch(render(InboxClient,{data,selfEmail:'joe@example.test'}),/>Load more</);
});
test('screening rows expose one Screen control, job-wide tasks have their own cue, and hover controls replace trailing facts',()=>{
 const thread={id:'new',fromName:'Person',initials:'P',channel:'email',when:'2h',preview:'Can you quote this?',newSender:true,jobTodos:[{id:'1'},{id:'2'}]};
 const html=render(ThreadRow,{thread,onSelect(){},onScreen(){}});
 assert.match(html,/Screen…/);assert.doesNotMatch(html,/Add as|Link to existing/);assert.match(html,/2 job to-dos/);
 assert.match(html,/top-2 right-2/);assert.match(html,/group-hover:invisible/);
});


test('new sender renders screening instead of any reply or Send until Reply anyway',()=>{
 const html=render(ReaderBody,{reader:{...reader,aiDraft:{body:'Unreviewed saved text'}},threadId:'stranger',newSender:true,screening:React.createElement('div',{},'Screen this sender')});
 assert.match(html,/Screen this sender/);assert.match(html,/Reply options/);assert.match(html,/Reply anyway/);
 assert.doesNotMatch(html,/textarea|Draft with AI|Send email/);
});
test('SMS media uses only stored authorised file ids, with exact original message recovery',()=>{
 const sms={...messages[1],body:[''],media:[{file_id:'photo-1',mime:'image/jpeg',name:'Site photo',size:100}],originalHref:'/messages?thread=7#sms-message-71'};
 const html=render(ChannelReaderBody,{reader:{...reader,channel:'sms',messages:[sms]},threadId:'sms:7'});
 assert.match(html,/src="\/api\/files\/photo-1\?w=600"/);assert.match(html,/href="\/api\/files\/photo-1"/);assert.match(html,/href="\/messages\?thread=7#sms-message-71"/);assert.match(html,/Open original message/);assert.doesNotMatch(html,/No text or stored media/);
});

test('unseen job row reserves a separate legible job line, and done mail has no unread dot or bold name',()=>{
 const html=render(ThreadRow,{thread:{id:'terrace',fromName:'Avery Chen',initials:'AC',channel:'email',subject:'Railings',preview:'Please send two options',view:'done',unread:true,inboundLast:true,projectLabel:'Chen · Terrace',outstandingCents:123400,needsMeReason:'Client replied',when:'Yesterday'},onSelect(){}});
 assert.doesNotMatch(html,/aria-label="Unread"|font-bold|font-semibold text-ink"/);
 assert.match(html,/Chen · Terrace/);assert.match(html,/\$1,234/);
 assert.match(html,/data-row-job/);
});

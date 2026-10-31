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
    if(s==='@/lib/run-action')return {url:'stub:run',shortCircuit:true};
    if(s==='next/navigation')return {url:'stub:router',shortCircuit:true};
    if(s==='@/components/ui')return {url:'stub:ui',shortCircuit:true};
    if(s==='@/lib/actions/inbox')return {url:'stub:actions',shortCircuit:true};
    if(s.startsWith('@/'))return n(new URL('../'+s.slice(2)+(s.endsWith('.ts')?'':'.ts'),import.meta.url).href,c);
    return n(s,c);
  },
  load(u,c,n){
    if(u===componentUrl)return {format:'module',source:ts.transpileModule(source+'\nexport {ReaderBody, ChannelReaderBody, ThreadRow};',{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
    const stubs={
      'stub:run':'export const runAction=async fn=>fn();',
      'stub:router':'export const useRouter=()=>({refresh(){}});',
      'stub:ui':`const React=globalThis.__readerReact; export const Button=({children,onClick,disabled})=>React.createElement('button',{onClick,disabled},children); export const Avatar=()=>null; export const Chip=({children})=>React.createElement('span',{},children); export const VoiceButton=()=>null; export const PageHeader=()=>null; export const EmptyState=()=>null; export const Segmented=()=>null;`,
      'stub:actions':source.match(/import \{([\s\S]*?)\} from "@\/lib\/actions\/inbox"/)[1].split('import {').at(-1).split(',').map(s=>s.trim()).filter(Boolean).map(name=>`export const ${name}=async()=>({ok:true,html:''});`).join('\n'),
    };
    return u in stubs?{format:'module',source:stubs[u],shortCircuit:true}:n(u,c);
  }
});
const {ReaderBody,ChannelReaderBody,ThreadRow,InboxClient}=await import(componentUrl);
const messages=[{id:'1',fromName:'Tom',fromEmail:'tom@example.test',initials:'TT',meta:'Yesterday',date:1000,to:'Joe',body:['Old message text'],outbound:false},{id:'2',fromName:'Joe',fromEmail:'joe@example.test',initials:'JS',meta:'Today',date:2000,to:'Tom',cc:['Ana <ana@example.test>'],body:['Latest message body'],outbound:true,attachments:[{id:'a',name:'plan.pdf',size:4096,type:'application/pdf'}]}];
const reader={channel:'email',messages,messageCount:2,subject:'Plans',aiDraft:{body:'',summary:''},replyPlaceholder:'Reply to Tom…',replyTarget:{toEmail:'tom@example.test',toName:'Tom',cc:['ana@example.test']}};
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
test('email opens newest expanded, earlier 44px summary collapsed; displays identity, recipients and attachments',()=>{
  const html=render(ReaderBody,{reader,threadId:'thread'});
  assert.match(html,/Expand all/); assert.match(html,/h-11/); assert.match(html,/aria-expanded="false"/);
  assert.match(html,/Latest message body/); assert.doesNotMatch(html,/Old message text<\/p>/);
  assert.match(html,/plan.pdf/); assert.match(html,/application\/pdf/); assert.match(html,/ana@example.test/);
});
test('resolved To is visible and editable before typing; reply-all is opt-in',()=>{
  const html=render(ReaderBody,{reader,threadId:'thread'});
  assert.match(html,/To:/); assert.match(html,/tom@example.test/); assert.match(html,/aria-label="Reply recipient"/);
  assert.match(html,/Reply all/); assert.doesNotMatch(html,/type="checkbox" checked/);
});
test('automated mail has Done and no composer or AI draft button',()=>{
  const html=render(ReaderBody,{reader:{...reader,automated:true},threadId:'thread'});
  assert.match(html,/Automated message — no reply needed/); assert.match(html,/>Done</);
  assert.doesNotMatch(html,/Reply to Tom|Draft with|textarea/);
});
test('chat uses left/right bubbles with days, scrolls newest, and has the inline channel composer',()=>{
  const html=render(ChannelReaderBody,{reader:{...reader,channel:'sms',replyLabel:'Text from the SJC number (612) 555-1234'},threadId:'sms:1'});
  assert.match(html,/items-start/); assert.match(html,/items-end/); assert.match(html,/role="separator"/);
  assert.match(html,/Text from the SJC number/); assert.match(html,/textarea/); assert.match(html,/segment/);
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

import {draftTransport,draftActionStub,draftComponentUrls,draftResolve} from './helpers/inbox-draft-transport.mjs';
globalThis.__draftServer=draftTransport();
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
const url = new URL("../components/inbox/InboxClient.tsx", import.meta.url)
  .href;
const source = readFileSync(new URL(url), "utf8");
let states = [],
  cursor = 0,
  effects = [],
  pending = [],
  sends = [],
  draftCalls = [],
  cleanups = [];
const map = new Map();
const testWindow={localStorage:null,innerHeight:1000,setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){},dispatchEvent(){},matchMedia:()=>({matches:false})};
globalThis.window=testWindow;
globalThis.localStorage = {
  getItem: (k) => map.get(k) ?? null,
  setItem: (k, v) => map.set(k, v),
  removeItem: (k) => map.delete(k),
};
testWindow.localStorage=globalThis.localStorage;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.__draftHooks = {
  useState(initial) {
    const i = cursor++;
    if (!(i in states))
      states[i] = typeof initial === "function" ? initial() : initial;
    return [
      states[i],
      (value) => {
        states[i] = typeof value === "function" ? value(states[i]) : value;
      },
    ];
  },
  useRef(initial) {
    const i = cursor++;
    return states[i] ?? (states[i] = { current: initial });
  },
  useEffect(fn, deps) {
    const i = cursor++;
    if (!states[i] || !deps || deps.some((d, j) => d !== states[i][j])) {
      states[i] = deps;
      effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});
    }
  },
  useTransition() {
    return [false, (fn) => pending.push(Promise.resolve(fn()))];
  },
};
globalThis.__draftActions = {
  draft: async (...args) => {
    draftCalls.push(args);
    if(globalThis.__waitDraft)await globalThis.__waitDraft;
    return {
      ok: true,
      body: "Thanks, Tom.",
      toEmail: "tom@example.test",
      model: "Hermes",
    };
  },
  send: async (args) => {
    sends.push(args);
    return { ok: !globalThis.__sendFails, error: "Try again" };
  },
};
const actionNames = source
  .match(/import \{([\s\S]*?)\} from "@\/lib\/actions\/inbox"/)[1]
  .split("import {")
  .at(-1)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const stubs = {
  "@/lib/actions/inbox-drafts":draftActionStub,
  "@/components/ui/Toast":"export const toast=()=>1,dismissToast=()=>{};",
  "@/lib/actions/inbox-screening":"export const setInboxPreferenceAction=async()=>({ok:true});",
  react: `const h=globalThis.__draftHooks;export const useState=h.useState,useRef=h.useRef,useEffect=h.useEffect,useLayoutEffect=h.useEffect,useTransition=h.useTransition,useCallback=f=>f,useMemo=f=>f();`,
  "next/navigation": "export const useRouter=()=>({refresh(){}});",
  "@/components/ui": `export const Button=()=>null,Avatar=()=>null,Chip=()=>null,VoiceButton=()=>null,EmptyState=()=>null,Segmented=()=>null;`,
  "@/lib/actions/inbox": actionNames
    .map(
      (n) =>
        `export const ${n}=${n === "getThreadHtmlAction" ? "async()=>{if(globalThis.__htmlRequest)return globalThis.__htmlRequest();return {status:globalThis.__imageHtml?'formatted':'text-only',html:globalThis.__imageHtml??''};}" : n === "archiveThreadAction" ? "async(...args)=>globalThis.__archive(...args)" : n === "draftReplyAction" ? "globalThis.__draftActions.draft" : (n === "sendReplyAction" || n === "sendChannelReplyAction") ? "globalThis.__draftActions.send" : "async()=>({ok:true})"};`,
    )
    .join("\n"),
  "@/lib/actions/inbox-experience":
    "export const inboxContextAction=async()=>globalThis.__contextRequest?.(),undoChannelDoneAction=async()=>({ok:true});export const markChannelDoneAction=async()=>({ok:true});",
  "./InboxPanels":
    "export const SenderScreening=()=>null,ContactCreateDialog=()=>null,ThreadSummary=()=>null,ContextPanel=()=>null,LinkPicker=()=>null,MessageTaskDialog=()=>null,ShortcutHelp=()=>null;",
  "@/lib/run-action": "export const runAction=async fn=>fn();",
};
registerHooks({
  resolve(s, c, n) {
    if (s in stubs && (s !== "react" || c.parentURL === url || draftComponentUrls.includes(c.parentURL)))
      return { url: "stub:" + s, shortCircuit: true };
    const draft=draftResolve(s,c,n);if(draft)return draft;
    if (s.startsWith("@/"))
      return n(new URL("../" + s.slice(2) + ".ts", import.meta.url).href, c);
    return n(s, c);
  },
  load(u, c, n) {
    if(draftComponentUrls.includes(u))return {format:'module',source:ts.transpileModule(readFileSync(new URL(u),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
    if (u === url)
      return {
        format: "module",
        source: ts.transpileModule(source + "\nexport {ReaderBody,ChannelReaderBody,EmailMessageCard,ThreadRow,sendWithReceipt,DraftBody};", {
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
        shortCircuit: true,
      };
    return u.startsWith("stub:")
      ? { format: "module", source: stubs[u.slice(5)], shortCircuit: true }
      : n(u, c);
  },
});
const { ReaderBody, ChannelReaderBody, InboxClient, EmailMessageCard, ThreadRow, sendWithReceipt, DraftBody } = await import(url);
const reader = {
  channel:"email",
  messages: [{ id: "m1", fromEmail:"tom@example.test", body: ["Plans?"] }],
  subject: "Plans",
  replyTarget: { toEmail: "tom@example.test", toName: "Tom", cc: [] },
  replyPlaceholder: "Reply to Tom…",
  aiDraft: { body: "" },
};
let readerExtra={};
let tree,
  id = "t1",
  channel = null,
  clientData = null, cardData = null, bodyData=null, viewerOwner=false;
function render() {
  if(globalThis.window)Object.assign(window,{localStorage,setInterval:()=>1,clearInterval(){}});
  cursor = 0;
  if(bodyData){tree=DraftBody(bodyData);return;}
  if(cardData){tree=EmailMessageCard(cardData);return;}
  if(clientData){tree=InboxClient({data:clientData,selfEmail:"joe@example.test",owner:viewerOwner});return;}
  const Component=channel?ChannelReaderBody:ReaderBody;
  tree = Component({ ...readerExtra, reader:channel?{...reader,channel,replyLabel:"To (612) 555-1234"}:reader, threadId: id, mailbox: "joe@example.test", owner:viewerOwner, onSendDone:async()=>{globalThis.__doneCalls=(globalThis.__doneCalls??0)+1;return {ok:!globalThis.__doneFails,error:"offline"};} });
}
function flush() {
  for (let i = 0; i < 3; i++) {
    const work = effects;
    effects = [];
    work.forEach((fn) => fn());
    render();
  }
}
function mount(next) {
  globalThis.window={...testWindow,...globalThis.window};
  cleanups.forEach(fn=>fn?.());cleanups=[];
  globalThis.window??=testWindow;Object.assign(window,{localStorage,setInterval:()=>1,clearInterval(){}});
  states = [];
  effects = [];
  id = next;
  render();
  flush();
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function find(pred) {
  return nodes(tree).find(pred);
}
function click(text) {
  const n = find((n) => (n.props?.children === text || n.props?.["aria-label"] === text) && n.props?.onClick);
  assert.ok(n, text);
  n.props.onClick();
  render();
  flush();
}
async function settle() {
  for(let i=0;i<8;i++){await Promise.all(pending);pending=[];await Promise.resolve();render();flush();}
}
test("typed draft restores across conversation switches/reloads with edited recipient; discard clears it", async () => {
  mount("t1");
  click("Reply to Tom…");
  find((n) => n.props?.["aria-label"] === "Reply body").props.onChange({
    target: { value: "My typed reply" },
  });
  render();
  flush();
  find((n) => n.props?.["aria-label"] === "Reply recipient").props.onChange({
    target: { value: "ana@example.test" },
  });
  render();
  flush();
  mount("t2");
  assert.equal(
    find((n) => n.props?.["aria-label"] === "Reply body"),
    undefined,
  );
  mount("t1");
  assert.equal(
    find((n) => n.props?.["aria-label"] === "Reply body").props.value,
    "My typed reply",
  );
  assert.equal(
    find((n) => n.props?.["aria-label"] === "Reply recipient").props.value,
    "ana@example.test",
  );
  await settle();click("Discard");await settle();
  mount("t1");
  assert.equal(
    find((n) => n.props?.["aria-label"] === "Reply body"),
    undefined,
  );
});
test("intent creates an editable approval card but NEVER sends until the Send click; failure preserves draft", async () => {
  mount("t1");
  click("Reply to Tom…");
  click("Thanks");
  await settle();
  assert.equal(sends.length, 0);
  assert.deepEqual(draftCalls.at(-1), ["t1", "hermes", "Thanks"]);
  const editor = find((n) => n.props?.["aria-label"] === "AI draft body");
  assert.equal(editor.props.value, "Thanks, Tom.");
  editor.props.onChange({ target: { value: "Thanks, see you Monday." } });
  render();
  flush();
  mount("t2");
  mount("t1");
  assert.equal(
    find((n) => n.props?.["aria-label"] === "AI draft body").props.value,
    "Thanks, see you Monday.",
  );
  assert.equal(sends.length, 0);
  globalThis.__sendFails = true;
  find((n) => "data-draft-send" in (n.props ?? {})).props.onClick();
  await settle();
  assert.equal(sends.length, 1);
  assert.equal(sends[0].body, "Thanks, see you Monday.");
  assert.ok(map.size);
  globalThis.__sendFails = false;
  find((n) => "data-draft-send" in (n.props ?? {})).props.onClick();
  await settle();
  assert.equal(sends.length, 2);
  assert.equal(__draftServer.rows.get('t1:email').status,'sent');
});

test("empty reply collapses on blur, typing preserves it and default AI button still never sends", async () => {
  mount("blank");
  assert.equal(find(n => n.props?.["aria-label"] === "Reply body"),undefined);
  click("Reply to Tom…");
  const box=find(n => n.props?.onBlur);
  assert.ok(box);
  box.props.onBlur({currentTarget:{contains:()=>false},relatedTarget:null});
  render();flush();
  assert.equal(find(n => n.props?.["aria-label"] === "Reply body"),undefined);
  const before=sends.length;
  click("Draft with AI");
  await settle();
  assert.equal(sends.length,before);
  assert.equal(find(n => n.props?.["aria-label"] === "AI draft body").props.value,'Thanks, Tom.');
});


test('Send & Done keeps failed drafts; completion failure clears sent draft and retry only completes',async()=>{
 mount('send-done');click('Reply to Tom…');
 find(n=>n.props?.['aria-label']==='Reply body').props.onChange({target:{value:'Approved reply'}});render();flush();
 find(n=>n.props?.type==='file').props.onChange({target:{files:[new File(['photo'],'reply.png',{type:'image/png'})],value:'reply.png'}});render();flush();
 const before=sends.length;globalThis.__doneCalls=0;globalThis.__sendFails=true;
 click('Send & Done');await settle();assert.equal(sends.length,before+1);assert.equal(globalThis.__doneCalls,0);assert.ok(find(n=>n.props?.['aria-label']==='Remove reply.png'));assert.equal(find(n=>n.props?.['aria-label']==='Reply body').props.value,'Approved reply');
 globalThis.__sendFails=false;globalThis.__doneFails=true;
 click('Send & Done');await settle();assert.equal(sends.length,before+2);assert.equal(globalThis.__doneCalls,1);assert.equal(readDraftFor('send-done'),null);
 globalThis.__doneFails=false;click('Retry marking done');await settle();assert.equal(sends.length,before+2);assert.equal(globalThis.__doneCalls,2);
});
function readDraftFor(id){const row=__draftServer.rows.get(`${id}:${channel??'email'}`);return row?.status==='ready'&&row.body?row.body:null;}


test('generation never overwrites concurrent edits; explicit suggestion and restore retain both versions',async()=>{
 mount('conflict');click('Reply to Tom…');
 const edit=body=>{find(n=>n.props?.['aria-label']==='Reply body').props.onChange({target:{value:body}});render();flush();};
 edit('Before generation');
 let release;globalThis.__waitDraft=new Promise(resolve=>{release=resolve;});
 click('Draft with AI');edit('Joe edited during generation');
 release();globalThis.__waitDraft=null;await settle();
 assert.equal(find(n=>n.props?.['aria-label']==='Reply body').props.value,'Joe edited during generation');
 click('Keep mine');
 assert.equal(find(n=>n.props?.['aria-label']==='Reply body').props.value,'Joe edited during generation');
 globalThis.__waitDraft=new Promise(resolve=>{release=resolve;});
 click('Draft with AI');edit('Another edit');release();globalThis.__waitDraft=null;await settle();
 click('Use suggestion');
 assert.equal(find(n=>n.props?.['aria-label']==='AI draft body').props.value,'Thanks, Tom.');
 click('Restore previous');
 assert.equal(find(n=>n.props?.['aria-label']==='Reply body').props.value,'Another edit');
});
test('regenerate retains previous reviewed version; never sends',async()=>{
 mount('regenerate');click('Draft with AI');await settle();
 find(n=>n.props?.['aria-label']==='AI draft body').props.onChange({target:{value:'Reviewed original'}});render();flush();
 const count=sends.length;click('Regenerate');await settle();
 assert.equal(find(n=>n.props?.['aria-label']==='AI draft body').props.value,'Reviewed original');
 click('Use suggestion');
 assert.equal(find(n=>n.props?.['aria-label']==='AI draft body').props.value,'Thanks, Tom.');
 click('Restore previous');
 assert.equal(find(n=>n.props?.['aria-label']==='AI draft body').props.value,'Reviewed original');assert.equal(sends.length,count);
});


test('SMS, both portals and website forms share protected drafts and commit only after the channel Send click',async()=>{
 for(const kind of ['sms','client_portal','sub_portal','site_form']){
  channel=kind;mount(`channel-${kind}`);click('Write a reply…');
  const aria=kind==='sms'?'Text reply':'Reply';
  const edit=text=>{find(n=>n.props?.['aria-label']===aria).props.onChange({target:{value:text}});render();flush();};
  edit('Original channel reply');const before=sends.length;
  let release;globalThis.__waitDraft=new Promise(resolve=>{release=resolve;});click('Draft with AI');edit('Edited while AI runs');
  release();globalThis.__waitDraft=null;await settle();
  assert.equal(find(n=>n.props?.['aria-label']===aria).props.value,'Edited while AI runs');
  assert.equal(sends.length,before);click('Use suggestion');
  assert.equal(find(n=>n.props?.['aria-label']===aria).props.value,'Thanks, Tom.');
  click('Restore previous');assert.equal(find(n=>n.props?.['aria-label']===aria).props.value,'Edited while AI runs');
  const label=kind==='sms'?'Send text':kind==='client_portal'?'Post to client portal':kind==='sub_portal'?'Post to sub portal':'Send email';
  globalThis.__sendFails=true;click(label);await settle();assert.equal(find(n=>n.props?.['aria-label']===aria).props.value,'Edited while AI runs');
  globalThis.__sendFails=false;click(label);await settle();assert.equal(sends.length,before+2);assert.equal(sends.at(-1).body,'Edited while AI runs');
 }
 channel=null;
});
test('phone composer bounds itself to visual viewport height and moves above keyboard',()=>{
 globalThis.window={innerHeight:844,visualViewport:{height:400,offsetTop:0,addEventListener(){},removeEventListener(){}},matchMedia:()=>({matches:true}),dispatchEvent(){}};
 mount('phone');click('Reply to Tom…');
 const footer=find(n=>n.props?.['data-reply-active']);
 assert.equal(footer.props.style['--inbox-composer-max'],'180px');assert.equal(footer.props.style['--inbox-keyboard-inset'],'444px');
 delete globalThis.window;
});


test('plain Done retains the current split/search and offers Needs me when the pass ends; context retains cache and times out with retry',async()=>{
 const timers=new Map();let timerId=0;const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout,realFetch=globalThis.fetch;
 globalThis.fetch=async()=>{const data=globalThis.__contextRequest();return {ok:true,json:()=>data};};
 globalThis.setTimeout=fn=>{timers.set(++timerId,fn);return timerId;};globalThis.clearTimeout=id=>timers.delete(id);
 globalThis.window={dispatchEvent(){},addEventListener(){},removeEventListener(){}};globalThis.document={addEventListener(){},removeEventListener(){}};
 globalThis.__archive=async()=>({ok:true});
 let resolveContext;globalThis.__contextRequest=()=>new Promise(resolve=>{resolveContext=resolve;});
 const row=id=>({id,fromName:id,fromEmail:`${id}@example.test`,channel:'email',when:'2h',view:'needs_reply',contactRole:'client',inInbox:true});
 clientData={threads:[row('a'),row('b'),row('c')],readers:{a:reader,b:reader,c:reader},selectedId:'a',mailbox:{connected:true},smartViews:[],channels:[],labels:[],projects:[]};
 try{
  mount('root');
  const cached={person:{name:'Tom'},job:{name:'Closet'},todos:[]};resolveContext(cached);for(let i=0;i<4;i++)await Promise.resolve();render();flush();
  // Open context and refresh while retaining its last good result.
  find(n=>n.props?.title==='Open contact, job, money and to-dos').props.onClick();render();flush();
  let panel=find(n=>n.props?.initialData);assert.deepEqual(panel.props.initialData,cached);assert.equal(panel.props.docked,false,'phone strip opens the context sheet');assert.equal(find(n=>n.props?.['aria-label']==='Open person and job context').props['aria-expanded'],true);
  panel.props.onRetry();render();flush();panel=find(n=>n.props?.initialData);assert.deepEqual(panel.props.initialData,cached);
  for(const fn of timers.values())fn();render();flush();panel=find(n=>n.props?.initialData);assert.match(panel.props.loadError,/taking too long/);assert.ok(panel.props.onRetry);
  find(n=>n.props?.['aria-label']==='Inbox splits · loaded conversations'&&n.props?.onChange).props.onChange('clients');await settle();
  find(n=>n.props?.['aria-label']==='Search inbox').props.onChange({target:{value:'a@example.test'}});await settle();
  click('Done');await settle();
  assert.equal(find(n=>n.type===ReaderBody),undefined);
  assert.equal(find(n=>n.props?.['aria-label']==='Search inbox').props.value,'a@example.test');
  assert.ok(nodes(tree).some(n=>typeof n.props?.children==='string'&&n.props.children.includes('0 left in this pass')));
  click('Undo Done');await settle();assert.equal(find(n=>n.props?.['aria-label']==='Inbox splits · loaded conversations'&&n.props?.onChange).props.value,'clients');assert.equal(find(n=>n.props?.['aria-label']==='Search inbox').props.value,'a@example.test');assert.equal(find(n=>n.type===ReaderBody).props.threadId,'a');
 }finally{
  cleanups.forEach(fn=>fn?.());cleanups=[];clientData=null;globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;globalThis.fetch=realFetch;delete globalThis.window;delete globalThis.document;
 }
});

test('a draft written before AI generation stays mine until I explicitly use the suggestion',async()=>{
 mount('preexisting-human');click('Reply to Tom…');
 find(n=>n.props?.['aria-label']==='Reply body').props.onChange({target:{value:'Please keep this exact reply.'}});render();flush();
 const before=sends.length;click('Draft with AI');await settle();
 assert.equal(find(n=>n.props?.['aria-label']==='Reply body').props.value,'Please keep this exact reply.');
 assert.ok(find(n=>n.props?.children==='Compare'));assert.equal(sends.length,before);
 click('Use suggestion');assert.equal(find(n=>n.props?.['aria-label']==='AI draft body').props.value,'Thanks, Tom.');
 click('Restore previous');assert.equal(find(n=>n.props?.['aria-label']==='Reply body').props.value,'Please keep this exact reply.');
});

test('remote image consent is explicit and remembered per sender and mailbox without changing screening keys',async()=>{
 globalThis.__imageHtml='<p>Delivery</p><img src="https://tracker.example.test/pixel">';
 const base={threadId:'images',expanded:true,onToggle(){},blockImages:true,mailbox:'joe@example.test'};
 const open=async(email,mailbox='joe@example.test')=>{cardData={...base,mailbox,message:{id:email,fromEmail:email,fromName:email,body:[],initials:'P'}};mount('images');await settle();click('Formatted');};
 const formatted=()=>find(n=>typeof n.type==='function'&&n.type.name==='EmailHtml').props.html;
 try {
  await open('unknown@example.test');assert.doesNotMatch(formatted(),/src="https:/);assert.ok(find(n=>n.props?.children==='Show images'));
  const prior=new Set(map.keys());click('Show images');assert.match(formatted(),/src="https:/);
  const keys=[...map.keys()].filter(k=>!prior.has(k));assert.deepEqual(keys,['sjc:inbox:images:v1:joe@example.test:unknown@example.test']);
  await open('unknown@example.test');assert.match(formatted(),/src="https:/);
  await open('different@example.test');assert.doesNotMatch(formatted(),/src="https:/);
  await open('unknown@example.test','staff@example.test');assert.doesNotMatch(formatted(),/src="https:/);
 }finally{cardData=null;delete globalThis.__imageHtml;}
});

test('confirmation clears the draft and records recipient before completion resolves; a retry never resends',async()=>{
 const {readCompletions,completionKey}=await import('../lib/inbox-completion.ts');
 const key=completionKey('receipt@example.test');let confirmed=false,sent=0,finish,doneCount=0;
 const result=sendWithReceipt('receipt@example.test','receipt-thread',{...reader,channel:'email'},'tom@example.test',async()=>{sent++;return {ok:true}},()=>{doneCount++;return new Promise(resolve=>finish=resolve)},()=>{confirmed=true});
 for(let i=0;i<5;i++)await Promise.resolve();assert.equal(confirmed,true);assert.equal(readCompletions(localStorage,key)[0].recipient,'tom@example.test');
 finish({ok:false});const pendingResult=await result;assert.equal(pendingResult.sent,true);assert.equal(readCompletions(localStorage,key).length,1);
 const retry=pendingResult.retry();for(let i=0;i<3;i++)await Promise.resolve();finish({ok:true});await retry;
 assert.equal(readCompletions(localStorage,key).length,0);assert.equal(sent,1);assert.equal(doneCount,2);
});

test('failed SMS Retry uses the existing channel send path on click and preserves the composer draft',async()=>{
 channel='sms';sends=[];const prior=reader.messages;
 reader.messages=[{id:'failed-1',fromName:'Joe',outbound:true,body:['Retry this exact message'],deliveryState:'failed',deliveryError:'Carrier rejected'}];
 try{
  mount('retry-sms');assert.equal(sends.length,0);click('Write a reply…');
  find(n=>n.props?.['aria-label']==='Text reply').props.onChange({target:{value:'Unsent newer reply'}});render();flush();
  click('Retry');await settle();assert.equal(sends.length,1);assert.equal(sends[0].body,'Retry this exact message');
  assert.equal(find(n=>n.props?.children==='Retry').props.disabled,true);
  assert.equal(find(n=>n.props?.['aria-label']==='Text reply').props.value,'Unsent newer reply');
 }finally{reader.messages=prior;channel=null;}
});


test('email and channel Send controls live outside the scrolling composer contents',()=>{
 for(const kind of [null,'sms']){
  channel=kind;mount(`pinned-${kind}`);click(kind?'Write a reply…':'Reply to Tom…');
  const scrolling=nodes(tree).filter(n=>n.props?.className?.includes('max-sm:overflow-y-auto'));
  assert.ok(scrolling.length);
  for(const region of scrolling)assert.equal(nodes(region).some(n=>n.props?.children==='Send & Done'||n.props?.['aria-label']==='Send text'),false);
  assert.ok(find(n=>n.props?.children==='Send & Done'));
 }
 channel=null;
});

const autoSuggestion=(threadKey,patch={})=>({id:'11111111-1111-1111-1111-111111111111',threadKey,channel:'email',source:'ai',sourceMessageId:'m1',status:'ready',version:1,toEmail:'tom@example.test',cc:[],subject:'Plans',body:'Automatic draft for review',model:'claude',basedOn:'The latest email and job notes',summary:'Confirm the visit',...patch});
const footer=()=>{const node=find(n=>typeof n.type==='function'&&n.type.name==='DraftSyncFooter');return {saved:node.props.saved,nodes:nodes(node.type(node.props))};};

test('ready automatic suggestion opens an editable approval card without saving or sending until approval',async()=>{
 viewerOwner=true;__draftServer.suggestions=[autoSuggestion('arrival')];const before=sends.length;
 try{
  mount('arrival');await settle();
  assert.equal(find(n=>n.props?.['aria-label']==='AI draft body').props.value,'Automatic draft for review');
  assert.ok(find(n=>n.props?.title==='Based on: The latest email and job notes'));
  assert.equal(sends.length,before);assert.equal(__draftServer.rows.has('arrival:email'),false);
  click('Send email');await settle();assert.equal(sends.length,before+1);
  assert.equal(__draftServer.calls.findLast(([type])=>type==='sent')[1].suggestionId,'11111111-1111-1111-1111-111111111111');
 }finally{viewerOwner=false;__draftServer.suggestions=[];}
});
test('automatic suggestion never replaces human text; Dismiss retires only the suggestion; staff see none',async()=>{
 viewerOwner=true;const key='human-arrival';__draftServer.suggestions=[autoSuggestion(key)];
 __draftServer.rows.set(`${key}:email`,{...autoSuggestion(key),source:'human',model:null,basedOn:'',body:'My exact words',version:3});
 try{
  mount(key);await settle();assert.equal(find(n=>n.props?.['aria-label']==='Reply body').props.value,'My exact words');
  assert.ok(find(n=>[n.props?.children].flat().join('')==='Claude drafted a reply'));assert.ok(find(n=>n.props?.children==='Compare'));
  click('Dismiss');await settle();assert.equal(__draftServer.suggestions.length,0);assert.equal(find(n=>n.props?.['aria-label']==='Reply body').props.value,'My exact words');
  viewerOwner=false;__draftServer.suggestions=[autoSuggestion('staff-arrival')];mount('staff-arrival');await settle();
  assert.equal(find(n=>n.props?.['aria-label']==='AI draft body'),undefined);assert.equal(find(n=>[n.props?.children].flat().join('')==='Claude drafted a reply'),undefined);
 }finally{viewerOwner=false;__draftServer.suggestions=[];}
});
test('every reply channel exposes sync status, conflict choices and sends only the version saved',async()=>{
 for(const kind of [null,'sms','client_portal','sub_portal','site_form']){
  channel=kind;const key=`sync-${kind}`;mount(key);await settle();click(kind?'Write a reply…':'Reply to Tom…');
  const label=kind?(kind==='sms'?'Text reply':'Reply'):'Reply body';
  find(n=>n.props?.['aria-label']===label).props.onChange({target:{value:'Mine'}});render();flush();
  const saved=footer().saved;
  assert.ok(footer().nodes.some(n=>n.props?.children==='Saving…'));
  const their={...autoSuggestion(key),source:'human',model:null,basedOn:'',channel:kind??'email',body:'Theirs',version:7};__draftServer.rows.set(`${key}:${kind??'email'}`,their);
  await saved.synced.refresh();await settle();assert.ok(footer().nodes.some(n=>n.props?.children==='This draft changed on another device'));
  assert.equal(find(n=>n.props?.['aria-label']===label).props.value,'Mine');
  const before=sends.length;click('Send & Done');await settle();assert.equal(sends.length,before);
  footer().nodes.find(n=>n.props?.children==='Use theirs').props.onClick();render();flush();
  assert.equal(find(n=>n.props?.['aria-label']===label).props.value,'Theirs');
  assert.ok(footer().nodes.some(n=>n.props?.children==='Saved'));
  click('Send & Done');await settle();assert.equal(sends.length,before+1);
  assert.equal(__draftServer.calls.findLast(([type])=>type==='sent')[1].baseVersion,7);
 }
 channel=null;
});
test('a successful send with failed draft cleanup displays a sent warning and never resends',async()=>{
 mount('cleanup-failure');await settle();click('Reply to Tom…');
 find(n=>n.props?.['aria-label']==='Reply body').props.onChange({target:{value:'Only send once'}});render();flush();
 const before=sends.length;__draftServer.cleanupFails=true;
 try{click('Send email');await settle();assert.equal(sends.length,before+1);assert.ok(find(n=>typeof n.props?.children==='string'&&n.props.children.includes('Sent. Could not clear')));assert.equal(find(n=>n.props?.children==='Send email').props.disabled,true);}
 finally{__draftServer.cleanupFails=false;}
});
test('list loads suggestions once in a batch for the window and reuses it on rerender',async()=>{
 __draftServer.calls.length=0;viewerOwner=true;
 const row=id=>({id,channel:'email',fromName:id,subject:'Plans',preview:'Plans?',when:'Today',view:'needs_reply',inInbox:true});
 clientData={threads:[row('batch-a'),row('batch-b')],readers:{'batch-a':reader,'batch-b':reader},selectedId:'batch-a',mailbox:{connected:true},smartViews:[],channels:[],labels:[],projects:[]};
 const previousFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>null});globalThis.document={addEventListener(){},removeEventListener(){}};
 try{mount('batch');await settle();render();flush();assert.deepEqual(__draftServer.calls.filter(([type])=>type==='load'),[['load',['batch-a','batch-b']]]);}
 finally{cleanups.forEach(f=>f?.());cleanups=[];clientData=null;viewerOwner=false;globalThis.fetch=previousFetch;delete globalThis.document;}
});

test('offline footer stays honest, Keep mine explicitly rebases without losing text',async()=>{
 mount('offline-footer');await settle();click('Reply to Tom…');
 find(n=>n.props?.['aria-label']==='Reply body').props.onChange({target:{value:'Offline words'}});render();flush();
 __draftServer.offline=true;
 try{await footer().saved.synced.flush();await settle();assert.ok(footer().nodes.some(n=>n.props?.children==='Saved on this device only'));}
 finally{__draftServer.offline=false;}
 __draftServer.rows.set('offline-footer:email',{...autoSuggestion('offline-footer'),source:'human',body:'Remote words',version:2});
 await footer().saved.synced.refresh();await settle();assert.equal(footer().saved.synced.status,'conflict');
 footer().nodes.find(n=>n.props?.children==='Keep mine').props.onClick();render();flush();await footer().saved.synced.flush();await settle();
 assert.equal(__draftServer.rows.get('offline-footer:email').body,'Offline words');assert.equal(footer().saved.synced.status,'saved');
});

test('accepted automatic suggestion retains its exact id across reload for send cleanup',async()=>{
 viewerOwner=true;__draftServer.suggestions=[autoSuggestion('accepted-reload')];
 try{
  mount('accepted-reload');await settle();find(n=>n.props?.['aria-label']==='AI draft body').props.onChange({target:{value:'Edited automatic draft'}});render();flush();await settle();
  mount('accepted-reload');await settle();click('Send email');await settle();
  assert.equal(__draftServer.calls.findLast(([type])=>type==='sent')[1].suggestionId,'11111111-1111-1111-1111-111111111111');
 }finally{viewerOwner=false;__draftServer.suggestions=[];}
});


test('full draft review pins the incoming ask, opens source on one click and retains Claude on regenerate',async()=>{
 const prior=reader.messages;viewerOwner=true;reader.messages=[{...prior[0],body:['Hi Builder,\n\nPlease add hallway painting to the estimate. Could you include popcorn removal?\n\nThanks,\nCasey']}];
 __draftServer.suggestions=[autoSuggestion('review-focus')];const sendsBefore=sends.length;
 try{
  mount('review-focus');await settle();
  assert.match(find(n=>n.type?.name==='RequestExcerpt').props.text,/hallway painting/);
  assert.ok(find(n=>String(n.props?.children).includes('joe@example.test')));
  click('Expand review');assert.ok(find(n=>n.props?.className?.includes('absolute inset-0 z-[65]')));
  click('Request · Sources');click('Read full message');assert.equal(find(n=>n.props?.hidden===false&&n.props?.className?.includes('max-h-[40%]')).props.hidden,false);
  click('Regenerate');await settle();assert.equal(draftCalls.at(-1)[1],'claude');assert.equal(sends.length,sendsBefore);
 }finally{viewerOwner=false;reader.messages=prior;__draftServer.suggestions=[];}
});
test('new sender composer opens only after Reply anyway, with no hidden draft Send action',()=>{
 readerExtra={newSender:true,screening:'Screen sender'};
 try{
  mount('screen-first');assert.ok(find(n=>n.props?.['data-screen-first']!==undefined));
  assert.equal(find(n=>n.props?.children==='Draft with AI'),undefined);assert.equal(find(n=>n.props?.children==='Send email'),undefined);
  click('Reply anyway');assert.ok(find(n=>n.props?.['aria-label']==='Reply body'));
 }finally{readerExtra={};}
});

test('unseen mail review keeps recipient and Expand above body, one Close, tools pinned, and source replaces excerpt',async()=>{
 const prior={messages:reader.messages,replyTarget:reader.replyTarget};viewerOwner=true;
 reader.messages=[{id:'m1',fromName:'Avery Chen',body:['Could you send two railing options for the terrace?']}];
 reader.replyTarget={toName:'Avery Chen',toEmail:'avery@example.test',cc:[]};
 __draftServer.suggestions=[{...autoSuggestion('terrace-review'),toEmail:'avery@example.test',body:'I will send both railing options tomorrow.\n\nBuilder'}];
 try{
  mount('terrace-review');await settle();
  const summary=find(n=>n.type==='summary'&&n.props?.title==='To avery@example.test');assert.ok(summary);
  assert.ok(nodes(summary).some(n=>[n.props?.children].flat().includes('Avery Chen')));
  assert.equal(summary.props.title,'To avery@example.test','full recipient stays inspectable in the compact header');
  const expand=find(n=>n.props?.['aria-label']==='Expand review');assert.ok(expand);
  const tools=find(n=>n.props?.['data-draft-tools']!==undefined);assert.match(nodes(tools).find(n=>n.props?.className?.includes('flex-nowrap')).props.className,/flex-nowrap/);
  click('Expand review');assert.equal(nodes(tree).filter(n=>n.props?.children==='Close review').length,1);
  assert.equal(find(n=>n.type?.name==='RequestExcerpt'),undefined);
  assert.equal(find(n=>n.props?.['data-draft-sources']!==undefined),undefined);
  assert.equal(find(n=>n.props?.['aria-label']==='Regenerate reply intent'),undefined);
  click('Request · Sources');
  assert.equal(find(n=>n.type?.name==='RequestExcerpt').props.compact,true);
  assert.ok(find(n=>n.props?.['data-draft-sources']!==undefined));
  const body=find(n=>n.props?.['aria-label']==='AI draft body');assert.equal(body.props.expanded,true);
  click('Read full message');assert.equal(find(n=>n.type?.name==='RequestExcerpt'),undefined);
  assert.equal(find(n=>n.props?.['aria-label']==='AI draft body').props.value,'I will send both railing options tomorrow.\n\nBuilder');
 }finally{viewerOwner=false;reader.messages=prior.messages;reader.replyTarget=prior.replyTarget;__draftServer.suggestions=[];}
});

test('unseen cross-device draft restores provenance without local metadata and conflict compares actual envelopes and text',async()=>{
 const key='gate-handoff';viewerOwner=true;
 __draftServer.rows.set(`${key}:email`,{...autoSuggestion(key),source:'human',model:'hermes',body:'Please choose a gate finish',basedOn:'Gate request and specification',acceptedSuggestionId:'22222222-2222-4222-8222-222222222222',humanEdited:true,version:2});
 try{
  map.clear();mount(key);await settle();assert.equal(find(n=>n.props?.['aria-label']==='AI draft body').props.value,'Please choose a gate finish');
  assert.equal(footer().saved.value.model,'Hermes');assert.equal(footer().saved.value.basedOn,'Gate request and specification');assert.equal(footer().saved.accepted.id,'22222222-2222-4222-8222-222222222222');
  find(n=>n.props?.['aria-label']==='AI draft body').props.onChange({target:{value:'My gate answer'}});render();flush();
  __draftServer.rows.set(`${key}:email`,{...__draftServer.rows.get(`${key}:email`),body:'Their gate answer',toEmail:'inspector@example.test',version:3});
  await footer().saved.synced.refresh();await settle();
  const compare=footer().nodes.find(n=>n.props?.['aria-label']==='Compare draft versions');assert.ok(compare);
  assert.ok(nodes(compare).some(n=>n.props?.children==='My gate answer'));assert.ok(nodes(compare).some(n=>n.props?.children==='Their gate answer'));
  assert.ok(nodes(compare).some(n=>[n.props?.children].flat().includes('inspector@example.test')));
 }finally{viewerOwner=false;}
});

test('unseen legacy human draft can change recipient and send without a false provenance conflict',async()=>{
 const key='legacy-gate-recipient';viewerOwner=false;
 __draftServer.rows.set(`${key}:email`,{...autoSuggestion(key),source:'human',model:null,basedOn:'',body:'Please review the gate options',version:1});
 mount(key);await settle();find(n=>n.props?.['aria-label']==='Reply recipient').props.onChange({target:{value:'inspector@example.test'}});render();flush();
 await footer().saved.synced.flush();await settle();const before=sends.length;click('Send email');await settle();assert.equal(sends.length,before+1);assert.equal(sends.at(-1).toEmail,'inspector@example.test');
});

test('unseen Other view scopes the archive label and hides it at zero, with sent-only mail excluded',async()=>{
 const previousFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>null});globalThis.document={addEventListener(){},removeEventListener(){}};
 const automated={id:'tool-reservation',channel:'email',fromName:'Tool Library',subject:'Tool reservation',preview:'Ready for pickup',when:'Earlier',view:'done',inInbox:true,inboundLast:true,automated:true,receivedAt:Date.now()-3*86400000};
 try{
  for(const inInbox of [true,false]){
   clientData={threads:[{...automated,inInbox},{...automated,id:'owner-sent',inboundLast:false}],readers:{},selectedId:'tool-reservation',mailbox:{connected:true},smartViews:[],channels:[],labels:[],projects:[]};
   mount('other-scope');await settle();find(n=>n.props?.['aria-label']==='Inbox splits · loaded conversations').props.onChange('other');await settle();
   const batch=find(n=>[n.props?.children].flat().join('')==='Archive older automated mail (1)');assert.equal(Boolean(batch),inInbox);
   assert.equal(find(n=>n.type?.name==='ThreadRow'&&n.props.thread.id==='owner-sent'),undefined);
  }
 }finally{cleanups.forEach(f=>f?.());cleanups=[];clientData=null;globalThis.fetch=previousFetch;delete globalThis.document;}
});


test('unseen rich reader defaults to formatted, exposes failures and allows only two deliberate retries',async()=>{
 let calls=0;
 const base={threadId:'comparison-notice',expanded:true,onToggle(){},blockImages:true,mailbox:'owner@example.test',message:{id:'comparison-1',fromEmail:'notice@example.test',fromName:'Notice',body:['Terms &mdash; choose &ldquo;plan B&rdquo;. [image: logo]'],initials:'N'}};
 try {
  let finish;globalThis.__htmlRequest=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  cardData=base;mount('comparison-notice');assert.ok(find(n=>n.props?.children==='Loading formatted email… Text preview below.'));assert.equal(calls,1);
  finish({status:'failed',html:'',error:'Could not load formatted email. Showing text below.'});await settle();
  const retry=()=>find(n=>Array.isArray(n.props?.children)&&n.props.children[0]==='Retry formatted email (');
  assert.ok(retry());
  globalThis.__htmlRequest=async()=>{calls++;return {status:'failed',html:'',error:'Could not load formatted email. Showing text below.'};};
  retry().props.onClick();render();flush();await settle();assert.equal(calls,2);
  retry().props.onClick();render();flush();await settle();assert.equal(calls,3);assert.equal(retry(),undefined);
  assert.ok(find(n=>n.props?.children==='Retry limit reached. Reopen the conversation later to try again.'));
  const html='<p>Options</p><table><tr><th>Old</th><th>New</th><th>Difference</th></tr><tr><td>700</td><td>600</td><td>100</td></tr></table>';
  globalThis.__htmlRequest=async()=>({status:'formatted',html});mount('comparison-notice');await settle();
  assert.equal(find(n=>n.props?.children==='Formatted').props['aria-pressed'],true);
  assert.equal(find(n=>typeof n.type==='function'&&n.type.name==='EmailHtml').props.html.includes('<table>'),true);
  click('Readable');assert.match(find(n=>typeof n.type==='function'&&n.type.name==='EmailHtml').props.html,/<th scope="col"/);
  globalThis.__htmlRequest=async()=>({status:'text-only',html:''});mount('comparison-notice');await settle();
  assert.ok(find(n=>n.props?.children==='Text-only email · no HTML part'));assert.equal(retry(),undefined);
 } finally {cleanups.forEach(fn=>fn?.());cleanups=[];cardData=null;delete globalThis.__htmlRequest;}
});

test('unseen approval card discloses actual saved inputs separately from its recipients',async()=>{
 viewerOwner=true;__draftServer.suggestions=[autoSuggestion('courtyard-sources',{basedOn:'Based on: project Pine courtyard, 2 earlier messages'})];
 try {
  mount('courtyard-sources');await settle();
  const disclosure=find(n=>n.props?.['data-draft-sources']!==undefined);assert.ok(disclosure);
  assert.deepEqual(nodes(disclosure).filter(n=>n.type==='li').map(n=>n.props.children),['Latest message when drafted','2 earlier messages','project Pine courtyard']);
  const recipient=find(n=>n.type==='summary'&&n.props.title==='To tom@example.test');assert.ok(recipient);
  assert.ok(!nodes(recipient).includes(disclosure));
  const card=find(n=>n.props?.['data-draft-card']!==undefined);assert.doesNotMatch(card.props.className,/mt-auto/,'spare space follows the card');
 }finally{viewerOwner=false;__draftServer.suggestions=[];}
});

test('unseen row touch gestures invoke Done or tomorrow, cancel vertical scrolling, and suppress the following click',()=>{
 cleanups.forEach(f=>f?.());cleanups=[];states=[];cursor=0;effects=[];
 let done=0,tomorrow=0,opened=0;
 const row=ThreadRow({thread:{id:'gate-arrival',channel:'sms',fromName:'Riley',subject:'The gate hardware is ready',view:'needs_reply'},onDone:()=>done++,onTomorrow:()=>tomorrow++,onSelect:()=>opened++});
 const button=nodes(row).find(n=>n.props?.['data-thread-row']);
 const start=(x,y)=>button.props.onTouchStart({touches:[{clientX:x,clientY:y}]});
 const end=(x,y)=>button.props.onTouchEnd({changedTouches:[{clientX:x,clientY:y}]});
 start(0,0);end(100,10);assert.equal(done,1);button.props.onClick({preventDefault(){}});assert.equal(opened,0);
 start(100,0);end(0,10);assert.equal(tomorrow,1);
 start(0,0);button.props.onTouchMove({touches:[{clientX:40,clientY:100}]});end(100,120);assert.equal(done,1);assert.equal(tomorrow,1);
 start(0,0);button.props.onTouchCancel();end(100,0);assert.equal(done,1);
});

test('unseen exact sources open a message or record while preserving the draft and its sync provenance',async()=>{
 viewerOwner=true;const key='garden-evidence';
 const sources=[{kind:'message',threadId:key,messageId:'m1',label:'Inbound message'},{kind:'message',threadId:key,messageId:'older-garden',label:'Earlier message · Riley'},{kind:'lead',slug:'garden-gate',label:'Garden gate'}];
 __draftServer.suggestions=[autoSuggestion(key,{basedOn:'Based on: lead Garden gate, 1 earlier message',sources})];
 const previousDocument=globalThis.document;let opened='';globalThis.document={getElementById:id=>({closest:()=>({open:false}),scrollIntoView:()=>{opened=id;}})};
 try{
  mount(key);await settle();const original=find(n=>n.props?.['aria-label']==='AI draft body').props.value;
  let disclosure=find(n=>n.props?.['data-draft-sources']!==undefined);
  assert.equal(nodes(disclosure).filter(n=>n.type==='li').length,3);
  const record=nodes(disclosure).find(n=>n.type==='a');assert.equal(record.props.href,'/leads/garden-gate');assert.equal(record.props.target,'_blank');
  nodes(disclosure).find(n=>n.props?.children==='Earlier message · Riley').props.onClick();render();flush();
  assert.equal(opened,'inbox-message-older-garden');assert.equal(find(n=>n.props?.['aria-label']==='AI draft body').props.value,original);
  find(n=>n.props?.['aria-label']==='AI draft body').props.onChange({target:{value:original+' Edited.'}});render();flush();await footer().saved.synced.flush();await settle();
  assert.deepEqual(__draftServer.rows.get(key+':email').sources,sources);
 }finally{viewerOwner=false;__draftServer.suggestions=[];globalThis.document=previousDocument;}
});

test('focused answer uses remaining height and measures continuation on the actual scrolling textarea',()=>{
 const oldObserver=globalThis.ResizeObserver;
 globalThis.ResizeObserver=class {observe(){} disconnect(){}};
 const input={style:{},clientWidth:342,clientHeight:440,scrollHeight:410,scrollTop:0,addEventListener(){},removeEventListener(){}};
 try {
  bodyData={inputRef:{current:input},expanded:true,fill:true,value:'A short reply with its sign-off.'};
  mount('short-focused');
  assert.equal(input.style.height,'100%');assert.equal(input.style.minHeight,'0px');
  assert.match(find(n=>n.type==='textarea').props.className,/flex-1 overflow-y-auto/);
  assert.equal(find(n=>n.props?.children==='More below ↓'),undefined);
  input.scrollHeight=980;bodyData={...bodyData,value:'A much longer reply.'};render();flush();
  assert.ok(find(n=>n.props?.children==='More below ↓'));
 }finally{cleanups.forEach(fn=>fn?.());cleanups=[];bodyData=null;globalThis.ResizeObserver=oldObserver;}
});

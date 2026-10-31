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
globalThis.localStorage = {
  getItem: (k) => map.get(k) ?? null,
  setItem: (k, v) => map.set(k, v),
  removeItem: (k) => map.delete(k),
};
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
  "@/components/ui/Toast":"export const toast=()=>1,dismissToast=()=>{};",
  "@/lib/actions/inbox-screening":"export const setInboxPreferenceAction=async()=>({ok:true});",
  react: `const h=globalThis.__draftHooks;export const useState=h.useState,useRef=h.useRef,useEffect=h.useEffect,useLayoutEffect=h.useEffect,useTransition=h.useTransition,useCallback=f=>f,useMemo=f=>f();`,
  "next/navigation": "export const useRouter=()=>({refresh(){}});",
  "@/components/ui": `export const Button=()=>null,Avatar=()=>null,Chip=()=>null,VoiceButton=()=>null,EmptyState=()=>null,Segmented=()=>null;`,
  "@/lib/actions/inbox": actionNames
    .map(
      (n) =>
        `export const ${n}=${n === "archiveThreadAction" ? "async(...args)=>globalThis.__archive(...args)" : n === "draftReplyAction" ? "globalThis.__draftActions.draft" : (n === "sendReplyAction" || n === "sendChannelReplyAction") ? "globalThis.__draftActions.send" : "async()=>({ok:true})"};`,
    )
    .join("\n"),
  "@/lib/actions/inbox-experience":
    "export const inboxContextAction=async()=>globalThis.__contextRequest?.(),undoChannelDoneAction=async()=>({ok:true});export const markChannelDoneAction=async()=>({ok:true});",
  "./InboxPanels":
    "export const ContactCreateDialog=()=>null,ThreadSummary=()=>null,ContextPanel=()=>null,LinkPicker=()=>null,MessageTaskDialog=()=>null,ShortcutHelp=()=>null;",
  "@/lib/run-action": "export const runAction=async fn=>fn();",
};
registerHooks({
  resolve(s, c, n) {
    if (s in stubs && (s !== "react" || c.parentURL === url))
      return { url: "stub:" + s, shortCircuit: true };
    if (s.startsWith("@/"))
      return n(new URL("../" + s.slice(2) + ".ts", import.meta.url).href, c);
    return n(s, c);
  },
  load(u, c, n) {
    if (u === url)
      return {
        format: "module",
        source: ts.transpileModule(source + "\nexport {ReaderBody,ChannelReaderBody};", {
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
const { ReaderBody, ChannelReaderBody, InboxClient } = await import(url);
const reader = {
  messages: [{ id: "m1", fromEmail:"tom@example.test", body: ["Plans?"] }],
  subject: "Plans",
  replyTarget: { toEmail: "tom@example.test", toName: "Tom", cc: [] },
  replyPlaceholder: "Reply to Tom…",
  aiDraft: { body: "" },
};
let tree,
  id = "t1",
  channel = null,
  clientData = null;
function render() {
  cursor = 0;
  if(clientData){tree=InboxClient({data:clientData,selfEmail:"joe@example.test"});return;}
  const Component=channel?ChannelReaderBody:ReaderBody;
  tree = Component({ reader:channel?{...reader,channel,replyLabel:"To (612) 555-1234"}:reader, threadId: id, mailbox: "joe@example.test", onSendDone:async()=>{globalThis.__doneCalls=(globalThis.__doneCalls??0)+1;return {ok:!globalThis.__doneFails,error:"offline"};} });
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
  cleanups.forEach(fn=>fn?.());cleanups=[];
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
  const n = find((n) => n.props?.children === text && n.props?.onClick);
  assert.ok(n, text);
  n.props.onClick();
  render();
  flush();
}
async function settle() {
  await Promise.all(pending);
  pending = [];
  render();
  flush();
}
test("typed draft restores across conversation switches/reloads with edited recipient; discard clears it", () => {
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
  click("Discard");
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
  assert.equal(map.size, 0);
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
 const before=sends.length;globalThis.__doneCalls=0;globalThis.__sendFails=true;
 click('Send & Done');await settle();assert.equal(sends.length,before+1);assert.equal(globalThis.__doneCalls,0);assert.equal(find(n=>n.props?.['aria-label']==='Reply body').props.value,'Approved reply');
 globalThis.__sendFails=false;globalThis.__doneFails=true;
 click('Send & Done');await settle();assert.equal(sends.length,before+2);assert.equal(globalThis.__doneCalls,1);assert.equal(readDraftFor('send-done'),null);
 globalThis.__doneFails=false;click('Retry marking done');await settle();assert.equal(sends.length,before+2);assert.equal(globalThis.__doneCalls,2);
});
function readDraftFor(id){return map.get(`sjc:inbox:draft:v1:joe%40example.test:${id}`)??null;}


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


test('plain Done advances after confirmation, clears search and reports remaining; context retains cache and times out with retry',async()=>{
 const timers=new Map();let timerId=0;const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout,realFetch=globalThis.fetch;
 globalThis.fetch=async()=>{const data=globalThis.__contextRequest();return {ok:true,json:()=>data};};
 globalThis.setTimeout=fn=>{timers.set(++timerId,fn);return timerId;};globalThis.clearTimeout=id=>timers.delete(id);
 globalThis.window={dispatchEvent(){}};globalThis.document={addEventListener(){},removeEventListener(){}};
 globalThis.__archive=async()=>({ok:true});
 let resolveContext;globalThis.__contextRequest=()=>new Promise(resolve=>{resolveContext=resolve;});
 const row=id=>({id,fromName:id,fromEmail:`${id}@example.test`,channel:'email',when:'2h',view:'needs_reply',contactRole:'client',inInbox:true});
 clientData={threads:[row('a'),row('b'),row('c')],readers:{a:reader,b:reader,c:reader},selectedId:'a',mailbox:{connected:true},smartViews:[],channels:[],labels:[],projects:[]};
 try{
  mount('root');
  const cached={person:{name:'Tom'},job:{name:'Closet'},todos:[]};resolveContext(cached);for(let i=0;i<4;i++)await Promise.resolve();render();flush();
  // Open context and refresh while retaining its last good result.
  find(n=>n.props?.title==='Open contact, job, money and to-dos').props.onClick();render();flush();
  let panel=find(n=>n.props?.initialData);assert.deepEqual(panel.props.initialData,cached);
  panel.props.onRetry();render();flush();panel=find(n=>n.props?.initialData);assert.deepEqual(panel.props.initialData,cached);
  for(const fn of timers.values())fn();render();flush();panel=find(n=>n.props?.initialData);assert.match(panel.props.loadError,/taking too long/);assert.ok(panel.props.onRetry);
  find(n=>n.props?.['aria-label']==='Search inbox').props.onChange({target:{value:'a'}});render();flush();
  click('Done');await settle();
  const selected=find(n=>n.type===ReaderBody);assert.equal(selected.props.threadId,'b');
  assert.equal(find(n=>n.props?.['aria-label']==='Search inbox').props.value,'');
  assert.ok(nodes(tree).some(n=>typeof n.props?.children==='string'&&n.props.children.includes('2 left in Needs me')));
 }finally{
  cleanups.forEach(fn=>fn?.());cleanups=[];clientData=null;globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;globalThis.fetch=realFetch;delete globalThis.window;delete globalThis.document;
 }
});

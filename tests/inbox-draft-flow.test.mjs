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
  draftCalls = [];
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
  useRef() {
    const i = cursor++;
    return states[i] ?? (states[i] = { current: null });
  },
  useEffect(fn, deps) {
    const i = cursor++;
    if (!states[i] || !deps || deps.some((d, j) => d !== states[i][j])) {
      states[i] = deps;
      effects.push(fn);
    }
  },
  useTransition() {
    return [false, (fn) => pending.push(Promise.resolve(fn()))];
  },
};
globalThis.__draftActions = {
  draft: async (...args) => {
    draftCalls.push(args);
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
        `export const ${n}=${n === "draftReplyAction" ? "globalThis.__draftActions.draft" : n === "sendReplyAction" ? "globalThis.__draftActions.send" : "async()=>({ok:true})"};`,
    )
    .join("\n"),
  "@/lib/actions/inbox-experience":
    "export const inboxContextAction=async()=>null,undoChannelDoneAction=async()=>({ok:true});export const markChannelDoneAction=async()=>({ok:true});",
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
        source: ts.transpileModule(source + "\nexport {ReaderBody};", {
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
const { ReaderBody } = await import(url);
const reader = {
  messages: [{ id: "m1", body: ["Plans?"] }],
  subject: "Plans",
  replyTarget: { toEmail: "tom@example.test", toName: "Tom", cc: [] },
  replyPlaceholder: "Reply to Tom…",
  aiDraft: { body: "" },
};
let tree,
  id = "t1";
function render() {
  cursor = 0;
  tree = ReaderBody({ reader, threadId: id, mailbox: "joe@example.test", onSendDone:async()=>{globalThis.__doneCalls=(globalThis.__doneCalls??0)+1;return {ok:!globalThis.__doneFails,error:"offline"};} });
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

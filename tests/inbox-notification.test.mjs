import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Exercise the actual shared component with inert hooks/actions; no polling,
// browser, DOM, DB, Gmail or approval mutation can run.
const url = new URL(
  "../components/shell/NotificationCenter.tsx",
  import.meta.url,
).href;
const source = readFileSync(new URL(url), "utf8");
const fixture = { path: "/inbox", opened: false, surface: false, cursor: 0 };
globalThis.__approvalUI = {
  React,
  fixture,
  hooks: {
    useState(initial) {
      const index = fixture.cursor++;
      let value = typeof initial === "function" ? initial() : initial;
      if (index === 0) value = fixture.surface;
      if (index === 1) value = fixture.opened;
      if (Array.isArray(value)) value = [{ key: "decision-1" }];
      return [value, () => {}];
    },
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useCallback: (fn) => fn,
  },
};
const stubs = {
  react:
    "const h=globalThis.__approvalUI.hooks;export const useState=h.useState,useRef=h.useRef,useEffect=h.useEffect,useCallback=h.useCallback;",
  "next/navigation":
    "export const usePathname=()=>globalThis.__approvalUI.fixture.path;export const useRouter=()=>({refresh(){}});",
  "next/link":
    "export default function Link({children,...props}){return globalThis.__approvalUI.React.createElement('a',props,children);}",
  "@/components/ui/Toast":
    'export const toast=()=>{throw Error("Unexpected toast");};',
  "@/lib/actions/approvals":
    'const fail=()=>{throw Error("Approval/network call prohibited");};export const approveWaiting=fail,declineWaiting=fail,pollNotificationCenter=fail;',
  "@/components/notifications/ApprovalCard":
    "export const ApprovalCard=()=>globalThis.__approvalUI.React.createElement('article',{'data-approval-card':true},'Decision details');",
};
registerHooks({
  resolve(s, c, n) {
    if (s in stubs && (s !== "react" || c.parentURL === url))
      return { url: "stub:approval:" + s, shortCircuit: true };
    if (s === "@/lib/notification-placement")
      return n(
        new URL("../lib/notification-placement.ts", import.meta.url).href,
        c,
      );
    return n(s, c);
  },
  load(u, c, n) {
    if (u === url)
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(source, {
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
      };
    if (u.startsWith("stub:approval:"))
      return {
        format: "module",
        shortCircuit: true,
        source: stubs[u.slice("stub:approval:".length)],
      };
    return n(u, c);
  },
});
const { NotificationCenter } = await import(url);
function render(path, opened = false, surface = false) {
  Object.assign(fixture, { path, opened, surface, cursor: 0 });
  return renderToStaticMarkup(React.createElement(NotificationCenter));
}
test("inbox renders only a compact badge until deliberately opened; active inbox surfaces collapse elsewhere too", () => {
  for (const [path, surface] of [
    ["/inbox", false],
    ["/inbox/thread", false],
    ["/projects", true],
  ]) {
    const html = render(path, false, surface);
    assert.match(html, /1 waiting on you/);
    assert.match(html, /Decisions 1/);
    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /data-approval-card|Decision details|bottom-\[/);
  }
});
test("explicitly opened inbox decisions use their own layer below dialogs; other pages retain the original stack", () => {
  const opened = render("/inbox", true);
  assert.match(opened, /id="inbox-decisions"/);
  assert.match(opened, /z-\[35\]/);
  assert.match(opened, /Close decisions/);
  assert.match(opened, /data-approval-card/);
  const normal = render("/projects");
  assert.match(normal, /bottom-\[/);
  assert.match(normal, /z-\[60\]/);
  assert.match(normal, /data-approval-card/);
});

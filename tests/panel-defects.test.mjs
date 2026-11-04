import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
const root = new URL('../', import.meta.url);
registerHooks({
 resolve(s,c,n) {
  if(s==='server-only')return {url:'data:text/javascript,',shortCircuit:true};
  if(s==='@/lib/db')return {url:'stub:db',shortCircuit:true};
  if(s.startsWith('@/'))return n(new URL(s.slice(2)+(s.endsWith('.tsx')?'':'.ts'),root).href,c);
  return n(s,c);
 },
 load(u,c,n) {
  if(u==='stub:db')return {format:'module',source:'export const query=(...a)=>globalThis.__query(...a); export const queryOne=async(...a)=>(await query(...a)).rows[0]??null;',shortCircuit:true};
  if(u.endsWith('.tsx'))return {format:'module',source:ts.transpileModule(readFileSync(new URL(u),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};
  return n(u,c);
 }
});
const source = p => readFileSync(new URL(p,root),'utf8');
test('new, scoped, reopened and agent-switched chats clear one-message send permission',()=>{
 const s=source('components/panel/PanelChat.tsx');
 for(const marker of ['const openThread =','const newThread =','const newThreadFor =']) {
  assert.match(s.slice(s.indexOf(marker),s.indexOf(marker)+180),/setAllowSends\(false\)/);
 }
 assert.match(s,/onClick=\{\(\) => \{\s*setAllowSends\(false\);\s*chat.selectAgent/);
});
test('archived folders have an always reachable restore action even with no threads',()=>{
 assert.match(source('components/panel/ThreadList.tsx'),/folders.filter\(\(f\) => f.archivedAt\).map/);
});
test('dictation in panel exposes a persistent accessible recovery message',()=>{
 assert.match(source('components/panel/PanelDictation.tsx'),/role="alert"/);
 assert.match(source('components/panel/PanelDictation.tsx'),/microphone.*browser/i);
});
test('Auto and Claude both handle the advertised mode shortcut',()=>{
 assert.match(source('components/panel/PanelChat.tsx'),/\(chat.agent === "claude" \|\| chat.agent === "auto"\) && e.key === "Tab"/);
});
test('assistant markdown renders emphasis, lists and safe named links; HTML stays escaped',async()=>{
 const {AssistantMarkdown}=await import('../components/panel/AssistantMarkdown.tsx');
 const html=renderToStaticMarkup(createElement(AssistantMarkdown,{text:'**Job**\n\n- [Open](https://example.com)\n- [Bad](javascript:alert)\n\n<script>alert(1)</script>'}));
 assert.match(html,/<strong>Job<\/strong>/);assert.match(html,/<ul/);assert.match(html,/href="https:\/\/example.com\/?"/);
 assert.doesNotMatch(html,/href="javascript:|<script>/);assert.match(html,/&lt;script&gt;/);
});
test('saved assistant messages restore only their matching run log',async()=>{
 globalThis.__query=async sql=>({rows:sql.includes('FROM ai_conversations')?[{id:'c',agent:'claude'}]:sql.includes('FROM ai_messages')?[{id:'m',role:'assistant',body:'Done',run_id:'r',activity:'Tool: read',duration_seconds:18}]:[]});
 const {getConversation}=await import('../lib/ai-chat.ts');
 const c=await getConversation('c');assert.equal(c.messages[0].workLog,'Tool: read');assert.equal(c.messages[0].runId,'r');
});

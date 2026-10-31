import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
let role = 'owner', assigned = true, entityCalls = 0;
const item = { id: '11111111-1111-1111-1111-111111111111', title: 'Call supplier', body: 'Confirm delivery', status: 'todo', assignedTo: [] };
globalThis.__detail = { requireAccess: async()=>({id:'me',role}), getEngineWorkItem: async()=>item, query: async()=>({rows:assigned?[{one:1}]:[]}), resolveEntityRef:async()=>{entityCalls++;return null;}, getWorkbenchSnapshot:async()=>null };
registerHooks({resolve(s,c,next){if(s.startsWith('@/'))return {url:`stub:${s}`,shortCircuit:true};return next(s,c);},load(url,c,next){
 if(url.startsWith('stub:'))return {format:'module',source:'export const {requireAccess,getEngineWorkItem,query,resolveEntityRef,getWorkbenchSnapshot}=globalThis.__detail;',shortCircuit:true};
 if(url.endsWith('/lib/actions/workbench.ts'))return {format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return next(url,c);
}});
const {getWorkbenchAction}=await import('../lib/actions/workbench.ts');
test('unlinked to-do keeps its identity and details',async()=>{const r=await getWorkbenchAction(item.id);assert.equal(r.ok,true);assert.deepEqual(r.item,item);assert.equal(r.snapshot,null);});
test('staff cannot inspect another person’s to-do or its entity',async()=>{role='staff';assigned=false;entityCalls=0;const r=await getWorkbenchAction(item.id);assert.equal(r.ok,false);assert.equal(entityCalls,0);});

test('Workbench detail actions accept queue snapshots without an ok field', async()=>{
 const {runInNewContext}=await import('node:vm');
 const calls=[],states=[],pending=[];
 const exports={};
 const source=ts.transpileModule(readFileSync(new URL('../components/panel/WorkbenchPanel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
 assert.equal(source.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 runInNewContext(source.outputText+'\nexports.TodoDetails = TodoDetails;', {exports, require(name){
  if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name==='react')return {useState:initial=>[initial,value=>states.push(value)],useTransition:()=>[false,fn=>pending.push(fn())]};
  if(name==='@/lib/run-action')return {runAction:async fn=>fn()};
  if(name==='@/lib/actions/today')return Object.fromEntries(['completeTodayItem','restoreTodayItem','snoozeTodayItem'].map(key=>[key,async id=>{calls.push(key);return {priorities:[],waiting:[]};}]));
  if(name==='@/lib/engine-constants')return {STATUS_LABEL:{queued:'Queued',done:'Done'}};
  return new Proxy({}, {get:(_,key)=>key});
 }});
 function nodes(node){if(!node||typeof node!=='object')return [];const children=node.props?.children;return [node,...(Array.isArray(children)?children:[children]).flatMap(nodes)];}
 for(const [status,label,action] of [['queued','Mark done','completeTodayItem'],['done','Reopen','restoreTodayItem'],['queued','Snooze 3 days','snoozeTodayItem']]){
  const todo={...item,status,assigneeKind:'human',assignedTo:[]};
  const tree=exports.TodoDetails({item:todo,canEdit:true,assignees:[]});
  const button=nodes(tree).find(n=>n.props?.children===label);
  assert.ok(button,`${label} stays available without a linked record`);
  button.props.onClick();await Promise.all(pending.splice(0));assert.equal(calls.at(-1),action);
  assert.ok(states.some(value=>typeof value==='string'&& /Marked done|Reopened|Snoozed/.test(value)));
 }
});

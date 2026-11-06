// Expectations first: selecting a call uses the foreground action even without
// Ask. Genuine DAL redirects reach React's transition boundary; no silent typed
// failure, no panel dependency, and BrowserPhone keeps its background action.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {getRedirectError} from 'next/dist/client/components/redirect.js';

for(const destination of [null,'/login','/logout','/today'])test(`no-ai staff call selection: ${destination??'authorized'}`,async()=>{
 const states=[],effects=[],transitions=[],reads=[];let index=0,deny=false;
 const jsx=(type,props,key)=>({type,key,props});
 const hooks={
  useState(init){const i=index++;if(!(i in states))states[i]=init;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
  useEffect(fn){effects.push(fn);},useTransition:()=>[false,fn=>transitions.push(fn())],
 };
 const exports={};
 const deps={react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/actions/calls':{
  loadSelectedCall:async id=>{reads.push(id);if(deny&&destination)throw getRedirectError(destination,'push');return {call:{id},events:[]};},
  loadCall:()=>assert.fail('explicit selection must not use a background failure envelope'),
 },'@/components/calls/BrowserPhone':{useStartCall:()=>()=>{},useBrowserPhone:()=>null},'@/lib/comms/phone':{formatUsPhone:x=>x},'@/lib/comms/call-identity':{callIdentityLabel:c=>c.id},'@/lib/background-result':{isBackgroundFailure:()=>false},'@/components/shell/backgroundAuth':{noteBackgroundFailure:()=>assert.fail('silent auth notifier')}};
 runInNewContext(ts.transpileModule(readFileSync(new URL('../components/calls/CallsClient.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:s=>deps[s]??{},console});
 const render=()=>{index=0;return exports.CallsClient({calls:[{id:'A'},{id:'B'}],configured:true,problems:[],openId:'A'});};
 const buttons=tree=>{const out=[];const visit=n=>{if(!n)return;if(Array.isArray(n))return n.forEach(visit);if(n.type==='button'&&n.key==='B')out.push(n);visit(n.props?.children);};visit(tree);return out;};
 let tree=render();effects.shift()();await transitions.shift();assert.deepEqual(reads,['A']);
 tree=render();effects.length=0;deny=true;buttons(tree)[0].props.onClick();render();effects.shift()();
 if(destination)await assert.rejects(transitions.shift(),e=>e.digest===`NEXT_REDIRECT;push;${destination};307;`);else await transitions.shift();
 assert.deepEqual(reads,['A','B']);
 const phone=readFileSync(new URL('../components/calls/BrowserPhone.tsx',import.meta.url),'utf8');assert.match(phone,/await loadCall\(callId\)/);assert.doesNotMatch(phone,/loadSelectedCall/);
});

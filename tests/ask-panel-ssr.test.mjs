import {test} from 'node:test';
// R4 expectations: mounted shell + focus reads never navigate after typed auth
// loss; clear transcript/queue/follow work, keep draft and in-panel sign-in.
// Send/upload/Retry retain the same boundary; positive refresh still works.
import assert from 'node:assert/strict';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {compile} from 'tailwindcss';
import {hostWidths, deviceCases} from './fixtures/ask-pane-host.mjs';

// Real React SSR, with controlled provider/action/browser seams. No DOM, DB or server.
const root=new URL('../',import.meta.url);
const stubs=new Map([
 ['next/dynamic',`export default function dynamic(){return ()=>null;}`],
 ['./actions',`export const canvasPanelIdentity=(...a)=>globalThis.__canvasIdentity?.(...a)??({ok:false,code:'CANVAS_DISABLED'});`],
 ['next/link',`import React from 'react';export default function Link(props){return React.createElement('a',props);}`],
 ['@/components/today/PriorityCard',`export const PriorityCard=()=>null;`],
 ['@/components/today/ModelActionChips',`export const ModelActionChips=()=>null;`],
 ['next/navigation',`export const useRouter=()=>globalThis.__panelRouter??({push(){},refresh(){}});export const usePathname=()=>'/panel';`],
 ['@/components/today/TodayQueueContext',`export const useTodayQueue=()=>globalThis.__queueState??({priorities:[],waiting:[],signedOut:false,refresh:async()=>{}});`],
 ['./TodayQueueContext',`export const useTodayQueue=()=>globalThis.__queueState??({priorities:[],waiting:[],signedOut:false,refresh:async()=>{}});`],
 ['@/lib/use-dictation',`export const useDictation=options=>{globalThis.__dictationOptions=options;return {state:'idle',supported:true,start(){},stop(){},cancel(){}};}`],
 ['@/lib/use-voice-round',`export const useVoiceRound=options=>{globalThis.__voiceOptions=options;return {phase:'idle',voiceMode:false,supported:options.availability?.enabled??true};};`],
 ['./useRecordMentions',`export const useRecordMentions=()=>({refs:[],records:[],results:[],clear(){}});`],
 ['./PanelDictation',`export const PanelDictation=()=>null;`],
 ['./JobPicker',`export const JobPicker=()=>null;`],
 ['./GrantCard',`export const GrantCard=()=>null;`],
 ['./RunReview',`export const RunReview=()=>null;`],
 ['./PanelProvider',`export const usePanel=()=>({layout:{ready:true,where:'docked',collapsed:false,width:420,follow:true},setWidth(){},commitWidth(){},toggleCollapsed(){},setWhere(){},setFollow(){}});`],
 ['@/components/shell/MobileTabBar',`export const OPEN_MOBILE_OPERATOR='qa-open';`],
 ['./QueueRail',`export const QueueRail=()=>null;`],
]);
const hookNames=['useState','useRef','useEffect','useLayoutEffect','useSyncExternalStore','useReducer','useId','useCallback','useMemo'];
registerHooks({
 resolve(s,c,n){
  if(c.parentURL==='panel-react:hooks'||c.parentURL==='panel-stub:next/link')return n(s,{...c,parentURL:import.meta.url});
  if(s==='react'&&/\/components\/(panel|shell|today)\//.test(c.parentURL??''))return {url:'panel-react:hooks',shortCircuit:true};
  if(stubs.has(s))return {url:'panel-stub:'+s,shortCircuit:true};
  if(s.startsWith('@/lib/actions/'))return {url:'panel-action:'+s,shortCircuit:true};
  if(s.startsWith('@/')||s.startsWith('.')){
   const u=s.startsWith('@/')?new URL(s.slice(2),root):new URL(s,c.parentURL);
   for(const ext of ['', '.ts','.tsx','/index.ts'])if(existsSync(new URL(u.href+ext))&&statSync(new URL(u.href+ext)).isFile())return {url:u.href+ext,shortCircuit:true};
  }
  return n(s,c);
 },
 load(u,c,n){
  if(u==='panel-react:hooks')return {format:'module',shortCircuit:true,source:`import * as Real from 'react';export * from 'react';`+hookNames.map(k=>`export const ${k}=(...a)=>(globalThis.__panelHooks?.${k}??Real.${k})(...a);`).join('')};
  if(u.startsWith('panel-stub:'))return {format:'module',source:stubs.get(u.slice(11)),shortCircuit:true};
  if(u.startsWith('panel-action:')){
   // Export only imported runtime action names; calls are controlled per test.
   const files=['useAgentChat.ts','ThreadList.tsx','useChatAttachments.ts'];
   const names=new Set(['pollLiveChanges','refreshTodayQueue','checkPriorityCompletion','completeTodayItem','snoozeTodayItem','assignTodayItem','promoteTodayItem','sendBackTodayItem','loadTodayRecovery','restoreTodayItem']);
   for(const file of files){const s=readFileSync(new URL('components/panel/'+file,root),'utf8');for(const m of s.matchAll(/\b(\w+(?:Action|AgentRun))\b/g))names.add(m[1]);}
   return {format:'module',source:[...names].map(k=>`export const ${k}=(...a)=>globalThis.__panelActions?.['${k}']?.(...a);`).join('\n'),shortCircuit:true};
  }
  if(/\.(ts|tsx)$/.test(u))return {format:'module',source:ts.transpileModule(readFileSync(new URL(u),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
  return n(u,c);
 }
});
const {PanelChat}=await import('../components/panel/PanelChat.tsx');
const {PanelDock}=await import('../components/panel/PanelDock.tsx');
const render=Component=>renderToString(React.createElement(Component));
const chatProps={registerHandOff(){},onRunStart(){},onRunEnd(){},showQueueCards:false};
const storage=values=>({getItem:k=>values[k]??null,setItem(k,v){values[k]=v;},removeItem(k){delete values[k];}});
for(const populated of [false,true])test(`actual PanelChat server and hydration markup agree; storage ${populated?'populated':'empty'}`,()=>{
 delete globalThis.window;delete globalThis.sessionStorage;
 const server=render(()=>React.createElement(PanelChat,chatProps));
 const session=storage(populated?{'sjcos:lastRoute':'/projects/private-job','sjcos:panel:session:v1':JSON.stringify({conversationId:'private-thread',agent:'hermes',claude:{model:'opus'}})}:{});
 globalThis.sessionStorage=session;globalThis.window={sessionStorage:session,localStorage:storage({'sjcos:panel:state:v1':JSON.stringify({width:999,where:'window',collapsed:true})})};
 try{assert.equal(render(()=>React.createElement(PanelChat,chatProps)),server);assert.doesNotMatch(server,/private-job|private-thread/);}finally{delete globalThis.window;delete globalThis.sessionStorage;}
});
test('no-registration narrow selector stays compact and has one Threads control',()=>{
 const html=render(()=>React.createElement(PanelDock,{width:390,inWindow:true}));
 assert.equal((html.match(/role="tablist"/g)||[]).length,1);
 assert.equal((html.match(/aria-label="Threads"/g)||[]).length,1);
 assert.match(html,/inline-flex h-12 max-w-full items-center gap-0.5/);
 assert.match(html,/rounded-\[5px\] px-2.5 font-sans text-label/);
});
for(const width of [880,900,1100,1280])test(`chat stretches inside a single grid cell at ${width}`,()=>{
 const html=render(()=>React.createElement(PanelDock,{width,inWindow:true}));
 assert.match(html,/min-h-0 min-w-0 grid grid-cols-\[minmax\(0,1fr\)\] grid-rows-\[minmax\(0,1fr\)\]/);
});

// Controlled hook lifecycle for state/effect/event integration without a DOM.
// Child markup still uses React DOM server; this is not a browser hydration claim.
function lifecycle(component, props={}) {
 const slots=[],pending=[];let index=0,output;
 const slot=(init)=>{const i=index++;if(!(i in slots))slots[i]=init();return [i,slots[i]];};
 const effect=(fn,deps)=>{const [i,old]=slot(()=>({}));if(!deps||!old.deps||deps.some((d,n)=>!Object.is(d,old.deps[n]))){pending.push(()=>{old.cleanup?.();old.cleanup=fn();old.deps=deps;});}};
 const hooks={
  useState(init){const [i,value]=slot(()=>typeof init==='function'?init():init);return [value,next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
  useRef(init){return slot(()=>({current:init}))[1];},
  useEffect:effect,useLayoutEffect:effect,
  useSyncExternalStore(subscribe,get){return get();},
  useReducer(reducer,init,initialize){const [state,set]=hooks.useState(()=>initialize?initialize(init):init);return [state,event=>set(value=>reducer(value,event))];},
  useId(){return hooks.useRef('fixture-id').current;},
  useCallback(fn){return fn;},useMemo(fn){return fn();},
 };
 return {
  slots,
  render(){index=0;globalThis.__panelHooks=hooks;try{output=component(props);return output;}finally{delete globalThis.__panelHooks;}},
  effects(){for(const fn of pending.splice(0))fn();},
  dispose(){for(const value of slots)value?.cleanup?.();},
 };
}
function nodes(tree,predicate) {
 const result=[];function visit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}if(predicate(node))result.push(node);visit(node.props?.children);}visit(tree);return result;
}
const tick=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const {ThreadList}=await import('../components/panel/ThreadList.tsx');
const {useAgentChat}=await import('../components/panel/useAgentChat.ts');
const {ASK_STATUS_COPY,askFailure,askCall}=await import('../components/panel/askStatusCopy.ts');
const railProps={currentId:null,variant:'rail',scopeFolderId:null,onOpen(){},onNew(){},onNewFor(){},onScopeChange(){},onCurrentRemoved(){}};
const background=await import("../components/shell/backgroundAuth.ts");
function clientScope(work){
 background.resumeBackgroundAuth();
 const prior={window:globalThis.window,sessionStorage:globalThis.sessionStorage,BroadcastChannel:globalThis.BroadcastChannel};
 const session=storage({});globalThis.sessionStorage=session;globalThis.BroadcastChannel=undefined;
 globalThis.window={sessionStorage:session,localStorage:storage({}),location:{search:''},addEventListener(){},removeEventListener(){},setTimeout(){},confirm(){return true;}};
 return Promise.resolve().then(work).finally(()=>{background.resumeBackgroundAuth();for(const [key,value]of Object.entries(prior)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
}
for(const code of Object.keys(ASK_STATUS_COPY).filter(code=>code!=='THREAD_UNAVAILABLE'))test(`rail renders ${code} without private metadata`,()=>{
 const html=render(()=>React.createElement(ThreadList,{...railProps,failureCode:code}));
 assert.ok(html.includes(ASK_STATUS_COPY[code].replaceAll("'",'&#x27;')));
 assert.doesNotMatch(html,/Search threads|Empty —|New folder/);
 if(code==='SIGN_IN_AGAIN')assert.match(html,/href="\/login"/);else assert.match(html,/Try again/);
});
test('legacy throws map to fixed codes without displaying their causes',()=>{
 assert.deepEqual(askFailure(Error('ASK_SIGN_IN_REQUIRED')),{ok:false,code:'SIGN_IN_AGAIN'});
 assert.deepEqual(askFailure(Error('ASK_ACCESS_DENIED')),{ok:false,code:'CHAT_OFF'});
 assert.equal(askFailure(Error('private title / SQL cause')),null);
});
for(const code of ['ASK_PAUSED','THREAD_UNAVAILABLE','SIGN_IN_AGAIN','CHAT_OFF'])test(`chat healthy → ${code} → retry clears private content and preserves failed send`,()=>clientScope(async()=>{
 let refused=false;const restored=[];
 globalThis.__panelActions={
  listThreadRailAction:async()=>({ok:true,rail:{folders:[],threads:[]},capabilities:{deleteAvailable:false}}),
  loadConversationAction:async()=>({ok:true,conversation:{id:'owned',agent:'claude',title:'Private title',folderName:'Private folder',messages:[{id:'old',body:'Private transcript'}]}}),
  sendMessageAction:async()=>refused?{ok:false,code}:{ok:true,kind:'answer',message:{id:'reply',body:'Done'}},
 };
 const h=lifecycle(()=>useAgentChat({getPageContext:()=>undefined,onSendError:spec=>restored.push(spec.directive)}));
 try{
  let chat=h.render();h.effects();await tick();
  chat=h.render();await chat.openConversation('owned');chat=h.render();assert.equal(chat.conversationTitle,'Private title');
  refused=true;chat.submit({directive:'Keep this draft'});await tick();chat=h.render();
  assert.equal(chat.failureCode,code);assert.equal(chat.conversationTitle,'New chat');assert.deepEqual(chat.messages,[]);assert.equal(chat.folderName,null);assert.equal(chat.pending,false);assert.deepEqual(restored,['Keep this draft']);
  await chat.retry();chat=h.render();assert.equal(chat.failureCode,null);assert.equal(chat.conversationId,null);
 }finally{h.dispose();delete globalThis.__panelActions;}
}));
test('rail reload failure clears old folders/titles; successful retry restores list',()=>clientScope(async()=>{
 let code=null;
 globalThis.__panelActions={listThreadRailAction:async()=>code?{ok:false,code}:{ok:true,rail:{folders:[],threads:[]},capabilities:{deleteAvailable:false}}};
 const h=lifecycle(ThreadList,railProps);
 try{
  h.render();h.effects();await tick();let tree=h.render();assert.match(render(()=>tree),/No chats yet. Only your own chats show here./);
  code='ASK_PAUSED';// invoke the same reload through the bus-independent refresh effect
  railProps.refreshKey='failed';h.render();h.effects();await tick();tree=h.render();
  assert.match(render(()=>tree),/Chats are paused/);assert.doesNotMatch(render(()=>tree),/Search threads/);
  code=null;await nodes(tree,n=>n.type==='button'&&n.props.children==='Try again')[0].props.onClick();await tick();tree=h.render();assert.match(render(()=>tree),/No chats yet/);
 }finally{h.dispose();delete railProps.refreshKey;delete globalThis.__panelActions;}
}));
const thread={id:'owned',title:'Private delete title',agent:'claude',folderId:null,pinnedAt:null,settledAt:null,archivedAt:null,lastActivityAt:null,updatedAt:null};
for(const available of [false,true])test(`delete capability ${available}; lost-response retry reuses operation UUID`,()=>clientScope(async()=>{
 const calls=[];let confirms=0;
 window.confirm=copy=>{assert.equal(copy,"Delete this chat? It's removed now and erased for good after 30 days.");confirms++;return true;};
 globalThis.__panelActions={
  listThreadRailAction:async()=>({ok:true,rail:{folders:[],threads:[thread]},capabilities:{deleteAvailable:available}}),
  deleteConversationAction:async(id,op)=>{calls.push([id,op]);if(calls.length===1)throw Error('lost response');return {ok:true,state:'deleted'};},
 };
 const h=lifecycle(ThreadList,railProps);
 try{
  h.render();h.effects();await tick();let tree=h.render();
  nodes(tree,n=>n.props['aria-label']==='More')[0].props.onClick();tree=h.render();
  const action=nodes(tree,n=>n.props.label==='Delete')[0];assert.equal(action.props.disabled,!available);
  if(!available){assert.equal(action.props.description,ASK_STATUS_COPY.DELETE_NOT_READY);assert.match(render(()=>action),/<span class="block text-meta text-ink-4 whitespace-normal">Chat deletion is not ready yet\. Try again later\.<\/span>/);assert.equal(calls.length,0);return;}
  action.props.onClick();await tick();tree=h.render();assert.doesNotMatch(render(()=>tree),/Private delete title/);assert.match(render(()=>tree),/couldn&#x27;t be confirmed/);
  const retry=nodes(tree,n=>n.type==='button'&&n.props.children==='Retry deletion')[0];retry.props.onClick();await tick();tree=h.render();
  assert.equal(calls.length,2);assert.equal(calls[0][1],calls[1][1]);assert.match(calls[0][1],/^[0-9a-f]{8}-[0-9a-f-]{27}$/);assert.equal(confirms,1);
 }finally{h.dispose();delete globalThis.__panelActions;}
}));
const {registerAskPane,setAskPaneScope,publishAskPaneSnapshots}=await import('../components/panel/askPaneRegistry.ts');
const {askPaneLayout}=await import('../components/panel/askPaneLayout.ts');
const scope={userId:'qa',threadId:'qa-thread',claimToken:'qa-claim'};
const canvas={kind:'canvas',id:'qa-canvas',user_id:scope.userId,thread_id:scope.threadId,run_id:null,label:'QA diagram',attention:'none',revision:'1',selected_version:1,latest_version:1};
for(const row of hostWidths)test(`actual pane host consumes shared measured fixture ${row.width}`,()=>{
 const contexts=[];const unregister=registerAskPane({id:'canvas',render:context=>{contexts.push(context);return {content:React.createElement('div',{'data-qa-stage':true},'Stage')};}});
 setAskPaneScope(scope);publishAskPaneSnapshots(scope,[canvas]);
 const h=lifecycle(PanelDock,{mode:'popout',inWindow:true});
 try{
  h.render();const state=h.slots.findIndex(value=>value?.scope===''&&'selected' in value);
  h.slots[state]={...h.slots[state],scope:JSON.stringify([scope.userId,scope.threadId,scope.claimToken]),selected:{kind:'canvas',id:canvas.id}};
  const viewport=h.slots.findIndex(value=>value?.width===0&&value?.height===0);h.slots[viewport]={width:row.width+16,height:900};
  h.slots[h.slots.indexOf(0)]=row.width;
  const tree=h.render(),html=render(()=>tree);
  assert.equal((html.match(/role="tablist"/g)||[]).length,1);
  assert.equal(contexts[0].split,row.split);assert.ok(Math.abs(contexts[0].paneWidth-row.pane)<.001);
  assert.equal((html.match(/role="separator"/g)||[]).length,row.split?1:0);
  if(row.split)assert.ok(html.includes(`grid-template-columns:${row.chat}px 12px minmax(0,1fr)`));
  assert.equal(nodes(tree,n=>n.type===PanelChat).length,1);
 }finally{h.dispose();setAskPaneScope(null);unregister();}
});
test('landscape host uses one vertical selector, one Close Operator and fixture stage allocation',()=>{
 const row=deviceCases.find(x=>x.landscape);assert.ok(row);
 const contexts=[];const unregister=registerAskPane({id:'canvas',render:context=>{contexts.push(context);return {content:React.createElement('div',null,'Stage')};}});
 setAskPaneScope(scope);publishAskPaneSnapshots(scope,[canvas]);
 const h=lifecycle(PanelDock,{mode:'sheet'});
 try{
  h.render();const state=h.slots.findIndex(value=>value?.scope===''&&'selected' in value);h.slots[state]={...h.slots[state],scope:JSON.stringify([scope.userId,scope.threadId,scope.claimToken]),selected:{kind:'canvas',id:canvas.id}};
  h.slots[h.slots.findIndex(value=>value?.width===0&&value?.height===0)]={width:row.width,height:row.height};h.slots[h.slots.indexOf(0)]=row.width;
  const html=render(()=>h.render());assert.equal((html.match(/role="tablist"/g)||[]).length,1);assert.match(html,/aria-orientation="vertical"/);assert.equal((html.match(/aria-label="Close Operator"/g)||[]).length,1);assert.ok(contexts[0].landscape);
  assert.ok(askPaneLayout({...row,selected:true,safeArea:80}).stage>=200);
  assert.match(html,/grid-template-columns:minmax\(0,1fr\) 128px/);
  assert.match(html,/grid-template-rows:48px 20px minmax\(200px,1fr\)/);
 }finally{h.dispose();setAskPaneScope(null);unregister();}
});

const {PanelHost}=await import('../components/panel/PanelHost.tsx');
test('actual PanelHost suppresses grabber/header only for selected short landscape',()=>{
 const h=lifecycle(PanelHost,{children:React.createElement('main',null,'App')});
 try{
  h.render();const viewport=h.slots.findIndex(x=>x?.width===0&&x?.height===0);h.slots[viewport]={width:800,height:360};
  const activity=h.slots.findIndex(x=>x?.selected===false&&x?.landscape===false);h.slots[activity]={selected:true,landscape:true};
  const tree=h.render();
  assert.equal(nodes(tree,n=>n.type===PanelDock).length,1);
  assert.equal(nodes(tree,n=>n.type==='button'&&n.props['aria-label']==='Close Operator').length,0);
  assert.equal(nodes(tree,n=>n.props.className?.includes('mx-auto mt-2 h-1')).length,0);
  assert.equal(nodes(tree,n=>n.type==='span'&&n.props.children==='Operator').length,0);
  h.slots[activity]={selected:false,landscape:false};const ordinary=h.render();
  assert.equal(nodes(ordinary,n=>n.type==='button'&&n.props['aria-label']==='Close Operator').length,1);
  assert.equal(nodes(ordinary,n=>n.props.className?.includes('mx-auto mt-2 h-1')).length,1);
 }finally{h.dispose();}
});
const {useAskContentWidth}=await import('../components/panel/askPaneHooks.ts');
test('actual measurement hook adopts contentRect width and disconnects on unmount',()=>{
 let callback,observed,disconnected=false;const prior=globalThis.ResizeObserver;
 globalThis.ResizeObserver=class{constructor(cb){callback=cb;}observe(node){observed=node;}disconnect(){disconnected=true;}};
 const target={},h=lifecycle(()=>useAskContentWidth({current:target}));
 try{assert.equal(h.render(),0);h.effects();assert.equal(observed,target);callback([{contentRect:{width:840}}]);assert.equal(h.render(),840);}finally{h.dispose();globalThis.ResizeObserver=prior;}
 assert.equal(disconnected,true);
});
for(const throwing of [false,true])test(`poll ${throwing?'throws':'returns failure'} clears content without restoring an accepted turn`,()=>clientScope(async()=>{
 const prior=globalThis.setTimeout;globalThis.setTimeout=fn=>{queueMicrotask(fn);return 0;};
 const restored=[];
 globalThis.__panelActions={
  listThreadRailAction:async()=>({ok:true,rail:{folders:[],threads:[]},capabilities:{deleteAvailable:false}}),
  newConversationAction:async()=>({ok:true,id:'owned'}),
  sendMessageAction:async()=>({ok:true,kind:'run',runId:'run'}),
  pollAgentRun:async()=>{if(throwing)throw Error('ASK_PAUSED');return {ok:false,code:'ASK_PAUSED'};},
 };
 const h=lifecycle(()=>useAgentChat({getPageContext:()=>undefined,onSendError:spec=>restored.push(spec.directive)}));
 try{let chat=h.render();h.effects();await tick();chat=h.render();chat.submit({directive:'Already accepted'});await tick();chat=h.render();assert.equal(chat.failureCode,'ASK_PAUSED');assert.deepEqual(chat.messages,[]);assert.deepEqual(restored,[]);assert.equal(chat.pending,false);}finally{h.dispose();delete globalThis.__panelActions;globalThis.setTimeout=prior;}
}));
for(const throwing of [false,true])test(`new-thread ${throwing?'throw':'failure result'} is handled without a sent bubble`,()=>clientScope(async()=>{
 globalThis.__panelActions={listThreadRailAction:async()=>({ok:true,rail:{folders:[],threads:[]}}),newConversationAction:async()=>{if(throwing)throw Error('ASK_PAUSED');return {ok:false,code:'ASK_PAUSED'};}};
 const drafts=[];const h=lifecycle(()=>useAgentChat({getPageContext:()=>undefined,onSendError:spec=>drafts.push(spec.directive)}));
 try{let chat=h.render();h.effects();await tick();chat=h.render();chat.submit({directive:'Keep draft'});await tick();chat=h.render();assert.equal(chat.failureCode,'ASK_PAUSED');assert.deepEqual(chat.messages,[]);assert.deepEqual(drafts,['Keep draft']);}finally{h.dispose();delete globalThis.__panelActions;}
}));
test('a rail failure during admission keeps the draft even when the send response arrives later',()=>clientScope(async()=>{
 let finish;const drafts=[];
 globalThis.__panelActions={listThreadRailAction:async()=>({ok:true,rail:{folders:[],threads:[]}}),newConversationAction:()=>new Promise(resolve=>{finish=resolve;})};
 const h=lifecycle(()=>useAgentChat({getPageContext:()=>undefined,onSendError:spec=>drafts.push(spec.directive)}));
 try{let chat=h.render();h.effects();await tick();chat=h.render();chat.submit({directive:'Keep draft during admission'});chat=h.render();chat.reportFailure('ASK_PAUSED');await tick();assert.deepEqual(drafts,['Keep draft during admission']);finish({ok:false,code:'ASK_PAUSED'});await tick();chat=h.render();assert.deepEqual(chat.messages,[]);assert.equal(drafts.length,1);}finally{h.dispose();delete globalThis.__panelActions;}
}));
for(const code of ['ASK_PAUSED','THREAD_UNAVAILABLE','SIGN_IN_AGAIN','CHAT_OFF'])test(`actual PanelChat shows ${code} above composer and keeps typed text`,()=>clientScope(async()=>{
 globalThis.__panelActions={listThreadRailAction:async()=>({ok:true,rail:{folders:[],threads:[]}}),newConversationAction:async()=>({ok:false,code})};
 const h=lifecycle(PanelChat,chatProps);
 try{
  let tree=h.render();h.effects();await tick();tree=h.render();
  nodes(tree,n=>n.type==='input'&&n.props.placeholder?.startsWith('Tell '))[0].props.onChange({target:{value:'Keep the typed draft'}});
  tree=h.render();nodes(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});await tick();tree=h.render();h.effects();tree=h.render();
  const html=render(()=>tree);assert.ok(html.includes(ASK_STATUS_COPY[code].replaceAll("'",'&#x27;')));
  if(code==='THREAD_UNAVAILABLE')assert.doesNotMatch(html,/Try again/);
  else if(code==='SIGN_IN_AGAIN')assert.match(html,/href="\/login"/);
  else assert.match(html,/Try again/);
  const send=nodes(tree,n=>n.type==='button'&&n.props['aria-label']==='Send')[0];assert.equal(send.props.disabled,code!=='THREAD_UNAVAILABLE');
  const attach=nodes(tree,n=>n.type==='button'&&n.props['aria-label']==='Attach files')[0];assert.equal(attach.props.disabled,code!=='THREAD_UNAVAILABLE');
  assert.equal(nodes(tree,n=>n.type==='input'&&n.props.placeholder?.startsWith('Tell '))[0].props.value,'Keep the typed draft');
  assert.equal((html.match(/Keep the typed draft/g)||[]).length,1);
 }finally{h.dispose();delete globalThis.__panelActions;}
}));

for(const variant of ['rail','drawer'])test(`${variant} SSR and initial render show loading until the first list resolves`,()=>clientScope(async()=>{
 let finish;
 globalThis.__panelActions={listThreadRailAction:()=>new Promise(resolve=>{finish=resolve;})};
 const props={...railProps,variant},h=lifecycle(ThreadList,props);
 const assertLoading=html=>{
  assert.match(html,/<p role="status"[^>]*>Loading chats…<\/p>/);
  assert.doesNotMatch(html,/No chats yet|Empty —|class="mb-1"/);
 };
 try{
  assertLoading(render(()=>React.createElement(ThreadList,props)));
  assertLoading(render(()=>h.render()));h.effects();await tick();assertLoading(render(()=>h.render()));
  finish({ok:true,rail:{folders:[],threads:[]}});await tick();const html=render(()=>h.render());
  assert.match(html,/No chats yet\. Only your own chats show here\./);assert.doesNotMatch(html,/Loading chats|Empty —/);
 }finally{h.dispose();delete globalThis.__panelActions;}
}));

for(const variant of ['rail','drawer'])test(`${variant} empty folders use today's per-folder copy`,()=>clientScope(async()=>{
 const folder={id:'empty-job',name:'Tierney',entityKind:null,entityId:null,entityHref:null,collapsed:false,archivedAt:null,sortKey:null};
 globalThis.__panelActions={listThreadRailAction:async()=>({ok:true,rail:{folders:[folder],threads:[]}})};
 const h=lifecycle(ThreadList,{...railProps,variant,scopeFolderId:folder.id});
 try{
  h.render();h.effects();await tick();const html=render(()=>h.render());
  assert.match(html,/Tierney/);assert.match(html,/Empty — start a chat here\./);assert.doesNotMatch(html,/No chats yet|Loading chats/);
 }finally{h.dispose();delete globalThis.__panelActions;}
}));

for(const variant of ['rail','drawer'])test(`${variant} ignores an unavailable active chat before and after list load`,()=>clientScope(async()=>{
 globalThis.__panelActions={listThreadRailAction:async()=>({ok:true,rail:{folders:[],threads:[thread]}})};
 const props={...railProps,variant,failureCode:'THREAD_UNAVAILABLE'},h=lifecycle(ThreadList,props);
 try{
  let html=render(()=>h.render());assert.match(html,/Loading chats/);assert.doesNotMatch(html,/This chat isn|Try again/);
  h.effects();await tick();html=render(()=>h.render());assert.match(html,/Private delete title/);
  props.failureCode=null;h.render();h.effects();props.failureCode='THREAD_UNAVAILABLE';
  html=render(()=>h.render());assert.match(html,/Private delete title/);
  h.effects();await tick();html=render(()=>h.render());
  assert.match(html,/Private delete title/);assert.doesNotMatch(html,/This chat isn|Try again/);
 }finally{h.dispose();delete globalThis.__panelActions;}
}));

test('an unavailable row action flashes the sentence and reloads without clearing other chats',()=>clientScope(async()=>{
 let reloads=0,finish;const failures=[];
 globalThis.__panelActions={
  listThreadRailAction:()=>++reloads===1?Promise.resolve({ok:true,rail:{folders:[],threads:[thread,{...thread,id:'other',title:'Other owned chat'}]}}):new Promise(resolve=>{finish=resolve;}),
  pinConversationAction:async id=>{assert.equal(id,thread.id);return {ok:false,code:'THREAD_UNAVAILABLE'};},
 };
 const h=lifecycle(ThreadList,{...railProps,onFailure:code=>failures.push(code)});
 try{
  h.render();h.effects();await tick();let tree=h.render();
  const row=nodes(tree,n=>n.props.draggable!==undefined&&nodes(n,x=>x.type==='button'&&x.props.title===thread.title).length)[0];
  nodes(row,n=>n.props['aria-label']==='More')[0].props.onClick();tree=h.render();
  nodes(tree,n=>n.props.label==='Pin')[0].props.onClick();await tick();tree=h.render();
  let html=render(()=>tree);assert.match(html,/This chat isn&#x27;t available to this account\./);
  assert.match(html,/Other owned chat/);assert.match(html,/Search threads/);
  assert.equal(nodes(tree,n=>n.type==='button'&&n.props.children==='Try again').length,0);
  assert.equal(reloads,2);assert.deepEqual(failures,[]);
  finish({ok:true,rail:{folders:[],threads:[{...thread,id:'other',title:'Other owned chat'}]}});await tick();html=render(()=>h.render());
  assert.match(html,/Other owned chat/);assert.doesNotMatch(html,/Private delete title/);
 }finally{h.dispose();delete globalThis.__panelActions;}
}));

for(const search of ['?c=foreign&m=opus&keep=1','?c=foreign&c=another&m=opus&m=sonnet&keep=1','?m=opus&keep=1'])test(`mount consumes chat parameters once, preserving route, other query, hash and history state: ${search}`,()=>clientScope(async()=>{
 const historyState={__NA:true,key:'next-entry'},replaced=[],opened=[];
 window.location=new URL(`https://sjcos.test/panel${search}#transcript`);
 window.history={state:historyState,replaceState(state,title,url){
  replaced.push({state,title,url});window.location=new URL(url,window.location);
 }};
 globalThis.__panelActions={
  listThreadRailAction:async()=>({ok:true,rail:{folders:[],threads:[]}}),
  loadConversationAction:async id=>{opened.push(id);assert.equal(window.location.search,'?keep=1');return {ok:false,code:'THREAD_UNAVAILABLE'};},
 };
 let h=lifecycle(()=>useAgentChat({getPageContext:()=>undefined}));
 try{
  h.render();h.effects();await tick();const chat=h.render();
  assert.equal(chat.failureCode,search.includes('c=')?'THREAD_UNAVAILABLE':null);
  assert.equal(chat.conversationTitle,'New chat');assert.deepEqual(chat.messages,[]);
  assert.equal(replaced.length,1);assert.equal(replaced[0].state,historyState);assert.equal(replaced[0].title,'');
  assert.equal(window.location.pathname,'/panel');assert.equal(window.location.search,'?keep=1');assert.equal(window.location.hash,'#transcript');
  h.dispose();h=lifecycle(()=>useAgentChat({getPageContext:()=>undefined}));h.render();h.effects();await tick();
  assert.equal(h.render().failureCode,null);assert.deepEqual(opened,search.includes('c=')?['foreign']:[]);assert.equal(replaced.length,1);
 }finally{h.dispose();delete globalThis.__panelActions;}
}));

test('initial composer keeps 44 px touch targets and compiles 28 px fine-pointer controls',async()=>{
 const html=render(()=>React.createElement(PanelChat,chatProps));
 for(const label of ['Attach files','Start voice conversation','Send']){
  const button=[...html.matchAll(/<button\b[^>]*>/g)].map(match=>match[0]).find(tag=>tag.includes(`aria-label="${label}"`));
  assert.ok(button,label);assert.match(button,/\bsize-11 pointer-fine:size-7\b/);
 }
 const compiler=await compile('@theme { --spacing: 0.25rem; } @tailwind utilities;');
 const css=compiler.build(['size-11','pointer-fine:size-7']);
 assert.match(css,/\.size-11\s*\{\s*width: calc\(var\(--spacing\) \* 11\);\s*height: calc\(var\(--spacing\) \* 11\);/);
 assert.match(css,/@media \(pointer: fine\)\s*\{\s*width: calc\(var\(--spacing\) \* 7\);\s*height: calc\(var\(--spacing\) \* 7\);/);
});


for(const status of [401,200,403,503,'offline'])test(`unknown action throw probes status ${status} before selecting fixed copy`,async()=>{
 const prior=globalThis.fetch,calls=[];
 globalThis.fetch=async(...args)=>{calls.push(args);if(status==='offline')throw Error('offline private cause');return {status};};
 try{
  await assert.rejects(askCall(Promise.reject(Error('unexpected HTML private cause'))),{ok:false,code:status===401?'SIGN_IN_AGAIN':'ASK_PAUSED'});
  assert.deepEqual(calls,[['/api/ai/status',{cache:'no-store'}]]);
 }finally{globalThis.fetch=prior;}
});
test('typed returned and thrown sign-in failures do not probe; successes pass through',async()=>{
 const prior=globalThis.fetch;globalThis.fetch=()=>{throw Error('must not probe known results');};
 try{
  await assert.rejects(askCall(Promise.resolve({ok:false,code:'SIGN_IN_AGAIN'})),{ok:false,code:'SIGN_IN_AGAIN'});
  await assert.rejects(askCall(Promise.reject({ok:false,code:'SIGN_IN_AGAIN'})),{ok:false,code:'SIGN_IN_AGAIN'});
  const success={ok:true,id:'owned'};assert.equal(await askCall(Promise.resolve(success)),success);
 }finally{globalThis.fetch=prior;}
});
for(const variant of ['rail','drawer'])for(const code of ['ASK_PAUSED','SIGN_IN_AGAIN'])test(`${variant} ${code} keeps normal header and close control in SSR and initial render`,()=>{
 let closed=0;const props={...railProps,variant,failureCode:code,onClose(){closed++;}},h=lifecycle(ThreadList,props);
 try{
  const tree=h.render();
  for(const html of [render(()=>React.createElement(ThreadList,props)),render(()=>tree)]){
   assert.match(html,/<div class="relative flex items-center gap-1.5 border-b border-rule px-3 py-2"><span class="text-label font-semibold text-ink-3">Threads<\/span>/);
   assert.equal((html.match(/aria-label="Close threads"/g)||[]).length,1);
   assert.match(html,/<div class="p-3[^"]*"><p role="status">/);
   assert.doesNotMatch(html,/Close Threads|Search threads|New folder/);
  }
  nodes(tree,n=>n.type==='button'&&n.props['aria-label']==='Close threads')[0].props.onClick();assert.equal(closed,1);
 }finally{h.dispose();}
});
for(const available of [false,true])test(`archived trash visibility follows capability ${available}`,()=>clientScope(async()=>{
 globalThis.__panelActions={
  listThreadRailAction:async()=>({ok:true,rail:{folders:[],threads:[]},capabilities:{deleteAvailable:available}}),
  listArchivedThreadsAction:async()=>({ok:true,threads:[{...thread,archivedAt:'2026-11-01'}]}),
 };
 const h=lifecycle(ThreadList,railProps);
 try{
  h.render();h.effects();await tick();let tree=h.render();
  nodes(tree,n=>n.type==='button'&&n.props.children==='Show archived')[0].props.onClick();h.render();h.effects();await tick();tree=h.render();
  assert.match(render(()=>tree),/Private delete title/);
  assert.equal(nodes(tree,n=>n.type==='button'&&n.props['aria-label']==='Delete').length,Number(available));
 }finally{h.dispose();delete globalThis.__panelActions;}
}));
test('picking a file in unavailable New chat clears the notice and stages the file without sending',()=>clientScope(async()=>{
 const calls=[];
 globalThis.__panelActions={
  listThreadRailAction:async()=>({ok:true,rail:{folders:[],threads:[]}}),
  newConversationAction:async()=>({ok:false,code:'THREAD_UNAVAILABLE'}),
  uploadChatFilesAction:async fd=>{calls.push(fd.get('files').name);return {ok:true,files:[{id:'upload',name:'photo.jpg',url:'/photo.jpg',kind:'image'}]};},
 };
 const h=lifecycle(PanelChat,chatProps);
 try{
  h.render();h.effects();await tick();let tree=h.render();
  nodes(tree,n=>n.type==='input'&&n.props.placeholder?.startsWith('Tell '))[0].props.onChange({target:{value:'Draft stays'}});
  tree=h.render();nodes(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});await tick();h.render();h.effects();tree=h.render();
  assert.match(render(()=>tree),/This chat isn/);
  const input=nodes(tree,n=>n.type==='input'&&n.props.type==='file')[0];
  await input.props.onChange({target:{files:null}});assert.match(render(()=>h.render()),/This chat isn/);
  await input.props.onChange({target:{files:[new File(['photo'],'photo.jpg',{type:'image/jpeg'})]}});await tick();tree=h.render();
  assert.doesNotMatch(render(()=>tree),/This chat isn/);assert.deepEqual(calls,['photo.jpg']);
  assert.match(render(()=>tree),/photo.jpg/);
  assert.equal(nodes(tree,n=>n.type==='input'&&n.props.placeholder?.startsWith('Tell '))[0].props.value,'Draft stays');
 }finally{h.dispose();delete globalThis.__panelActions;}
}));
for(const typed of [false,true])test(`expired session ${typed?'typed result':'transport throw'} shows sign in, clears content and retains draft`,()=>clientScope(async()=>{
 const prior=globalThis.fetch;let expired=false;
 globalThis.fetch=async()=>({status:401});
 globalThis.__panelActions={
  listThreadRailAction:async()=>({ok:true,rail:{folders:[],threads:[]}}),
  loadConversationAction:async()=>({ok:true,conversation:{id:'owned',agent:'claude',title:'Private title',messages:[{id:'old',body:'Private transcript'}]}}),
  sendMessageAction:async()=>{if(!expired)return {ok:true,kind:'answer',message:{id:'answer',body:'Done'}};if(typed)return {ok:false,code:'SIGN_IN_AGAIN'};throw Error('Unexpected server HTML');},
 };
 const restored=[],h=lifecycle(()=>useAgentChat({getPageContext:()=>undefined,onSendError:spec=>restored.push(spec.directive)}));
 try{
  h.render();h.effects();await tick();await h.render().openConversation('owned');assert.equal(h.render().conversationTitle,'Private title');
  expired=true;h.render().submit({directive:'Keep draft'});await tick();const chat=h.render();
  assert.equal(chat.failureCode,'SIGN_IN_AGAIN');assert.deepEqual(chat.messages,[]);assert.equal(chat.conversationTitle,'New chat');assert.deepEqual(restored,['Keep draft']);
  assert.match(render(()=>React.createElement(ThreadList,{...railProps,failureCode:chat.failureCode})),/Sign in again to continue\./);
 }finally{h.dispose();delete globalThis.__panelActions;globalThis.fetch=prior;}
}));
for(const code of ['ASK_PAUSED','SIGN_IN_AGAIN','CHAT_OFF','THREAD_UNAVAILABLE'])test(`panel voice and dictation receive recovery generation after ${code}`,()=>clientScope(async()=>{
 let state=null;
 globalThis.__panelActions={listThreadRailAction:async()=>state?{ok:false,code:state}:{ok:true,rail:{folders:[],threads:[]}}};
 const h=lifecycle(PanelChat,{...chatProps,threadsRail:true});
 try{
  h.render();h.effects();await tick();let tree=h.render();
  const rail=nodes(tree,n=>n.type===ThreadList)[0];assert.ok(rail);
  const before=globalThis.__voiceOptions.availability;
  assert.equal(before.enabled,true);assert.equal(typeof before.generation,'number');
  rail.props.onFailure(code);tree=h.render();
  assert.equal(globalThis.__voiceOptions.availability.enabled,code==='THREAD_UNAVAILABLE');
  const dictation=nodes(tree,n=>typeof n.type==='function'&&n.type.name==='PanelDictation')[0];
  assert.deepEqual(dictation.props.availability,globalThis.__voiceOptions.availability);
  if(code!=='THREAD_UNAVAILABLE'){
   state=code;await rail.props.onRetry();await tick();tree=h.render();
   assert.deepEqual(globalThis.__voiceOptions.availability,{enabled:false,generation:before.generation});
  }
  state=null;await nodes(tree,n=>n.type===ThreadList)[0].props.onRetry();
  await tick();tree=h.render();
  assert.equal(globalThis.__voiceOptions.availability.enabled,true);
  assert.ok(globalThis.__voiceOptions.availability.generation>before.generation);
 }finally{h.dispose();delete globalThis.__panelActions;delete globalThis.__voiceOptions;}
}));
test('handoff carries the exact unverified pane-host blocking condition',()=>{
 const handoff=readFileSync(new URL('docs/plans/build/ask-pane-host-phase0-HANDOFF.md',root),'utf8');
 assert.ok(handoff.slice(handoff.indexOf('Next visual round (coordinator only):')).includes('Pane-host layout (landscape strip, 839/840/1000 split, 1100 popout pane, 1280 expansion and Back to app) is not visually verified in Phase 0, because nothing registers a pane. These captures block Canvas Phase 1 build round 1.'));
});

test('shared Sign in link keeps SSR stable and returns to the current page including query and hash',()=>clientScope(async()=>{
 const {AskSignInLink}=await import('../components/panel/AskSignInLink.tsx');
 window.location=new URL('https://sjcos.test/projects/owned?tab=money#invoice');
 const h=lifecycle(AskSignInLink);
 try{
  const server=render(()=>React.createElement(AskSignInLink));
  assert.equal(render(()=>h.render()),server);h.effects();const tree=h.render();
  assert.equal(tree.props.href,'/login?returnTo='+encodeURIComponent('/projects/owned?tab=money#invoice'));
  window.location=new URL('https://sjcos.test/today?filter=waiting');const anchor={href:''};tree.props.onClick({currentTarget:anchor});
  assert.equal(anchor.href,'/login?returnTo='+encodeURIComponent('/today?filter=waiting'));
 }finally{h.dispose();}
}));

test('auth redirect digests and exact legacy auth codes normalize without accepting arbitrary login text',()=>{
 for(const path of ['/login','/login?returnTo=%2Ftoday','/logout']){
  const error=Object.assign(Error('NEXT_REDIRECT'),{digest:`NEXT_REDIRECT;push;${path};307;`});
  assert.deepEqual(askFailure(error),{ok:false,code:'SIGN_IN_AGAIN'});
 }
 for(const code of ['ASK_COOKIE_REQUIRED','ASK_SESSION_REVOKED'])assert.deepEqual(askFailure(Error(code)),{ok:false,code:'SIGN_IN_AGAIN'});
 for(const digest of ['NEXT_REDIRECT;push;/today;307;','NEXT_REDIRECT;push;https://other.test/login;307;','NEXT_REDIRECT;push;//other.test/login;307;','NEXT_REDIRECT;push;/login;bad;']){
  assert.equal(askFailure(Object.assign(Error('NEXT_REDIRECT'),{digest})),null);
 }
 assert.equal(askFailure(Error('private cause includes login')),null);
});
test('PanelDictation forwards the optional enabled/generation contract to the dictation hook',()=>clientScope(async()=>{
 const {PanelDictation:ActualDictation}=await import('../components/panel/PanelDictation.tsx');
 const onText=()=>{},props={onText,availability:{enabled:false,generation:2}},h=lifecycle(ActualDictation,props);
 try{
  assert.equal(render(()=>React.createElement(ActualDictation,props)),'');assert.equal(h.render(),null);
  assert.equal(globalThis.__dictationOptions.onText,onText);assert.deepEqual(globalThis.__dictationOptions.availability,props.availability);
  props.availability={enabled:true,generation:3};assert.match(render(()=>h.render()),/aria-label="Dictate"/);
  assert.deepEqual(globalThis.__dictationOptions.availability,props.availability);
  delete props.availability;assert.match(render(()=>h.render()),/aria-label="Dictate"/);assert.equal(globalThis.__dictationOptions.availability,undefined);
 }finally{h.dispose();delete globalThis.__dictationOptions;}
}));
for(const code of ['SIGN_IN_AGAIN','ASK_PAUSED'])test(`upload transport errors use status to report ${code} without exposing causes`,()=>clientScope(async()=>{
 const {useChatAttachments}=await import('../components/panel/useChatAttachments.ts');
 const prior=globalThis.fetch,failures=[],errors=[];globalThis.fetch=async()=>({status:code==='SIGN_IN_AGAIN'?401:503});
 globalThis.__panelActions={uploadChatFilesAction:async()=>{throw Error('Unexpected login HTML or private cause');}};
 const h=lifecycle(()=>useChatAttachments(msg=>errors.push(msg),code=>failures.push(code)));
 try{
  await h.render().uploadFiles([new File(['photo'],'photo.jpg')]);const uploads=h.render();
  assert.deepEqual(failures,[code]);assert.deepEqual(errors,[ASK_STATUS_COPY[code]]);assert.deepEqual(uploads.attachments,[]);assert.equal(uploads.uploading,false);
 }finally{h.dispose();delete globalThis.__panelActions;globalThis.fetch=prior;}
}));

for(const source of ['poll','focus','send','upload','retry'])test(`mounted shell, queue and panel retain draft on ${source} auth loss`,()=>clientScope(async()=>{
 const {LiveUpdates}=await import('../components/shell/LiveUpdates.tsx');
 const {LiveActionNav}=await import('../components/panel/LiveActionNav.tsx');
 const {postPanelMessage}=await import('../components/panel/panelBus.ts');
 const {TodayQueueProvider}=await import('../components/today/TodayQueueContext.tsx');
 const oldDoc=globalThis.document,oldInterval=globalThis.setInterval,oldClear=globalThis.clearInterval;
 const events=new Map(),timers=[];let expired=false,reads=0,refreshes=0,pushes=0;
 globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
 window.addEventListener=(name,fn)=>events.set(name,fn);window.removeEventListener=(name)=>events.delete(name);
 globalThis.setInterval=fn=>{timers.push(fn);return timers.length;};globalThis.clearInterval=()=>{};
 window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 globalThis.__panelRouter={push(){pushes++;},refresh(){refreshes++;}};
 const success={ok:true,rail:{folders:[],threads:[]}},failure={ok:false,code:'SIGN_IN_AGAIN'};
 globalThis.__panelActions={
  pollLiveChanges:async cursor=>{reads++;return expired?failure:{cursor:(cursor??0)+1,scopes:['work_items'],agentScopes:[]};},
  refreshTodayQueue:async()=>expired?failure:{priorities:[],waiting:{items:[],total:0}},
  listThreadRailAction:async()=>expired?failure:success,
  loadConversationAction:async()=>({ok:true,conversation:{id:'own',agent:'claude',title:'Private title',messages:[{id:'old',body:'Private transcript'}]}}),
  sendMessageAction:async()=>failure,uploadChatFilesAction:async()=>failure,
 };
 const nav=lifecycle(LiveActionNav),shell=lifecycle(LiveUpdates),queue=lifecycle(TodayQueueProvider,{initialPriorities:[{id:'private-priority',title:'Private priority'}],initialWaiting:{items:[{id:'private-waiting',label:'Private waiting'}],total:1}}),panel=lifecycle(PanelChat,{...chatProps,threadsRail:true});
 try{
  nav.render();nav.effects();
  postPanelMessage({type:"run",phase:"start",runId:"run",agent:"claude",subjectId:"todo"},{local:true});assert.equal(pushes,1);
  shell.render();shell.effects();queue.render();queue.effects();panel.render();panel.effects();await tick();
  assert.equal(queue.render().props.value.priorities.length,1);assert.equal(queue.render().props.value.waiting.length,1);assert.equal(queue.render().props.value.signedOut,false);
  let tree=panel.render();let rail=nodes(tree,n=>n.type===ThreadList)[0];await rail.props.onOpen('own');await tick();tree=panel.render();
  const composer=()=>nodes(panel.render(),n=>n.type==='input'&&n.props.placeholder?.startsWith('Tell '))[0];
  composer().props.onChange({target:{value:'Keep my draft'}});panel.render();
  // Positive live refresh, then leave a second refresh queued inside the gap.
  await timers[0]();await tick();assert.equal(refreshes,1);
  await timers[0]();await tick();assert.equal(refreshes,1);
  expired=true;
  if(source==='poll')await timers[0]();
  if(source==='focus')await events.get('focus')();
  if(source==='send')nodes(panel.render(),n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
  if(source==='upload')await nodes(panel.render(),n=>n.type==='input'&&n.props.type==='file')[0].props.onChange({target:{files:[new File(['x'],'x.jpg',{type:'image/jpeg'})]}});
  if(source==='retry')await nodes(panel.render(),n=>n.type===ThreadList)[0].props.onRetry();
  await tick();panel.render();panel.effects();tree=panel.render();
  const html=render(()=>tree);assert.match(html,/Sign in again to continue/);assert.doesNotMatch(html,/Private transcript|Private title/);assert.equal(composer().props.value,'Keep my draft');
  assert.equal(nodes(tree,n=>n.type===ThreadList)[0].props.failureCode,'SIGN_IN_AGAIN');
  assert.equal(queue.render().props.value.signedOut,true);
  assert.deepEqual(queue.render().props.value.priorities,[]);assert.deepEqual(queue.render().props.value.waiting,[]);
  const before=reads;await timers[0]();await events.get('focus')();await tick();assert.equal(reads,before);assert.equal(refreshes,1);
  postPanelMessage({type:"run",phase:"end",runId:"run",agent:"claude",subjectId:"todo"},{local:true});
  postPanelMessage({type:"focus",runId:"run",href:"/projects/private",label:"Private"},{local:true});
  postPanelMessage({type:"run",phase:"start",runId:"other",agent:"claude",subjectId:"other"},{local:true});
  assert.equal(pushes,1);assert.equal(refreshes,1);
  // Known expiry Retry also remains local and cannot resume automatic work.
  await nodes(tree,n=>n.type===ThreadList)[0].props.onRetry();assert.equal(background.backgroundAuthLost(),true);
 }finally{
  panel.dispose();queue.dispose();shell.dispose();nav.dispose();globalThis.document=oldDoc;globalThis.setInterval=oldInterval;globalThis.clearInterval=oldClear;
  delete globalThis.__panelActions;delete globalThis.__panelRouter;
 }
}));

// R5 expectations: cleared queues explain expiry on Today and every panel Queue
// tab; no work count/all-clear/Waiting header, and sign-in returns to this page.
for (const page of ['/today','/panel']) test(`signed-out queue at ${page} explains recovery without a false all-clear`,()=>clientScope(async()=>{
 const {TodayCards}=await import('../components/today/TodayCards.tsx');
 const {QueueRail}=await import('../components/panel/QueueRail.tsx');
 const {Segmented}=await import('../components/ui/index.ts');
 const {AskSignInLink}=await import('../components/panel/AskSignInLink.tsx');
 window.location={pathname:page,search:'',hash:''};
 globalThis.__queueState={priorities:[],waiting:[],signedOut:true};
 try{
  const cards=lifecycle(TodayCards,{brief:null});const tree=cards.render();
  assert.equal(nodes(tree,n=>n.type===Segmented)[0].props.options[0].count,undefined);
  for(const component of [()=>tree,()=>React.createElement(QueueRail,{onHandOff(){}})]){
   const html=render(component);assert.match(html,/Sign in again to continue\./);assert.match(html,/>Sign in<\/a>/);
   assert.doesNotMatch(html,/Nothing else on the list|Up next|Waiting on me/);
  }
  const link=lifecycle(AskSignInLink);link.render();link.effects();
  assert.equal(link.render().props.href,`/login?returnTo=${encodeURIComponent(page)}`);link.dispose();cards.dispose();
  // Healthy empty queues keep the true empty-state copy and zero count.
  globalThis.__queueState.signedOut=false;
  const healthy=lifecycle(TodayCards,{brief:null});const normal=healthy.render();
  assert.equal(nodes(normal,n=>n.type===Segmented)[0].props.options[0].count,0);
  assert.match(render(()=>normal),/Nothing else on the list/);healthy.dispose();
 }finally{delete globalThis.__queueState;}
}));

// Build R6 (design): signed-out pages must not show ordinary empty states — no
// "Waiting on me" card and no queue narration ("You're all clear") in the panel.
test('signed-out Today hides Waiting on me and the panel hides queue narration', async () => {
  const {TodayWaitingSummary} = await import('../components/today/TodayWaitingSummary.tsx');
  const prior = globalThis.__queueState;
  try {
    globalThis.__queueState = {priorities: [], waiting: [], signedOut: true, refresh: async () => {}};
    assert.equal(render(TodayWaitingSummary), '');
    const chat = render(() => React.createElement(PanelChat, {...chatProps, showNarration: true}));
    assert.doesNotMatch(chat, /all clear/i);
    globalThis.__queueState = {priorities: [], waiting: [], signedOut: false, refresh: async () => {}};
    assert.match(render(TodayWaitingSummary), /Waiting on me/);
    assert.match(render(() => React.createElement(PanelChat, {...chatProps, showNarration: true})), /all clear/i);
  } finally {
    if (prior === undefined) delete globalThis.__queueState; else globalThis.__queueState = prior;
  }
});

// Canvas Phase 1: actual slot components and feature adapter share Phase 0 host.
const {CanvasPane}=await import('../components/panel/CanvasPane.tsx');
const canvasStore=await import('../components/panel/canvas/store.ts');
const {useCanvasFeed}=await import('../components/panel/canvas/useCanvasFeed.tsx');
const cv={version:2,title:'Permit steps',summary:'Application through inspection.',change_note:'Moved inspection',actor:{id:'u',name:'Claude'},run_id:'r',created_at:'2026-11-05T12:00:00Z',restored_from_version:null,design:null};
const av={revision:'1',master:true,diagrams:true,pages:false,floor:false,exports:false,staff:true,source:true};
const cm={id:'canvas',thread_id:'thread',user_id:'u',created_run_id:'r',kind:'diagram',latest_version:3,created_at:cv.created_at,updated_at:cv.created_at};
const cd={ok:true,canvas:cm,selected:cv,availability:av,capabilities:{preview:true,code:true,download_formats:[],restore:true,save:false,load_latest:false},preview:{mode:'diagram_renderer',href:'/api/canvas/renderer',renderer_version:'1'}};
function canvasSetup(){const scope={userId:'u',threadId:'thread',claimToken:'test'};setAskPaneScope(scope);canvasStore.updateCanvas({scope,items:[{canvas:cm,latest:{...cv,version:3}}],events:[],availability:av,selection:{canvas:{version:2,follow:false}},views:{canvas:{data:cd,code:{ok:true,canvas_id:'canvas',version:2,kind:'diagram',code:'flowchart TD\n A["<script>alert(1)</script>"] --> B',sha256:'h',untrusted:true,availability:av}}}});return {snapshot:{kind:'canvas',id:'canvas',thread_id:'thread',user_id:'u',run_id:'r',label:cv.title,selected_version:2,latest_version:3,followLatest:false,revision:'2',attention:'new'},mode:'popout',compact:true,landscape:false,paneWidth:480,viewportWidth:1100,split:true,signal:new AbortController().signal,frameBoundary(){}};}
test('Canvas source sheet escapes source, Close preserves preview and older selection; SVG disabled/source enabled',()=>{
 const context=canvasSetup(),h=lifecycle(CanvasPane,{context,slot:'content'});
 try{
  canvasStore.patchCanvas('canvas',{sheet:'code'});let tree=h.render(),html=render(()=>tree);
  assert.match(html,/Show code/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
  const overlay=nodes(tree,n=>typeof n.type==='function'&&n.type.name==='CanvasOverlay')[0];overlay.props.onClose();tree=h.render();
  assert.equal(canvasStore.canvasState().views.canvas.sheet,undefined);assert.equal(canvasStore.canvasState().selection.canvas.version,2);
  canvasStore.patchCanvas('canvas',{sheet:'menu'});tree=h.render();
  assert.equal(nodes(tree,n=>n.type==='button'&&n.props.children==='Drawing (SVG)')[0].props.disabled,true);
  assert.equal(nodes(tree,n=>n.type==='button'&&n.props.children==='Diagram code (.mmd)')[0].props.disabled,false);
  html=render(()=>tree);assert.doesNotMatch(html,/Save to project files|Print \/ Save PDF|Page \(HTML\)|Floor plan/);
 }finally{h.dispose();canvasStore.clearCanvas();setAskPaneScope(null);}
});
test('Canvas fix and Ask for a change prefill exact version, focus Chat, and never send',()=>{
 const context=canvasSetup(),prefills=[];canvasStore.updateCanvas({prefill:(...a)=>prefills.push(a)});
 const content=lifecycle(CanvasPane,{context,slot:'content'}),actions=lifecycle(CanvasPane,{context,slot:'actions'});
 try{
  canvasStore.patchCanvas('canvas',{renderError:'RENDER_FAILED'});
  const tree=content.render();nodes(tree,n=>n.type==='button'&&n.props.children==='Ask Claude to fix it')[0].props.onClick();
  nodes(actions.render(),n=>n.type==='button'&&n.props.children==='Ask for a change')[0].props.onClick();
  assert.deepEqual(prefills,[['Fix the "Permit steps" diagram (version 2). The error was: The diagram could not be drawn.','canvas',2],['Change the "Permit steps" diagram (version 2): ','canvas',2]]);
 }finally{content.dispose();actions.dispose();canvasStore.clearCanvas();setAskPaneScope(null);}
});
test('Canvas title/meta/actions use the shared compact slots and step versions without enabling follow',()=>{
 const context=canvasSetup(),h=lifecycle(CanvasPane,{context,slot:'actions'});
 try{
  nodes(h.render(),n=>n.type==='button'&&n.props['aria-label']==='Previous version')[0].props.onClick();
  assert.deepEqual(canvasStore.canvasState().selection.canvas,{version:1,follow:false});
  const meta=lifecycle(CanvasPane,{context,slot:'meta'});const html=render(()=>meta.render());assert.match(html.replaceAll('<!-- -->',''),/Version 3 is ready/);assert.match(html,/Latest/);meta.dispose();
  canvasStore.updateCanvas({updating:true});const updating=lifecycle(CanvasPane,{context,slot:'meta'});assert.match(render(()=>updating.render()),/Claude is updating this canvas…/);updating.dispose();
 }finally{h.dispose();canvasStore.clearCanvas();setAskPaneScope(null);}
});
test('Canvas feature off performs no identity, fetch or registration and keeps Phase 0 selector',()=>clientScope(async()=>{
 const old=process.env.NEXT_PUBLIC_SJC_CANVAS_ENABLED;process.env.NEXT_PUBLIC_SJC_CANVAS_ENABLED='0';let identities=0;globalThis.__canvasIdentity=()=>{identities++;};
 const h=lifecycle(()=>useCanvasFeed({threadId:'thread',pending:false,blocked:false,activeRunId:null,prefill(){}}));
 try{assert.equal(h.render(),null);h.effects();await tick();assert.equal(identities,0);const html=render(()=>React.createElement(PanelDock,{width:390,inWindow:true}));assert.doesNotMatch(html,/role="tab"[^>]*aria-label="Canvas/);}finally{h.dispose();delete globalThis.__canvasIdentity;if(old===undefined)delete process.env.NEXT_PUBLIC_SJC_CANVAS_ENABLED;else process.env.NEXT_PUBLIC_SJC_CANVAS_ENABLED=old;}
}));
test('Canvas feed drains forward after newest, merges groups, changes claim on kill and clears cached source',()=>clientScope(async()=>{
 const old=process.env.NEXT_PUBLIC_SJC_CANVAS_ENABLED,doc=globalThis.document,fetch=globalThis.fetch,interval=globalThis.setInterval,clear=globalThis.clearInterval;
 process.env.NEXT_PUBLIC_SJC_CANVAS_ENABLED='1';globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{};
 globalThis.__canvasIdentity=async()=>({ok:true,userId:'u'});
 let killed=false;const calls=[];const event=n=>({id:String(n),thread_id:'thread',actor_user_id:'u',run_id:'r',at:cv.created_at,group_id:'run:r:canvas:canvas',kind:'updated',canvas_id:'canvas',version:{...cv,version:n}});
 globalThis.fetch=async url=>{calls.push(url);if(url.includes('/canvases?'))return {ok:true,json:async()=>({ok:true,canvases:killed?[]:[{canvas:cm,latest:{...cv,version:3}}],next_cursor:null,availability:killed?{...av,revision:'2',master:false}:av})};const after=new URL('https://s'+url).searchParams.get('after');return {ok:true,json:async()=>({ok:true,events:killed?[]:after==='2'?[event(3)]:after?[event(2)]:[event(1)],cursor:killed?'4':after==='2'?'3':after?'2':'1',next_before:'older',has_more:!after||after==='1',availability:killed?{...av,revision:'2',master:false}:av})};};
 const props={threadId:'thread',pending:true,blocked:false,activeRunId:'r',prefill(){}};const h=lifecycle(()=>useCanvasFeed(props));
 try{
  h.render();h.effects();await tick();await tick();
  const state=h.render();assert.equal(state.events.length,3);assert.equal(calls.filter(x=>x.includes('canvas-events')).length,3);assert.ok(calls.some(x=>x.includes('after=2')));
  const claim=canvasStore.canvasState().scope.claimToken;canvasStore.patchCanvas('canvas',{code:{code:'private source'}});killed=true;
  // Changing run cadence triggers an immediate refresh without dropping history.
  props.pending=false;h.render();h.effects();await tick();await tick();
  assert.notEqual(canvasStore.canvasState().scope.claimToken,claim);assert.deepEqual(canvasStore.canvasState().views,{});assert.deepEqual(canvasStore.canvasState().items,[]);
 }finally{h.dispose();canvasStore.clearCanvas();setAskPaneScope(null);globalThis.document=doc;globalThis.fetch=fetch;globalThis.setInterval=interval;globalThis.clearInterval=clear;delete globalThis.__canvasIdentity;if(old===undefined)delete process.env.NEXT_PUBLIC_SJC_CANVAS_ENABLED;else process.env.NEXT_PUBLIC_SJC_CANVAS_ENABLED=old;}
}));

test('DiagramStage verifies exact frame/null origin/nonce, sends only source and disposes its port on abort',()=>clientScope(async()=>{
 const {DiagramStage}=await import('../components/panel/canvas/DiagramStage.tsx');
 const context=canvasSetup(),controller=new AbortController();context.signal=controller.signal;
 const old={document:globalThis.document,MessageChannel:globalThis.MessageChannel,ResizeObserver:globalThis.ResizeObserver,matchMedia:globalThis.matchMedia,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 const callbacks=new Map(),ports=[],sent=[],removed=[],boundary=[];
 window.addEventListener=(name,fn)=>callbacks.set(name,fn);window.removeEventListener=(name)=>callbacks.delete(name);
 globalThis.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 globalThis.MessageChannel=class{constructor(){this.port1={onmessage:null,postMessage:m=>sent.push(m),start(){},close(){this.closed=true;}};this.port2={};ports.push(this);}};
 globalThis.setTimeout=()=>1;globalThis.clearTimeout=()=>{};
 const contentWindow={postMessage:(...args)=>sent.push(args)};
 context.frameBoundary=(...args)=>boundary.push(args);
 const h=lifecycle(DiagramStage,{id:'canvas',version:cv,code:canvasStore.canvasState().views.canvas.code,context});
 try{
  h.render();h.slots[0].current={contentWindow,removeAttribute:name=>removed.push(name)};
  h.slots[1].current={getBoundingClientRect:()=>({width:480,height:500}),addEventListener(){},removeEventListener(){}};
  h.effects();
  const ready={type:'canvas-ready',instance_id:'a'.repeat(32),nonce:'b'.repeat(32)};
  callbacks.get('message')({source:{},origin:'null',data:ready});assert.equal(ports.length,0);
  callbacks.get('message')({source:contentWindow,origin:'https://app.test',data:ready});assert.equal(ports.length,0);
  callbacks.get('message')({source:contentWindow,origin:'null',data:ready});assert.equal(ports.length,1);
  const receive=data=>ports[0].port1.onmessage({data:{instance_id:ready.instance_id,nonce:ready.nonce,sequence:0,...data}});
  receive({type:'ready',nonce:'wrong'});assert.equal(sent.length,1);
  receive({type:'ready'});assert.equal(sent[1].type,'render');assert.equal(sent[1].source,canvasStore.canvasState().views.canvas.code.code);assert.equal(sent[1].version,2);assert.doesNotMatch(JSON.stringify(sent),/Cookie|Authorization|grant|token|secret/);
  receive({type:'escape',sequence:1});assert.equal(boundary[0][1],'escape');
  receive({type:'rendered',sequence:1,canvas_id:'other',version:2,svg:'<svg/>',width:100,height:100});assert.notEqual(canvasStore.canvasState().views.canvas.ready,true);
  receive({type:'rendered',sequence:1,canvas_id:'canvas',version:2,svg:'<svg/>',width:100,height:100});assert.equal(canvasStore.canvasState().views.canvas.ready,true);
  controller.abort();assert.equal(ports[0].port1.closed,true);assert.deepEqual(removed,['src']);
 }finally{h.dispose();for(const [k,v]of Object.entries(old))globalThis[k]=v;canvasStore.clearCanvas();setAskPaneScope(null);}
}));

test('enabled Canvas offers an authenticated empty pane before the first chat is created',()=>clientScope(async()=>{
 const old=process.env.NEXT_PUBLIC_SJC_CANVAS_ENABLED,doc=globalThis.document,interval=globalThis.setInterval,clear=globalThis.clearInterval;
 process.env.NEXT_PUBLIC_SJC_CANVAS_ENABLED='1';globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{};globalThis.__canvasIdentity=async()=>({ok:true,userId:'u',availability:av});
 const h=lifecycle(()=>useCanvasFeed({threadId:null,pending:false,blocked:false,activeRunId:null,prefill(){}}));
 try{h.render();h.effects();await tick();assert.equal(h.render().scope.threadId,'new-chat');const {getAskPaneFeed}=await import('../components/panel/askPaneRegistry.ts');assert.equal(getAskPaneFeed().snapshots[0].id,'empty');assert.equal(getAskPaneFeed().snapshots[0].selected_version,0);}finally{h.dispose();globalThis.document=doc;globalThis.setInterval=interval;globalThis.clearInterval=clear;delete globalThis.__canvasIdentity;if(old===undefined)delete process.env.NEXT_PUBLIC_SJC_CANVAS_ENABLED;else process.env.NEXT_PUBLIC_SJC_CANVAS_ENABLED=old;}
}));
test('late canvas source cannot repaint after the person/thread claim changes',async()=>{
 canvasSetup();const prior=globalThis.fetch;let finish;globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
 const c=new AbortController();const load=canvasStore.loadCanvas('canvas',2,c.signal);
 const next={userId:'other',threadId:'other-thread',claimToken:'next'};canvasStore.clearCanvas();canvasStore.updateCanvas({scope:next});
 try{finish({ok:true,json:async()=>({...cd,capabilities:{...cd.capabilities,code:false}})});await load;assert.deepEqual(canvasStore.canvasState().views,{});}finally{c.abort();globalThis.fetch=prior;canvasStore.clearCanvas();setAskPaneScope(null);}
});

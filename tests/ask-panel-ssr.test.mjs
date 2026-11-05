import {test} from 'node:test';
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
 ['@/components/today/PriorityCard',`export const PriorityCard=()=>null;`],
 ['@/components/today/ModelActionChips',`export const ModelActionChips=()=>null;`],
 ['next/navigation',`export const useRouter=()=>({push(){}});export const usePathname=()=>'/panel';`],
 ['@/components/today/TodayQueueContext',`export const useTodayQueue=()=>({priorities:[],waiting:[],refresh:async()=>{}});`],
 ['@/lib/use-voice-round',`export const useVoiceRound=()=>({phase:'idle',voiceMode:false,supported:true});`],
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
  if(c.parentURL==='panel-react:hooks')return n(s,{...c,parentURL:import.meta.url});
  if(s==='react'&&c.parentURL?.includes('/components/panel/'))return {url:'panel-react:hooks',shortCircuit:true};
  if(stubs.has(s))return {url:'panel-stub:'+s,shortCircuit:true};
  if(s.startsWith('@/lib/actions/'))return {url:'panel-action:'+s,shortCircuit:true};
  if(s.startsWith('@/')||s.startsWith('.')){
   const u=s.startsWith('@/')?new URL(s.slice(2),root):new URL(s,c.parentURL);
   for(const ext of ['', '.ts','.tsx'])if(existsSync(new URL(u.href+ext))&&statSync(new URL(u.href+ext)).isFile())return {url:u.href+ext,shortCircuit:true};
  }
  return n(s,c);
 },
 load(u,c,n){
  if(u==='panel-react:hooks')return {format:'module',shortCircuit:true,source:`import * as Real from 'react';export * from 'react';`+hookNames.map(k=>`export const ${k}=(...a)=>(globalThis.__panelHooks?.${k}??Real.${k})(...a);`).join('')};
  if(u.startsWith('panel-stub:'))return {format:'module',source:stubs.get(u.slice(11)),shortCircuit:true};
  if(u.startsWith('panel-action:')){
   // Export only imported runtime action names; calls are controlled per test.
   const files=['useAgentChat.ts','ThreadList.tsx','useChatAttachments.ts'];
   const names=new Set();
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
const {ASK_STATUS_COPY,askFailure}=await import('../components/panel/askStatusCopy.ts');
const railProps={currentId:null,variant:'rail',scopeFolderId:null,onOpen(){},onNew(){},onNewFor(){},onScopeChange(){},onCurrentRemoved(){}};
function clientScope(work){
 const prior={window:globalThis.window,sessionStorage:globalThis.sessionStorage,BroadcastChannel:globalThis.BroadcastChannel};
 const session=storage({});globalThis.sessionStorage=session;globalThis.BroadcastChannel=undefined;
 globalThis.window={sessionStorage:session,localStorage:storage({}),location:{search:''},addEventListener(){},removeEventListener(){},setTimeout(){},confirm(){return true;}};
 return Promise.resolve().then(work).finally(()=>{for(const [key,value]of Object.entries(prior)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
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
  if(!available){assert.equal(action.props.description,ASK_STATUS_COPY.DELETE_NOT_READY);assert.equal(calls.length,0);return;}
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

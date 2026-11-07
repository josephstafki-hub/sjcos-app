import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hostWidths, deviceCases, escapeLayers} from './fixtures/ask-pane-host.mjs';
import {askPaneLayout, splitterKey, clampChat, readPaneWidth, writePaneWidth, paneLayoutKey, paneTransition, initialPaneState, topEscapeLayer, arrivalSelection, tabKey, canvasAnnouncement, paneUrl} from '../components/panel/askPaneLayout.ts';
const near = (a,b) => assert.ok(Math.abs(a-b)<0.001, `${a} ≠ ${b}`);
for (const row of hostWidths) test(`H5 measured content ${row.width}`, () => {
 const l=askPaneLayout({width:row.width,height:900,mode:'popout',selected:true});
 assert.equal(l.split,row.split); near(l.chat,row.chat); near(l.gutter,row.gutter); near(l.pane,row.pane);
});
for (const row of deviceCases) test(`H5 ${row.name}`, () => {
 const l=askPaneLayout({...row,selected:true,safeArea:80});
 assert.equal(l.compact,row.compact); assert.equal(l.landscape,row.landscape);
 if(row.stage) near(l.stage,row.stage); if(row.pane) near(l.pane,row.pane);
 if(row.landscape) { assert.ok(l.strip>=64); assert.equal(l.actionColumn,128); assert.ok(l.stage>=200); assert.equal(l.split,false); }
});
test('compact bounds use allocated pane and height independently',()=>{
 for (const width of [430,600,639,640,744,820]) for(const height of [599,600]) {
  const l=askPaneLayout({width,height,mode:'popout',selected:true}); assert.equal(l.compact,width<640||height<600);
 }
 assert.equal(askPaneLayout({width:1000,height:900,mode:'popout',selected:true}).compact,true);
});
test('nothing registered preserves the 560/880 Queue/Threads layout and dock',()=>{
 for(const width of [360,420,559,560,839,880,1280]) {
  const l=askPaneLayout({width,height:900,mode:'dock',selected:false});
  assert.equal(l.split,false); assert.equal(l.queueColumn,width>=560); assert.equal(l.threadsColumn,width>=880); assert.equal(l.expanded,false);
 }
});
test('resting arrivals never expand dock; explicit dock uses captured width and dynamic bounds',()=>{
 assert.equal(askPaneLayout({width:1280,height:900,mode:'dock',selected:false,dockWidth:420}).expanded,false);
 const l=askPaneLayout({width:1280,height:900,mode:'dock',selected:true,dockWidth:420});
 near(l.chat,420); near(l.pane,848); assert.equal(l.reset,420); assert.equal(l.max,788);
 for(const dockWidth of [320,900]) assert.equal(askPaneLayout({width:1280,height:900,mode:'dock',selected:true,dockWidth}).split,false);
});
test('splitter pointer minima and dynamic keyboard Arrow/Shift/Home/End/reset',()=>{
 const l=askPaneLayout({width:1000,height:900,mode:'popout',selected:true});
 assert.equal(clampChat(-1,l.min,l.max),340); assert.equal(clampChat(9999,l.min,l.max),508);
 for(const [key,shift,w] of [['ArrowLeft',false,404],['ArrowRight',false,436],['ArrowRight',true,484],['Home',false,340],['End',false,508],['Enter',false,420]]) assert.equal(splitterKey(420,key,shift,l),w);
 assert.equal(splitterKey(500,'ArrowRight',true,l),508);
 const dock=askPaneLayout({width:1280,height:900,mode:'dock',selected:true,dockWidth:450}); assert.equal(splitterKey(700,'Enter',false,dock),450);
});
test('scoped storage survives throws, bad values and isolates person/device; writes only width',()=>{
 const map=new Map(); const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 writePaneWidth(storage,'joe','device1',450); assert.equal(readPaneWidth(storage,'joe','device1'),450);
 assert.equal(readPaneWidth(storage,'staff','device1'),null); assert.equal(readPaneWidth(storage,'joe','device2'),null);
 assert.match(paneLayoutKey('joe','device1'),/^sjcos:ask-pane-layout:v1:joe:device1$/);
 assert.deepEqual([...map.values()],['450']);
 const bad={getItem(){throw Error('private')},setItem(){throw Error('quota')}};
 assert.equal(readPaneWidth(bad,'joe','d'),null); assert.doesNotThrow(()=>writePaneWidth(bad,'joe','d',400));
 for(const value of ['null','NaN','{}','-10']) {map.set(paneLayoutKey('joe','device1'),value); assert.equal(readPaneWidth(storage,'joe','device1'),null);}
});
test('one history entry, replace on switch/rotation, Back and sheet close consume once',()=>{
 let s=initialPaneState('joe/thread');
 s=paneTransition(s,{type:'select',ref:{kind:'canvas',id:'c'},mode:'sheet'}); assert.equal(s.history,'push');
 s=paneTransition(s,{type:'select',ref:{kind:'browser',id:'b'},mode:'sheet'}); assert.equal(s.history,'replace');
 s=paneTransition(s,{type:'rotate'}); assert.equal(s.history,'none'); assert.equal(s.selected.id,'b');
 s=paneTransition(s,{type:'close-operator'}); assert.equal(s.history,'back'); assert.equal(s.selected,null); assert.equal(s.remembered.id,'b');
 s=paneTransition(s,{type:'reopen',authorized:true,mode:'sheet'}); assert.equal(s.selected.id,'b');
 s=paneTransition(s,{type:'pop'}); assert.equal(s.history,'none'); assert.equal(s.selected,null);
});
test('popout never pushes; denied reopen and scope changes remove old private selection',()=>{
 let s=paneTransition(initialPaneState('a'),{type:'select',ref:{kind:'canvas',id:'c'},mode:'popout'}); assert.equal(s.history,'none');
 s=paneTransition(s,{type:'scope',scope:'b'}); assert.equal(s.selected,null); assert.equal(s.remembered,null);
 s=paneTransition(s,{type:'reopen',authorized:false,mode:'sheet'}); assert.equal(s.selected,null);
});
test('failed leave cannot commit a switch/exit; direct links replace rather than Back',()=>{
 let s=paneTransition(initialPaneState('a'),{type:'select',ref:{kind:'browser',id:'b'},mode:'dock'});
 assert.deepEqual(paneTransition(s,{type:'exit',leaveAllowed:false}),s);
 assert.deepEqual(paneTransition(s,{type:'select',ref:{kind:'canvas',id:'c'},mode:'dock',leaveAllowed:false}),s);
 s={...s,ownsEntry:false}; assert.equal(paneTransition(s,{type:'exit'}).history,'replace');
});
test('actual innermost Escape only; newly opened leave confirm cannot fall through',()=>{
 const layers=Object.entries(escapeLayers).map(([id,priority])=>({id,priority}));
 assert.equal(topEscapeLayer(layers).id,'menu'); assert.equal(topEscapeLayer(layers.filter(x=>x.id!=='menu')).id,'sheet');
 assert.equal(topEscapeLayer([{id:'review',priority:400},{id:'leave',priority:300}]).id,'review');
 assert.equal(topEscapeLayer([]),null);
});
test('attention is deterministic for simultaneous arrivals and respects human choice/takeover',()=>{
 const canvas={kind:'canvas',id:'c',attention:'new'}; const browser={kind:'browser',id:'b',attention:'needs_you',takeover:true};
 for(const arrivals of [[canvas,browser],[browser,canvas]]) {
  assert.equal(arrivalSelection({arrivals,selected:null,expanded:true,canFollow:true}).kind,'browser');
  assert.equal(arrivalSelection({arrivals,selected:null,expanded:false,canFollow:true}),null);
  assert.deepEqual(arrivalSelection({arrivals,selected:{kind:'canvas',id:'c'},humanChoice:true,expanded:true,canFollow:true}),{kind:'canvas',id:'c'});
 }
 assert.equal(arrivalSelection({arrivals:[canvas,{...browser,attention:'new',takeover:false}],selected:null,expanded:true,canFollow:true}),null);
 for(const canFollow of [false,true]) assert.equal(arrivalSelection({arrivals:[canvas],selected:null,expanded:true,canFollow})?.id??null,canFollow?'c':null);
});
test('vertical/horizontal tabs and follow announcements',()=>{
 const tabs=['queue','chat','canvas','browser'];
 assert.equal(tabKey(tabs,'chat','ArrowDown',true),'canvas'); assert.equal(tabKey(tabs,'chat','ArrowRight',true),null);
 assert.equal(tabKey(tabs,'chat','ArrowRight',false),'canvas'); assert.equal(tabKey(tabs,'canvas','Home',false),'queue'); assert.equal(tabKey(tabs,'queue','End',true),'browser');
 assert.equal(canvasAnnouncement('Permit steps',3,true),'Canvas updated: Permit steps, version 3'); assert.equal(canvasAnnouncement('Permit steps',3,false),'Version 3 is ready.');
});
test('pane URL preserves route/query/hash and uses IDs only',()=>{
 assert.equal(paneUrl('/today?job=a#card',{kind:'canvas',id:'c'}),'/today?job=a&canvas=c#card');
 assert.equal(paneUrl('/today?canvas=c&job=a',{kind:'browser',id:'b'}),'/today?job=a&browser=b');
 assert.equal(paneUrl('/today?record=x&job=a',null),'/today?job=a');
});

// Exercise the actual runtime contracts as well as the policy reducer.
import {registerAskPane,setAskPaneScope,publishAskPaneSnapshots,getAskPaneFeed,selectAskPane,registerAskPaneOverlay,askPaneOverlays} from '../components/panel/askPaneRegistry.ts';
import {AskPaneHistory} from '../components/panel/askPaneHistory.ts';
function fakeWindow(href='/today?job=a#row') {
 const events=new EventTarget(); const stack=[{url:new URL(href,'https://sjcos.example'),state:{next:'preserved'}}];let index=0;
 const win={crypto:{randomUUID:()=> 'local-device'},scrollX:0,scrollY:177,scrollTo(x,y){this.scrollX=x;this.scrollY=y;},addEventListener:events.addEventListener.bind(events)};
 Object.defineProperty(win,'location',{get:()=>stack[index].url});
 win.history={get state(){return stack[index].state;},pushState(state,_,url){stack.splice(index+1);stack.push({state,url:new URL(url,stack[index].url)});index++;},replaceState(state,_,url){stack[index]={state,url:new URL(url,stack[index].url)};},back(){this.go(-1);},go(delta){index+=delta;queueMicrotask(()=>events.dispatchEvent(new Event('popstate')));}};
 return {win,stack,get index(){return index;}};
}
test('runtime history: switch replaces one entry; exit sanitizes Forward and restores route/scroll/state',async()=>{
 const f=fakeWindow(),h=new AskPaneHistory(f.win);
 h.open({kind:'canvas',id:'c'}); assert.equal(f.stack.length,2); assert.match(f.win.location.search,/canvas=c/);
 h.open({kind:'browser',id:'b'}); assert.equal(f.stack.length,2); assert.match(f.win.location.search,/browser=b/);
 f.win.scrollY=0; await h.consume(); assert.equal(f.index,0); assert.equal(f.win.location.href,'https://sjcos.example/today?job=a#row'); assert.equal(f.win.scrollY,177); assert.equal(f.win.history.state.next,'preserved');
 assert.equal(f.stack[1].url.search,'?job=a'); assert.equal(f.stack[1].state.sjcosAskPane,undefined);
 f.win.history.go(1); await Promise.resolve();assert.equal(h.isOurEntry(),false);
});
test('runtime direct links replace on exit and do not create an entry',async()=>{
 const f=fakeWindow('/today?canvas=c&job=a'),h=new AskPaneHistory(f.win);
 h.open({kind:'canvas',id:'c'},true); assert.equal(f.stack.length,1); await h.consume(); assert.equal(f.index,0);assert.equal(f.win.location.search,'?job=a');
});
test('runtime app navigation waits for exit before one router navigation',async()=>{
 const f=fakeWindow(),h=new AskPaneHistory(f.win);h.open({kind:'browser',id:'b'});
 const calls=[]; const leave=async allowed=>{if(!allowed)return;await h.consume();calls.push('/projects');};
 await leave(false);assert.equal(calls.length,0);assert.equal(f.index,1);
 await leave(true);assert.deepEqual(calls,['/projects']);assert.equal(f.index,0);
});
test('runtime registry filters identity, ignores late claims, aborts old renderers and stores no metadata',()=>{
 const a={userId:'a',threadId:'t',claimToken:'claim1'},b={userId:'b',threadId:'t2',claimToken:'claim2'};
 const remove=registerAskPane({id:'canvas',render:()=>({content:null})});
 assert.throws(()=>registerAskPane({id:'canvas',render:()=>({content:null})}));
 setAskPaneScope(a); const signal=getAskPaneFeed().signal;
 const snap={user_id:'a',thread_id:'t',run_id:null,label:'private title',attention:'new',revision:'1',kind:'canvas',id:'c',selected_version:1,latest_version:1};
 assert.equal(publishAskPaneSnapshots(a,[snap,{...snap,user_id:'b',id:'wrong'}]),true);assert.equal(getAskPaneFeed().snapshots.length,1);
 selectAskPane(a,{kind:'canvas',id:'c'});assert.equal(getAskPaneFeed().request.ref.id,'c');
 setAskPaneScope(b);assert.equal(signal.aborted,true);assert.equal(getAskPaneFeed().snapshots.length,0);assert.equal(getAskPaneFeed().request,null);
 assert.equal(publishAskPaneSnapshots(a,[snap]),false);selectAskPane(a,{kind:'canvas',id:'c'});assert.equal(getAskPaneFeed().request,null);
 remove();setAskPaneScope(null);assert.equal(getAskPaneFeed().registrations.length,0);
});
test('runtime overlay close consumes only the current registered layer and scopes claims',()=>{
 const scope={userId:'a',threadId:'t',claimToken:'1'},other={...scope,claimToken:'2'},calls=[];
 const sheet=registerAskPaneOverlay({scope,priority:500,onEscape:()=>calls.push('sheet')});
 let menu;menu=registerAskPaneOverlay({scope,priority:600,onEscape:()=>{calls.push('menu');menu();}});
 registerAskPaneOverlay({scope:other,priority:999,onEscape:()=>calls.push('wrong')})();
 topEscapeLayer(askPaneOverlays(scope)).onEscape();assert.deepEqual(calls,['menu']);
 topEscapeLayer(askPaneOverlays(scope)).onEscape();assert.deepEqual(calls,['menu','sheet']);sheet();
});
import {rememberAskPane,recalledAskPane} from '../components/panel/askPaneRegistry.ts';
test('remembered selection keeps IDs/version/followLatest only and needs fresh authorization after close',()=>{
 const scope={userId:'joe',threadId:'thread',claimToken:'old'};
 const snapshot={kind:'canvas',id:'c',selected_version:2,latest_version:3,followLatest:false,label:'secret title',source:'private source',frames:['secret']};
 rememberAskPane(scope,snapshot);
 assert.deepEqual(recalledAskPane(scope),{kind:'canvas',id:'c',selected_version:2,followLatest:false});
 assert.equal(recalledAskPane({...scope,userId:'staff'}),null);assert.equal(recalledAskPane({...scope,threadId:'other'}),null);
 setAskPaneScope(scope);setAskPaneScope(null);assert.equal(publishAskPaneSnapshots(scope,[]),false);
 const fresh={...scope,claimToken:'new'};setAskPaneScope(fresh);assert.equal(publishAskPaneSnapshots(fresh,[]),true);
 assert.equal(getAskPaneFeed().snapshots.length,0);setAskPaneScope(null);rememberAskPane(scope,null);
});
import {askFocusTargets,trapAskFocus,moveAskFrameFocus} from '../components/panel/askPaneFocus.ts';
test('focus policy includes iframe and excludes hidden controls; Tab wraps within the modal',()=>{
 const previous=globalThis.document;
 try {
  const nodes=['close','iframe','hidden','last'].map(name=>({name,focus(){globalThis.document.activeElement=this;},getClientRects:()=>name==='hidden'?[]:[{}],closest:()=>null}));
  let selector='';const root={querySelectorAll(value){selector=value;return nodes;},contains:node=>nodes.includes(node),focus(){globalThis.document.activeElement=this;}};
  globalThis.document={activeElement:nodes[3]};
  assert.deepEqual(askFocusTargets(root).map(x=>x.name),['close','iframe','last']);assert.match(selector,/iframe/);
  const event={key:'Tab',shiftKey:false,preventDefault(){this.defaultPrevented=true;}};
  trapAskFocus(event,root);assert.equal(globalThis.document.activeElement,nodes[0]);assert.equal(event.defaultPrevented,true);
  trapAskFocus({...event,defaultPrevented:false,shiftKey:true},root);assert.equal(globalThis.document.activeElement,nodes[3]);
  moveAskFrameFocus(root,nodes[1],false);assert.equal(globalThis.document.activeElement,nodes[3]);
  moveAskFrameFocus(root,nodes[1],true);assert.equal(globalThis.document.activeElement,nodes[0]);
 }finally{globalThis.document=previous;}
});
test('840px splitter has usable dynamic bounds and clamps all stored widths',()=>{
 for(const chatWidth of [-10,99999]) {
  const l=askPaneLayout({width:840,height:900,mode:'popout',selected:true,chatWidth});
  assert.equal(l.min,340);assert.equal(l.max,348);assert.ok(l.chat>=340&&l.chat<=348);assert.ok(l.pane>=480);
  assert.equal(splitterKey(l.chat,'Home',false,l),340);assert.equal(splitterKey(l.chat,'End',false,l),348);
 }
});
test('Browser registration requires its leave/pause guard',()=>{
 assert.throws(()=>registerAskPane({id:'browser',render:()=>({content:null})}),/leave guard/);
 const remove=registerAskPane({id:'browser',render:()=>({content:null}),beforeLeave:async()=>false});remove();
});
test('explicit Queue/Chat choice blocks later routine following arrivals',()=>{
 const s=paneTransition(initialPaneState('a'),{type:'human'});
 assert.equal(s.humanChoice,true);
 assert.equal(arrivalSelection({arrivals:[{kind:'canvas',id:'c',attention:'new'}],selected:null,expanded:true,canFollow:true,humanChoice:s.humanChoice}),null);
});

test('short landscape popout uses the shared strip and 128px action column',()=>{
 const l=askPaneLayout({width:800,height:360,mode:'popout',selected:true,safeArea:80});
 assert.equal(l.landscape,true);assert.equal(l.strip,64);assert.equal(l.actionColumn,128);assert.ok(l.stage>=200);assert.equal(l.split,false);
 assert.equal(askPaneLayout({width:800,height:360,mode:'popout',selected:false}).landscape,false);
 assert.equal(askPaneLayout({width:800,height:600,mode:'popout',selected:true}).landscape,false);
});

test('C28 per-kind publication and Canvas revocation preserve Browser identity and signal',async()=>{
 const {publishAskPaneKind,refreshAskPaneKindSignal}=await import('../components/panel/askPaneRegistry.ts');
 const scope={userId:'joe',threadId:'local',claimToken:'new'};setAskPaneScope(scope);
 const common={user_id:'joe',thread_id:'local',run_id:null,revision:'1',attention:'none',label:'Safe'};
 const b={...common,kind:'browser',id:'b',task_id:'b',status:'active',takeover:false};
 const c={...common,kind:'canvas',id:'c',selected_version:1,latest_version:1};
 publishAskPaneKind(scope,'browser',[b]);const signal=getAskPaneFeed().signal;
 publishAskPaneKind(scope,'canvas',[c],true);assert.deepEqual(getAskPaneFeed().snapshots.map(x=>x.kind),['browser','canvas']);
 publishAskPaneKind(scope,'canvas',[]);assert.deepEqual(getAskPaneFeed().snapshots,[b]);assert.equal(getAskPaneFeed().signal,signal);assert.equal(signal.aborted,false);refreshAskPaneKindSignal(scope,'canvas');const canvasSignal=getAskPaneFeed().kindSignals.canvas;refreshAskPaneKindSignal(scope,'canvas');assert.equal(canvasSignal.aborted,true);assert.equal(signal.aborted,false);assert.deepEqual(getAskPaneFeed().snapshots,[b]);
 assert.equal(publishAskPaneKind({...scope,claimToken:'old'},'browser',[]),false);assert.deepEqual(getAskPaneFeed().snapshots,[b]);setAskPaneScope(null);
});
test('C29 rendered shared Browser shell retains 48/20 center, 128 landscape actions and one region',async()=>{
 const {browserRenderHarness,browserLandscapeRows}=await import('./fixtures/ask-pane-host.mjs');const render=await browserRenderHarness();
 const {AskContentPane}=await import('../components/panel/AskContentPane.tsx');const React=await import('react');
 for(const row of browserLandscapeRows.filter(x=>!x.name.startsWith('owner'))){const html=render(AskContentPane,{id:'browser',registration:{id:'browser',beforeLeave:async()=>true,render:()=>({content:React.createElement('p',null,'Browser page'),actions:React.createElement('button',null,'Close')})},snapshot:{kind:'browser',id:'b',task_id:'b',label:'city.example',thread_id:'t',user_id:'u',run_id:null},mode:'sheet',compact:true,landscape:true,split:false,paneWidth:736,viewportWidth:800,signal:new AbortController().signal,frameBoundary(){},onExit(){},entrySerial:1});assert.match(html,/grid-template-columns:minmax\(0,1fr\) 128px/);assert.match(html,/48px 20px minmax\(200px,1fr\)/);assert.equal((html.match(/role="region"/g)||[]).length,1);}
});

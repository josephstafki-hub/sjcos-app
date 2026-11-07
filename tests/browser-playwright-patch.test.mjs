// Expectations first: pinned-only transform, exhaustive toggles and fail-closed executable paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {patchBundle,census,UPSTREAM_SHA256} from '../deploy/browser/playwright-patch/apply.mjs';
import {guardTarget} from '../lib/browser/target-barrier.mjs';
let pristine='/opt/sjcos-browser/node/node_modules/playwright-core-upstream-1.64.1/lib/coreBundle.js';
const source=await readFile(pristine,'utf8').catch(async e=>{if(!['EACCES','ENOENT'].includes(e.code))throw e;pristine='/opt/sjcos-browser/node/node_modules/playwright-core/lib/coreBundle.js';return readFile(pristine,'utf8').catch(async e=>{if(!['EACCES','ENOENT'].includes(e.code))throw e;pristine='/home/joe/.local/opt/sjcos-browser/node/node_modules/playwright-core/lib/coreBundle.js';return readFile(pristine,'utf8');});});
const patched=await patchBundle(source);
assert.deepEqual(patched.metadata,JSON.parse(await readFile(new URL('../deploy/browser/playwright-patch/result.json',import.meta.url),'utf8')));
test('exact upstream pin and complete 7 resume / 8 toggle census',()=>{assert.equal(UPSTREAM_SHA256,'829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d');assert.equal(census(source).filter(x=>x.text.includes('Runtime.runIfWaitingForDebugger')).length,7);assert.equal(census(source).length,15);assert.equal(census(patched.bundle).filter(x=>x.text.includes('Runtime.runIfWaitingForDebugger')).length,0);new vm.Script(patched.bundle);});
for(const [name,change]of [['unknown resume',s=>s+'\nx.send("Runtime.runIfWaitingForDebugger")'],['unknown Fetch toggle',s=>s+'\nx.send("Fetch.disable")'],['wrong version',s=>s.replace('7.0','7.1')],['already patched',()=>patched.bundle]])test('refuses '+name,async()=>{await assert.rejects(patchBundle(change(source)));});
function setup(type='page',changes={}){const calls=[],sessions=new Map();const session={send:async(m,params)=>{calls.push(m);if(m==='Target.closeTarget'||m==='Target.disposeBrowserContext'){const b=runtime.boot(browser);for(const s of b.states)if(s.closing)runtime.detached(browser,{targetId:s.target.targetId});}return {success:true};},on(){},_sessionId:'s'};const runtime=patched.runtimeFactory();const browser={options:{__sjcBarrier:{guardTarget,releaseTarget:async()=>{},bindTarget:async()=>({generation:1}),validateBinding:async()=>true,registerFetch:async()=>calls.push('handlers'),revokeListener:async()=>calls.push('revoke'),...changes}},_session:{send:session.send},_contexts:new Map([['ctx',{}]])};return {runtime,browser,session,event:{targetInfo:{type,targetId:'t',browserContextId:'ctx'},waitingForDebugger:true},calls,sessions};}
for(const type of ['worker','shared_worker','service_worker','other','browser','unknown'])test('patched runtime closes '+type+' without initialization/resume',async()=>{const x=setup(type);await assert.rejects(x.runtime.attach(x.browser,x.session,x.event));assert.equal(x.calls.includes('Runtime.enable'),false);assert.equal(x.calls.includes('Runtime.runIfWaitingForDebugger'),false);assert.ok(x.calls.indexOf('revoke')<x.calls.indexOf('Target.closeTarget'));});
for(const name of ['bindTarget','validateBinding','registerFetch'])test('patch callback failure '+name+' is terminal',async()=>{const x=setup('page',{[name]:async()=>{throw Error('secret');}});await assert.rejects(x.runtime.attach(x.browser,x.session,x.event));assert.equal(x.calls.includes('Runtime.runIfWaitingForDebugger'),false);});
test('patch prepares Fetch before init and resumes once after init',async()=>{const x=setup();await x.runtime.attach(x.browser,x.session,x.event);assert.equal(x.calls.includes('Runtime.runIfWaitingForDebugger'),false);await x.runtime.resume(x.session);await assert.rejects(x.runtime.resume(x.session));assert.equal(x.calls.filter(x=>x==='Runtime.runIfWaitingForDebugger').length,1);});
test('unknown context is never admitted',async()=>{const x=setup();x.browser._contexts.clear();await assert.rejects(x.runtime.attach(x.browser,x.session,x.event));});
test('startup target without debugger pause is refused',async()=>{const x=setup();x.event.waitingForDebugger=false;await assert.rejects(x.runtime.attach(x.browser,x.session,x.event));});
test('third concurrent tab denied while guards are pending',async()=>{const x=setup();await x.runtime.attach(x.browser,x.session,x.event);await x.runtime.resume(x.session);const session=()=>({...x.session});await x.runtime.attach(x.browser,session(),{...x.event,targetInfo:{...x.event.targetInfo,targetId:'t2'}});await assert.rejects(x.runtime.attach(x.browser,session(),{...x.event,targetInfo:{...x.event.targetInfo,targetId:'t3'}}));});
test('duplicate target reattach revokes boot',async()=>{const x=setup();await x.runtime.attach(x.browser,x.session,x.event);await x.runtime.resume(x.session);await assert.rejects(x.runtime.attach(x.browser,{...x.session},x.event));});
test('disconnect fences delayed resume',async()=>{const x=setup();await x.runtime.attach(x.browser,x.session,x.event);await x.runtime.fail(x.browser);await assert.rejects(x.runtime.resume(x.session));assert.equal(x.calls.includes('Runtime.runIfWaitingForDebugger'),false);});
test('no public CDP reconnect, DevTools, worker transport or route/auth fallback remains',()=>{for(const text of ['SJC_CDP_RECONNECT_FORBIDDEN','SJC_DEVTOOLS_FORBIDDEN','SJC_WORKER_TRANSPORT_FORBIDDEN','SJC_FETCH_OWNED','SJC_PERSISTENT_FORBIDDEN'])assert.ok(patched.bundle.includes(text));assert.equal(patched.bundle.includes('PW_CHROMIUM_ATTACH_TO_OTHER'),false);});
import {createRequire} from 'node:module';
let loadedCore;
test('actual patched bundle loads without a browser; private connect refuses absent guard/persistent boot',async()=>{
 const filename=pristine;
 const mod={exports:{}};
 const compiled=vm.runInThisContext('(function(exports,require,module,__filename,__dirname){'+patched.bundle+'\n})',{filename});
 compiled(mod.exports,createRequire(filename),mod,filename,path.dirname(filename));
 loadedCore=mod.exports;
 assert.ok(mod.exports.sjcBrowser);assert.throws(()=>mod.exports.sjcBrowser.connect(null,null,{}));assert.throws(()=>mod.exports.sjcBrowser.connect(null,null,{persistent:{},__sjcBarrier:{}}));
});
test('two listener/context reservations are atomic and listener cannot be shared',()=>{
 const x=setup(),opts={serviceWorkers:'block',proxy:{server:'http://10.203.0.2:18081'}};
 x.runtime.reserveContext(x.browser,opts);assert.throws(()=>x.runtime.reserveContext(x.browser,opts));
 x.runtime.reserveContext(x.browser,{...opts,proxy:{server:'http://10.203.0.2:18082'}});assert.throws(()=>x.runtime.reserveContext(x.browser,{...opts,proxy:{server:'http://10.203.0.2:18083'}}));
});
for(const proxy of [{server:'http://127.0.0.1:18081'},{server:'http://10.203.0.2:18081',username:'secret'},{server:'http://10.203.0.2:18081',bypass:'*'}])test('context proxy never accepts '+JSON.stringify(proxy),()=>{const x=setup();assert.throws(()=>x.runtime.reserveContext(x.browser,{serviceWorkers:'block',proxy}));});
test('dispose/detach fences target before close, never detaches to resume',async()=>{const x=setup();await x.runtime.attach(x.browser,x.session,x.event);await assert.rejects(x.runtime.detach(x.session));assert.equal(x.calls.includes('Runtime.runIfWaitingForDebugger'),false);assert.ok(x.calls.indexOf('revoke')<x.calls.indexOf('Target.closeTarget'));});
import {parse} from 'acorn';
test('AST census: all seven upstream resume calls removed, exactly two guarded autoattach calls remain',async()=>{
 function commands(text){const ast=parse(text,{ecmaVersion:'latest',sourceType:'script'}),found=[];const stack=[ast];while(stack.length){const n=stack.pop();if(!n||typeof n!=='object')continue;if(n.type==='CallExpression'&&['send','_sendMayFail'].includes(n.callee?.property?.name)&&typeof n.arguments[0]?.value==='string')found.push(n.arguments[0].value);for(const [k,v]of Object.entries(n)){if(k==='start'||k==='end')continue;if(Array.isArray(v))stack.push(...v);else if(v&&typeof v==='object')stack.push(v);}}return found;}
 const before=commands(source),after=commands(patched.bundle);
 assert.equal(before.filter(x=>x==='Runtime.runIfWaitingForDebugger').length,7);
 for(const command of ['Runtime.runIfWaitingForDebugger','Fetch.enable','Fetch.disable'])assert.equal(after.filter(x=>x===command).length,0,command);
 assert.equal(after.filter(x=>x==='Target.setAutoAttach').length,2);
 const barrier=commands(await readFile('lib/browser/target-barrier.mjs','utf8').then(x=>x.replace('export async function','async function')));
 assert.equal(barrier.filter(x=>x==='Runtime.runIfWaitingForDebugger').length,1);assert.equal(barrier.filter(x=>x==='Fetch.enable').length,1);
});

test('actual patched CRBrowser fake transport performs only version + sole root autoattach then revokes on disconnect',async()=>{
 const sent=[];let revoked=0;
 const transport={send(message){sent.push(message.method);queueMicrotask(()=>transport.onmessage({id:message.id,result:message.method==='Browser.getVersion'?{revision:'r',product:'HeadlessChrome/156.0.8078.4',userAgent:'HeadlessChrome'}:{}}));},close(){transport.onclose?.();}};
 const parent=loadedCore.server.createPlaywright({sdkLanguage:'javascript',isInternalPlaywright:true});
 const policy={guardTarget,bindTarget:async()=>({}),validateBinding:async()=>true,registerFetch:async()=>{},revokeListener:async()=>{revoked++;}};
 await loadedCore.sjcBrowser.connect(parent,transport,{name:'chromium',browserType:'chromium',originalLaunchOptions:{},protocolLogger:()=>{},browserLogsCollector:{recentLogs:()=>[]},__sjcBarrier:policy});
 assert.deepEqual(sent,['Browser.getVersion','Target.setAutoAttach']);
 transport.close();await new Promise(r=>setImmediate(r));assert.equal(revoked,1);
});
test('external policy fatal fence synchronously closes the independent barrier boot',async()=>{
 let fence;const x=setup('page',{registerFence:f=>fence=f});await x.runtime.attach(x.browser,x.session,x.event);fence();assert.throws(()=>x.runtime.boot(x.browser));await assert.rejects(x.runtime.resume(x.session));assert.equal(x.calls.includes('Runtime.runIfWaitingForDebugger'),false);await x.runtime.fail(x.browser);
});
// A3b lifecycle expectations: explicit guarded close only; reuse fresh bindings.
for(const kind of ['page','context'])test('guarded '+kind+' close permits fresh slot reuse',async()=>{const x=setup();const o={serviceWorkers:'block',proxy:{server:'http://10.203.0.2:18081'}};x.runtime.reserveContext(x.browser,o);x.runtime.commitContext(x.browser,'ctx',o);await x.runtime.attach(x.browser,x.session,x.event);await x.runtime.resume(x.session);if(kind==='context'){const o2={...o,proxy:{server:'http://10.203.0.2:18082'}};x.runtime.reserveContext(x.browser,o2);x.runtime.commitContext(x.browser,'other',o2);x.browser._contexts.set('other',{});await x.runtime.attach(x.browser,{...x.session,_sessionId:'other-session'},{...x.event,targetInfo:{...x.event.targetInfo,targetId:'other-page',browserContextId:'other'}});}
if(kind==='context'){for(const s of x.runtime.boot(x.browser).states)if(s.target.targetId==='other-page')await x.runtime.resume(s.session);}
if(kind==='page')await x.runtime.closePage(x.browser,'t');else await x.runtime.closeContext(x.browser,'ctx');assert.equal(x.runtime.boot(x.browser).live,true);if(kind==='context'){assert.equal(x.runtime.boot(x.browser).pages.get('other'),1);assert.equal(x.runtime.boot(x.browser).listeners.has('http://10.203.0.2:18082'),true);}
if(kind==='context'){x.runtime.reserveContext(x.browser,o);x.runtime.commitContext(x.browser,'ctx2',o);x.browser._contexts.set('ctx2',{});}await x.runtime.attach(x.browser,{...x.session},{...x.event,targetInfo:{...x.event.targetInfo,targetId:'fresh',browserContextId:kind==='page'?'ctx':'ctx2'}});});
test('released session cannot resume again',async()=>{const x=setup();await x.runtime.attach(x.browser,x.session,x.event);await x.runtime.resume(x.session);await x.runtime.closePage(x.browser,'t');await assert.rejects(x.runtime.resume(x.session));});
test('unguarded target after release never resumes',async()=>{const x=setup();await x.runtime.attach(x.browser,x.session,x.event);await x.runtime.resume(x.session);await x.runtime.closePage(x.browser,'t');await assert.rejects(x.runtime.attach(x.browser,{...x.session},{...x.event,targetInfo:{...x.event.targetInfo,targetId:'evil',type:'worker'}}));assert.equal(x.calls.filter(m=>m==='Runtime.runIfWaitingForDebugger').length,1);});
test('failed guarded close kills boot and retains reservation',async()=>{const x=setup();await x.runtime.attach(x.browser,x.session,x.event);await x.runtime.resume(x.session);x.browser._session.send=async()=>({success:false});await assert.rejects(x.runtime.closePage(x.browser,'t'));assert.throws(()=>x.runtime.boot(x.browser));});

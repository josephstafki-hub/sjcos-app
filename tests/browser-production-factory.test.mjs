// Expectations first (A2b): no real browser, network listener or privileged process.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionBrowser,createProductionFactory,productionLaunchSpec,cdpInput} from '../lib/browser/production-browser.mjs';
import {InputEvent} from '../lib/browser/phase1-contracts.mjs';
import {BrowserService} from '../lib/browser/service.mjs';
import {createServiceIO,createControllerHandlers,bindAttachedContext} from '../lib/browser/production-bridge.mjs';
import {ControlMessage} from '../lib/browser/phase1-contracts.mjs';
import * as installationAdapter from '../deploy/browser/production-adapter.mjs';
import {validateProductionIdentity} from '../lib/browser/production-namespace.mjs';
const identity={uid:997,controllerUid:997,browserUid:998,browserName:'sjcos-browser',namespace:{name:'sjcos-browser',current:'net:[2]',host:'net:[1]',expectedInode:2,currentInode:2}};
for(const [name,patch,code] of [['root',{uid:0},'IDENTITY'],['wrong browser uid',{browserUid:999},'IDENTITY'],['same credential uid',{controllerUid:998,uid:998},'IDENTITY'],['wrong browser name',{browserName:'joe'},'IDENTITY'],['host net',{namespace:{...identity.namespace,current:'net:[1]'}},'NAMESPACE']])test('refuses '+name,()=>assert.throws(()=>validateProductionIdentity({...identity,...patch}),new RegExp(code)));
test('fixed pinned sandboxed arguments and clean environment',()=>{const s=productionLaunchSpec('/run/sjcos-browser-chromium/p/profile');assert.match(s.executable,/chromium_headless_shell-1248/);assert.ok(s.args.includes('--site-per-process'));assert.ok(s.args.includes('--disable-component-extensions-with-background-pages'));assert.ok(!s.args.includes('--no-sandbox'));assert.equal(s.uid,998);assert.equal(s.env.CREDENTIALS_DIRECTORY,undefined);});
test('profile cannot escape runtime',()=>assert.throws(()=>productionLaunchSpec('/tmp/evil')));
function fixture(){let count=0,closed=0;const calls=[],listeners=new Map();const session={send:async(m,p)=>{calls.push([m,p]);return {};},on:(m,f)=>listeners.set(m,f),off:(m)=>listeners.delete(m)};const context={_browserContextId:'ctx',newPage:async()=>({_targetId:'p'+(++count),session}),close:async()=>closed++};const gate={open:async()=>({proxy:{server:'http://10.203.0.2:18081'}}),attach:async()=>{},release:async()=>{},policy:{bindTarget:async()=>{},validateBinding:async()=>true,registerFetch:async()=>{},revokeListener:async()=>{}}};const options={authorizeInput:async()=>true,identity,verify:async()=>true,helper:async(op)=>{calls.push([op]);return op==='start'?{endpoint:'ws://127.0.0.1:1234/devtools/browser/abc'}:{ok:true};},connect:async(_e,policy)=>{assert.equal(typeof policy.guardTarget,'function');return {newContext:async()=>context,close:async()=>{}};},gate,sessionFor:async(p)=>p.session,publishFrame:async(_r,frame)=>calls.push(['frame',frame]),extract:async()=>({text:'public'}),progress:{}};return {options,calls,listeners,closed:()=>closed};}
test('unverified evidence prevents helper launch',async()=>{const f=fixture();f.options.verify=async()=>false;await assert.rejects(createProductionBrowser(f.options),/RUNTIME_NOT_READY/);assert.equal(f.calls.length,0);});
test('one process starts and closes exactly once',async()=>{const f=fixture(),b=await createProductionBrowser(f.options);await b.close();await b.close();assert.equal(f.calls.filter(x=>x[0]==='start').length,1);assert.equal(f.calls.filter(x=>x[0]==='stop').length,1);});
test('two contexts and four pages bounded',async()=>{const f=fixture(),b=await createProductionBrowser(f.options);for(let i=0;i<2;i++){const c=await b.newContext({acceptDownloads:false,serviceWorkers:'block',viewport:{width:1280,height:800}});await c.newPage();await c.newPage();await assert.rejects(c.newPage(),/RESOURCE_LIMIT/);}await assert.rejects(b.newContext({}),/RESOURCE_LIMIT/);await b.close();});
test('unsafe context options rejected',async()=>{const f=fixture(),b=await createProductionBrowser(f.options);await assert.rejects(b.newContext({storageState:'secret'}),/FORBIDDEN/);await b.close();});
test('CDP method not caller selectable',()=>assert.throws(()=>cdpInput({type:'Runtime.evaluate',expression:'evil'}),/BAD_INPUT/));
test('wheel maps only fixed input method',()=>assert.deepEqual(cdpInput({type:'wheel',x:1,y:2,delta_x:0,delta_y:5}),['Input.dispatchMouseEvent',{type:'mouseWheel',x:1,y:2,deltaX:0,deltaY:5}]));
test('IME remains bounded',()=>assert.throws(()=>cdpInput({type:'ime_commit',text:'x'.repeat(4097)}),/BAD_INPUT/));
async function record(f,b){const c=await b.newContext({acceptDownloads:false,serviceWorkers:'block',viewport:{width:1280,height:800}});await c.newPage();return {context:c,task:{id:'task',private:false,document_epoch:1,control_epoch:1,context_generation:1}};}
test('screencast ACK and binary frame channel',async()=>{const f=fixture(),b=await createProductionBrowser(f.options),r=await record(f,b);await b.startCapture(r);await f.listeners.get('Page.screencastFrame')({sessionId:1,data:Buffer.from('jpeg').toString('base64')});assert.ok(f.calls.some(x=>x[0]==='Page.screencastFrameAck'));assert.ok(Buffer.isBuffer(f.calls.find(x=>x[0]==='frame')[1].bytes));await b.close();});
test('oversize frame acknowledged and dropped',async()=>{const f=fixture(),b=await createProductionBrowser(f.options),r=await record(f,b);await b.startCapture(r);await f.listeners.get('Page.screencastFrame')({sessionId:1,data:'a'.repeat(220000)});assert.ok(f.calls.some(x=>x[0]==='Page.screencastFrameAck'));assert.ok(!f.calls.some(x=>x[0]==='frame'));await b.close();});
test('private barrier stops and drains capture',async()=>{const f=fixture(),b=await createProductionBrowser(f.options),r=await record(f,b);await b.startCapture(r);assert.equal(await b.stopAndAckScreencast(r),true);assert.equal(await b.drainPublicOutputs(r),true);await b.close();});
test('pressure kills fixed process tree',async()=>{const f=fixture(),b=await createProductionBrowser(f.options);await record(f,b);await b.pressure();await assert.rejects(b.newContext({}),/REVOKED/);assert.ok(f.calls.some(x=>x[0]==='stop'));});
test('fence blocks model but preserves resolved human input',async()=>{const f=fixture(),b=await createProductionBrowser(f.options),r=await record(f,b);await b.fence(r);await assert.rejects(b.capturePublic(r,{}),/REVOKED/);await b.deliverInput(r,{event:{type:'ime_commit',text:'hello'}});assert.ok(f.calls.some(x=>x[0]==='Input.insertText'));await b.close();});
import {createProductionGate} from '../lib/browser/production-gate.mjs';
test('production gate requires A2a phase1 authority and no fixture fallback',async()=>{const gate=createProductionGate({readBridgeFor:async()=>({authority:{phase:0},handle:async()=>{}}),call:async()=>({ok:true})});const lease=await gate.open();await assert.rejects(gate.attach({id:'ctx',lease},{task:{controller_boot_id:'boot',context_generation:1}}),/GATE_AUTHORITY_REFUSED/);});
test('production gate exact context target guard and popup ceiling',async()=>{const calls=[];const gate=createProductionGate({readBridgeFor:async(_r,options)=>{assert.equal(typeof options.registerDigest,'function');return {authority:{phase:1,unknownAll:async()=>{}},handle:async()=>({ok:true})};},call:async x=>{calls.push(x);return {ok:true,listenerCookie:'cookie'};}});const lease=await gate.open(),c={id:'ctx',lease};await gate.attach(c,{task:{id:'task',controller_boot_id:'boot',context_generation:2,listener_generation:9}});for(const id of ['p1','p2']){const b=await gate.policy.bindTarget({targetId:id,browserContextId:'ctx',type:'page',waitingForDebugger:true});assert.equal(b.generation,9);assert.equal(b.contextGeneration,2);assert.equal(await gate.policy.validateBinding({targetId:id},b),true);}await assert.rejects(gate.policy.bindTarget({targetId:'p3',browserContextId:'ctx',type:'page',waitingForDebugger:true}),/RESOURCE_LIMIT/);assert.equal(calls.filter(c=>c.op==='bind').length,1);await gate.release(c);});
test('concurrent context creation reserves capacity before awaits',async()=>{const f=fixture(),b=await createProductionBrowser(f.options);const o={acceptDownloads:false,serviceWorkers:'block',viewport:{width:1280,height:800}};const results=await Promise.allSettled([b.newContext(o),b.newContext(o),b.newContext(o)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,2);await b.close();});
for(const where of ['page','session','authority'])test('final input fence catches change during '+where+' await',async()=>{const f=fixture();f.options.authorizeInput=async(r)=>{if(where==='authority')r.task.control_epoch++;return true;};let mutate=()=>{};const orig=f.options.sessionFor;f.options.sessionFor=async p=>{mutate();return orig(p);};const b=await createProductionBrowser(f.options),r=await record(f,b);if(where==='page')f.options.gate.attach=async()=>{r.task.document_epoch++;};if(where==='session')mutate=()=>r.task.context_generation++;await assert.rejects(b.deliverInput(r,{event:{type:'ime_commit',text:'no'}}),/REVOKED/);assert.ok(!f.calls.some(c=>c[0]==='Input.insertText'));await b.close();});

// R1 expectations: exact wire input at fractional viewport edges survives the
// final CDP adapter. No quantization or bypass of the shared contract.
for(const type of ['pointer','wheel'])test('fractional '+type+' contract reaches CDP',async()=>{
 const f=fixture(),b=await createProductionBrowser(f.options),r=await record(f,b);
 const e=InputEvent.parse({type,x:1279.999999,y:799.999999,...(type==='pointer'?{phase:'move',button:0,buttons:0,modifiers:[]}:{delta_x:0.5,delta_y:-0.25})});
 await b.deliverInput(r,{event:e});const sent=f.calls.find(x=>x[0]==='Input.dispatchMouseEvent');assert.equal(sent[1].x,e.x);assert.equal(sent[1].y,e.y);
 for(const xy of [{x:1280,y:1},{x:1,y:800},{x:-0.001,y:1},{x:NaN,y:1},{x:1,y:Infinity}])assert.throws(()=>cdpInput({...e,...xy}),/BAD_INPUT/);
 await b.close();
});
test('production factory exposes all fixed navigation hooks',()=>{const f=createProductionFactory({});for(const k of ['navigationState','prepareNavigation','guardedNavigation'])assert.equal(typeof f[k],'function',k);});
for(const k of ['pausePublic','resumePublic'])test('factory exposes '+k+' for committed public continuation',()=>assert.equal(typeof createProductionFactory({})[k],'function'));
test('installation adapter refuses service dependencies missing a guarded navigation hook',()=>{
 const required=['runEnd','browser','authorize','transition','fence','reconcile','audit','release','privacyIO','resolveInput','deliverInput','begin','finish','commandResult','confirmFresh','navigationState','prepareNavigation','guardedNavigation','pausePublic','resumePublic'];
 const deps={verifyReadiness:async()=>{},verifyAccounting:async()=>{},handlers:()=>{},io:Object.fromEntries(required.map(k=>[k,async()=>{}]))};
 assert.equal(installationAdapter.validateServiceDependencies(deps),deps);
 for(const k of ['navigationState','prepareNavigation','guardedNavigation','pausePublic','resumePublic']){const io={...deps.io};delete io[k];assert.throws(()=>installationAdapter.validateServiceDependencies({...deps,io}),/BOOTSTRAP_REFUSED/);}
});

async function navigationFixture(){
 const f=fixture();const send=f.options.sessionFor;
 f.resolveSession=async p=>{const s=await send(p);return {...s,send:async(m,v)=>{f.calls.push([m,v]);if(m==='Page.getNavigationHistory')return {currentIndex:1,entries:[{id:10,url:'https://public.example/a'},{id:20,url:'https://public.example/b'},{id:30,url:'https://public.example/c'}]};return {};}};};f.options.sessionFor=p=>f.resolveSession(p);
 f.options.gate.prepareNavigation=async(_r,n)=>({reviewed:true,document_epoch:2,read_manifest_revision:3,url:n.url});
 const b=await createProductionBrowser(f.options),r=await record(f,b);Object.assign(r.task,{privacy_mode:'public',state:'active',read_manifest_revision:3,controller_boot_id:'boot',listener_generation:9});
 const request={action:'reload',expected_epoch:1,expected_document_epoch:1,context_generation:1,read_manifest_revision:3};return {f,b,r,request};
}
test('public pause drains loading/capture; only a different authorized run with a new listener resumes observations',async()=>{
 const {f,b,r}=await navigationFixture();try{
  Object.assign(r.task,{current_run_id:'old-run'});let paused=0,resumed=0;f.options.gate.pausePublic=async()=>{paused++;return true;};f.options.gate.resumePublic=async()=>{resumed++;return true;};
  await b.startCapture(r);await b.pausePublic(r);assert.equal(paused,1);assert.ok(f.calls.some(([m])=>m==='Page.stopLoading'));assert.ok(f.calls.some(([m])=>m==='Page.stopScreencast'));await assert.rejects(b.capturePublic(r),/REVOKED/);await assert.rejects(b.deliverInput(r,{event:{type:'ime_commit',text:'old'}}),/REVOKED/);
  await assert.rejects(b.resumePublic(r,{reauthorize:async()=>({...r.task})}),/REVOKED/);
  Object.assign(r.task,{current_run_id:'new-run',listener_generation:10,control_epoch:2});
  await b.resumePublic(r,{reauthorize:async()=>({...r.task})});assert.equal(resumed,1);assert.deepEqual(await b.capturePublic(r),{text:'public'});
  await assert.rejects(b.resumePublic(r,{reauthorize:async()=>({...r.task})}),/REVOKED/);
 }finally{await b.close();}
});
test('public pause waits for pending extraction and discards its old result',async()=>{
 const f=fixture();let release,started;const waiting=new Promise(r=>release=r),began=new Promise(r=>started=r);f.options.extract=async()=>{started();await waiting;return {text:'old'};};f.options.gate.pausePublic=async()=>true;
 const b=await createProductionBrowser(f.options),r=await record(f,b);Object.assign(r.task,{privacy_mode:'public',current_run_id:'old',listener_generation:9});
 try{
  const extraction=assert.rejects(b.capturePublic(r),/REVOKED/);await began;let drained=false;const pause=b.pausePublic(r).then(()=>drained=true);await Promise.resolve();assert.equal(drained,false);release();await extraction;await pause;assert.equal(drained,true);
 }finally{release();await b.close();}
});
for(const change of ['private','context','boot','authority-await'])test('public resume rejects '+change+' authority changes',async()=>{
 const {f,b,r}=await navigationFixture();try{
  r.task.current_run_id='old';f.options.gate.pausePublic=async()=>true;f.options.gate.resumePublic=async()=>true;await b.pausePublic(r);
  Object.assign(r.task,{current_run_id:'new',listener_generation:10,control_epoch:2});
  if(change==='private')Object.assign(r.task,{private:true,privacy_mode:'private'});if(change==='context')r.task.context_generation++;if(change==='boot')r.task.controller_boot_id='other';
  await assert.rejects(b.resumePublic(r,{reauthorize:async()=>{if(change==='authority-await')r.task.control_epoch++;return {...r.task};}}),/REVOKED/);assert.equal(r.context.modelFenced,true);
 }finally{await b.close();}
});
for(const action of ['back','forward','reload'])test('guarded '+action+' uses fixed CDP after fresh authority and consumes prepared effect once',async()=>{
 const {f,b,r,request}=await navigationFixture();try{
  const state=await b.navigationState(r);assert.deepEqual(state.targets,['p1']);assert.equal(state[action],true);
  const prepared=await b.prepareNavigation(r,{...request,action});assert.equal(prepared.document_epoch,2);
  let checks=0;const args={action,target_id:null,prepared,reauthorize:async()=>{checks++;return {...r.task};}};
  assert.deepEqual(await b.guardedNavigation(r,args),{document_epoch:2});assert.equal(checks,1);
  const effects=f.calls.filter(([m])=>['Page.reload','Page.navigateToHistoryEntry'].includes(m));assert.equal(effects.length,1);
  assert.deepEqual(effects[0],action==='reload'?['Page.reload',{ignoreCache:true}]:['Page.navigateToHistoryEntry',{entryId:action==='back'?10:30}]);
  await assert.rejects(b.guardedNavigation(r,args),/REVIEW_STALE/);assert.ok(!f.calls.some(([m])=>m.startsWith('Input.')));
 }finally{await b.close();}
});
test('tab switch uses exact live target and fresh reauthorization',async()=>{
 const {f,b,r,request}=await navigationFixture();try{
  await r.context.newPage();const prepared=await b.prepareNavigation(r,{...request,action:'switch_tab',target_id:'p2'});
  await b.guardedNavigation(r,{action:'switch_tab',target_id:'p2',prepared,reauthorize:async()=>({...r.task})});
  assert.equal(r.activeTarget,'p2');assert.ok(f.calls.some(([m])=>m==='Page.bringToFront'));assert.equal(r.task.document_epoch,1);
  await assert.rejects(b.prepareNavigation(r,{...request,action:'switch_tab',target_id:'arbitrary'}),/REVIEW_STALE/);
 }finally{await b.close();}
});
for(const seam of ['session','authority','history','target','missing-authority','unreviewed','expired-review'])test('navigation refuses '+seam+' changes without effect',async()=>{
 const {f,b,r,request}=await navigationFixture();try{
  if(seam==='unreviewed'){f.options.gate.prepareNavigation=async()=>({reviewed:false});await assert.rejects(b.prepareNavigation(r,request),/BROWSER_REVIEW_REQUIRED/);return;}
  const prepared=await b.prepareNavigation(r,request);
  if(seam==='expired-review')f.options.gate.prepareNavigation=async()=>({reviewed:false});
  if(seam==='session'){const orig=f.resolveSession;f.resolveSession=async p=>{r.task.control_epoch++;return orig(p);};}
  if(seam==='history'){const orig=f.resolveSession;f.resolveSession=async p=>{const s=await orig(p);return {...s,send:async(m,v)=>m==='Page.getNavigationHistory'?{currentIndex:0,entries:[]} : s.send(m,v)};};}
  if(seam==='target')r.context.pages.clear();
  await assert.rejects(b.guardedNavigation(r,{action:'reload',target_id:null,prepared,reauthorize:seam==='missing-authority'?undefined:async()=>{if(seam==='authority')r.task.document_epoch++;return {...r.task};}}),seam==='expired-review'?/BROWSER_REVIEW_REQUIRED/:/REVIEW_STALE|REVOKED/);
  assert.ok(!f.calls.some(([m])=>['Page.reload','Page.navigateToHistoryEntry','Page.bringToFront'].includes(m)));
 }finally{await b.close();}
});
test('switching tabs drains the old screencast and captures the selected page',async()=>{
 const {f,b,r,request}=await navigationFixture();try{
  await b.startCapture(r);await r.context.newPage();const selected=[];const orig=f.resolveSession;f.resolveSession=async p=>{selected.push(p._targetId);return orig(p);};
  const prepared=await b.prepareNavigation(r,{...request,action:'switch_tab',target_id:'p2'});
  await b.guardedNavigation(r,{action:'switch_tab',target_id:'p2',prepared,reauthorize:async()=>({...r.task})});
  const stop=f.calls.findIndex(([m])=>m==='Page.stopScreencast'),front=f.calls.findIndex(([m])=>m==='Page.bringToFront');
  assert.ok(stop>=0&&front>stop);assert.equal(f.calls.filter(([m])=>m==='Page.startScreencast').length,2);assert.equal(selected.at(-1),'p2');
 }finally{await b.close();}
});

async function gateFixture({reviewed=false,discover=async()=>true}={}){
 const calls=[],listeners=new Map();let fatal=0;
 const authority={phase:1,unknownAll:async()=>{},authorizeFetch:async()=>reviewed,discoverFetch:discover};
 const gate=createProductionGate({readBridgeFor:async()=>({authority,handle:async()=>({ok:true})}),call:async q=>{calls.push(q);return {ok:true,listenerCookie:'cookie'};},onFatal:async()=>fatal++});
 const lease=await gate.open(),c={id:'ctx',lease},r={context:c,task:{id:'task',controller_boot_id:'boot',context_generation:2,listener_generation:9,document_epoch:1,control_epoch:1,read_manifest_revision:3,private:false,privacy_mode:'public',state:'active'}};
 await gate.attach(c,r);const t={targetId:'p1',browserContextId:'ctx',type:'page',waitingForDebugger:true},binding=await gate.policy.bindTarget(t);
 const session={on:(k,v)=>listeners.set(k,v),send:async(m,v)=>{calls.push([m,v]);}};await gate.policy.registerFetch(session,binding,()=>true);
 return {gate,r,c,authority,calls,listeners,fatal:()=>fatal};
}
test('missing public asset is blocked once and committed for review without fatal shutdown or replay',async()=>{
 let discoveries=0;const f=await gateFixture({discover:async(request,meta)=>{assert.equal(request.kind,'resource');assert.equal(meta.targetId,'p1');discoveries++;return true;}});
 await f.listeners.get('Fetch.requestPaused')({requestId:'req',resourceType:'Stylesheet',request:{method:'GET',url:'https://public.example/style.css'}});
 assert.equal(discoveries,1);assert.equal(f.fatal(),0);assert.equal(f.calls.filter(x=>x[0]==='Fetch.failRequest').length,1);assert.ok(!f.calls.some(x=>x[0]==='Fetch.continueRequest'));
 assert.equal(await f.gate.policy.validateBinding({targetId:'p1'},f.gate.bindingForTarget('p1')),true);
});
for(const mode of ['throws','unclassified'])test('gate '+mode+' remains fatal and never stages on authority errors',async()=>{
 let discoveries=0;const f=await gateFixture({discover:async()=>{discoveries++;return false;}});if(mode==='throws')f.authority.authorizeFetch=async()=>{throw Error('binding');};
 await f.listeners.get('Fetch.requestPaused')({requestId:'req',resourceType:'Document',request:{method:'GET',url:'https://public.example/'}});
 assert.equal(discoveries,mode==='throws'?0:1);assert.equal(f.fatal(),1);assert.ok(!f.calls.some(x=>x[0]==='Fetch.continueRequest'));
});
test('gate preparation requires a reviewed exact next document; new review then deliberate reload',async()=>{
 let discoveries=0;const f=await gateFixture({discover:async()=>{discoveries++;return true;}}),n={url:'https://public.example/',action:'reload',target_id:'p1',document_epoch:2,read_manifest_revision:3};
 assert.equal((await f.gate.prepareNavigation(f.r,n)).reviewed,false);assert.equal(discoveries,1);assert.equal(f.fatal(),0);
 f.authority.authorizeFetch=async(q)=>{assert.equal(q.url,n.url);assert.equal(q.method,'GET');assert.equal(q.kind,'document');return true;};
 assert.deepEqual(await f.gate.prepareNavigation(f.r,n),{reviewed:true,document_epoch:2,read_manifest_revision:3,url:n.url});
 await assert.rejects(f.gate.prepareNavigation(f.r,{...n,document_epoch:1}),/REVIEW_STALE/);await assert.rejects(f.gate.prepareNavigation(f.r,{...n,target_id:'unknown'}),/GATE_AUTHORITY_REFUSED/);
});
test('gate public pause cancels old listener and rebinds current sessions to fresh committed generation',async()=>{
 const bridges=[],calls=[],listeners=new Map();let fatal=0,oldReleased=0;
 const gate=createProductionGate({call:async q=>{calls.push(q);return {ok:true,listenerCookie:'cookie-'+q.binding?.generation};},onFatal:async()=>fatal++,readBridgeFor:async()=>{
  const n=bridges.length;const authority={phase:1,unknownAll:async()=>{oldReleased++;},authorizeFetch:async()=>true};const bridge={authority,handle:async e=>({ok:true,epoch:n,event:e.event})};bridges.push(bridge);return bridge;
 }});
 const c={id:'ctx',lease:await gate.open()},r={context:c,task:{id:'task',current_run_id:'old',controller_boot_id:'boot',private:false,privacy_mode:'public',state:'active',context_generation:2,listener_generation:9,control_epoch:1}};await gate.attach(c,r);
 const t={targetId:'p1',browserContextId:'ctx',type:'page',waitingForDebugger:true},barrierBinding=await gate.policy.bindTarget(t);await gate.policy.registerFetch({on:(e,f)=>listeners.set(e,f),send:async(m,v)=>calls.push([m,v])},barrierBinding,()=>true);
 await gate.pausePublic(r);assert.equal(oldReleased,1);assert.equal(calls.filter(q=>q.op==='revoke').length,1);assert.equal(fatal,0);
 await assert.rejects(gate.resumePublic(r,r.task),/REVOKED/);
 Object.assign(r.task,{current_run_id:'new',listener_generation:10,control_epoch:2});await gate.resumePublic(r,r.task);
 assert.equal(bridges.length,2);assert.equal(await gate.policy.validateBinding(t,barrierBinding),true);assert.equal(gate.bindingForTarget('p1').generation,10);
 assert.equal((await gate.handle({event:'request',contextId:'ctx'})).epoch,1);
 await listeners.get('Fetch.requestPaused')({requestId:'new-fetch',resourceType:'Document',request:{method:'GET',url:'https://public.example/'}});
 assert.ok(calls.some(q=>q[0]==='Fetch.continueRequest'));assert.equal(fatal,0);await gate.release(c);
});
test('in-flight old Fetch cannot continue after pause/resume or trigger fatal against the new turn',async()=>{
 let release;const pending=new Promise(r=>release=r);const f=await gateFixture({reviewed:true});f.r.task.current_run_id='old';f.authority.authorizeFetch=async()=>{await pending;return true;};
 const fetching=f.listeners.get('Fetch.requestPaused')({requestId:'old',resourceType:'Document',request:{method:'GET',url:'https://public.example/'}});
 await f.gate.pausePublic(f.r);Object.assign(f.r.task,{current_run_id:'new',listener_generation:10,control_epoch:2});await f.gate.resumePublic(f.r,f.r.task);release();await fetching;
 assert.ok(!f.calls.some(q=>q[0]==='Fetch.continueRequest'));assert.equal(f.fatal(),0);
});
test('service normal run end and committed attachment resume the actual factory/gate without copying context or reviving a capability',async()=>{
 const f=fixture(),calls=[];const gate=createProductionGate({readBridgeFor:async()=>({authority:{phase:1,unknownAll:async()=>{},authorizeFetch:async()=>true},handle:async()=>({ok:true})}),call:async q=>{calls.push(q);return {ok:true,listenerCookie:'cookie-'+q.binding?.generation};}});f.options.gate=gate;
 const factory=createProductionFactory(f.options),id='11111111-1111-4111-8111-111111111111';let durable={id,person_id:'22222222-2222-4222-8222-222222222222',current_run_id:'33333333-3333-4333-8333-333333333333',controller_boot_id:'44444444-4444-4444-8444-444444444444',state:'active',private:false,privacy_mode:'public',control_epoch:1,document_epoch:1,context_generation:1,listener_generation:9,read_manifest_revision:3};
 const io=createServiceIO({factory,db:{readTask:async()=>({...durable})},common:{authorize:async()=>true,audit:async()=>{},reconcile:async()=>{},runEnd:async()=>{durable={...durable,state:'paused',control_epoch:2};}}});
 const service=new BrowserService({io,uid:997});await service.start();await service.open(durable);const r=service.contexts.get(id),b=await factory.browser();
 try{
  await factory.bind(r);const p=[...r.context.pages][0],binding=await gate.policy.bindTarget({targetId:p._targetId,browserContextId:r.context.id,type:'page',waitingForDebugger:true});await gate.policy.registerFetch(p.session,binding,()=>true);
  await service.runEnd(id,'completed');assert.equal(r.context.modelFenced,true);assert.equal(r.task.state,'paused');assert.equal(calls.filter(q=>q.op==='revoke').length,1);
  durable={...durable,current_run_id:'55555555-5555-4555-8555-555555555555',state:'active',control_epoch:3,listener_generation:10};
  await bindAttachedContext(service,{...durable});assert.equal(r.commandsFenced,false);assert.equal(r.context.modelFenced,false);assert.equal(gate.bindingForTarget(p._targetId).generation,10);assert.equal(f.closed(),0);
  assert.deepEqual(await b.capturePublic(r),{text:'public'});assert.equal(calls.filter(q=>q.op==='bind').length,2);
 }finally{await b.close();}
});
test('wire control through controller/service/production factory sends one reviewed reload in a new document epoch',async()=>{
 const f=fixture(),base=f.options.sessionFor;f.options.sessionFor=async p=>{const s=await base(p);return {...s,send:async(m,v)=>{f.calls.push([m,v]);return m==='Page.getNavigationHistory'?{currentIndex:0,entries:[{id:1,url:'https://public.example/'}]}:{};}};};
 f.options.gate.prepareNavigation=async(_r,n)=>({reviewed:true,document_epoch:n.document_epoch,read_manifest_revision:n.read_manifest_revision,url:n.url});
 const factory=createProductionFactory(f.options);let service;
 const io=createServiceIO({factory,db:{readTask:async r=>({...r.task})},common:{authorize:async()=>true,audit:async()=>{},reconcile:async()=>{}}});
 const id='11111111-1111-4111-8111-111111111111',task={id,person_id:'22222222-2222-4222-8222-222222222222',controller_boot_id:'33333333-3333-4333-8333-333333333333',state:'active',private:false,privacy_mode:'public',control_epoch:1,document_epoch:1,context_generation:1,listener_generation:9,read_manifest_revision:3};
 service=new BrowserService({io,uid:997});await service.start();await service.open(task);
 try{
  const handlers=createControllerHandlers({service,authorizeWeb:async x=>x.payload.proof_id===id,readMetadata:async()=>({}),key:new Uint8Array(32)});
  const body=ControlMessage.parse({action:'reload',viewer_id:id,device_secret:'a'.repeat(43),idempotency_key:id,expected_epoch:1,expected_document_epoch:1,context_generation:1,read_manifest_revision:3});
  const wire={task_id:id,payload:{proof_id:id,body}};assert.deepEqual(await handlers.control(wire),{document_epoch:2});
  await assert.rejects(handlers.control(wire),/REVIEW_STALE/);assert.equal(f.calls.filter(([m])=>m==='Page.reload').length,1);assert.ok(!f.calls.some(([m])=>m.startsWith('Input.')));
 }finally{await (await factory.browser()).close();}
});

// R2 expectations first: exercise the public control entrypoint, not just the
// run-end hook. Only committed task storage and CDP/root I/O are doubles.
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function publicControlFixture(configure=()=>{}){
 const f=fixture(),calls=[],bridges=[];
 const gate=createProductionGate({call:async q=>{calls.push(q);return {ok:true,listenerCookie:'cookie-'+q.binding?.generation};},readBridgeFor:async(_r,options)=>{
  const bridge={options,revoked:0,authority:{phase:1,authorizeFetch:async()=>true},handle:async()=>({ok:true})};
  bridge.authority.unknownAll=async()=>{bridge.revoked++;};bridges.push(bridge);return bridge;
 }});f.options.gate=gate;configure(f.options);
 const factory=createProductionFactory(f.options),id='11111111-1111-4111-8111-111111111111';
 let durable={id,person_id:'22222222-2222-4222-8222-222222222222',current_run_id:'33333333-3333-4333-8333-333333333333',controller_boot_id:'44444444-4444-4444-8444-444444444444',state:'active',private:false,privacy_mode:'public',control_epoch:1,document_epoch:1,context_generation:1,listener_generation:9,read_manifest_revision:3};
 const io=createServiceIO({factory,db:{readTask:async()=>({...durable})},common:{authorize:async()=>true,audit:async()=>{},reconcile:async()=>{}}});
 const service=new BrowserService({io,uid:997});await service.start();await service.open(durable);const r=service.contexts.get(id),b=await factory.browser();await factory.bind(r);
 const p=[...r.context.pages][0],binding=await gate.policy.bindTarget({targetId:p._targetId,browserContextId:r.context.id,type:'page',waitingForDebugger:true});await gate.policy.registerFetch(p.session,binding,()=>true);
 const handlers=createControllerHandlers({service,authorizeWeb:async()=>true,readMetadata:async()=>({}),readTask:async()=>({...durable}),key:new Uint8Array(32)});
 const control=action=>handlers.control({task_id:id,payload:{proof_id:id,body:ControlMessage.parse({action,viewer_id:id,device_secret:'a'.repeat(43),idempotency_key:id,expected_epoch:r.task.control_epoch})}});
 return {...f,cdpCalls:f.calls,b,r,p,gate,calls,bridges,service,factory,control,commitPause:()=>{durable={...durable,state:'paused',control_epoch:durable.control_epoch+1};},
  continue:async()=>{durable={...durable,state:'active',current_run_id:durable.current_run_id==='55555555-5555-4555-8555-555555555555'?'66666666-6666-4666-8666-666666666666':'55555555-5555-4555-8555-555555555555',control_epoch:durable.control_epoch+1,listener_generation:durable.listener_generation+1};return bindAttachedContext(service,{...durable});}};
}
test('public control pause/resume/pause cycles drain without permanent fencing and replace old authority/output',async()=>{
 const f=await publicControlFixture();try{
  const context=f.r.context;
  for(let turn=0;turn<2;turn++){
   const ticket=f.service.modelTicket(f.r.task.id),old=f.gate.bindingForTarget(f.p._targetId),bridge=f.bridges.at(-1);
   await f.b.startCapture(f.r);const ack=await f.control('pause');assert.equal(ack.proof_metadata.drained,true);
   assert.equal(f.gate.bindingForTarget(f.p._targetId),null);assert.equal(bridge.revoked,1);
   await assert.rejects(f.b.capturePublic(f.r),/REVOKED/);await assert.rejects(f.b.startCapture(f.r),/REVOKED/);
   await assert.rejects(f.b.deliverInput(f.r,{event:{type:'ime_commit',text:'old'}}),/REVOKED/);
   assert.throws(()=>f.service.publishModel(f.r.task.id,ticket,'old'),/PRIVATE_INPUT_REQUIRED/);
   assert.equal(await f.factory.pausePublic(f.r),true);assert.equal(bridge.revoked,1);
   f.commitPause();await f.continue();const next=f.gate.bindingForTarget(f.p._targetId);
   assert.equal(f.r.context,context);assert.equal(next.generation,old.generation+1);assert.notEqual(next.listenerCookie,old.listenerCookie);assert.notEqual(next.guardId,old.guardId);
   assert.throws(()=>bridge.options.bindingFor({targetId:f.p._targetId}),/GATE_AUTHORITY_REFUSED/);
   assert.throws(()=>f.service.publishModel(f.r.task.id,ticket,'old'),/PRIVATE_INPUT_REQUIRED/);
   assert.equal(f.service.publishModel(f.r.task.id,f.service.modelTicket(f.r.task.id),'fresh'),'fresh');
   assert.deepEqual(await f.b.capturePublic(f.r),{text:'public'});
  }
  await f.control('pause');assert.equal(f.calls.filter(q=>q.op==='revoke').length,3);assert.equal(f.closed(),0);
 }finally{await f.b.close();}
});
test('public control pause drains in-flight extraction/frame and aborts reads, old input and Fetch across resume',async()=>{
 const extraction=deferred(),extractBegan=deferred(),frame=deferred(),frameBegan=deferred(),readBegan=deferred(),input=deferred(),inputBegan=deferred(),fetch=deferred(),fetchBegan=deferred();
 const f=await publicControlFixture(options=>{
  options.extract=async()=>{extractBegan.resolve();await extraction.promise;return {text:'old'};};
  options.publishFrame=async()=>{frameBegan.resolve();await frame.promise;};
  options.authorizeInput=async()=>{inputBegan.resolve();await input.promise;return true;};
 });let signal;
 try{
  const capture=assert.rejects(f.b.capturePublic(f.r),/REVOKED/);await extractBegan.promise;
  const read=assert.rejects(f.service.read(f.r.task.id,async s=>{signal=s;readBegan.resolve();await extraction.promise;return 'old';}),/TIMEOUT|REVOKED/);await readBegan.promise;
  const typing=assert.rejects(f.b.deliverInput(f.r,{event:{type:'ime_commit',text:'old'}}),/REVOKED/);await inputBegan.promise;
  await f.b.startCapture(f.r);const publishing=f.listeners.get('Page.screencastFrame')({sessionId:1,data:Buffer.from('jpeg').toString('base64')});await frameBegan.promise;
  f.bridges[0].authority.authorizeFetch=async()=>{fetchBegan.resolve();await fetch.promise;return true;};
  const fetching=f.listeners.get('Fetch.requestPaused')({requestId:'old-fetch',resourceType:'Document',request:{method:'GET',url:'https://public.example/'}});await fetchBegan.promise;
  const ticket=f.service.modelTicket(f.r.task.id);let drained=false;const pause=f.control('pause').then(x=>{drained=true;return x;});
  await new Promise(r=>setImmediate(r));assert.equal(drained,false);assert.equal(signal.aborted,true);await read;
  extraction.resolve();await capture;await new Promise(r=>setImmediate(r));assert.equal(drained,false);
  frame.resolve();await publishing;await pause;assert.equal(f.r.context.pending.size,0);assert.equal(f.r.context.observationPending.size,0);
  f.commitPause();await f.continue();fetch.resolve();input.resolve();await fetching;await typing;
  assert.ok(!f.cdpCalls.some(q=>q[0]==='Fetch.continueRequest'));assert.ok(!f.calls.some(q=>q.op==='revoke_all'));
  assert.ok(!f.cdpCalls.some(q=>q[0]==='Input.insertText'));
  await f.listeners.get('Fetch.requestPaused')({requestId:'fresh-fetch',resourceType:'Document',request:{method:'GET',url:'https://public.example/'}});
  await f.b.deliverInput(f.r,{event:{type:'ime_commit',text:'fresh'},control:{control_epoch:f.r.task.control_epoch}});
  assert.equal(f.cdpCalls.filter(q=>q[0]==='Fetch.continueRequest').length,1);assert.equal(f.cdpCalls.filter(q=>q[0]==='Input.insertText').length,1);
  assert.throws(()=>f.service.publishModel(f.r.task.id,ticket,'old'),/PRIVATE_INPUT_REQUIRED/);
 }finally{extraction.resolve();frame.resolve();input.resolve();fetch.resolve();await f.b.close();}
});
test('public pause waits for a starting screencast and prevents late or paused capture start',async()=>{
 const f=await publicControlFixture(),started=deferred(),release=deferred();try{
  const send=f.p.session.send;f.p.session.send=async(m,v)=>{const result=await send(m,v);if(m==='Page.startScreencast'){started.resolve();await release.promise;}return result;};
  const starting=assert.rejects(f.b.startCapture(f.r),/REVOKED/);await started.promise;
  let drained=false;const pause=f.control('pause').then(x=>{drained=true;return x;});await new Promise(r=>setImmediate(r));assert.equal(drained,false);
  release.resolve();await starting;await pause;assert.equal(f.r.context.session,null);assert.equal(f.listeners.has('Page.screencastFrame'),false);
  await assert.rejects(f.b.startCapture(f.r),/REVOKED/);
 }finally{release.resolve();await f.b.close();}
});
for(const boundary of ['stop','private'])test(boundary+' still permanently fences the gate despite a fresh run/listener',async()=>{
 const f=await publicControlFixture();try{
  if(boundary==='stop')await f.control('stop');
  else{Object.assign(f.r.task,{private:true,privacy_mode:'private'});await f.factory.stopInputAndCapture(f.r);}
  Object.assign(f.r.task,{private:false,privacy_mode:'public',current_run_id:'new',listener_generation:10,control_epoch:3});
  await assert.rejects(f.gate.pausePublic(f.r),/GATE_AUTHORITY_REFUSED/);await assert.rejects(f.gate.resumePublic(f.r,f.r.task),/REVOKED/);
  assert.equal(f.gate.bindingForTarget(f.p._targetId),null);
  if(boundary==='stop')assert.equal(f.service.contexts.has(f.r.task.id),false);
 }finally{await f.b.close();}
});

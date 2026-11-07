/** Production CDP owner. Fixed privileged helper launches ONLY the pinned shell
 * as uid998; controller runs as a distinct nonroot uid. No acceptance launcher.
 * All dependencies are installation-owned callbacks, never RPC-selected. */
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {chromiumArguments,CHROMIUM,productionHelperCall} from './launcher.mjs';
import {guardTarget} from './target-barrier.mjs';
import {productionIdentity,validateProductionIdentity} from './production-namespace.mjs';
const fail=code=>{throw Error('BROWSER_'+code);};
export function productionLaunchSpec(profile){
 if(!/^\/run\/sjcos-browser-chromium\/[a-z0-9-]{1,32}\/profile$/.test(profile))fail('LAUNCH_REFUSED');
 const base=profile.slice(0,-8);return {executable:CHROMIUM,uid:998,args:chromiumArguments(profile),env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',HOME:base+'/home',XDG_CONFIG_HOME:base+'/home',XDG_CACHE_HOME:base+'/home',TMPDIR:base}};
}
export function cdpInput(e){
 const finite=(n,a,b)=>typeof n==='number'&&Number.isFinite(n)&&n>=a&&n<=b;
 const point=()=>{if(!finite(e.x,0,1280)||e.x===1280||!finite(e.y,0,800)||e.y===800)fail('BAD_INPUT');};
 const mods=()=>{if(!Array.isArray(e.modifiers)||e.modifiers.some(x=>!['Alt','Control','Meta','Shift'].includes(x)))fail('BAD_INPUT');return e.modifiers.reduce((n,x)=>n|({Alt:1,Control:2,Meta:4,Shift:8})[x],0);};
 if(e?.type==='wheel'){point();if(!finite(e.delta_x,-1200,1200)||!finite(e.delta_y,-1200,1200))fail('BAD_INPUT');return ['Input.dispatchMouseEvent',{type:'mouseWheel',x:e.x,y:e.y,deltaX:e.delta_x,deltaY:e.delta_y}];}
 if(e?.type==='pointer'){point();if(!['down','up','move'].includes(e.phase)||![0,1,2].includes(e.button)||!Number.isInteger(e.buttons)||e.buttons<0||e.buttons>7)fail('BAD_INPUT');return ['Input.dispatchMouseEvent',{type:({down:'mousePressed',up:'mouseReleased',move:'mouseMoved'})[e.phase],x:e.x,y:e.y,button:['left','middle','right'][e.button],buttons:e.buttons,modifiers:mods(),clickCount:1}];}
 if(e?.type==='key'){if(!['down','up'].includes(e.phase)||! /^(?:[a-zA-Z0-9]|Arrow(?:Up|Down|Left|Right)|Backspace|Delete|Enter|Tab|Escape|Home|End|PageUp|PageDown|Shift|Alt|Control|Meta| )$/.test(e.key??'')||typeof e.code!=='string'||e.code.length>32||e.modifiers?.some(x=>['Control','Meta','Alt'].includes(x)))fail('BAD_INPUT');return ['Input.dispatchKeyEvent',{type:e.phase==='up'?'keyUp':'keyDown',key:e.key,code:e.code,modifiers:mods()}];}
 if(e?.type==='ime_commit'&&typeof e.text==='string'&&Buffer.byteLength(e.text)<=4096&&!e.text.includes('\0'))return ['Input.insertText',{text:e.text}];
 fail('BAD_INPUT');
}
async function connectPinned(endpoint,policy){
 const core=createRequire(import.meta.url)('/opt/sjcos-browser/node/node_modules/playwright-core/lib/coreBundle.js');
 if(!core.sjcBrowser)fail('RUNTIME_NOT_READY');const progress=core.server.nullProgress;
 const transport=await core.server.WebSocketTransport.connect(progress,endpoint);
 try{const browser=await core.sjcBrowser.connect(core.server.createPlaywright({sdkLanguage:'javascript',isInternalPlaywright:true}),transport,{name:'chromium',browserType:'chromium',headful:false,artifactsDir:'/run/sjcos-browser-runtime',downloadsPath:'/run/sjcos-browser-runtime',tracesDir:'/run/sjcos-browser-runtime',originalLaunchOptions:{},protocolLogger:()=>{},browserProcess:{close:()=>policy.revokeListener(),kill:()=>policy.revokeListener()},browserLogsCollector:{recentLogs:()=>[]},__sjcBarrier:policy});return {newContext:o=>browser.newContext(progress,o),close:async()=>transport.close(),progress};}catch{transport.close();throw Error('BROWSER_SERVICE_UNAVAILABLE');}
}
// Trusted, bounded visible-only extraction; no values, markup, console or title.
const EXTRACTION=`(() => {const textNodes=[]; const w=document.createTreeWalker(document.body||document,NodeFilter.SHOW_TEXT);let n,count=0,bytes=0;while((n=w.nextNode())&&count++<10000&&bytes<20000){const p=n.parentElement;if(!p||p.closest('input,textarea,select,[contenteditable],script,style,[hidden],[aria-hidden="true"]'))continue;const s=getComputedStyle(p);if(s.visibility!=='visible'||s.display==='none'||!p.getClientRects().length)continue;const text=n.textContent.slice(0,20000-bytes);bytes+=text.length;textNodes.push({kind:'text',visible:true,text});}return {url:location.href,textNodes,controls:[]};})()`;
export async function createProductionBrowser({identity,verify,helper=productionHelperCall,connect=connectPinned,gate,sessionFor=p=>gate.sessionFor(p),publishFrame,extract,clock=Date.now,progress,authorizeInput}={}){
 identity??=await productionIdentity();validateProductionIdentity(identity);
 if(typeof verify!=='function'||await verify()!==true)fail('RUNTIME_NOT_READY');
 if(!gate?.policy||typeof publishFrame!=='function')fail('FORBIDDEN');
 let closed=false,closing,raw,barrierFence=()=>{},creating=0;const contexts=new Set();
 const close=()=>{if(closing)return closing;closed=true;barrierFence();closing=Promise.resolve().then(async()=>{let timer;try{const settle=Promise.allSettled([...contexts].map(c=>c.close()));const stopped=helper('stop');await Promise.all([stopped,raw?.close(),Promise.race([settle,new Promise(resolve=>{timer=setTimeout(resolve,2000);})])]);}finally{clearTimeout(timer);}});return closing;};
 const policy={...gate.policy,guardTarget,registerFence:f=>{barrierFence=f;},revokeListener:async()=>{try{await gate.policy.revokeListener();}finally{void close().catch(()=>{});}}};
 try{const started=await helper('start');if(!/^ws:\/\/127\.0\.0\.1:[0-9]{4,5}\/devtools\/browser\/[a-z0-9-]+$/.test(started.endpoint??''))fail('LAUNCH_REFUSED');raw=await connect(started.endpoint,policy);progress??=raw.progress;}catch(e){await close().catch(()=>{});throw e;}
 const live=()=>{if(closed)fail('REVOKED');};
 function state(r){live();const c=r?.context;if(!contexts.has(c)||c.closed)fail('REVOKED');return c;}
 async function page(r){const c=state(r);c.record??=r;if(c.record!==r)fail('REVOKED');await gate.attach(c,r);if(!c.pages.size)await c.newPage();for(const p of c.pages)r.tabs?.add(target(p));const p=r.activeTarget?[...c.pages].find(p=>target(p)===r.activeTarget):[...c.pages][0];if(!p)fail('REVOKED');return p;}
 const preparedNavigations=new WeakMap();
 const target=p=>p._delegate?._targetId??p._delegate?._mainFrameSession?._targetId??p._targetId;
 const navigationSnapshot=r=>JSON.stringify(['id','controller_boot_id','listener_generation','context_generation','document_epoch','control_epoch','read_manifest_revision','current_run_id','state','private','privacy_mode'].map(k=>r.task?.[k]));
 const reviewStale=()=>fail('REVIEW_STALE');
 const publicNavigation=r=>{if(state(r).publicPaused||r.task.private!==false||r.task.privacy_mode!=='public'||!['active','paused'].includes(r.task.state))reviewStale();};
 async function navigationPage(r){await page(r);const pages=[...state(r).pages],p=r.activeTarget?pages.find(p=>target(p)===r.activeTarget):pages[0];if(!p)reviewStale();return p;}
 function historyEntry(h,action){if(!Number.isInteger(h?.currentIndex)||!Array.isArray(h.entries))reviewStale();const i=h.currentIndex+(action==='back'?-1:action==='forward'?1:0),e=h.entries[i];if(!e||!Number.isInteger(e.id)||typeof e.url!=='string')reviewStale();return e;}
 async function stopCapture(c){if(c.session){const s=c.session;c.session=null;s.off?.('Page.screencastFrame',c.handler);await s.send('Page.stopScreencast');}await Promise.all([...c.pending]);return true;}
 const api={get closed(){return closed;},browser:async()=>{live();return api;},
  async newContext(options){live();if(contexts.size+creating>=2)fail('RESOURCE_LIMIT');if(options.acceptDownloads!==false||options.serviceWorkers!=='block'||options.viewport?.width!==1280||options.viewport?.height!==800||Object.keys(options).some(k=>!['acceptDownloads','serviceWorkers','viewport'].includes(k)))fail('FORBIDDEN');
   creating++;let lease,inner;try{lease=await gate.open();inner=await raw.newContext({...options,...lease});live();}catch(e){if(lease)await gate.release({lease}).catch(()=>{});throw e;}finally{creating--;}
   const c={id:inner._browserContextId??inner.id,inner,lease,pages:new Set(),owner:api,opening:0,closed:false,modelFenced:false,captureEpoch:0,pending:new Set(),observationPending:new Set(),lastFrame:0,
    async newPage(){live();if(c.closed||c.pages.size+c.opening>=2||[...contexts].reduce((n,x)=>n+x.pages.size+x.opening,0)>=4)fail('RESOURCE_LIMIT');c.opening++;try{const p=await inner.newPage(progress);live();c.pages.add(p);c.record?.tabs?.add(target(p));p.on?.('close',()=>{c.pages.delete(p);c.record?.tabs?.delete(target(p));if(c.record?.activeTarget===target(p))c.record.activeTarget=null;});return p;}finally{c.opening--;}},
    async close(){if(c.closed)return;c.closed=true;c.captureEpoch++;await api.stopAndAckScreencast({context:c}).catch(()=>{});try{await gate.fence?.(c);await inner.close();}finally{try{await gate.release(c);}finally{contexts.delete(c);c.pages.clear();}}}};contexts.add(c);return c;
  },
  async bind(r){await page(r);return true;},
  async pausePublic(r){
   const c=state(r);if(r.task.private||r.task.privacy_mode!=='public')fail('REVOKED');if(c.publicPaused)return c.publicPausePromise;
   c.publicPaused={...r.task,drained:false};c.modelFenced=true;c.captureEpoch++;
   r.commandsFenced=true;r.outputFence?.fence();
   for(const controller of [...r.observations??[],...r.reads??[]])controller.abort();r.registry?.clear();
   c.record??=r;if(c.record!==r)fail('REVOKED');
   c.publicPausePromise=(async()=>{
    if(typeof gate.pausePublic!=='function')fail('REVOKED');await gate.attach(c,r);
    const revoke=gate.pausePublic(r);
    await Promise.all([revoke,api.stopAndAckScreencast(r),Promise.allSettled([...c.observationPending]),...([...c.pages].map(async p=>{const s=await sessionFor(p);await s.send('Page.stopLoading');}))]);
    state(r);c.publicPaused.drained=true;return true;
   })().catch(async e=>{await gate.fence?.(c);throw e;});return c.publicPausePromise;
  },
  async resumePublic(r,{reauthorize}={}){
   const c=state(r),old=c.publicPaused;if(!old?.drained||typeof reauthorize!=='function'||typeof gate.resumePublic!=='function')fail('REVOKED');
   const before=navigationSnapshot(r),valid=t=>{
    state(r);if(c.publicPaused!==old||navigationSnapshot(r)!==before||!t||t.id!==old.id||t.private||t.privacy_mode!=='public'||t.state!=='active'||t.controller_boot_id!==old.controller_boot_id||t.context_generation!==old.context_generation||!t.current_run_id||t.current_run_id===old.current_run_id||!Number.isSafeInteger(t.listener_generation)||t.listener_generation<=old.listener_generation||t.control_epoch<=old.control_epoch||['id','private','privacy_mode','state','controller_boot_id','context_generation','listener_generation','control_epoch','current_run_id','document_epoch','read_manifest_revision'].some(k=>t[k]!==r.task[k]))fail('REVOKED');
   };
   valid(await reauthorize());
   try{if(await gate.resumePublic(r,r.task)!==true)fail('REVOKED');valid(await reauthorize());c.publicPaused=null;c.publicPausePromise=null;c.modelFenced=false;return true;}
   catch(e){await gate.fence?.(c);throw e;}
  },
  async navigationState(r){
   publicNavigation(r);const before=navigationSnapshot(r),p=await navigationPage(r),s=await sessionFor(p),h=await s.send('Page.getNavigationHistory');
   publicNavigation(r);if(before!==navigationSnapshot(r)||!state(r).pages.has(p))reviewStale();
   return {back:h.currentIndex>0,forward:h.currentIndex>=0&&h.currentIndex<h.entries.length-1,reload:h.currentIndex>=0&&!!h.entries[h.currentIndex],targets:[...state(r).pages].map(target)};
  },
  async prepareNavigation(r,request){
   publicNavigation(r);const before=navigationSnapshot(r),c=state(r);
   if(!['back','forward','reload','switch_tab'].includes(request.action)||Object.entries({expected_epoch:'control_epoch',expected_document_epoch:'document_epoch',context_generation:'context_generation',read_manifest_revision:'read_manifest_revision'}).some(([q,k])=>!Number.isSafeInteger(request[q])||request[q]!==r.task[k]))reviewStale();
   let p=await navigationPage(r);if(request.action==='switch_tab'){p=[...c.pages].find(p=>target(p)===request.target_id);if(!p)reviewStale();}
   const s=await sessionFor(p);let history,entry,reviewed;
   if(request.action!=='switch_tab'){
    history=await s.send('Page.getNavigationHistory');entry=historyEntry(history,request.action);
    if(typeof gate.prepareNavigation!=='function')reviewStale();
    reviewed=await gate.prepareNavigation(r,{url:entry.url,action:request.action,target_id:target(p),document_epoch:r.task.document_epoch+1,read_manifest_revision:r.task.read_manifest_revision});
    if(reviewed?.reviewed===false)fail('REVIEW_REQUIRED');
    if(reviewed?.reviewed!==true||reviewed.document_epoch!==r.task.document_epoch+1||reviewed.read_manifest_revision!==r.task.read_manifest_revision||reviewed.url!==entry.url)reviewStale();
   }
   publicNavigation(r);if(before!==navigationSnapshot(r)||!c.pages.has(p))reviewStale();
   const prepared=Object.freeze({reviewed:request.action==='switch_tab'||reviewed.reviewed,document_epoch:r.task.document_epoch+(request.action==='switch_tab'?0:1),read_manifest_revision:r.task.read_manifest_revision});
   preparedNavigations.set(prepared,{r,c,p,before,action:request.action,target_id:request.target_id??null,history:JSON.stringify(history),entry});return prepared;
  },
  async guardedNavigation(r,{action,target_id=null,prepared,reauthorize}={}){
   const n=preparedNavigations.get(prepared);if(!n||n.r!==r||n.action!==action||n.target_id!==target_id||typeof reauthorize!=='function')reviewStale();
   preparedNavigations.delete(prepared); // burned before every await/effect
   const local=()=>{publicNavigation(r);if(state(r)!==n.c||!n.c.pages.has(n.p)||n.before!==navigationSnapshot(r))reviewStale();};local();
   const s=await sessionFor(n.p);local();
   const recapture=action==='switch_tab'&&!!n.c.session;
   if(action!=='switch_tab'){
    const h=await s.send('Page.getNavigationHistory');if(JSON.stringify(h)!==n.history)reviewStale();local();
    const reviewed=await gate.prepareNavigation(r,{url:n.entry.url,action,target_id:target(n.p),document_epoch:prepared.document_epoch,read_manifest_revision:prepared.read_manifest_revision});
    if(reviewed?.reviewed===false)fail('REVIEW_REQUIRED');
    if(reviewed?.reviewed!==true||reviewed.document_epoch!==prepared.document_epoch||reviewed.read_manifest_revision!==prepared.read_manifest_revision||reviewed.url!==n.entry.url)reviewStale();local();
   }else if(recapture){await api.stopAndAckScreencast(r);local();}
   const authority=await reauthorize();if(authority!==true&&(!authority||authority.id!==r.task.id))reviewStale();
   // Mandatory fresh authority after session/history awaits. No await between
   // this synchronous epoch/target fence and the fixed CDP effect.
   local();let sent;
   if(action==='switch_tab'){sent=s.send('Page.bringToFront');r.activeTarget=target_id;}
   else if(action==='reload')sent=s.send('Page.reload',{ignoreCache:true});
   else sent=s.send('Page.navigateToHistoryEntry',{entryId:n.entry.id});
   await sent;if(recapture)await api.startCapture(r);return {document_epoch:prepared.document_epoch};
  },
  async capturePublic(r,{signal}={}){const c=state(r);if(c.modelFenced||signal?.aborted)fail('REVOKED');const epoch=c.captureEpoch;
   const pending=(async()=>{const p=await page(r);if(c.modelFenced||c.captureEpoch!==epoch||signal?.aborted)fail('REVOKED');const value=await (extract?extract(p):p.mainFrame().evaluateExpression(progress,EXTRACTION,{isFunction:false}));if(c.modelFenced||c.captureEpoch!==epoch||signal?.aborted)fail('REVOKED');return value;})();c.observationPending.add(pending);try{return await pending;}finally{c.observationPending.delete(pending);}
  },
  async deliverInput(r,resolved){
   if(state(r).publicPaused)fail('REVOKED');
   const c=state(r),keys=['id','document_epoch','control_epoch','context_generation','stream_generation','controller_boot_id','private','current_run_id','state','active_controller','privacy_mode'];
   const snapshot=()=>JSON.stringify(keys.map(k=>r.task?.[k]));const before=snapshot(),inputBefore=JSON.stringify(resolved),stopped=c.inputStopped;
   const p=await page(r),s=await sessionFor(p);
   const event=resolved.event?.type==='type_answer'?{type:'ime_commit',text:resolved.confirmedText}:resolved.event;const [m,v]=cdpInput(event);
   if(typeof authorizeInput!=='function'||await authorizeInput(r,resolved)!==true)fail('REVOKED');
   // No await between the final local fence and actual send. Authority callback
   // must resolve fresh committed human authority (task/viewer/frame/epochs).
   state(r);if(c.publicPaused||before!==snapshot()||inputBefore!==JSON.stringify(resolved)||stopped!==c.inputStopped)fail('REVOKED');
   if(c.inputStopped){if(!Number.isSafeInteger(resolved.control?.control_epoch)||resolved.control.control_epoch<=(c.stoppedEpoch??-1))fail('REVOKED');c.inputStopped=false;}
   return s.send(m,v);
  },
  async startCapture(r,{fps=2}={}){const c=state(r);if(c.publicPaused||c.captureStarting)fail('REVOKED');const epoch=++c.captureEpoch;
   const valid=()=>{state(r);if(c.publicPaused||c.captureEpoch!==epoch)fail('REVOKED');};
   const starting=(async()=>{const p=await page(r);valid();const s=await sessionFor(p);valid();if(c.session)await stopCapture(c);valid();c.session=s;c.lastFrame=0;
   c.handler=async e=>{try{await s.send('Page.screencastFrameAck',{sessionId:e.sessionId});if(c.closed||closed||epoch!==c.captureEpoch||!c.session||clock()-c.lastFrame<1000/Math.min(5,Math.max(1,fps))||typeof e.data!=='string'||e.data.length>218456||c.pending.size)return;const bytes=Buffer.from(e.data,'base64');if(bytes.length>163840)return;c.lastFrame=clock();const promise=Promise.resolve(publishFrame(r,{bytes,frame_id:randomUUID(),width:1280,height:800,viewport:{width:1280,height:800},document_epoch:r.task.document_epoch,control_epoch:r.task.control_epoch,context_generation:r.task.context_generation}));c.pending.add(promise);try{await promise;}finally{c.pending.delete(promise);}}catch{void close().catch(()=>{});}};
   s.on('Page.screencastFrame',c.handler);await s.send('Page.startScreencast',{format:'jpeg',quality:55,maxWidth:1280,maxHeight:800,everyNthFrame:1});valid();return true;})();
   c.captureStarting=starting;try{return await starting;}finally{if(c.captureStarting===starting)c.captureStarting=null;}
  },
  async stopAndAckScreencast(r){const c=r.context;c.captureEpoch++;if(c.captureStarting)await Promise.allSettled([c.captureStarting]);return stopCapture(c);},
  async drainPublicOutputs(r){await Promise.all([...r.context.pending]);return true;},
  async cancelObservations(r){r.context.modelFenced=true;r.context.captureEpoch++;return true;},
  async cancelAndDrainCommands(r){r.context.modelFenced=true;await gate.fence?.(r.context);return true;},
  async fence(r){await api.cancelObservations(r);await api.cancelAndDrainCommands(r);await api.stopAndAckScreencast(r);return true;},
  async ackPrivate(r,binding){await api.drainPublicOutputs(r);if(binding.privacy_mode!=='private'||!r.context.modelFenced)fail('PRIVATE_INPUT_REQUIRED');return true;},
  async rotatePrivateHandles(r,savedTask){if(!Number.isSafeInteger(savedTask.stream_generation)||savedTask.stream_generation<1)fail('STREAM_STALE');await api.drainPublicOutputs(r);return {stream_generation:savedTask.stream_generation};},
  async stopInputAndCapture(r){r.context.inputStopped=true;r.context.stoppedEpoch=r.task.control_epoch;
   // Public Pause/Done must preserve a resumable gate. Private input and
   // terminal lifecycle paths continue using the permanent fence.
   if(r.task.private===false&&r.task.privacy_mode==='public')return api.pausePublic(r);
   return api.fence(r);
  },
  async release(r){await gate.release(r.context);return true;},
  pressure:close,close,
 };return api;
}

/** Lazy service adapter; idle shutdown never reuses a dead CDP connection. */
export function createProductionFactory(options){
 let current,starting;
 const factory={browser:async()=>{if(current){if(!current.closed)return current;await current.close();}if(!starting)starting=createProductionBrowser(options).then(b=>{current=b;return b;}).finally(()=>{starting=null;});return starting;}};
 for(const name of ['bind','pausePublic','resumePublic','navigationState','prepareNavigation','guardedNavigation','capturePublic','deliverInput','startCapture','fence','cancelAndDrainCommands','cancelObservations','stopAndAckScreencast','drainPublicOutputs','ackPrivate','rotatePrivateHandles','stopInputAndCapture','release'])factory[name]=(r,...args)=>{if(!r.context?.owner)throw Error('BROWSER_REVOKED');return r.context.owner[name](r,...args);};
 factory.pressure=async()=>{await current?.pressure();};return factory;
}

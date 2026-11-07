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
 const point=()=>{if(!finite(e.x,0,1279)||!finite(e.y,0,799))fail('BAD_INPUT');};
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
 async function page(r){const c=state(r);c.record??=r;if(c.record!==r)fail('REVOKED');await gate.attach(c,r);if(!c.pages.size)await c.newPage();return [...c.pages][0];}
 const api={get closed(){return closed;},browser:async()=>{live();return api;},
  async newContext(options){live();if(contexts.size+creating>=2)fail('RESOURCE_LIMIT');if(options.acceptDownloads!==false||options.serviceWorkers!=='block'||options.viewport?.width!==1280||options.viewport?.height!==800||Object.keys(options).some(k=>!['acceptDownloads','serviceWorkers','viewport'].includes(k)))fail('FORBIDDEN');
   creating++;let lease,inner;try{lease=await gate.open();inner=await raw.newContext({...options,...lease});live();}catch(e){if(lease)await gate.release({lease}).catch(()=>{});throw e;}finally{creating--;}
   const c={id:inner._browserContextId??inner.id,inner,lease,pages:new Set(),owner:api,opening:0,closed:false,modelFenced:false,captureEpoch:0,pending:new Set(),lastFrame:0,
    async newPage(){live();if(c.closed||c.pages.size+c.opening>=2||[...contexts].reduce((n,x)=>n+x.pages.size+x.opening,0)>=4)fail('RESOURCE_LIMIT');c.opening++;try{const p=await inner.newPage(progress);live();c.pages.add(p);p.on?.('close',()=>c.pages.delete(p));return p;}finally{c.opening--;}},
    async close(){if(c.closed)return;c.closed=true;c.captureEpoch++;await api.stopAndAckScreencast({context:c}).catch(()=>{});try{await gate.fence?.(c);await inner.close();}finally{try{await gate.release(c);}finally{contexts.delete(c);c.pages.clear();}}}};contexts.add(c);return c;
  },
  async bind(r){await page(r);return true;},
  async capturePublic(r,{signal}={}){const c=state(r);if(c.modelFenced||signal?.aborted)fail('REVOKED');const epoch=c.captureEpoch,p=await page(r);const value=await (extract?extract(p):p.mainFrame().evaluateExpression(progress,EXTRACTION,{isFunction:false}));if(c.modelFenced||c.captureEpoch!==epoch||signal?.aborted)fail('REVOKED');return value;},
  async deliverInput(r,resolved){
   const c=state(r),keys=['id','document_epoch','control_epoch','context_generation','stream_generation','controller_boot_id','private','current_run_id','state','active_controller','privacy_mode'];
   const snapshot=()=>JSON.stringify(keys.map(k=>r.task?.[k]));const before=snapshot(),inputBefore=JSON.stringify(resolved),stopped=c.inputStopped;
   const p=await page(r),s=await sessionFor(p);
   const event=resolved.event?.type==='type_answer'?{type:'ime_commit',text:resolved.confirmedText}:resolved.event;const [m,v]=cdpInput(event);
   if(typeof authorizeInput!=='function'||await authorizeInput(r,resolved)!==true)fail('REVOKED');
   // No await between the final local fence and actual send. Authority callback
   // must resolve fresh committed human authority (task/viewer/frame/epochs).
   state(r);if(before!==snapshot()||inputBefore!==JSON.stringify(resolved)||stopped!==c.inputStopped)fail('REVOKED');
   if(c.inputStopped){if(!Number.isSafeInteger(resolved.control?.control_epoch)||resolved.control.control_epoch<=(c.stoppedEpoch??-1))fail('REVOKED');c.inputStopped=false;}
   return s.send(m,v);
  },
  async startCapture(r,{fps=2}={}){const c=state(r),p=await page(r),s=await sessionFor(p);if(c.session)await api.stopAndAckScreencast(r);const epoch=++c.captureEpoch;c.session=s;c.lastFrame=0;
   c.handler=async e=>{try{await s.send('Page.screencastFrameAck',{sessionId:e.sessionId});if(c.closed||closed||epoch!==c.captureEpoch||!c.session||clock()-c.lastFrame<1000/Math.min(5,Math.max(1,fps))||typeof e.data!=='string'||e.data.length>218456||c.pending.size)return;const bytes=Buffer.from(e.data,'base64');if(bytes.length>163840)return;c.lastFrame=clock();const promise=Promise.resolve(publishFrame(r,{bytes,frame_id:randomUUID(),width:1280,height:800,viewport:{width:1280,height:800},document_epoch:r.task.document_epoch,control_epoch:r.task.control_epoch,context_generation:r.task.context_generation}));c.pending.add(promise);try{await promise;}finally{c.pending.delete(promise);}}catch{void close().catch(()=>{});}};
   s.on('Page.screencastFrame',c.handler);await s.send('Page.startScreencast',{format:'jpeg',quality:55,maxWidth:1280,maxHeight:800,everyNthFrame:1});return true;
  },
  async stopAndAckScreencast(r){const c=r.context;c.captureEpoch++;if(c.session){const s=c.session;c.session=null;s.off?.('Page.screencastFrame',c.handler);await s.send('Page.stopScreencast');}await Promise.all([...c.pending]);return true;},
  async drainPublicOutputs(r){await Promise.all([...r.context.pending]);return true;},
  async cancelObservations(r){r.context.modelFenced=true;r.context.captureEpoch++;return true;},
  async cancelAndDrainCommands(r){r.context.modelFenced=true;await gate.fence?.(r.context);return true;},
  async fence(r){await api.cancelObservations(r);await api.cancelAndDrainCommands(r);await api.stopAndAckScreencast(r);return true;},
  async ackPrivate(r,binding){await api.drainPublicOutputs(r);if(binding.privacy_mode!=='private'||!r.context.modelFenced)fail('PRIVATE_INPUT_REQUIRED');return true;},
  async rotatePrivateHandles(r,savedTask){if(!Number.isSafeInteger(savedTask.stream_generation)||savedTask.stream_generation<1)fail('STREAM_STALE');await api.drainPublicOutputs(r);return {stream_generation:savedTask.stream_generation};},
  async stopInputAndCapture(r){r.context.inputStopped=true;r.context.stoppedEpoch=r.task.control_epoch;return api.fence(r);},
  async release(r){await gate.release(r.context);return true;},
  pressure:close,close,
 };return api;
}

/** Lazy service adapter; idle shutdown never reuses a dead CDP connection. */
export function createProductionFactory(options){
 let current,starting;
 const factory={browser:async()=>{if(current){if(!current.closed)return current;await current.close();}if(!starting)starting=createProductionBrowser(options).then(b=>{current=b;return b;}).finally(()=>{starting=null;});return starting;}};
 for(const name of ['bind','capturePublic','deliverInput','startCapture','fence','cancelAndDrainCommands','cancelObservations','stopAndAckScreencast','drainPublicOutputs','ackPrivate','rotatePrivateHandles','stopInputAndCapture','release'])factory[name]=(r,...args)=>{if(!r.context?.owner)throw Error('BROWSER_REVOKED');return r.context.owner[name](r,...args);};
 factory.pressure=async()=>{await current?.pressure();};return factory;
}

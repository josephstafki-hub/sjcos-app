/** Controller-owned Phase1 gate adapter. D policy/authority remain authoritative.
 * readBridgeFor must be A2a createProductionReadBridge's phase:1 result.
 * No fixture signer, no arbitrary root RPC, no request bodies over control IPC. */
import {parseBrowserUrl} from './network-policy.mjs';
import {randomUUID} from 'node:crypto';
import {connect as netConnect,createServer} from 'node:net';
import {lstat,chmod} from 'node:fs/promises';
import {encodeFrame,frameReader} from './controller-rpc.mjs';

export async function productionGateCall(value){
 const parent=await lstat('/run/sjcos-browser-gate'),s=await lstat('/run/sjcos-browser-gate/control.sock');
 if(parent.isSymbolicLink()||parent.mode&0o022||s.isSymbolicLink()||!s.isSocket()||s.uid!==parent.uid||s.uid===0||s.uid===998||s.mode&0o007)throw Error('BROWSER_GATE_AUTHORITY_REFUSED');
 return new Promise((resolve,reject)=>{const socket=netConnect('/run/sjcos-browser-gate/control.sock');let done=false;const finish=(error,value)=>{if(done)return;done=true;socket.destroy();error?reject(Error('BROWSER_GATE_AUTHORITY_REFUSED')):resolve(value);};socket.setTimeout(2000,()=>finish(true));socket.on('error',()=>finish(true));socket.on('end',()=>finish(true));socket.on('connect',()=>socket.write(encodeFrame(value)));socket.on('data',frameReader(v=>v.ok===true?finish(false,v):finish(true),()=>finish(true)));});
}
export async function serveProductionGatePolicy(gate){
 if(process.getuid()===0||process.getuid()===998)throw Error('BROWSER_FORBIDDEN');
 const sockets=new Set();const server=createServer(s=>{if(sockets.size>=8)return s.destroy();sockets.add(s);s.on('close',()=>sockets.delete(s));s.setTimeout(2000,()=>s.destroy());s.on('error',()=>{});s.on('data',frameReader(async v=>{try{s.end(encodeFrame(await gate.handle(v)));}catch{s.end(encodeFrame({ok:false}));}},()=>s.destroy()));});
 await new Promise((yes,no)=>{server.once('error',no);server.listen('/run/sjcos-browser-runtime/gate-policy.sock',yes);});await chmod('/run/sjcos-browser-runtime/gate-policy.sock',0o660);
 return {close:async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
const refuse=()=>{throw Error('BROWSER_GATE_AUTHORITY_REFUSED');};
export function createProductionGate({readBridgeFor,networkConfig,call=productionGateCall,onFatal=async()=>{}}){
 if(typeof readBridgeFor!=='function')refuse();
 const slots=new Set(),contexts=new Map(),targets=new Map(),fetches=new Map(),sessions=new Map();let dead=false;
 const live=()=>{if(dead)refuse();};
 const requestFor=(url,kind,method='GET')=>({method,url,kind,headers:[['host',parseBrowserUrl(url).hostname],['user-agent','SJC-Public-Browser/1'],['accept',kind==='document'?'text/html':'*/*'],['accept-encoding','identity']]});
 async function fatal(){dead=true;await Promise.allSettled([...contexts.values()].map(c=>c.authority?.unknownAll()));await Promise.allSettled([call({op:'revoke_all'}),onFatal()]);}
 async function ack(x){const r=await call(x);if(r?.ok!==true){await fatal();refuse();}return r;}
 async function bridgeFor(entry){
  const turn=entry.turn,check=()=>{live();if(entry.paused||entry.fenced||entry.turn!==turn)refuse();};
  const bindingFor=e=>{check();return [...entry.bindings.values()].find(b=>b.targetId===e.targetId&&b.listener===e.listener&&b.guardId===e.guardId&&b.listenerCookie===e.listenerCookie);};
  const options={networkConfig,bindingFor,fetchFor:async e=>{check();const q=fetches.get(e.listenerCookie),fetch=q?.shift();if(fetch?.url!==e.url||fetch?.method!==e.method)refuse();return fetch;},registerDigest:async(e,b)=>{
   check();const result=await call({op:'fetch',listenerCookie:b.listenerCookie,generation:b.generation,guardId:b.guardId,targetId:b.targetId,requestDigest:e.requestDigest});check();if(result?.ok!==true){await fatal();refuse();}
  },onFatal:async()=>{if(entry.turn===turn&&!entry.paused&&!entry.fenced)await fatal();}};
  const bridge=await readBridgeFor(entry.record,options);if(bridge?.authority?.phase!==1||typeof bridge.handle!=='function')refuse();return bridge;
 }
 const adapter={
  bindingForTarget(id){const stable=targets.get(id),c=contexts.get(stable?.contextId);return c&&!c.paused&&!c.fenced?c.bindings.get(id)??null:null;},
  sessionFor(p){const id=p._delegate?._targetId??p._delegate?._mainFrameSession?._targetId??p._targetId;const s=sessions.get(id);if(!s)refuse();return s;},
  async open(){live();const port=[18081,18082].find(p=>!slots.has(p));if(!port)throw Error('BROWSER_RESOURCE_LIMIT');slots.add(port);return {proxy:{server:'http://10.203.0.2:'+port}};},
  async attach(c,r){live();if(contexts.has(c.id)){if(contexts.get(c.id).record!==r)refuse();return;}if(!c.id||!r.task?.controller_boot_id)refuse();
   const port=Number(c.lease.proxy.server.split(':').at(-1));
   if(!Number.isSafeInteger(r.task.listener_generation)||r.task.listener_generation<1)refuse();
   const entry={record:r,port,generation:r.task.listener_generation,contextGeneration:r.task.context_generation,bindings:new Map(),pageTargets:new Set(),fenced:false,paused:false,turn:0};contexts.set(c.id,entry);
   const bridge=await bridgeFor(entry);entry.authority=bridge.authority;entry.handle=bridge.handle;
  },
  async pausePublic(r){
   live();const c=contexts.get(r.context?.id);if(!c||c.record!==r||c.fenced||r.task.private||r.task.privacy_mode!=='public')refuse();if(c.paused)return c.pauseDrain;
   c.paused=true;c.turn++;c.pausedTask={...r.task};const cookie=c.cookie;fetches.delete(cookie);
   c.pauseDrain=(async()=>{if(cookie)await ack({op:'revoke',listenerCookie:cookie,generation:c.generation});await c.authority.unknownAll();c.cookie=null;return true;})();return c.pauseDrain;
  },
  async resumePublic(r,task){
   live();const c=contexts.get(r.context?.id),old=c?.pausedTask;
   if(!c||c.record!==r||c.fenced||!c.paused||!old||task.id!==old.id||task.private||task.privacy_mode!=='public'||task.state!=='active'||task.controller_boot_id!==old.controller_boot_id||task.context_generation!==old.context_generation||!task.current_run_id||task.current_run_id===old.current_run_id||!Number.isSafeInteger(task.listener_generation)||task.listener_generation<=c.generation||task.control_epoch<=old.control_epoch)throw Error('BROWSER_REVOKED');
   await c.pauseDrain;const before=JSON.stringify(r.task);if(before!==JSON.stringify(task))throw Error('BROWSER_REVOKED');
   try{
    const bridge=await bridgeFor(c);c.generation=task.listener_generation;
    const bindings=[...c.bindings.values()];
    const first=bindings.length?{generation:c.generation,guardId:randomUUID(),contextId:r.context.id,taskId:task.id,bootId:task.controller_boot_id,targetId:bindings[0].targetId}:null;
    if(first)c.cookie=(await ack({op:'bind',port:c.port,binding:first})).listenerCookie;
    for(const oldBinding of bindings){const b=Object.freeze({...oldBinding,generation:c.generation,guardId:oldBinding.targetId===first.targetId?first.guardId:randomUUID(),listenerCookie:c.cookie});c.bindings.set(b.targetId,b);await ack({op:'guard',listenerCookie:b.listenerCookie,generation:b.generation,guardId:b.guardId,targetId:b.targetId});}
    if(c.fenced||before!==JSON.stringify(r.task))throw Error('BROWSER_REVOKED');
    c.authority=bridge.authority;c.handle=bridge.handle;c.pausedTask=null;c.paused=false;return true;
   }catch(e){await adapter.fence(r.context);throw e;}
  },
  async prepareNavigation(r,n){
   live();const c=contexts.get(r.context?.id),b=adapter.bindingForTarget(n.target_id);if(!c||c.record!==r||c.fenced||c.paused||!b||b.contextId!==r.context.id||c.bindings.get(n.target_id)!==b)refuse();
   const snapshot=()=>JSON.stringify(['id','private','privacy_mode','state','controller_boot_id','context_generation','listener_generation','control_epoch','document_epoch','read_manifest_revision'].map(k=>r.task[k]));
   const before=snapshot(),valid=()=>{live();if(c.fenced||c.paused||c.record!==r||adapter.bindingForTarget(n.target_id)!==b||r.task.private||r.task.privacy_mode!=='public'||r.task.listener_generation!==c.generation||r.task.context_generation!==c.contextGeneration||n.document_epoch!==r.task.document_epoch+1||n.read_manifest_revision!==r.task.read_manifest_revision||before!==snapshot())throw Error('BROWSER_REVIEW_STALE');};valid();
   const request=requestFor(parseBrowserUrl(n.url).url,'document'),meta={targetId:n.target_id};
   const reviewed=await c.authority.authorizeFetch(request,meta);valid();
   if(reviewed!==true){if(reviewed!==false)refuse();if(typeof c.authority.discoverFetch==='function')await c.authority.discoverFetch(request,meta);valid();}
   return {reviewed:reviewed===true,document_epoch:n.document_epoch,read_manifest_revision:n.read_manifest_revision,url:request.url};
  },
  async handle(e){live();if(e.event==='liveness')return {ok:true};const c=contexts.get(e.contextId);if(!c||c.fenced||c.paused)refuse();const turn=c.turn,result=await c.handle(e);return c.paused||c.fenced||turn!==c.turn?{ok:false}:result;},
  async fence(c){const entry=contexts.get(c.id);if(entry){entry.fenced=true;await entry.authority.unknownAll();if(entry.cookie)await ack({op:'revoke',listenerCookie:entry.cookie,generation:entry.generation});}return true;},
  async release(c){const entry=contexts.get(c.id);if(entry){if(!entry.fenced)await adapter.fence(c);for(const k of entry.bindings.keys()){targets.delete(k);sessions.delete(k);};fetches.delete(entry.cookie);contexts.delete(c.id);}const port=Number(c.lease?.proxy?.server.split(':').at(-1));slots.delete(port);return true;},
 };
 adapter.policy={
  async releaseTarget(t){const b=targets.get(t.targetId);if(!b)return;const c=contexts.get(b.contextId);targets.delete(t.targetId);sessions.delete(t.targetId);c?.bindings.delete(t.targetId);c?.pageTargets.delete(t.targetId);},
  async bindTarget(t){live();const c=contexts.get(t.browserContextId);if(!c||c.fenced||c.paused||!t.waitingForDebugger||!['page','iframe'].includes(t.type)||targets.has(t.targetId))refuse();if(t.type==='page'&&c.pageTargets.size>=2)throw Error('BROWSER_RESOURCE_LIMIT');
   if(t.type==='page')c.pageTargets.add(t.targetId);
   let b={listener:c.port,generation:c.generation,contextGeneration:c.contextGeneration,guardId:randomUUID(),contextId:t.browserContextId,taskId:c.record.task.id,bootId:c.record.task.controller_boot_id,targetId:t.targetId};
   // D transport's frozen listener shape is exact; contextGeneration belongs
   // only to the controller authority binding, not the root transport wire.
   if(!c.cookie){const {listener,contextGeneration,...binding}=b;c.cookie=(await ack({op:'bind',port:c.port,binding})).listenerCookie;}
   b=Object.freeze({...b,listenerCookie:c.cookie});targets.set(t.targetId,b);c.bindings.set(t.targetId,b);return b;
  },
  validateBinding:async(t,b)=>!dead&&targets.get(t.targetId)===b&&!contexts.get(b.contextId)?.fenced,
  async registerFetch(s,b,isLive){sessions.set(b.targetId,s);const c=contexts.get(b.contextId);if(!c||c.fenced)refuse();await ack({op:'guard',listenerCookie:b.listenerCookie,generation:b.generation,guardId:b.guardId,targetId:b.targetId});
   s.on('Fetch.requestPaused',async e=>{const turn=c.turn,binding=c.bindings.get(b.targetId);try{
    live();if(!isLive()||c.fenced||c.paused||!binding)refuse();const kind=e.resourceType==='Document'?'document':'resource',request=requestFor(e.request.url,kind,e.request.method),meta={targetId:b.targetId};
    const allowed=await c.authority.authorizeFetch(request,meta);
    if(c.paused||turn!==c.turn)refuse();
    if(allowed===false&&typeof c.authority.discoverFetch==='function'&&await c.authority.discoverFetch(request,meta)===true){
     live();if(c.paused||turn!==c.turn||c.fenced||!isLive()||c.bindings.get(b.targetId)!==binding)refuse();
     await s.send('Fetch.failRequest',{requestId:e.requestId,errorReason:'BlockedByClient'});return;
    }
    if(allowed!==true)refuse();const q=fetches.get(binding.listenerCookie)??[];if(q.length>=32)refuse();q.push({...binding,kind,method:e.request.method,url:e.request.url});fetches.set(binding.listenerCookie,q);if(c.paused||turn!==c.turn||c.fenced||!isLive())refuse();await s.send('Fetch.continueRequest',{requestId:e.requestId,headers:request.headers.map(([name,value])=>({name,value}))});
   }catch{try{await s.send('Fetch.failRequest',{requestId:e.requestId,errorReason:'BlockedByClient'});}finally{if(targets.has(b.targetId)&&!c.paused&&turn===c.turn)await fatal();}}});
   for(const ev of ['Disconnected','Inspector.detached','Target.detachedFromTarget'])s.on(ev,e=>{if(ev==='Target.detachedFromTarget')return; if(targets.has(b.targetId))void fatal().catch(()=>{});});
  },
  revokeListener:fatal,
 };
 return adapter;
}

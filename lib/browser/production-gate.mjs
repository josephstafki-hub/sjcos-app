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
 async function fatal(){dead=true;await Promise.allSettled([...contexts.values()].map(c=>c.authority?.unknownAll()));await Promise.allSettled([call({op:'revoke_all'}),onFatal()]);}
 async function ack(x){const r=await call(x);if(r?.ok!==true){await fatal();refuse();}return r;}
 const adapter={
  bindingForTarget(id){return targets.get(id)??null;},
  sessionFor(p){const id=p._delegate?._targetId??p._delegate?._mainFrameSession?._targetId??p._targetId;const s=sessions.get(id);if(!s)refuse();return s;},
  async open(){live();const port=[18081,18082].find(p=>!slots.has(p));if(!port)throw Error('BROWSER_RESOURCE_LIMIT');slots.add(port);return {proxy:{server:'http://10.203.0.2:'+port}};},
  async attach(c,r){live();if(contexts.has(c.id)){if(contexts.get(c.id).record!==r)refuse();return;}if(!c.id||!r.task?.controller_boot_id)refuse();
   const port=Number(c.lease.proxy.server.split(':').at(-1));
   const entry={record:r,port,generation:r.task.context_generation,bindings:new Map(),pageTargets:new Set(),fenced:false};contexts.set(c.id,entry);
   const bindingFor=e=>[...entry.bindings.values()].find(b=>b.targetId===e.targetId&&b.listener===e.listener&&b.guardId===e.guardId&&b.listenerCookie===e.listenerCookie);
   const gateOptions={networkConfig,bindingFor,fetchFor:async e=>{const q=fetches.get(e.listenerCookie),fetch=q?.shift();if(fetch?.url!==e.url||fetch?.method!==e.method)refuse();return fetch;},registerDigest:async(e,b)=>{await ack({op:'fetch',listenerCookie:b.listenerCookie,generation:b.generation,guardId:b.guardId,targetId:b.targetId,requestDigest:e.requestDigest});},onFatal:fatal};
   const bridge=await readBridgeFor(r,gateOptions);if(bridge?.authority?.phase!==1||typeof bridge.handle!=='function')refuse();entry.authority=bridge.authority;entry.handle=bridge.handle;
  },
  async handle(e){live();if(e.event==='liveness')return {ok:true};const c=contexts.get(e.contextId);if(!c||c.fenced)refuse();return c.handle(e);},
  async fence(c){const entry=contexts.get(c.id);if(entry){entry.fenced=true;await entry.authority.unknownAll();if(entry.cookie)await ack({op:'revoke',listenerCookie:entry.cookie,generation:entry.generation});}return true;},
  async release(c){const entry=contexts.get(c.id);if(entry){if(!entry.fenced)await adapter.fence(c);for(const k of entry.bindings.keys()){targets.delete(k);sessions.delete(k);};fetches.delete(entry.cookie);contexts.delete(c.id);}const port=Number(c.lease?.proxy?.server.split(':').at(-1));slots.delete(port);return true;},
 };
 adapter.policy={
  async releaseTarget(t){const b=targets.get(t.targetId);if(!b)return;const c=contexts.get(b.contextId);targets.delete(t.targetId);sessions.delete(t.targetId);c?.bindings.delete(t.targetId);c?.pageTargets.delete(t.targetId);},
  async bindTarget(t){live();const c=contexts.get(t.browserContextId);if(!c||c.fenced||!t.waitingForDebugger||!['page','iframe'].includes(t.type)||targets.has(t.targetId))refuse();if(t.type==='page'&&c.pageTargets.size>=2)throw Error('BROWSER_RESOURCE_LIMIT');
   if(t.type==='page')c.pageTargets.add(t.targetId);
   let b={listener:c.port,generation:c.generation,guardId:randomUUID(),contextId:t.browserContextId,taskId:c.record.task.id,bootId:c.record.task.controller_boot_id,targetId:t.targetId};
   if(!c.cookie){const {listener,...binding}=b;c.cookie=(await ack({op:'bind',port:c.port,binding})).listenerCookie;}
   b=Object.freeze({...b,listenerCookie:c.cookie});targets.set(t.targetId,b);c.bindings.set(t.targetId,b);return b;
  },
  validateBinding:async(t,b)=>!dead&&targets.get(t.targetId)===b&&!contexts.get(b.contextId)?.fenced,
  async registerFetch(s,b,isLive){sessions.set(b.targetId,s);const c=contexts.get(b.contextId);if(!c||c.fenced)refuse();await ack({op:'guard',listenerCookie:b.listenerCookie,generation:b.generation,guardId:b.guardId,targetId:b.targetId});
   s.on('Fetch.requestPaused',async e=>{try{live();if(!isLive()||c.fenced)refuse();const kind=e.resourceType==='Document'?'document':'resource';const url=parseBrowserUrl(e.request.url);const headers=[['host',url.hostname],['user-agent','SJC-Public-Browser/1'],['accept',kind==='document'?'text/html':'*/*'],['accept-encoding','identity']];if(await c.authority.authorizeFetch({method:e.request.method,url:e.request.url,kind,headers},{targetId:b.targetId})!==true)refuse();const q=fetches.get(b.listenerCookie)??[];if(q.length>=32)refuse();q.push({...b,kind,method:e.request.method,url:e.request.url});fetches.set(b.listenerCookie,q);if(c.fenced||!isLive())refuse();await s.send('Fetch.continueRequest',{requestId:e.requestId,headers:headers.map(([name,value])=>({name,value}))});}catch{try{await s.send('Fetch.failRequest',{requestId:e.requestId,errorReason:'BlockedByClient'});}finally{if(targets.has(b.targetId))await fatal();}}});
   for(const ev of ['Disconnected','Inspector.detached','Target.detachedFromTarget'])s.on(ev,e=>{if(ev==='Target.detachedFromTarget')return; if(targets.has(b.targetId))void fatal().catch(()=>{});});
  },
  revokeListener:fatal,
 };
 return adapter;
}

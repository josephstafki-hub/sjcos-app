/** Isolated fixture authority: ephemeral test keys, never a release reviewer. */
import {fork} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {mkdir,writeFile,chown,chmod,readFile} from 'node:fs/promises';
import {canonical} from './acceptance-attestation.mjs';
import {createAuthority,DurableJournal,verifySigned} from './controller-authority.mjs';
import {createControllerPolicy} from './controller.mjs';
import {createGateAuthority} from './controller-gate.mjs';
import {serveController,unixCall} from './controller-rpc.mjs';
import {sha256} from './runtime-readiness.mjs';
export const envelope=(value,key)=>{const bytes=Buffer.from(canonical(value));return {payload:bytes.toString('base64'),signature:sign(null,bytes,key).toString('base64')};};
async function localFixtureController({run,dir,config,gate,ca,specs,onRequest=async()=>{}}){
 if(process.getuid()!==0||run.purpose!=='browser-0b-candidate'||config.enabled!==false||config.databaseEnabled!==false)throw Error('BROWSER_FIXTURE_CONTROLLER_REFUSED');
 const account=(await readFile('/etc/passwd','utf8')).split('\n').find(x=>x.startsWith('sjcos-browser:'))?.split(':');
 if(!account||Number(account[2])!==config.uid||Number(account[3])!==config.gid)throw Error('BROWSER_FIXTURE_ACCOUNT_MISMATCH');
 const keys=generateKeyPairSync('ed25519'),sink=generateKeyPairSync('ed25519');
 await writeFile(dir+'/checkpoint.pub',sink.publicKey.export({type:'spki',format:'pem'}),{mode:0o600,flag:'wx'});
 for(const [name,key]of [['manifest',keys.privateKey],['checkpoint',sink.privateKey]])await writeFile(dir+'/'+name+'.key',key.export({type:'pkcs8',format:'pem'}),{mode:0o600,flag:'wx'});
 const receiptDir='/var/lib/sjcos-browser/controller-receipts/'+run.runId;await mkdir(receiptDir,{mode:0o700});
 const sinkDir=receiptDir+'/sink';await mkdir(sinkDir,{mode:0o700});const sinkJournal=new DurableJournal(sinkDir);
 const checkpointPath='/run/sjcos-browser/controller-'+run.runId.replace(/^./,c=>c==='f'?'0':'f')+'.sock';
 const checkpoint=await serveController(checkpointPath,async({record})=>{await sinkJournal.claim('sink',record.id,record);return {ok:true,envelope:envelope({purpose:'browser-controller-checkpoint',...record},sink.privateKey)};});
 let endpoint;try{
 const authority=createAuthority({publicKey:keys.publicKey,...run,journal:new DurableJournal(receiptDir),checkpoint:record=>unixCall(checkpointPath,{record}),verifyCheckpoint:(ack,record)=>canonical(verifySigned(ack.envelope,sink.publicKey))===canonical({purpose:'browser-controller-checkpoint',...record})});
 const events=[],fetches=[],bindings=[],sessions=[];let seq=0;
 const observe=(event,data={})=>{if(events.length>=2048)throw Error('BROWSER_CONTROLLER_EVENT_LIMIT');const item={seq:++seq,event,at:Date.now(),...data};events.push(item);if(process.send)process.send({event:item});};
 const uses=new Map();const specKey=r=>canonical([r.method,r.url,r.kind]);
 const allowed=r=>specs.some(s=>s.method===r.method&&s.url===r.url&&s.kind===r.kind&&(uses.get(specKey(r))??0)<(s.uses??1));
 const fixtureAuthority={...authority,authorizeFetch:async r=>allowed(r),authorizeRequest:async(r,correlation)=>{
   if(!allowed(r)||!specs.some(s=>s.method===r.method&&s.url===r.url&&r.bodySha256===(s.bodySha256??sha256(r.method==='POST'?'fixture-write':''))))throw Error('BROWSER_UNAPPROVED_FIXTURE_REQUEST');
   uses.set(specKey(r),(uses.get(specKey(r))??0)+1);
   const now=Date.now();await authority.admit(envelope({format:1,purpose:r.method==='POST'?'browser-action-manifest':'browser-read-manifest',manifestId:randomUUID(),runId:run.runId,taskId:run.taskId,userId:run.userId,bootId:run.bootId,revision:1,issuedAt:now,expiresAt:now+60000,requests:[r]},keys.privateKey));
   const receipt=await authority.authorizeRequest(r);observe('consume',{kind:receipt.kind,url:r.url,requestDigest:r.requestDigest,consumeId:receipt.consumeReceipt.id,checkpointVerified:true,...correlation});await onRequest(r,receipt);return receipt;
 }};
 const controlledGate={call:async(op,data)=>{
   if(op==='fetch'){fetches.push(data);observe('fetch_paused',{targetId:data.targetId,url:data.url});return {ok:true};}
   if(op==='bind'){const {generation,guardId,contextId,taskId,bootId,targetId,listener}=data;return gate('bind',{port:listener,binding:{generation,guardId,contextId,taskId,bootId,targetId}});}
   if(op==='guard'){const ack=await gate(op,data);observe('guard_registered',{targetId:data.targetId});return ack;}
   if(op==='revoke'){observe('boot_revoked');return gate('revoke_all');}
   return gate(op,data);
 }};
 const policy=createControllerPolicy({runId:run.runId,taskId:run.taskId,bootId:run.bootId,gate:controlledGate,authority:fixtureAuthority,profile:{caFile:ca.caFile,caSha256:ca.caSha256}});
 const originalBind=policy.bindTarget;policy.bindTarget=async target=>{observe('target_attached',{targetId:target.targetId,type:target.type});const b=await originalBind(target);bindings.push(b);return b;};
 const originalRegister=policy.registerFetch;policy.registerFetch=async(session,binding,isLive)=>{sessions.push(session);session.on('Target.attachedToTarget',e=>observe('child_target',{targetId:e.targetInfo.targetId,type:e.targetInfo.type,waitingForDebugger:e.waitingForDebugger}));const send=session.send.bind(session);session.send=async(name,data)=>{if(name==='Runtime.runIfWaitingForDebugger')observe('resume',{targetId:binding.targetId});if(name==='Fetch.continueWithAuth')observe('auth_cancelled',{targetId:binding.targetId});return send(name,data);};await originalRegister(session,binding,isLive);};
 const handler=createGateAuthority({authority:fixtureAuthority,networkConfig:run.networkConfig,bindingFor:policy.bindingFor,fetchFor:e=>{const i=fetches.findIndex(x=>x.method===e.method&&x.url===e.url&&x.listener===e.listener&&x.generation===e.generation);return i<0?null:fetches.splice(i,1)[0];},registerDigest:async(e,b)=>{await gate('fetch',{listenerCookie:e.listenerCookie,generation:e.generation,requestDigest:e.requestDigest,guardId:b.guardId,targetId:b.targetId});observe('digest_registered',{id:e.id,targetId:b.targetId,requestDigest:e.requestDigest});},onFatal:()=>policy.revokeListener()});
 const policyPath='/run/sjcos-browser/controller-'+run.runId+'.sock';
 endpoint=await serveController(policyPath,async e=>{if(e.event==='liveness')return {ok:policy.isLive()};observe('policy',{name:e.event,id:e.id,...(e.status?{status:e.status}:{})});return handler(e);});
 // Dedicated gate may connect; uid-0 peer authentication still happens in T1.
 await chown(policyPath,0,config.gid);await chmod(policyPath,0o660);
 let endpointClosed=false,closing;const disconnectPolicy=async()=>{if(endpointClosed)return;endpointClosed=true;observe('policy_disconnected');await endpoint.close();};
 return {policy,observe,events,bindings,sessions,policyPath,receiptDir,disconnectPolicy,queueRaw:(binding,r)=>{observe('fetch_paused',{targetId:binding.targetId,url:r.url,raw:true});fetches.push({...binding,...r});},close:()=>closing??=(async()=>{try{await policy.revokeListener();}finally{try{await disconnectPolicy();}finally{await checkpoint.close();}}})()};
 }catch(e){try{await endpoint?.close();}finally{await checkpoint.close();}throw e;}
}

// The controller runs separately from the CDP guardian. Only bounded request
// metadata/session commands cross IPC; neither browser response bodies nor keys do.
export function bridge(child){
 let serial=0;const pending=new Map();
 const request=(op,args=[])=>new Promise((resolve,reject)=>{if(pending.size>=64||Buffer.byteLength(JSON.stringify({op,args}))>32768)return reject(Error('BROWSER_CONTROLLER_BRIDGE_LIMIT'));const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('BROWSER_CONTROLLER_BRIDGE_TIMEOUT '+op));},3000);pending.set(id,{resolve,reject,timer});child.send({id,op,args},e=>{if(e){clearTimeout(timer);pending.delete(id);reject(e);}});});
 const reply=m=>{const p=pending.get(m.reply);if(!p)return;pending.delete(m.reply);clearTimeout(p.timer);m.error?p.reject(Error('BROWSER_CONTROLLER_BRIDGE_REFUSED')):p.resolve(m.value);};
 const lost=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('BROWSER_CONTROLLER_LOST'));}pending.clear();};
 return {request,reply,lost};
}
export async function prepareFixtureController(options){
 if(process.getuid()!==0)throw Error('BROWSER_FIXTURE_CONTROLLER_REFUSED');
 const {gate,onRequest=async()=>{},...data}=options;
 const child=fork(fileURLToPath(import.meta.url),['--controller-worker'],{stdio:['ignore','ignore','pipe','ipc'],execArgv:['--max-old-space-size=96']});child.stderr.resume();
 const rpc=bridge(child),events=[],bindings=[],sessions=[];let fatalHandler=()=>{},live=true,closed=false,bound=false,monitorBusy=false,revoking;
 const fatal=()=>{live=false;fatalHandler();};
 child.on('exit',()=>{rpc.lost();fatal();});child.on('error',()=>{rpc.lost();fatal();});
 child.on('message',async m=>{
  if(m.reply)return rpc.reply(m);
  if(m.event){if(events.length>=2048){fatal();return;}events.push(m.event);if(m.event.event==='boot_revoked')fatal();return;}
  if(m.op){try{let value;
   if(m.op==='gate')value=await gate(...m.args);
   else if(m.op==='onRequest')value=await onRequest(...m.args);
   else if(m.op==='sessionSend')value=await sessions[m.args[0]].send(...m.args.slice(1));
   else throw Error();
   if(child.connected)child.send({reply:m.id,value});
  }catch{if(child.connected)child.send({reply:m.id,error:true});}}
 });
 let initialized;try{initialized=await rpc.request('init',[data]);}catch(e){child.kill('SIGTERM');throw e;}
 const monitor=setInterval(()=>{if(!bound||!live||monitorBusy)return;monitorBusy=true;gate('stats').then(s=>{if(s.dead)void policy.revokeListener().catch(()=>{});},()=>{void policy.revokeListener().catch(()=>{});}).finally(()=>monitorBusy=false);},100);monitor.unref();
 const policy={fence:()=>{live=false;},isLive:()=>live,setFatalHandler:handler=>{fatalHandler=handler;if(!live)fatalHandler();},
  prepareProfile:args=>rpc.request('prepareProfile',[args]),
  bindTarget:async target=>{if(!live)throw Error('BROWSER_CONTROLLER_DEAD');const b=await rpc.request('bindTarget',[target]);if(!live)throw Error('BROWSER_CONTROLLER_DEAD');bindings.push(b);bound=true;return b;},
  validateBinding:async(target,b)=>live&&await rpc.request('validateBinding',[target,b]),
  registerFetch:async(session,binding,isLive)=>{
   const id=sessions.push(session)-1;
   for(const name of ['Fetch.requestPaused','Fetch.authRequired','Disconnected','Inspector.detached','Target.detachedFromTarget','Inspector.targetCrashed','Inspector.targetReloadedAfterCrash','Target.attachedToTarget'])session.on(name,e=>{if(live&&child.connected&&isLive()){try{child.send({op:'sessionEvent',args:[id,name,controllerSessionEvent(name,e)]});}catch{void policy.revokeListener().catch(()=>{});}}});
   const send=session.send.bind(session);session.send=async(name,args)=>{if(name==='Runtime.runIfWaitingForDebugger'&&child.connected)await rpc.request('observeResume',[binding.targetId]);return send(name,args);};
   await rpc.request('registerFetch',[id,binding]);
  },
  revokeListener:()=>{fatal();return revoking??=(child.connected?rpc.request('revokeListener'):Promise.resolve());},
 };
 return {...initialized,policy,events,bindings,sessions,pid:child.pid,
  queueRaw:(b,r)=>rpc.request('queueRaw',[b,r]),
  disconnectPolicy:()=>rpc.request('disconnectPolicy'),
  kill:async()=>{if(child.exitCode!==null||child.signalCode!==null)throw Error('BROWSER_CONTROLLER_ALREADY_DEAD');const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({pid:child.pid,code,signal})));if(!child.kill('SIGKILL'))throw Error('BROWSER_CONTROLLER_KILL_FAILED');const proof=await exited;if(proof.signal!=='SIGKILL')throw Error('BROWSER_CONTROLLER_WRONG_EXIT');return proof;},
  close:async()=>{if(closed)return;closed=true;clearInterval(monitor);try{if(child.connected)await rpc.request('close');}finally{if(child.connected)child.disconnect();if(child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done;}}},
 };
}
if(process.argv[2]==='--controller-worker'){
 const rpc=bridge(process),sessions=new Map();let controller;
 process.on('disconnect',()=>{rpc.lost();void Promise.resolve(controller?.close()).catch(()=>{}).finally(()=>process.exit(0));});
 process.on('message',async m=>{
  if(m.reply)return rpc.reply(m);
  if(m.op==='sessionEvent'){sessions.get(m.args[0])?.emit(m.args[1],m.args[2]);return;}
  try{let value;
   if(m.op==='init'){
    controller=await localFixtureController({...m.args[0],gate:(...a)=>rpc.request('gate',a),onRequest:(...a)=>rpc.request('onRequest',a)});
    controller.policy.setFatalHandler(()=>{setTimeout(()=>{void controller.close().then(()=>setTimeout(()=>process.exit(0),25),()=>setTimeout(()=>process.exit(1),25));},0);});
    value={policyPath:controller.policyPath,receiptDir:controller.receiptDir};
   }else if(m.op==='registerFetch'){
    const [id,binding]=m.args,s=new EventEmitter();s.send=(...a)=>rpc.request('sessionSend',[id,...a]);sessions.set(id,s);await controller.policy.registerFetch(s,controller.bindings.find(b=>b.targetId===binding.targetId),()=>controller.policy.isLive());
   }else if(m.op==='observeResume'){
    // Session proxy needs to observe the actual guardian's resume, never infer one from attach.
    controller.observe('resume',{targetId:m.args[0]});
   }else if(['close','disconnectPolicy','queueRaw'].includes(m.op))value=await controller[m.op](...m.args);
   else if(m.op==='validateBinding')value=await controller.policy.validateBinding(m.args[0],controller.bindings.find(b=>b.targetId===m.args[1].targetId));
   else value=await controller.policy[m.op](...m.args);
   if(process.connected)process.send({reply:m.id,value});
  }catch{if(process.connected)process.send({reply:m.id,error:true});}
 });
}

export function controllerSessionEvent(name,e={}){
 let value={};
 if(name==='Fetch.requestPaused')value={requestId:e.requestId,networkId:e.networkId,resourceType:e.resourceType,request:{method:e.request?.method,url:e.request?.url}};
 else if(name==='Fetch.authRequired')value={requestId:e.requestId};
 else if(name==='Target.attachedToTarget')value={waitingForDebugger:e.waitingForDebugger,targetInfo:{type:e.targetInfo?.type,targetId:e.targetInfo?.targetId,browserContextId:e.targetInfo?.browserContextId}};
 if(Buffer.byteLength(JSON.stringify(value))>32768)throw Error('BROWSER_CONTROLLER_EVENT_LIMIT');return value;
}

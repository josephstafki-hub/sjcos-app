/** Isolated fixture authority: ephemeral test keys, never a release reviewer. */
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {mkdir,writeFile,chown,chmod,readFile} from 'node:fs/promises';
import {canonical} from './acceptance-attestation.mjs';
import {createAuthority,DurableJournal,verifySigned} from './controller-authority.mjs';
import {createControllerPolicy} from './controller.mjs';
import {createGateAuthority} from './controller-gate.mjs';
import {serveController,unixCall} from './controller-rpc.mjs';
import {sha256} from './runtime-readiness.mjs';
export const envelope=(value,key)=>{const bytes=Buffer.from(canonical(value));return {payload:bytes.toString('base64'),signature:sign(null,bytes,key).toString('base64')};};
export async function prepareFixtureController({run,dir,config,gate,ca,specs,onRequest=async()=>{}}){
 if(process.getuid()!==0||run.purpose!=='browser-0b-candidate'||config.enabled!==false||config.databaseEnabled!==false)throw Error('BROWSER_FIXTURE_CONTROLLER_REFUSED');
 const account=(await readFile('/etc/passwd','utf8')).split('\n').find(x=>x.startsWith('sjcos-browser:'))?.split(':');
 if(!account||Number(account[2])!==config.uid||Number(account[3])!==config.gid)throw Error('BROWSER_FIXTURE_ACCOUNT_MISMATCH');
 const keys=generateKeyPairSync('ed25519'),sink=generateKeyPairSync('ed25519');
 for(const [name,key]of [['manifest',keys.privateKey],['checkpoint',sink.privateKey]])await writeFile(dir+'/'+name+'.key',key.export({type:'pkcs8',format:'pem'}),{mode:0o600,flag:'wx'});
 const receiptDir='/var/lib/sjcos-browser/controller-receipts/'+run.runId;await mkdir(receiptDir,{mode:0o700});
 const sinkDir=receiptDir+'/sink';await mkdir(sinkDir,{mode:0o700});const sinkJournal=new DurableJournal(sinkDir);
 const checkpointPath='/run/sjcos-browser/controller-'+run.runId.replace(/^./,c=>c==='f'?'0':'f')+'.sock';
 const checkpoint=await serveController(checkpointPath,async({record})=>{await sinkJournal.claim('sink',record.id,record);return {ok:true,envelope:envelope({purpose:'browser-controller-checkpoint',...record},sink.privateKey)};});
 let endpoint;try{
 const authority=createAuthority({publicKey:keys.publicKey,...run,journal:new DurableJournal(receiptDir),checkpoint:record=>unixCall(checkpointPath,{record}),verifyCheckpoint:(ack,record)=>canonical(verifySigned(ack.envelope,sink.publicKey))===canonical({purpose:'browser-controller-checkpoint',...record})});
 const events=[],fetches=[],bindings=[],sessions=[];let seq=0;
 const observe=(event,data={})=>{if(events.length>=256)throw Error('BROWSER_CONTROLLER_EVENT_LIMIT');events.push({seq:++seq,event,at:Date.now(),...data});};
 const uses=new Map();const specKey=r=>canonical([r.method,r.url,r.kind]);
 const allowed=r=>specs.some(s=>s.method===r.method&&s.url===r.url&&s.kind===r.kind&&(uses.get(specKey(r))??0)<(s.uses??1));
 const fixtureAuthority={...authority,authorizeFetch:async r=>allowed(r),authorizeRequest:async r=>{
   if(!allowed(r)||!specs.some(s=>s.method===r.method&&s.url===r.url&&r.bodySha256===(s.bodySha256??sha256(r.method==='POST'?'fixture-write':''))))throw Error('BROWSER_UNAPPROVED_FIXTURE_REQUEST');
   uses.set(specKey(r),(uses.get(specKey(r))??0)+1);
   const now=Date.now();await authority.admit(envelope({format:1,purpose:r.method==='POST'?'browser-action-manifest':'browser-read-manifest',manifestId:randomUUID(),runId:run.runId,taskId:run.taskId,userId:run.userId,bootId:run.bootId,revision:1,issuedAt:now,expiresAt:now+60000,requests:[r]},keys.privateKey));
   const receipt=await authority.authorizeRequest(r);observe('consume',{kind:receipt.kind,url:r.url,requestDigest:r.requestDigest});await onRequest(r,receipt);return receipt;
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
 endpoint=await serveController(policyPath,async e=>{observe('policy',{name:e.event,id:e.id,...(e.status?{status:e.status}:{})});return handler(e);});
 // Dedicated gate may connect; uid-0 peer authentication still happens in T1.
 await chown(policyPath,0,config.gid);await chmod(policyPath,0o660);
 let endpointClosed=false,closed=false;const disconnectPolicy=async()=>{if(endpointClosed)return;endpointClosed=true;observe('policy_disconnected');await endpoint.close();};
 return {policy,events,bindings,sessions,policyPath,receiptDir,disconnectPolicy,queueRaw:(binding,r)=>fetches.push({...binding,...r}),close:async()=>{if(closed)return;closed=true;try{await policy.revokeListener();}finally{try{await disconnectPolicy();}finally{await checkpoint.close();}}}};
 }catch(e){try{await endpoint?.close();}finally{await checkpoint.close();}throw e;}
}

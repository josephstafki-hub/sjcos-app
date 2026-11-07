// Expectations recorded before implementation in browser-0b-round2-expectations.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateEvidence} from '../lib/browser/acceptance.mjs';
import {verifyCaseArtifacts,fixturePacketMetrics,validateRssCase,fixtureBody,verifyChildBarrier,verifyOrdering,verifyDetachProof,verifyDispatchLoss,verifyUploadLoss} from '../lib/browser/root-fixture.mjs';
import {captureStatus} from '../lib/browser/controller-network.mjs';
import {evidence,digest as d,MiB} from './browser-round2-fixtures.mjs';

function packet(privatePacket=false){
 const head=Buffer.alloc(24);head.writeUInt32LE(0xa1b2c3d4);head.writeUInt32LE(256,16);head.writeUInt32LE(101,20);
 const ip=Buffer.alloc(24);ip[0]=0x45;ip[9]=privatePacket?17:6;ip.set(privatePacket?[127,0,0,1]:[8,8,8,8],16);ip.writeUInt16BE(privatePacket?123:443,22);
 const record=Buffer.alloc(16);record.writeUInt32LE(ip.length,8);record.writeUInt32LE(ip.length,12);return Buffer.concat([head,record,ip]);
}
for(const mode of ['kernel drops','private UDP','bypass contradiction'])test('retained artifact refuses '+mode,async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'browser-r2-')),base=dir+'/probe';await mkdir(base);
 try{
  const clean='1 packets captured\n1 packets received by filter\n0 packets dropped by kernel\n';
  const write=async(file,pcap,text)=>{await writeFile(base+'/'+file+'.pcap',pcap);await writeFile(base+'/'+file+'.pcap.stderr',text);await writeFile(base+'/'+file+'.pcap.terminal.json',JSON.stringify({code:0,signal:null,early:false}));};
  const pcap=packet(mode==='private UDP');await write('ingress',pcap,mode==='kernel drops'?clean.replace('0 packets dropped','2 packets dropped'):clean);
  const measurement={...fixturePacketMetrics(pcap),privatePackets:0,capture:captureStatus({code:0,signal:null,text:clean})};
  if(mode==='bypass contradiction'){const probe=packet(true);await write('probe',probe,clean);Object.assign(measurement,{probePackets:1,probeWireBytes:24,probePrivatePackets:1,probeLinkControlPackets:0,probeBypassPackets:0,probePcapSha256:fixturePacketMetrics(probe).pcapSha256,probeCapture:measurement.capture});}
  await writeFile(base+'/observations.json',JSON.stringify({packetIdentity:{linkControlSources:[]}}));await writeFile(base+'/origin.jsonl','');
  await assert.rejects(verifyCaseArtifacts(dir,[{name:'probe',measurement}]),mode==='kernel drops'?/kernel-drops:2/:mode==='private UDP'?/packet classification\/count mismatch:privatePackets/:/bypass artifact mismatch/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
for(const [name,scenario,mutate,reason] of [
 ['negative pool','declared-length',r=>r.poolMaxima.request=-1,/rss pools/],
 ['negative queue','declared-length',r=>r.maxDirectionalQueueBytes=-1,/rss maxDirectionalQueueBytes/],
 ['case-local over-cap memory','declared-length',r=>r.rssPeakBytes=337*MiB,/rss rssPeakBytes/],
 ['masked backpressure','preallocation-backpressure',r=>r.backpressureBeforeAllocation=false,/rss case backpressure/],
 ['masked unknown','controller-loss-unknown',r=>r.consumedWriteOutcome=null,/rss case unknown/],
])test('aggregate cannot hide '+name,()=>{const e=evidence();assert.doesNotThrow(()=>validateEvidence(e,{runId:'fresh',kind:'rss'}));mutate(e.cases.find(c=>c.name===scenario).measurement.rss);assert.throws(()=>validateEvidence(e,{runId:'fresh',kind:'rss'}),reason);});
function stress(){
 return {stats:{flows:0,handlers:0,reservations:0,pools:{request:0,response:0,transport:0}},origins:[{}],result:{candidates:{18081:8,18082:8},clients:Array.from({length:2},()=>({complete:true,declaredBodyBytes:25*MiB,bodyBytes:25*MiB,bodySha256:fixtureBody(25*MiB)}))},state:{holdWindow:{start:100,end:1700},samples:[...Array.from({length:17},(_,i)=>({at:100+i*100,slots:2,pools:{request:50*MiB,response:112*MiB},bufferedResponses:['a'],gateSeq:1})),{at:1800,slots:1},{at:1900,slots:0}],events:[{seq:1,event:'response_buffered',id:'a',bodyBytes:25*MiB}],tailObserved:true,tailHoldSamples:Array.from({length:5},()=>({slots:2,response:112*MiB,tails:[{id:'a',tail:1,reserved:true},{id:'b',tail:1,reserved:true}]}))}};
}
for(const [name,mutate,reason] of [
 ['clustered timestamps',s=>s.samples.slice(0,17).forEach(x=>x.at=100),/ordered hold/],
 ['long gap',s=>s.samples.splice(3,4),/ordered hold/],
 ['frozen request without actual buffered response',s=>s.events=[],/actual buffered response/],
])test('RSS stress refuses '+name,()=>{const f=stress();assert.equal(validateRssCase('preallocation-backpressure',f),true);mutate(f.state);assert.throws(()=>validateRssCase('preallocation-backpressure',f),reason);});
function oopif(){
 const ctl=[],gate=[],origins=[];const emit=(event,fields={})=>ctl.push({seq:ctl.length+1,event,...fields});
 emit('target_attached',{targetId:'P',type:'page',browserContextId:'C'});emit('guard_registered',{targetId:'P'});emit('resume',{targetId:'P'});
 const request=(targetId,id,url,frameId)=>{emit('fetch_paused',{targetId,frameId,url});emit('consume',{targetId,id,url,requestDigest:id.repeat(64),consumeId:id.repeat(64),checkpointVerified:true});emit('digest_registered',{targetId,id,requestDigest:id.repeat(64)});gate.push({event:'flow_closed',targetId,id,requestDigest:id.repeat(64),upstreamPlaintextBytes:10});origins.push({requestDigest:id.repeat(64),path:new URL(url).pathname});};
 request('P','a','https://child.example/oopif-first-request','F');emit('child_target',{targetId:'F',type:'iframe',waitingForDebugger:true});emit('target_attached',{targetId:'F',type:'iframe',browserContextId:'C'});emit('guard_registered',{targetId:'F'});emit('resume',{targetId:'F'});request('F','b','https://child.example/oopif-first-request/sub','F');
 return {ctl,gate,origins};
}
test('OOPIF parent navigation AND child exact guarded consume/write pass',()=>{const f=oopif();assert.equal(verifyOrdering(f.ctl,f.gate),true);assert.equal(verifyChildBarrier('oopif-first-request',f.ctl,f.gate,f.origins),true);});
for(const [name,mutate] of [
 ['unrelated iframe',f=>f.ctl.forEach(e=>{if(e.targetId==='F')e.targetId='UNRELATED';})],
 ['absent child Fetch interception',f=>f.ctl=f.ctl.filter(e=>!(e.targetId==='F'&&e.event==='fetch_paused'))],
])test('OOPIF refuses '+name,()=>{const f=oopif();mutate(f);assert.throws(()=>verifyChildBarrier('oopif-first-request',f.ctl,f.gate,f.origins));});
const detach=()=>({proof:{sessionId:'S',targetId:'T',eventMark:1,acknowledged:false},events:[{seq:1,event:'session_bound',sessionId:'S',targetId:'T'},{seq:2,event:'detach_attempt',sessionId:'S',targetId:'T'},{seq:3,event:'session_detached',sessionId:'S',targetId:'T'},{seq:4,event:'boot_revoked',reason:'BROWSER_SESSION_DETACHED',detached:{sessionId:'S',targetId:'T'}}]});
test('lost detach ack needs the same observed session and causal fence',()=>{const f=detach();assert.equal(verifyDetachProof(f.proof,f.events).detachRevoked,true);});
for(const [name,mutate] of [
 ['invalid session plus unrelated revoke',f=>{f.proof.sessionId='nonexistent';f.events=f.events.filter(e=>e.event!=='session_detached');f.events.at(-1).reason='BROWSER_GATE_MONITOR_FAILED';}],
 ['disabled detach cleanup',f=>f.events.pop()],
])test('detach refuses '+name,()=>{const f=detach();mutate(f);assert.throws(()=>verifyDetachProof(f.proof,f.events),/actual detach/);});
test('dispatch-loss root predicate requires exact zero-write consumed flow',()=>{
 const ctl=[{event:'consume',kind:'write',id:'f',requestDigest:d}],gate=[{event:'dispatch_held',id:'f',requestDigest:d},{event:'flow_closed',id:'f',requestDigest:d,upstreamPlaintextBytes:0}];
 assert.equal(verifyDispatchLoss(ctl,gate),true);gate[1].upstreamPlaintextBytes=1;assert.throws(()=>verifyDispatchLoss(ctl,gate),/zero upstream HTTP bytes/);
});

import {createGateAuthority} from '../lib/browser/controller-gate.mjs';
import {canonical} from '../lib/browser/acceptance-attestation.mjs';
import {sha256} from '../lib/browser/runtime-readiness.mjs';
for(const mode of ['valid','wrong digest','wrong decision','expired','duplicate'])test('post-TLS exact-flow dispatch '+mode,async()=>{
 let now=1000;const b={listener:18081,generation:1,listenerCookie:'4',guardId:'g',contextId:'c',taskId:'task',bootId:'boot',targetId:'t'};
 const handler=createGateAuthority({now:()=>now,networkConfig:{appHosts:['app.example'],serviceHosts:[],hostPublicAddresses:['9.9.9.9']},authority:{authorizeRequest:async()=>({expiresAt:1500,kind:'write',consumeReceipt:{id:d}})},bindingFor:async()=>b,fetchFor:async()=>({...b,kind:'fetch'})});
 const request={method:'POST',url:'https://permit.example/write',headers:[['host','permit.example'],['content-length','0']],hostAuthority:'permit.example',sni:'permit.example',bodySha256:d,dns:{hostname:'permit.example',chain:['permit.example'],addresses:['8.8.8.8'],ttlMs:60000}};
 request.requestDigest=sha256(canonical({method:request.method,url:request.url,headers:request.headers,bodySha256:d}));
 const event=(event,extra={})=>({v:1,event,id:'flow',remainingMs:1000,...b,...extra});
 for(const [name,extra] of [['http_connect',{authority:'permit.example:443'}],['requestheaders',request]])assert.equal((await handler(event(name,extra))).ok,true);
 const decision=await handler(event('request',request));assert.equal(decision.ok,true);
 assert.equal((await handler(event('server_connect',{...request,hostname:'permit.example',address:'8.8.8.8'}))).ok,true);
 assert.equal((await handler(event('server_connected',{hostname:'permit.example',peerAddress:'8.8.8.8'}))).ok,true);
 const dispatch=event('request_dispatch',{requestDigest:mode==='wrong digest'?'b'.repeat(64):request.requestDigest,decisionId:mode==='wrong decision'?'wrong':decision.decisionId});
 if(mode==='expired')now=1500;
 assert.equal((await handler(dispatch)).ok,['valid','duplicate'].includes(mode));
 if(mode==='duplicate')assert.equal((await handler(dispatch)).ok,false);
});

test('upload-loss root predicate refuses a next record or a second consume',()=>{
 const ctl=[{event:'consume',kind:'write',id:'f',requestDigest:d}],gate=[{event:'upload_held',id:'f',requestDigest:d},{event:'flow_closed',id:'f',requestDigest:d,upstreamPlaintextBytes:17000}];
 assert.equal(verifyUploadLoss(ctl,gate),true);assert.throws(()=>verifyUploadLoss([...ctl,...ctl],gate),/only headers/);gate[1].upstreamPlaintextBytes=50000;assert.throws(()=>verifyUploadLoss(ctl,gate),/only headers/);
});

import {createControllerPolicy} from '../lib/browser/controller.mjs';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
for(const disabled of [false,true])test('session-specific fence uses production detach cleanup '+(disabled?'disabled negative':'enabled'),async()=>{
 const calls=[],id=randomUUID();
 const policy=createControllerPolicy({runId:id,taskId:id,bootId:id,authority:{unknownAll:async()=>{}},gate:{call:async(op,data)=>{calls.push({op,data});return {ok:true,listenerCookie:'4'};}}});
 const binding=await policy.bindTarget({targetId:'T',type:'page',browserContextId:'C',waitingForDebugger:true});
 const session=new EventEmitter();session.__sjcSessionId='S';session.send=async()=>{};
 await policy.registerFetch(session,binding,()=>true);if(disabled)session.removeAllListeners('Disconnected');session.emit('Disconnected');await new Promise(r=>setImmediate(r));
 const revoke=calls.find(c=>c.op==='revoke');
 if(disabled){assert.equal(revoke,undefined);assert.equal(policy.isLive(),true);}
 else {assert.equal(revoke.data.reason,'BROWSER_SESSION_DETACHED');assert.deepEqual(revoke.data.detached,{sessionId:'S',targetId:'T'});assert.equal(policy.isLive(),false);}
});

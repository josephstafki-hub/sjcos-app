// Expectations in docs/plans/build/browser-0b-round1-expectations.md precede these fixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {createAuthority} from '../lib/browser/controller-authority.mjs';
import {envelope} from '../lib/browser/fixture-controller.mjs';
import {captureStatus,pcapMetrics} from '../lib/browser/controller-network.mjs';
import {combineRss,verifyOrdering,validateRssCase,verifyOriginConsumes,verifyChildBarrier} from '../lib/browser/root-fixture.mjs';
const hash='a'.repeat(64);
for(const method of ['GET','POST'])for(const stage of ['consume','checkpoint','verify','final'])test(`${method} expiry at ${stage} burns authority`,async()=>{
 let time=1000;const keys=generateKeyPairSync('ed25519'),ids={runId:randomUUID(),taskId:randomUUID(),userId:randomUUID(),bootId:randomUUID()},claims=[];
 const req={method,url:'https://permit.example/',kind:'document',bodySha256:hash,requestDigest:hash};
 const a=createAuthority({...ids,publicKey:keys.publicKey,now:()=>time,journal:{claim:async(kind,id)=>{claims.push(kind);if(kind===(stage==='final'?'checkpoint':stage))time=1011;return {id,digest:hash};}},checkpoint:async()=>{if(stage==='checkpoint')time=1011;return {};},verifyCheckpoint:async()=>{if(stage==='verify')time=1011;return true;}});
 const token=await a.admit(envelope({format:1,purpose:method==='GET'?'browser-read-manifest':'browser-action-manifest',manifestId:randomUUID(),...ids,revision:1,issuedAt:1000,expiresAt:1010,requests:[req]},keys.privateKey));
 await assert.rejects(a.consume(token,req));time=1001;await assert.rejects(a.consume(token,req));assert.ok(claims.includes('consume'));
});
for(const [name,status] of [
 ['kernel drops',{code:0,signal:null,text:'1 packets captured\n1 packets received by filter\n2 packets dropped by kernel\n'}],
 ['missing stats',{code:0,signal:null,text:'listening on any'}],
 ['SIGKILL',{code:null,signal:'SIGKILL',text:'1 packets captured\n1 packets received by filter\n0 packets dropped by kernel\n'}],
 ['nonzero',{code:1,signal:null,text:'1 packets captured\n1 packets received by filter\n0 packets dropped by kernel\n'}],
 ['budget exit',{code:0,signal:null,text:'250000 packets captured\n250000 packets received by filter\n0 packets dropped by kernel\n',early:true}],
])test('capture refuses '+name,()=>assert.throws(()=>captureStatus(status),/capture/));
test('capture accepts complete terminal statistics',()=>assert.equal(captureStatus({code:0,signal:null,text:'1 packets captured\n1 packets received by filter\n0 packets dropped by kernel\n'}).droppedPackets,0));
test('truncated packet record fails',()=>{const h=Buffer.alloc(25);h.writeUInt32LE(0xa1b2c3d4);h.writeUInt32LE(96,16);assert.throws(()=>pcapMetrics(h));});
test('header-only successful response fails',()=>assert.throws(()=>validateRssCase('declared-length',{state:{},origins:[{}],result:{received:100},stats:{flows:0,handlers:0,reservations:0,pools:{response:0}}})));
test('zero clients and transient slots fail',()=>assert.throws(()=>validateRssCase('two-25MiB-slow-readers',{state:{maxSlots:2,samples:[{slots:2,pools:{response:1}}]},origins:[{}],result:{clients:[{received:0},{received:0}]},stats:{flows:0,handlers:0,reservations:0,pools:{response:0}}})));
test('RSS reduction preserves prior retry and poisoned unknown',()=>{const s={poolMaxima:{request:1},automaticRetries:1,consumedWriteOutcome:'unsent'};const r=combineRss(s,{...s,automaticRetries:0,consumedWriteOutcome:'unknown'});assert.equal(r.automaticRetries,1);assert.equal(r.consumedWriteOutcome,'invalid');});
test('nonzero write cannot omit exact identity',()=>assert.throws(()=>verifyOrdering([{event:'target_attached',seq:1},{event:'guard_registered',seq:2},{event:'fetch_paused',seq:3}],[{event:'flow_closed',upstreamPlaintextBytes:1}])));
test('duplicate origin cannot share one consume',()=>assert.throws(()=>verifyOriginConsumes([{requestDigest:hash},{requestDigest:hash}],[{event:'consume',requestDigest:hash}])));
test('parent navigation cannot stand in for OOPIF barrier',()=>assert.throws(()=>verifyChildBarrier('oopif-first-request',[{event:'target_attached',targetId:'parent',type:'page'}],[],[])));
import {createGateAuthority} from '../lib/browser/controller-gate.mjs';
import {canonical} from '../lib/browser/acceptance-attestation.mjs';
import {sha256} from '../lib/browser/runtime-readiness.mjs';
for(const write of [false,true])for(const stage of ['server_connect','server_connected'])test(`signed ${write?'write':'read'} expiry fences ${stage}`,async()=>{
 let now=1000;const b={listener:18081,generation:1,listenerCookie:4,guardId:'g',contextId:'c',taskId:'task',bootId:'boot',targetId:'t'};
 const h=createGateAuthority({now:()=>now,networkConfig:{appHosts:['app.example'],serviceHosts:[],hostPublicAddresses:['9.9.9.9']},authority:{authorizeRequest:async()=>({expiresAt:1010,kind:write?'write':'read',consumeReceipt:{id:hash}})},bindingFor:async()=>b,fetchFor:async()=>({...b,kind:'document'})});
 const req={method:'GET',url:'https://permit.example/',headers:[['host','permit.example']],hostAuthority:'permit.example',sni:'permit.example',bodySha256:hash,dns:{hostname:'permit.example',chain:['permit.example'],addresses:['8.8.8.8'],ttlMs:60000}};req.requestDigest=sha256(canonical({method:req.method,url:req.url,headers:req.headers,bodySha256:hash}));
 const e=(event,extra={})=>({v:1,event,id:'flow',remainingMs:1000,...b,...extra});
 assert.equal((await h(e('http_connect',{authority:'permit.example:443'}))).ok,true);assert.equal((await h(e('requestheaders',req))).ok,true);
 const decision=await h(e('request',req));assert.equal(decision.expiresInMs,10);
 const connect=e('server_connect',{...req,hostname:'permit.example',address:'8.8.8.8'});
 if(stage==='server_connected')assert.equal((await h(connect)).ok,true);
 now=1010;assert.equal((await h(stage==='server_connect'?connect:e(stage,{hostname:'permit.example',peerAddress:'8.8.8.8'}))).ok,false);
});
import {validLinkControl,fixturePacketMetrics,namespaceSurvivors} from '../lib/browser/root-fixture.mjs';
function ndp(){const ip=Buffer.alloc(48);ip[0]=0x60;ip.writeUInt16BE(8,4);ip[6]=58;ip[7]=255;ip.set(Buffer.from('fe800000000000000000000000000001','hex'),8);ip.set(Buffer.from('ff020000000000000000000000000002','hex'),24);ip[40]=133;checksum(ip);return ip;}
function checksum(ip){const at=ip[6]===0?48:40;ip.writeUInt16BE(0,at+2);const p=Buffer.alloc(8);p.writeUInt32BE(ip.length-at);p[7]=58;const b=Buffer.concat([ip.subarray(8,40),p,ip.subarray(at)]);let sum=0;for(let i=0;i<b.length;i+=2)sum+=(b[i]<<8)+(b[i+1]??0);while(sum>>>16)sum=(sum&65535)+(sum>>>16);ip.writeUInt16BE((~sum)&65535,at+2);}
for(const [name,mutate] of [
 ['wrong hop limit',b=>b[7]=1],['bad checksum',b=>b[42]^=1],['wrong ICMP code',b=>{b[41]=1;checksum(b);}],['bad payload length',b=>b.writeUInt16BE(100,4)],['fragment extension',b=>b[6]=44],['truncated HBH',b=>b[6]=0],['invalid next header',b=>b[6]=17],['bad NDP reserved',b=>{b[47]=1;checksum(b);}],
])test('IPv6 control refuses '+name,()=>{const b=ndp();mutate(b);assert.equal(validLinkControl(b),false);});
test('valid IPv6 RS needs attributed outgoing interface as well as checksum',()=>{
 const ip=ndp(),sll=Buffer.alloc(20);sll.writeUInt16BE(0x86dd);sll.writeUInt32BE(2,4);sll[10]=4;sll[11]=6;sll.set(Buffer.from('020000000001','hex'),12);
 const head=Buffer.alloc(24);head.writeUInt32LE(0xa1b2c3d4);head.writeUInt32LE(256,16);head.writeUInt32LE(276,20);const r=Buffer.alloc(16);r.writeUInt32LE(68,8);r.writeUInt32LE(68,12);const pcap=Buffer.concat([head,r,sll,ip]);
 assert.equal(validLinkControl(ip),true);assert.equal(fixturePacketMetrics(pcap).privatePackets,1);
 const sources=[{index:2,source:ip.subarray(8,24).toString('hex'),mac:'020000000001'}];assert.equal(fixturePacketMetrics(pcap,{linkControlSources:sources}).linkControlPackets,1);
 const malformed=Buffer.concat([ip,Buffer.from('SECRET-IN-NDP')]);malformed.writeUInt16BE(malformed.length-40,4);checksum(malformed);assert.equal(validLinkControl(malformed),false);
});
test('unreadable survivor is failure, confirmed disappearance is allowed',async()=>{
 const run=async()=> '123\n456\n';await assert.rejects(namespaceSurvivors('n',[123],run,async()=>{throw Object.assign(Error(),{code:'EACCES'});}),/unreadable survivor/);
 assert.deepEqual(await namespaceSurvivors('n',[123],run,async()=>{throw Object.assign(Error(),{code:'ENOENT'});}),[]);
});
import {createControllerPolicy} from '../lib/browser/controller.mjs';
import {EventEmitter} from 'node:events';
test('fatal callback fences policy synchronously despite failed gate revoke',async()=>{
 let fenced=false;const id=randomUUID(),p=createControllerPolicy({runId:id,taskId:id,bootId:id,gate:{call:async()=>{throw Error('gate dead');}},authority:{unknownAll:async()=>{throw Error('sink dead');}}});p.setFatalHandler(()=>{fenced=true;});const pending=p.revokeListener();assert.equal(fenced,true);assert.equal(p.isLive(),false);await assert.rejects(pending);
});
import {capturePackets} from '../lib/browser/controller-network.mjs';
test('capture awaits stderr close after exit and preserves terminal stats',async()=>{
 const child=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{child.emit('exit',0,null);setTimeout(()=>{child.stderr.emit('data',Buffer.from('1 packets captured\n1 packets received by filter\n0 packets dropped by kernel\n'));child.emit('close',0,null);},20);};
 const p=capturePackets('b0b-1234abcd-f','unused',async()=>42,{writeCapture:async()=>{},spawnCapture:()=>{setImmediate(()=>child.stderr.emit('data',Buffer.from('listening on any\n')));return child;}});const result=await p;assert.equal(result.result,42);assert.equal(result.capture.capturedPackets,1);
});
import {createFatalShutdown} from '../lib/browser/launcher.mjs';
for(const hung of [false,true])test('fatal shutdown independently kills and awaits even '+(hung?'hung':'rejected')+' revoke',async()=>{
 let dead=false,killed=0,cleaned=0,finish;const close=createFatalShutdown({timeout:10,fence:()=>dead=true,revoke:()=>hung?new Promise(()=>{}):Promise.reject(Error()),kill:async()=>{killed++;await new Promise(r=>finish=r);},cleanup:async()=>cleaned++});
 const p=close();assert.equal(dead,true);assert.equal(close(),p);await new Promise(r=>setImmediate(r));assert.equal(killed,1);assert.equal(cleaned,0);finish();await assert.rejects(p);assert.equal(cleaned,1);
});
import {fixtureBody} from '../lib/browser/root-fixture.mjs';
const settled={flows:0,handlers:0,reservations:0,pools:{request:0,response:0,transport:0}};
function slowFixture(){return {state:{events:[{event:'response_buffered',id:'flow',seq:1,bodyBytes:25*1048576}],maxSlots:2,tailObserved:true,tailHoldSamples:Array.from({length:5},()=>({slots:2,response:112*1048576,tails:[{id:'a',tail:1,reserved:true},{id:'b',tail:1,reserved:true}]})),holdWindow:{start:100,end:1700},samples:[...Array.from({length:17},(_,i)=>({at:100+i*100,slots:2,pools:{response:112*1048576,request:50*1048576},bufferedResponses:['flow'],gateSeq:1})),{at:1800,slots:1},{at:1900,slots:0}]},origins:[{}],result:{candidates:{18081:8,18082:8},clients:Array.from({length:2},()=>({complete:true,declaredBodyBytes:25*1048576,bodyBytes:25*1048576,bodySha256:fixtureBody(25*1048576)}))},stats:settled};}
for(const [name,mutate]of [
 ['transient charge',s=>s.state.samples[5].pools.response=1],
 ['short hold',s=>s.state.holdWindow.end=500],
 ['missing one-slot release',s=>s.state.samples.splice(-2,1)],
 ['no outstanding TCP tail',s=>s.state.tailObserved=false],
 ['missing controlled tail samples',s=>delete s.state.tailHoldSamples],
 ['unreserved tail',s=>s.state.tailHoldSamples[0].tails[1].reserved=false],
 ['already acknowledged tail',s=>s.state.tailHoldSamples[0].tails[1].tail=0],
 ['same tail counted twice',s=>s.state.tailHoldSamples[0].tails[1].id='a'],
 ['partial second body',s=>s.result.clients[1].bodyBytes=1],
 ['wrong digest',s=>s.result.clients[1].bodySha256='b'.repeat(64)],
 ['only four candidates/context',s=>s.result.candidates[18082]=4],
 ['no concurrent frozen request',s=>s.state.samples.forEach(x=>{if(x.pools)x.pools.request=0;})],
])test('RSS measured stress rejects '+name,()=>{const s=slowFixture();mutate(s);assert.throws(()=>validateRssCase('preallocation-backpressure',s));});
test('complete sustained concurrent RSS fake passes the same root validator',()=>assert.equal(validateRssCase('preallocation-backpressure',slowFixture()),true));
test('matching write identity refuses wrong target and reused consume',()=>{
 const d=hash,events=[{seq:1,event:'target_attached',targetId:'t'},{seq:2,event:'guard_registered',targetId:'t'},{seq:3,event:'fetch_paused',targetId:'t'},{seq:4,event:'consume',id:'flow',targetId:'t',consumeId:hash,checkpointVerified:true,requestDigest:d},{seq:5,event:'digest_registered',id:'flow',targetId:'t',requestDigest:d}];const w={event:'flow_closed',id:'flow',targetId:'t',requestDigest:d,upstreamPlaintextBytes:10};
 assert.equal(verifyOrdering(events,[w]),true);assert.throws(()=>verifyOrdering(events,[{...w,targetId:'wrong'}]));assert.throws(()=>verifyOrdering(events,[w,w]));
});
import {bridge,controllerSessionEvent} from '../lib/browser/fixture-controller.mjs';
test('controller session bridge excludes request bodies/headers and bounds metadata',()=>{
 const result=controllerSessionEvent('Fetch.requestPaused',{requestId:'id',resourceType:'Document',request:{method:'POST',url:'https://permit.example/',postData:'secret'.repeat(100000),headers:{Authorization:'secret'}}});assert.equal(JSON.stringify(result).includes('secret'),false);assert.throws(()=>controllerSessionEvent('Fetch.requestPaused',{request:{url:'x'.repeat(32769)}}));
});
test('controller bridge rejects pending requests immediately on independent process loss',async()=>{
 const child={send:()=>{}},b=bridge(child),p=b.request('bindTarget');b.lost();await assert.rejects(p,/CONTROLLER_LOST/);
});
import {verifyConsumeRecord} from '../lib/browser/root-fixture.mjs';
test('actual consume/checkpoint/sink binds the transport digest; substituted records refuse',()=>{
 const keys=generateKeyPairSync('ed25519'),consume={runId:'run',bootId:'boot',kind:'read',transportRequestDigest:hash},record={id:hash,digest:sha256(canonical(consume)),runId:'run',bootId:'boot',kind:'read'},checkpoint={id:hash,digest:record.digest,ack:{envelope:envelope({purpose:'browser-controller-checkpoint',...record},keys.privateKey)}},event={consumeId:hash,requestDigest:hash};
 assert.equal(verifyConsumeRecord(event,consume,checkpoint,keys.publicKey,record),true);
 assert.throws(()=>verifyConsumeRecord({...event,requestDigest:'b'.repeat(64)},consume,checkpoint,keys.publicKey,record));
 assert.throws(()=>verifyConsumeRecord(event,consume,checkpoint,keys.publicKey,{...record,id:'b'.repeat(64)}));
 assert.throws(()=>verifyConsumeRecord(event,consume,{...checkpoint,digest:'b'.repeat(64)},keys.publicKey,record));
});

// Coordinator root-run fix: the headless shell attaches popups as their own browser-level page target
// (no child_target event). A distinct later page target still satisfies the paused-child evidence; the
// opener's own target never does, and the full attach/guard/resume/Fetch/write ordering is still required.
test('verifyChildBarrier accepts a distinct browser-level popup target with full ordering', async () => {
  const {verifyChildBarrier} = await import('../lib/browser/root-fixture.mjs');
  const name='popup-first-request', d='a'.repeat(64);
  const ctl=[
    {seq:1,event:'target_attached',targetId:'OPENER',type:'page'},{seq:2,event:'guard_registered',targetId:'OPENER'},{seq:3,event:'resume',targetId:'OPENER'},
    {seq:4,event:'target_attached',targetId:'POPUP',type:'page'},{seq:5,event:'guard_registered',targetId:'POPUP'},{seq:6,event:'resume',targetId:'POPUP'},
    {seq:7,event:'fetch_paused',targetId:'POPUP',url:'https://child.example/'+name},{seq:8,event:'consume',url:'https://child.example/'+name,requestDigest:d}];
  const gate=[{event:'flow_closed',targetId:'POPUP',upstreamPlaintextBytes:10,requestDigest:d}];
  assert.equal(verifyChildBarrier(name,ctl,gate,[{requestDigest:d,path:'/'+name}]),true);
  // Only the opener exists: refused.
  assert.throws(()=>verifyChildBarrier(name,ctl.slice(0,3),gate,[{requestDigest:d,path:'/'+name}]),/missing paused child/);
  // Popup resumed before its guard: refused.
  const bad=ctl.map(e=>e.targetId==='POPUP'&&e.event==='guard_registered'?{...e,seq:9}:e);
  assert.throws(()=>verifyChildBarrier(name,bad,gate,[{requestDigest:d,path:'/'+name}]),/child own/);
});

// OOPIF: the frame's own navigation is Fetch-paused on the parent target before the iframe target exists;
// the iframe must still attach paused and be guarded before resume, and the write must be the exact child request.
test('verifyChildBarrier OOPIF: navigation via parent before attach, exact child digest', async () => {
  const {verifyChildBarrier} = await import('../lib/browser/root-fixture.mjs');
  const name='oopif-first-request', child='c'.repeat(64), parent='p'.repeat(64).replace(/p/g,'b');
  const ctl=[
    {seq:1,event:'target_attached',targetId:'P',type:'page',browserContextId:'C'},{seq:2,event:'guard_registered',targetId:'P'},{seq:3,event:'resume',targetId:'P'},
    {seq:4,event:'fetch_paused',targetId:'P',url:'https://fixture.example/'+name},{seq:5,event:'consume',url:'https://fixture.example/'+name,requestDigest:parent},
    {seq:6,event:'fetch_paused',targetId:'P',frameId:'F',url:'https://child.example/'+name},{seq:7,event:'consume',url:'https://child.example/'+name,requestDigest:child},
    {seq:8,event:'child_target',targetId:'F',type:'iframe',waitingForDebugger:true},{seq:9,event:'target_attached',targetId:'F',type:'iframe',browserContextId:'C'},
    {seq:10,event:'guard_registered',targetId:'F'},{seq:11,event:'resume',targetId:'F'},{seq:12,event:'fetch_paused',targetId:'F',frameId:'F',url:'https://child.example/'+name+'/sub'},{seq:13,event:'consume',id:'sub',targetId:'F',url:'https://child.example/'+name+'/sub',requestDigest:hash},{seq:14,event:'digest_registered',id:'sub',targetId:'F',requestDigest:hash}];
  const gate=[{event:'flow_closed',targetId:'P',requestDigest:parent,upstreamPlaintextBytes:5},{event:'flow_closed',targetId:'P',requestDigest:child,upstreamPlaintextBytes:5},{event:'flow_closed',id:'sub',targetId:'F',requestDigest:hash,upstreamPlaintextBytes:5}];
  const origins=[{requestDigest:parent,path:'/'+name},{requestDigest:child,path:'/'+name},{requestDigest:hash,path:'/'+name+'/sub'}];
  assert.equal(verifyChildBarrier(name,ctl,gate,origins),true);
  // Only the parent page's own request was written: refused (no exact child write).
  assert.throws(()=>verifyChildBarrier(name,ctl,gate.slice(0,1),origins),/child own/);
  // Frame resumed before its guard: refused.
  assert.throws(()=>verifyChildBarrier(name,ctl.map(e=>e.targetId==='F'&&e.event==='guard_registered'?{...e,seq:12}:e),gate,origins),/child own/);
  // Popup still strict: a popup request on the parent target does not count.
  assert.throws(()=>verifyChildBarrier('popup-first-request',[{seq:1,event:'target_attached',targetId:'P',type:'page',browserContextId:'C'},{seq:2,event:'resume',targetId:'P'},{seq:3,event:'fetch_paused',targetId:'P',url:'https://child.example/popup-first-request'}],[],[]),/missing paused child/);
});

// Root-flake shutdown expectations precede implementation: the browser kill
// never waits on revocation, every failed boundary has a content-free code,
// cleanup always runs, and confirmed shutdown is idempotent.
for(const [failure,code] of [['revoke','revoke-failed'],['timeout','revoke-timeout'],['kill','kill-failed'],['cleanup','cleanup-failed'],['fence','fence-failed']])test('shutdown identifies '+code+' and still kills/cleans',async()=>{
 const calls=[];const close=createFatalShutdown({timeout:20,fence:()=>{calls.push('fence');if(failure==='fence')throw Error('secret');},revoke:async()=>{calls.push('revoke');if(failure==='revoke')throw Error('secret');if(failure==='timeout')await new Promise(()=>{});},kill:async()=>{calls.push('kill');if(failure==='kill')throw Error('secret');},cleanup:async()=>{calls.push('cleanup');if(failure==='cleanup')throw Error('secret');}});
 const p=close();assert.equal(close(),p);await assert.rejects(p,{message:'BROWSER_LAUNCH_REFUSED:'+code});assert.equal(calls.filter(x=>x==='kill').length,1);assert.equal(calls.filter(x=>x==='cleanup').length,1);
});
test('busy confirmed revoke does not delay kill or fail normal shutdown',async()=>{
 let confirm,killed=false,cleaned=false;const close=createFatalShutdown({timeout:500,fence:()=>{},revoke:()=>new Promise(r=>confirm=r),kill:async()=>{killed=true;},cleanup:async()=>{cleaned=true;}});
 const p=close();await new Promise(r=>setImmediate(r));assert.equal(killed,true);assert.equal(cleaned,false);confirm();await p;assert.equal(cleaned,true);assert.equal(close(),p);
});
test('policy denial returns before fatal revoke ACK (no gate/control circular wait)',async()=>{
 let cut=false,confirm;const pending=new Promise(r=>confirm=r);
 const handler=createGateAuthority({authority:{},networkConfig:{appHosts:['app.example'],serviceHosts:[],hostPublicAddresses:['9.9.9.9']},bindingFor:async()=>null,fetchFor:async()=>null,onFatal:()=>{cut=true;return pending;}});
 let timer;try{const result=await Promise.race([handler({event:'bad'}),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('circular revoke wait')),50))]);assert.deepEqual(result,{ok:false});assert.equal(cut,true);}finally{clearTimeout(timer);confirm();}
});
test('fatal fence reentry shares the published shutdown promise',async()=>{
 let close,reentered,kills=0;close=createFatalShutdown({fence:()=>{reentered=close();},revoke:async()=>{},kill:async()=>kills++,cleanup:async()=>{}});const p=close();assert.equal(reentered,p);await p;assert.equal(kills,1);
});

import {caseObservations,verifyCaseArtifacts} from '../lib/browser/root-fixture.mjs';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('RSS tail proof survives actual JSON write and parent artifact revalidation',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'browser-tail-artifact-'));
 try{
  const name='preallocation-backpressure',base=path.join(dir,name),fixture=slowFixture();await mkdir(base+'/receipts/sink',{recursive:true});
  const keys=generateKeyPairSync('ed25519'),id='b'.repeat(64),consume={runId:'run',bootId:'boot',kind:'read',transportRequestDigest:hash};
  const record={id,digest:sha256(canonical(consume)),runId:'run',bootId:'boot',kind:'read'};
  const checkpoint={id,digest:record.digest,ack:{envelope:envelope({purpose:'browser-controller-checkpoint',...record},keys.privateKey)}};
  const controllerEvents=[{seq:1,event:'target_attached',targetId:'t'},{seq:2,event:'guard_registered',targetId:'t'},{seq:3,event:'fetch_paused',targetId:'t'},{seq:4,event:'consume',id:'flow',targetId:'t',consumeId:id,checkpointVerified:true,requestDigest:hash},{seq:5,event:'digest_registered',id:'flow',targetId:'t',requestDigest:hash}];
  const events=[{event:'response_buffered',id:'flow',seq:1,bodyBytes:25*1048576},{event:'flow_closed',seq:2,id:'flow',targetId:'t',requestDigest:hash,upstreamPlaintextBytes:1}],origins=[{requestDigest:hash}];
  const receipts={['consume-'+id+'.json']:consume,['checkpoint-'+id+'.json']:checkpoint};
  for(const [file,value]of Object.entries({...receipts,['sink/sink-'+id+'.json']:record}))await writeFile(base+'/receipts/'+file,canonical(value));
  await writeFile(base+'/checkpoint.pub',keys.publicKey.export({type:'spki',format:'pem'}));
  const head=Buffer.alloc(24);head.writeUInt32LE(0xa1b2c3d4);head.writeUInt32LE(96,16);head.writeUInt32LE(101,20);
  const packet=Buffer.alloc(24);packet[0]=0x45;packet[9]=6;packet.set([8,8,8,8],16);packet.writeUInt16BE(443,22);const entry=Buffer.alloc(16);entry.writeUInt32LE(24,8);entry.writeUInt32LE(24,12);const pcap=Buffer.concat([head,entry,packet]);
  const stderr='1 packets captured\n1 packets received by filter\n0 packets dropped by kernel\n';await writeFile(base+'/ingress.pcap',pcap);await writeFile(base+'/ingress.pcap.stderr',stderr);
  await writeFile(base+'/origin.jsonl',JSON.stringify(origins[0])+'\n');
  await writeFile(base+'/ingress.pcap.terminal.json',JSON.stringify({code:0,signal:null,early:false}));
  fixture.state.memory={baseline:50*1048576,peak:210*1048576,beforeEvents:'oom_kill 0\n',afterEvents:'oom_kill 0\n'};fixture.state.packetIdentity={linkControlSources:[]};
  for(const sample of fixture.state.samples)Object.assign(sample,{pools:{request:sample.slots?50*1048576:0,response:sample.slots*56*1048576,transport:sample.slots*2*1048576},maxima:{request:50*1048576,response:112*1048576,transport:4*1048576},maxSlots:2,maxQueue:16000,contexts:2});
  const {deriveRss}=await import('../lib/browser/root-fixture.mjs');
  const rss=deriveRss({samples:fixture.state.samples,stats:fixture.stats,gateEvents:events,origins,memory:fixture.state.memory,unknownOutcome:null,unapprovedUpstreamBytes:0}),measurement={capture:captureStatus({code:0,signal:null,text:stderr}),...fixturePacketMetrics(pcap),responseEncodingRefused:false,eventSha256:sha256(JSON.stringify(events)),controllerEventsSha256:sha256(JSON.stringify(controllerEvents)),clientResultSha256:sha256(JSON.stringify(fixture.result)),originLogSha256:sha256(JSON.stringify(origins)),controllerEventCount:controllerEvents.length,eventCount:events.length,originRequests:1,rss,rssVerified:true,
   receiptSha256:sha256(Buffer.concat(Object.keys(receipts).sort().map(file=>Buffer.concat([Buffer.from(file),Buffer.from(canonical(receipts[file]))]))))};
  const observations=caseObservations({measurement,events,controllerEvents,...fixture,rss});
  const save=()=>writeFile(base+'/observations.json',JSON.stringify(observations));await save();
  assert.deepEqual(JSON.parse(await readFile(base+'/observations.json')).tailHoldSamples,fixture.state.tailHoldSamples);
  await verifyCaseArtifacts(dir,[{name,measurement}]);assert.equal(measurement.artifactHashesVerified,true);
  for(const corrupt of [o=>delete o.tailHoldSamples,o=>o.tailHoldSamples[0].tails[1].reserved=false,o=>o.tailHoldSamples[0].tails[1].id='a']){
   const damaged=structuredClone(observations);corrupt(damaged);await writeFile(base+'/observations.json',JSON.stringify(damaged));
   await assert.rejects(verifyCaseArtifacts(dir,[{name,measurement}]),/controlled TCP tails/);
  }
  for(const corrupt of [o=>o.samples[0].maxima.request=-1,o=>o.samples[0].pools.request=-1,o=>o.rss.poolMaxima.request=1]){
   const damaged=structuredClone(observations);corrupt(damaged);await writeFile(base+'/observations.json',JSON.stringify(damaged));
   await assert.rejects(verifyCaseArtifacts(dir,[{name,measurement}]),/RSS sample|RSS recomputation/);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('controller bridge preserves only the fixed EAGAIN code across process IPC',async()=>{
 for(const code of ['EAGAIN','secret exception text']){
  let request;const rpc=bridge({send:m=>request=m}),pending=rpc.request('gate',['fetch']);
  rpc.reply({reply:request.id,error:true,errorCode:code});
  await assert.rejects(pending,e=>e.message==='BROWSER_CONTROLLER_BRIDGE_REFUSED'&&e.code===(code==='EAGAIN'?'EAGAIN':'BROWSER_CONTROLLER_BRIDGE_REFUSED'));
 }
});
test('boot revoke retains a fixed trigger and discards exception text',async()=>{
 for(const reason of ['BROWSER_GATE_DIGEST_BACKPRESSURE','secret exception text']){
  let received;const id=randomUUID(),policy=createControllerPolicy({runId:id,taskId:id,bootId:id,authority:{unknownAll:async()=>{}},gate:{call:async(op,data)=>{received=data.reason;return {ok:true};}}});
  await policy.revokeListener(reason);assert.equal(received,reason.startsWith('BROWSER_')?reason:'BROWSER_CONTROLLER_REVOKE');
 }
});

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
function slowFixture(){return {state:{maxSlots:2,tailObserved:true,holdWindow:{start:100,end:1700},samples:[...Array.from({length:17},(_,i)=>({at:100+i*100,slots:2,pools:{response:112*1048576,request:50*1048576}})),{at:1800,slots:1},{at:1900,slots:0}]},origins:[{}],result:{candidates:{18081:8,18082:8},clients:Array.from({length:2},()=>({complete:true,declaredBodyBytes:25*1048576,bodyBytes:25*1048576,bodySha256:fixtureBody(25*1048576)}))},stats:settled};}
for(const [name,mutate]of [
 ['transient charge',s=>s.state.samples[5].pools.response=1],
 ['short hold',s=>s.state.holdWindow.end=500],
 ['missing one-slot release',s=>s.state.samples.splice(-2,1)],
 ['no outstanding TCP tail',s=>s.state.tailObserved=false],
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

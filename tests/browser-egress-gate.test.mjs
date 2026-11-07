import test from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {createPhase1ReadAuthority,verifyReadDispatch,actualRequestHmac} from '../lib/browser/read-authority.mjs';
import {createGateAuthority} from '../lib/browser/controller-gate.mjs';
import {makeTask,makeManifest,makeRequest,key,provenance} from './fixtures/browser-phase1-privacy/helpers.mjs';
function setup(){
 let time=Date.now(),mono=0,task=makeTask(),manifest=makeManifest(task,{now:time}),eligible=true;task={...task,read_manifest_revision:manifest.revision};
 const binding={taskId:task.id,bootId:task.controller_boot_id,generation:1,contextGeneration:0,guardId:randomUUID(),targetId:randomUUID(),listenerCookie:'opaque',listener:18081,contextId:randomUUID()};
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');const events=[],claims=new Set();let intent;
 const audit={anchorReadIntent:async x=>{events.push('anchor');intent=x.binding;}};
 const repository={transaction:async fn=>{
  const result=await fn({query:async(sql,args)=>{events.push('consume');const proof={v:1,task_id:args[0],original_run_id:task.current_run_id,boot_id:args[1],context_generation:0,task_origins_revision:1,manifest_revision:args[2],manifest_digest:args[4].toString('hex'),entry_id:args[3],parent_document_epoch:1,request_hmac:args[5].toString('hex'),flow_nonce:args[6],listener_generation:args[7],use_ordinal:1,expires_at:new Date(time+60000).toISOString(),consume_seq:1,checkpoint_ack_id:'independent_ack'};assert.equal(proof.request_hmac,intent.request_hmac);return {rows:[{result:proof}]};}});
  events.push('commit');task={...task,document_epoch:1};return result;
 }};
 const authority=createPhase1ReadAuthority({contextFor:async()=>({task,manifest,binding,provenance,eligible}),repository,audit,manifestKey:key,requestKey:Buffer.alloc(32,9),dispatchPrivateKey:privateKey,dispatchPublicKey:publicKey,journal:{claim:async(_,id)=>{if(claims.has(id))throw Error();claims.add(id);}},now:()=>time,monotonicNow:()=>mono});
 const meta={id:randomUUID(),targetId:binding.targetId,headers:[]},request=makeRequest();
 return {authority,request,meta,binding,publicKey,events,audit,repository,setTask:p=>{task={...task,...p};},setEligible:v=>{eligible=v;},advance:n=>{time+=n;mono+=n;},advanceMonotonic:n=>{mono+=n;}};
}
test('production exact authority commits consume before signed dispatch and checks again after TLS',async()=>{const x=setup();const r=await x.authority.authorizeRequest(x.request,x.meta);assert.deepEqual(x.events,['anchor','consume','commit']);assert.equal(r.kind,'read');assert.equal(verifyReadDispatch(r.dispatch,{publicKey:x.publicKey}).purpose,'browser-phase1-read-dispatch');assert.equal(await x.authority.authorizeDispatch(r,x.meta),true);await assert.rejects(x.authority.authorizeDispatch(r,x.meta));});
for(const [label,patch]of [['POST',{method:'POST'}],['OPTIONS',{method:'OPTIONS'}],['beacon',{kind:'beacon'}],['new path',{url:'https://portal.example/complete'}],['mutating query',{url:'https://portal.example/public?commit=1'}],['nonempty body',{bodySha256:'ab'.repeat(32)}]])test('production refuses '+label+' before consume',async()=>{const x=setup();await assert.rejects(x.authority.authorizeRequest({...x.request,...patch},x.meta));assert.deepEqual(x.events,[]);});
for(const change of [{private:true},{control_epoch:1},{context_generation:1},{read_manifest_revision:3},{manifest_revision:2},{current_run_id:randomUUID()},{document_epoch:2}])test('post-TLS authority change refuses '+JSON.stringify(change),async()=>{const x=setup(),r=await x.authority.authorizeRequest(x.request,x.meta);x.setTask(change);await assert.rejects(x.authority.authorizeDispatch(r,x.meta));});
test('future timer after departure cannot dispatch',async()=>{const x=setup(),r=await x.authority.authorizeRequest(x.request,x.meta);x.setEligible(false);await assert.rejects(x.authority.authorizeDispatch(r,x.meta));});
test('target swap or decision expiry never dispatches',async()=>{for(const expired of [false,true]){const x=setup(),r=await x.authority.authorizeRequest(x.request,x.meta);if(expired)x.advance(2001);await assert.rejects(x.authority.authorizeDispatch(r,{...x.meta,targetId:expired?x.meta.targetId:randomUUID()}));}});
test('transaction failure or expiry while anchoring grants no dispatch',async()=>{for(const kind of ['commit','timeout']){const x=setup();if(kind==='commit')x.repository.transaction=async()=>{throw Error('SQL commit refused');};else x.audit.anchorReadIntent=async()=>{x.advance(2001);};await assert.rejects(x.authority.authorizeRequest(x.request,x.meta));}});
test('signed purpose/proof/request substitution and fixture envelopes refuse',async()=>{const x=setup(),r=await x.authority.authorizeRequest(x.request,x.meta);for(const patch of [{purpose:'browser-read-manifest'},{request:{...r.dispatch.request,url:'https://portal.example/delete'}},{proof:{...r.dispatch.proof,entry_id:randomUUID()}},{signature:Buffer.alloc(64).toString('base64')}])assert.throws(()=>verifyReadDispatch({...r.dispatch,...patch},{publicKey:x.publicKey}));assert.throws(()=>verifyReadDispatch({payload:'e30=',signature:Buffer.alloc(64).toString('base64')},{publicKey:x.publicKey}));});
test('actual HMAC binds header values, target, nonce, method and exact bytes',()=>{const x=setup(),flow={nonce:randomUUID()},opts={actualRequest:x.request,binding:x.binding,flow,key};const h=actualRequestHmac(opts);assert.notEqual(h,actualRequestHmac({...opts,actualRequest:{...x.request,headers:[['accept','text/html']]}}));assert.notEqual(h,actualRequestHmac({...opts,binding:{...x.binding,targetId:randomUUID()}}));assert.notEqual(h,actualRequestHmac({...opts,flow:{nonce:randomUUID()}}));});
test('retry after consumed flow is burned without second consume',async()=>{const x=setup();await x.authority.authorizeRequest(x.request,x.meta);await assert.rejects(x.authority.authorizeRequest(x.request,x.meta));assert.equal(x.events.filter(x=>x==='consume').length,1);});
test('explicit production gate refuses fixture authority',()=>assert.throws(()=>createGateAuthority({phase:1,authority:{authorizeRequest:async()=>({kind:'write'})}})));
function gateSetup(){
 const x=setup(),request=makeRequest({headers:[['host','portal.example']]});
 const g=createGateAuthority({phase:1,authority:x.authority,networkConfig:{appHosts:['sjcos.example'],serviceHosts:['mcp.internal'],hostPublicAddresses:['8.8.4.4']},bindingFor:async()=>x.binding,fetchFor:async()=>({contextId:x.binding.contextId,kind:'document',targetId:x.binding.targetId})});
 const base={v:1,id:x.meta.id,remainingMs:2000,...x.binding,dns:{hostname:'portal.example',chain:['portal.example'],addresses:['8.8.8.8'],ttlMs:10000},...request,sni:'portal.example',hostAuthority:'portal.example'};
 return {...x,request,g,event:(event,patch={})=>g({...base,event,...patch})};
}
test('actual controller-gate production path preflights, consumes, pins TLS and rechecks dispatch',async()=>{
 const x=gateSetup();assert.equal((await x.event('http_connect',{authority:'portal.example:443'})).ok,true);
 assert.equal((await x.event('requestheaders')).ok,true);const r=await x.event('request');assert.equal(r.allow,true);assert.equal(r.kind,'read');
 assert.equal((await x.event('server_connect',{hostname:'portal.example',address:'8.8.8.8'})).ok,true);
 assert.equal((await x.event('server_connected',{hostname:'portal.example',peerAddress:'8.8.8.8'})).ok,true);
 assert.equal((await x.event('request_dispatch',{decisionId:r.decisionId})).ok,true);
 assert.equal((await x.event('request_dispatch',{decisionId:r.decisionId})).ok,false);
});
test('actual controller gate fences post-TLS private transition',async()=>{
 const x=gateSetup();await x.event('http_connect',{authority:'portal.example:443'});await x.event('requestheaders');const r=await x.event('request');await x.event('server_connect',{hostname:'portal.example',address:'8.8.8.8'});await x.event('server_connected',{hostname:'portal.example',peerAddress:'8.8.8.8'});x.setTask({private:true});assert.equal((await x.event('request_dispatch',{decisionId:r.decisionId})).ok,false);
});
for(const change of [{method:'POST',headers:[['host','portal.example'],['content-length','0']]},{method:'OPTIONS'},{headers:[['host','portal.example'],['x-secret','encoded']]}])test('actual controller gate blocks unsafe request at headers '+JSON.stringify(change),async()=>{const x=gateSetup();await x.event('http_connect',{authority:'portal.example:443'});assert.equal((await x.event('requestheaders',change)).ok,false);assert.deepEqual(x.events,[]);});

test('independent monotonic decision deadline survives a stalled wall clock',async()=>{const x=setup(),r=await x.authority.authorizeRequest(x.request,x.meta);x.advanceMonotonic(2001);await assert.rejects(x.authority.authorizeDispatch(r,x.meta));});

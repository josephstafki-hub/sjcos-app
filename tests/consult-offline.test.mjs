import {test} from 'node:test';import assert from 'node:assert/strict';
import {partitionKey,assertOfflineLease,seal,unseal} from '../lib/consult/offline.ts';
const id={user_id:'visitor',session_epoch:2,build:'v1',consult_id:'visit'};
test('offline authorization is identity-bound and expires after 24 hours',()=>{const lease={user_id:'visitor',session_epoch:2,expires_at:1000};assertOfflineLease(id,lease,999);for(const bad of [{...lease,user_id:'other'},{...lease,session_epoch:1},{...lease,expires_at:1},{...lease,expires_at:86401001}])assert.throws(()=>assertOfflineLease(id,bad,1000),/offline_locked/);assert.notEqual(partitionKey(id),partitionKey({...id,user_id:'other'}));});
test('ciphertext cannot be read by another identity, build, key, or revision',async()=>{const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);const value={outbox:[{event:'same-id'}],projection:{length:96}};const record=await seal(value,key,partitionKey(id),1);assert.deepEqual(await unseal(record,key,partitionKey(id)),value);assert.ok(!new TextDecoder().decode(record.ciphertext).includes('length'));await assert.rejects(unseal(record,key,partitionKey({...id,user_id:'other'})));await assert.rejects(unseal({...record,revision:2},key,partitionKey(id)));const other=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await assert.rejects(unseal(record,other,partitionKey(id)));});

import {ConsultOfflineStore,createDeviceKey,enrollPin,unlockPin,verifyLease,checkCapacity} from '../lib/consult/offline.ts';
import {OfflineEngine} from '../lib/consult/offline-engine.ts';
import {signOfflineLease} from '../lib/consult/offline-lease.ts';
import {emptyQueue,payloadHash} from '../lib/consult/queue.ts';
import {memoryIndexedDB} from './_harness/consult-idb.mjs';
import {readFileSync} from 'node:fs';import vm from 'node:vm';
const liveLease=()=>({user_id:id.user_id,session_epoch:id.session_epoch,expires_at:Date.now()+3600000});
const local=()=>({queue:emptyQueue(1,1),snapshot:{client:'Private'},blobs:[],last_send:null});
async function setup(request){const factory=memoryIndexedDB(),store=await ConsultOfflineStore.open(factory),key=await createDeviceKey(),lease=liveLease(),engine=new OfflineEngine(id,store,request);await engine.unlock(key,lease);await engine.prepare(local());return {factory,store,key,lease,engine};}
async function answer(){const payload={status:'answered',value:96};return {protocol_version:1,client_event_id:crypto.randomUUID(),device_id:crypto.randomUUID(),device_epoch:1,seq:1,base_revision:0,generation:1,type:'answer',target:{instance_id:crypto.randomUUID(),field_key:'length'},payload,payload_sha256:await payloadHash(payload)};}
test('cold reload offline recovers committed state and pending edits only after unlock',async()=>{const {store,key,lease,engine}=await setup();const op=await answer();await engine.capture(op,{length:96});engine.lock();assert.throws(()=>engine.read(),/offline_locked/);const next=new OfflineEngine(id,store);await next.unlock(key,lease);assert.equal(next.read().queue.entries[0].op.client_event_id,op.client_event_id);assert.equal(next.read().queue.projection.length,96);store.close();});
test('logout and user switch retain encrypted notes and expose no former-user projection',async()=>{const {store,key,lease,engine}=await setup();engine.logout();const other=new OfflineEngine({...id,user_id:'other'},store);assert.throws(()=>other.read(),/offline_locked/);await other.unlock(key,{...lease,user_id:'other'});assert.equal(other.read(),null);assert.throws(()=>engine.read(),/offline_locked/);await engine.unlock(key,lease);assert.equal(engine.read().snapshot.client,'Private');store.close();});
test('revocation quarantines original author operations and locks sensitive reads',async()=>{const {store,key,lease,engine}=await setup(async()=>Response.json({error_code:'access_denied'},{status:403}));const op=await answer();await engine.capture(op,{secret:1});await engine.replay();assert.throws(()=>engine.read(),/offline_locked/);const saved=await store.load(id,lease,key);assert.equal(saved.value.queue.blocked,'revoked');assert.equal(saved.value.queue.entries[0].status,'quarantined');assert.equal(saved.value.snapshot,null);assert.deepEqual(saved.value.queue.entries[0].op,op);store.close();});
test('expired lease locks capture, signed lease rejects tamper, wrong device and build',async()=>{const {store,key,engine}=await setup();const now=Date.now(),lease={...liveLease(),consult_id:id.consult_id,device_id:'device',build:id.build,issued_at:now};const signed=signOfflineLease(lease,Buffer.alloc(32,8));assert.equal((await verifyLease(signed,id,'device',signed.public_key)).user_id,id.user_id);await assert.rejects(verifyLease({...signed,payload:signed.payload+' '},id,'device',signed.public_key),/offline_locked/);await assert.rejects(verifyLease(signed,id,'other',signed.public_key),/offline_locked/);await assert.rejects(verifyLease(signed,{...id,build:'v2'},'device',signed.public_key),/offline_locked/);await assert.rejects(engine.unlock(key,{...liveLease(),expires_at:now-1}),/offline_locked/);store.close();});
test('PIN envelope requires both device key and PIN, persisted CryptoKey survives cold open',async()=>{const {store}=await setup();const device=await createDeviceKey(),envelope=await enrollPin('123456',device,'user');await store.keyRecord('device',device);const persisted=await store.keyRecord('device');const key=await unlockPin('123456',persisted,envelope,'user');const record=await seal({secret:1},key,'user',1);await assert.rejects(unlockPin('654321',persisted,envelope,'user'));await assert.rejects(unlockPin('123456',await createDeviceKey(),envelope,'user'));assert.deepEqual(await unseal(record,await unlockPin('123456',persisted,envelope,'user'),'user'),{secret:1});store.close();});
test('denied and quota storage never acknowledge a save; prior durable state survives',async()=>{const {factory,store,key,lease,engine}=await setup();factory.quota();await assert.rejects(engine.capture(await answer(),{length:12}),/storage_full/);assert.equal(engine.read().queue.entries.length,0);factory.quota(false);assert.equal((await store.load(id,lease,key)).value.queue.entries.length,0);factory.deny();await assert.rejects(ConsultOfflineStore.open(factory),/storage_unavailable/);store.close();await assert.rejects(checkCapacity({estimate:async()=>({quota:20,usage:10}),persist:async()=>false},100),/storage_full/);});
test('old-build reconnect preserves original bytes and demands update',async()=>{const {store,engine}=await setup(async()=>Response.json({error_code:'update_required'},{status:426}));const op=await answer();await engine.capture(op,{length:96});await engine.replay();assert.equal(engine.read().queue.entries[0].status,'update_required');assert.deepEqual(engine.read().queue.entries[0].op,op);store.close();});
test('duplicate commit after lost acknowledgment uses the same event and server receipt',async()=>{
 const seen=[];let lose=true;const {engine,store,key,lease}=await setup(async(url,init)=>{const op=JSON.parse(init.body).input.ops[0];seen.push(op.client_event_id);if(lose){lose=false;throw Error('ack lost');}return Response.json([{id:op.client_event_id,status:200,revision:2}]);});
 const op=await answer();await engine.capture(op,{length:96});await engine.replay();engine.lock();const saved=await store.load(id,lease,key);saved.value.queue.entries[0].next_at=0;await store.save(id,lease,key,saved.revision,saved.value);await engine.unlock(key,lease);await engine.replay();assert.deepEqual(seen,[op.client_event_id,op.client_event_id]);assert.equal(engine.read().queue.entries[0].status,'accepted');store.close();
});
test('orphan encrypted blob survives crash before manifest commit; exact hash recovery is safe',async()=>{const {store,key,lease,engine}=await setup();const blob=new Blob(['photo bytes']),hash=await payloadHash('unused');const bytes=await blob.arrayBuffer(),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');await store.saveBlob(id,lease,key,sha,blob);assert.deepEqual(await engine.orphanHashes(),[sha]);engine.lock();assert.equal(await (await store.loadBlob(id,lease,key,sha)).text(),'photo bytes');await assert.rejects(store.saveBlob(id,lease,key,hash,blob),/invalid_hash/);store.close();});
test('greater deletion epoch removes visible content and permanently blocks replay',async()=>{const {engine,store}=await setup();await engine.capture(await answer(),{secret:1});await engine.epochs(1,1,2);assert.equal(engine.read().queue.blocked,'deleted');assert.deepEqual(engine.read().queue.projection,{});assert.equal(engine.read().snapshot,null);await engine.replay();store.close();});
test('service worker refuses missing precache and outside-scope assets; no authenticated HTML cached',async()=>{const listeners={},messages=[];const context={self:{addEventListener:(n,fn)=>listeners[n]=fn,location:{origin:'https://test'},clients:{claim:async()=>{}},registration:{unregister:async()=>{}}},crypto,caches:{open:async()=>({match:async()=>undefined}),keys:async()=>[]},fetch:async()=>new Response('missing',{status:404}),URL,Response};vm.runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),context);for(const manifest of [{build:'v1',assets:[]},{build:'v1',assets:[{url:'/consult/offline.html',sha256:'a'.repeat(64)}]},{build:'v1',assets:[{url:'/consult/offline.html',sha256:'a'.repeat(64)},{url:'/consult/assets/capture.js',sha256:'b'.repeat(64)},{url:'/login',sha256:'b'.repeat(64)}]}]){let done;listeners.message({data:{type:'PRECACHE',manifest},ports:[{postMessage:m=>messages.push(m)}],waitUntil:p=>done=p});await done;}assert.deepEqual(messages.map(m=>m.code),['missing_precache','missing_precache','invalid_manifest']);let intercepted=false;listeners.fetch({request:{url:'https://test/projects',method:'GET',headers:new Headers(),mode:'navigate'},respondWith:()=>intercepted=true});assert.equal(intercepted,false);});

import {OfflineVault} from '../lib/consult/offline-vault.ts';
test('vault cold enrollment verifies issuer, PIN and lease without storing extractable content keys',async()=>{const factory=memoryIndexedDB(),store=await ConsultOfflineStore.open(factory),vault=new OfflineVault(store),now=Date.now();const signed=signOfflineLease({...liveLease(),consult_id:id.consult_id,device_id:'device',build:id.build,issued_at:now},Buffer.alloc(32,7));await vault.enroll(id,'device','123456',signed);const unlocked=await vault.unlock(id,'device','123456');assert.equal(unlocked.key.extractable,false);await assert.rejects(vault.unlock({...id,user_id:'other'},'device','123456'),/not_prepared/);await assert.rejects(vault.renew(id,'device',signOfflineLease({...JSON.parse(signed.payload),expires_at:now+10000},Buffer.alloc(32,6))),/offline_locked/);store.close();});

test('verified complete precache serves cold offline shell; kill switch blocks caching and preserves IDB',async()=>{
 const listeners={},stores=new Map(),messages=[];let offline=false,unregistered=false;
 const contents={'/consult/offline.html':'<main>Unlock</main>','/consult/assets/capture.js':'/* capture fixture */'};
 const manifest={build:'build1',assets:await Promise.all(Object.entries(contents).map(async([url,bytes])=>({url,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bytes)))].map(b=>b.toString(16).padStart(2,'0')).join('')})))};
 const caches={keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key),open:async key=>{if(!stores.has(key))stores.set(key,new Map());const s=stores.get(key);return {put:async(k,v)=>s.set(k,v.clone()),match:async k=>s.get(k)?.clone()};}};
 vm.runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{self:{addEventListener:(n,f)=>listeners[n]=f,location:{origin:'https://test'},clients:{claim:async()=>{},get:async()=>({url:'https://test/consult/'})},registration:{unregister:async()=>unregistered=true}},crypto,caches,URL,Response,fetch:async input=>{if(offline)throw Error('offline');return new Response(contents[typeof input==='string'?input:new URL(input.url).pathname]??'auth data');}});
 async function message(data){let task;listeners.message({data,ports:[{postMessage:m=>messages.push(m)}],waitUntil:p=>task=p});await task;return messages.at(-1);}
 assert.equal((await message({type:'PRECACHE',manifest})).ok,true);assert.equal((await message({type:'CHECK',manifest})).ok,true);offline=true;let response;listeners.fetch({clientId:'tab',request:{url:'https://test/consult/visit',method:'GET',headers:new Headers(),mode:'navigate'},respondWith:p=>response=p});assert.equal(await (await response).text(),contents['/consult/offline.html']);stores.set('sjcos-consult-shell:build2',new Map([['/consult/assets/ready',new Response('{}')],['/consult/offline.html',new Response('new shell')]]));
 stores.set('sjcos-consult-shell:incomplete',new Map([['/consult/offline.html',new Response('partial shell')]]));
 listeners.fetch({clientId:'',request:{url:'https://test/consult/visit?consult_build=build1',method:'GET',headers:new Headers(),mode:'navigate'},respondWith:p=>response=p});assert.equal(await (await response).text(),contents['/consult/offline.html']);
 listeners.fetch({clientId:'',request:{url:'https://test/consult/visit?consult_build=incomplete',method:'GET',headers:new Headers(),mode:'navigate'},respondWith:p=>response=p});assert.equal((await response).status,503);
 assert.equal((await message({type:'STOP_CACHE'})).capture_blocked,true);assert.equal(unregistered,true);assert.equal(stores.size,0);assert.equal((await message({type:'PRECACHE',manifest})).code,'capture_blocked');
});

import {getReady} from '../lib/consult/get-ready.ts';import {definitionChecksum} from '../lib/consult/forms/seed.ts';
test('Get ready in a new build partition continues the prepared device sequence and commits after all checks',async()=>{
 const store=await ConsultOfflineStore.open(memoryIndexedDB()),checks=[],device='device',now=Date.now(),signed=signOfflineLease({...liveLease(),consult_id:id.consult_id,device_id:device,build:id.build,issued_at:now},Buffer.alloc(32,9));
 const definition={key:'room',version:1,title:'Room',repeatable:true,say:[],fields:[],shots:[],coverage:[]};const snapshot={consult:{revision:0,completion_generation:1},pins:[{definition,checksum:await definitionChecksum(definition)}]};
 const request=async(url,options)=>options?.method==='POST'?Response.json(JSON.parse(options.body).command==='prepare_device'?{ok:true,epoch:1,generation:1,last_ack_seq:7}:signed):Response.json(snapshot);
 const result=await getReady({identity:id,device,pin:'123456',manifest:{build:id.build,assets:[]},worker:{postMessage:(message,ports)=>ports[0].postMessage({ok:true})},store,storage:{estimate:async()=>({quota:100000000,usage:0}),persist:async()=>false},needed_bytes:1024,request,onCheck:(key,value)=>{if(value.state==='done')checks.push(key);}});
 assert.equal(result.ok,true);assert.equal(result.engine.read().queue.next_seq,8);assert.deepEqual(checks,['visit_details','forms','offline_pages','saving_on_device','offline_lease']);assert.deepEqual(result.engine.read().snapshot,snapshot);store.close();
});

test('multipart replay recovers lost commit acknowledgment by event ID, evicts only committed bytes',async()=>{
 let committed=false,parts=0,commits=0;const events=[];const receipt={file_id:'file',media_id:'media'};
 const request=async(url,options)=>{
  if(url.endsWith('/commit')){commits++;committed=true;throw Error('commit ack lost');}
  if(url.includes('/parts/')){parts++;return Response.json({n:0});}
  const body=JSON.parse(options.body);
  if(url.endsWith('/uploads')){events.push(body.event_id);return Response.json({upload_id:'upload',part_bytes:1048576,received_parts:[],receipt:committed?receipt:null});}
  return Response.json(body.input.ops.map(op=>({id:op.client_event_id,status:200,revision:2})));
 };
 const {store,key,lease,engine}=await setup(request);const op=await answer();await engine.capture(op,{length:96});await engine.replay();
 const blob=new Blob(['photo bytes']),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');const meta={hash,event_id:crypto.randomUUID(),mime:'image/jpeg',kind:'photo',instance_id:op.target.instance_id,shot_key:'room'};
 await engine.captureBlob(blob,meta);await assert.rejects(engine.replay(),/ack lost/);assert.equal(engine.read().blobs[0].receipt,undefined);await engine.replay();assert.deepEqual(engine.read().blobs[0].receipt,receipt);assert.deepEqual(events,[meta.event_id,meta.event_id]);assert.equal(parts,1);assert.equal(commits,1);await engine.evictSyncedBlobs();assert.equal(await store.loadBlob(id,lease,key,hash),null);store.close();
});

test('decision-only saves survive cold reload, replay receipts, a new build and a new login partition',async()=>{
 const store=await ConsultOfflineStore.open(memoryIndexedDB()),device='stable-device';let ack=0;
 const definition={key:'room',version:1,title:'Room',repeatable:true,say:[],fields:[],shots:[],coverage:[]};
 const pin={definition,checksum:await definitionChecksum(definition)};
 for(const identity of [id,{...id,build:'v2'},{...id,build:'v2',session_epoch:3}]){
  const now=Date.now(),signed=signOfflineLease({...liveLease(),...identity,device_id:device,issued_at:now},Buffer.alloc(32,9));
  const request=async(_url,options)=>{
   if(!options?.method)return Response.json({consult:{revision:ack,completion_generation:1},pins:[pin]});
   const b=JSON.parse(options.body);
   if(b.command==='prepare_device')return Response.json({ok:true,epoch:1,generation:1,last_ack_seq:ack});
   if(b.command==='offline_lease')return Response.json(signed);
   return Response.json(b.input.ops.map(o=>{assert.equal(o.seq,ack+1);ack=o.seq;return {id:o.client_event_id,status:200,revision:ack};}));
  };
  const ready=await getReady({identity,device,pin:'123456',manifest:{build:identity.build,assets:[]},worker:{postMessage:(_m,p)=>p[0].postMessage({ok:true})},store,storage:{estimate:async()=>({quota:100000000,usage:0}),persist:async()=>true},needed_bytes:1,request,onCheck:()=>{}});
  assert.equal(ready.ok,true);assert.equal(ready.engine.read().queue.next_seq,ack+1);
  const payload={flags:{room:{disposition:'price_it',note:'Repair'}},trade_walks:[],rrp:{receipt:true},skips:{photo:{reason:'Client declined'}}};
  const op={...await answer(),device_id:device,type:'decisions',target:null,seq:ack+1,payload,payload_sha256:await payloadHash(payload)};
  await ready.engine.capture(op,{draft:payload});ready.engine.lock();
  const unlocked=await new OfflineVault(store).unlock(identity,device,'123456');const cold=new OfflineEngine(identity,store,request);
  await cold.unlockSigned(unlocked.key,signed,device,unlocked.issuer);assert.deepEqual(cold.read().queue.projection.draft,payload);
  await cold.replay();assert.equal(cold.read().queue.entries[0].status,'accepted');cold.lock();
 }
 assert.equal(ack,3);store.close();
});

test('offline Close intent and send failure survive cold unlock',async()=>{
 const {store,key,lease,engine}=await setup(async()=>Response.json({wrong:'shape'}));
 await engine.capture(await answer(),{});await engine.saveCloseIntent({photos_ok:false});
 await assert.rejects(engine.replay(),/invalid_receipts/);
 assert.equal(engine.read().last_send_failure.code,'invalid_receipts');
 engine.lock();const cold=new OfflineEngine(id,store);await cold.unlock(key,lease);
 assert.deepEqual(cold.read().close_intent.evidence,{photos_ok:false});assert.ok(cold.read().close_intent.started_at>0);
 assert.equal(cold.read().last_send_failure.code,'invalid_receipts');
 await cold.clearCloseIntent();assert.equal(cold.read().close_intent,undefined);store.close();
});

test('offline Close cold reload reconnect automatically closes exactly once',async()=>{
 const {VisitController}=await import('../lib/consult/ui/controller.ts');
 const {engine,store,key,lease}=await setup();
 Object.defineProperty(globalThis.navigator,'onLine',{value:false,configurable:true});
 const first=new VisitController(null,'visit');first.engine=engine;first.state.local=engine.read();first.state.device='device';
 await first.close(null);assert.equal(first.getState().closing.step,'waiting_signal');engine.lock();
 const cold=new OfflineEngine(id,store);await cold.unlock(key,lease);
 const next=new VisitController(null,'visit');next.engine=cold;next.state.local=cold.read();next.state.device='device';
 Object.defineProperty(globalThis.navigator,'onLine',{value:true,configurable:true});
 let closes=0;const previous=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{if(init?.method==='POST'){assert.equal(JSON.parse(init.body).command,'close');closes++;return Response.json({complete:true,checks:[],revision:1});}return Response.json({consult:{revision:1}});};
 try{await next.drain();assert.equal(next.getState().closing.step,'done');assert.equal(cold.read().close_intent,undefined);await next.drain();assert.equal(closes,1);}finally{globalThis.fetch=previous;store.close();}
});

test('empty-queue Close retries a lost acknowledgement after cold unlock with the exact request',async(t)=>{
 const {VisitController}=await import('../lib/consult/ui/controller.ts');
 const {engine,store,key,lease}=await setup();
 await engine.saveCloseIntent(null);
 const exact={expected_revision:1,manifest:{device_id:'device',marker:'same-request'}};
 await engine.saveCloseRequest(exact);engine.lock();
 const cold=new OfflineEngine(id,store);await cold.unlock(key,lease);
 const ctl=new VisitController(null,'visit');ctl.engine=cold;ctl.state.local=cold.read();ctl.state.device='device';
 Object.defineProperty(globalThis.navigator,'onLine',{value:true,configurable:true});
 const previous=globalThis.fetch;let effects=0,attempts=0;const seen=new Set();
 globalThis.fetch=async(_url,init)=>{
  if(!init?.method)return Response.json({consult:{revision:2}});
  const body=JSON.parse(init.body);assert.equal(body.command,'close');assert.deepEqual(body.input,exact);
  const k=JSON.stringify(body.input);if(!seen.has(k)){seen.add(k);effects++;}
  if(++attempts===1)throw new TypeError('Failed to fetch');
  return Response.json({complete:true,checks:[],revision:2});
 };
 t.after(()=>{globalThis.fetch=previous;if(ctl.timer)clearTimeout(ctl.timer);store.close();});
 await ctl.drain();assert.equal(ctl.state.closing.step,'waiting_signal');assert.ok(ctl.timer);
 // The actual scheduled callback (no browser online event or user action).
 let retried;const drain=ctl.drain.bind(ctl);ctl.drain=(...args)=>(retried=drain(...args));
 const timer=ctl.timer,fire=timer._onTimeout;clearTimeout(timer);fire();await retried;
 assert.equal(ctl.state.closing.step,'done');assert.equal(attempts,2);assert.equal(effects,1);assert.equal(cold.read().close_intent,undefined);
});

test('answer exceptions preserve unknown vs network failures; upload-only success stamps Last sent',async()=>{
 for(const error of [new Error('adapter bug'),new TypeError('Illegal invocation'),'thrown string',new TypeError('Failed to fetch')]){
  const {engine,store}=await setup(async()=>{throw error;});await engine.capture(await answer(),{});await engine.replay();
  assert.equal(engine.read().last_send_failure.code==='no_signal',error?.message==='Failed to fetch');store.close();
 }
 const {engine,store,key,lease}=await setup(async()=>Response.json({receipt:{file_id:'file',media_id:'media'}}));
 await engine.capture(await answer(),{});
 // Accepted answer supplies the original device identity, but only the upload is drained.
 let v=engine.read();v.queue.entries[0].status='accepted';await engine.commit(v);
 const bytes=new Blob(['bytes']);const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await bytes.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
 await engine.captureBlob(bytes,{hash:digest,event_id:crypto.randomUUID(),kind:'photo',mime:'image/jpeg',instance_id:'room'});
 await engine.replay();assert.ok(engine.read().last_send);assert.equal(engine.read().last_send_failure,null);
 engine.lock();await engine.unlock(key,lease);assert.ok(engine.read().last_send);store.close();
});

test('upload network and adapter exceptions retain honest diagnostics; malformed upload is actionable',async()=>{
 for(const [error,expected] of [[new TypeError('Failed to fetch'),'no_signal'],[new TypeError('adapter bug'),'adapter bug'],['oops','transport_unknown'],[null,'invalid_upload_response']]){
  const {engine,store}=await setup(async()=>{if(error===null)return Response.json({});throw error;});const op=await answer();await engine.capture(op,{});let v=engine.read();v.queue.entries[0].status='accepted';await engine.commit(v);
  const bytes=new Blob(['image']);const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await bytes.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
  await engine.captureBlob(bytes,{hash:digest,event_id:crypto.randomUUID(),kind:'photo',mime:'image/jpeg',instance_id:'room'});
  await assert.rejects(engine.replay());assert.equal(engine.read().last_send_failure.code,expected);assert.ok(engine.read().last_send_failure.detail);store.close();
 }
});

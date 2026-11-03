import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConsultOfflineStore} from '../lib/consult/offline.ts';
import {OfflineVault} from '../lib/consult/offline-vault.ts';
import {OfflineEngine} from '../lib/consult/offline-engine.ts';
import {signOfflineLease} from '../lib/consult/offline-lease.ts';
import {emptyQueue, payloadHash} from '../lib/consult/queue.ts';
import {VisitController} from '../lib/consult/ui/controller.ts';
import {memoryIndexedDB} from './_harness/consult-idb.mjs';

test('PIN cold unlock then Send now posts queued answers with browser fetch receiver semantics',async(t)=>{
 const identity={user_id:'visitor',session_epoch:1,build:'v1',consult_id:crypto.randomUUID()},device=crypto.randomUUID();
 const store=await ConsultOfflineStore.open(memoryIndexedDB());
 const now=Date.now(),signed=signOfflineLease({...identity,device_id:device,issued_at:now,expires_at:now+3600000},Buffer.alloc(32,9));
 const vault=new OfflineVault(store);await vault.enroll(identity,device,'123456',signed);
 const unlocked=await vault.unlock(identity,device,'123456');
 const engine=new OfflineEngine(identity,store);await engine.unlockSigned(unlocked.key,signed,device,unlocked.issuer);
 const snapshot={consult:{revision:0,completion_generation:1},decisions:{},pins:[],instances:[],heads:[],conflicts:[]};
 await engine.prepare({queue:emptyQueue(1,1),snapshot,blobs:[],last_send:null});
 const payload={status:'answered',value:96};
 const op={protocol_version:1,client_event_id:crypto.randomUUID(),device_id:device,device_epoch:1,seq:1,base_revision:0,generation:1,type:'answer',target:{instance_id:crypto.randomUUID(),field_key:'length'},payload,payload_sha256:await payloadHash(payload)};
 await engine.capture(op,{});engine.lock();
 let online=false;const posts=[];
 const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),originalFetch=globalThis.fetch;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{get onLine(){return online;}}});
 t.after(()=>{Object.defineProperty(globalThis,'navigator',nav);globalThis.fetch=originalFetch;});
 globalThis.fetch=async function(url,init){
  // Chromium's fetch rejects an OfflineEngine receiver before any network request.
  if(this!==undefined&&this!==globalThis)throw new TypeError('Illegal invocation');
  if(init?.method==='POST'){
   assert.equal(url,`/api/consult/${identity.consult_id}`);assert.equal(init.headers['X-Consult-CSRF'],'1');
   const body=JSON.parse(init.body);assert.equal(body.command,'ops');posts.push(body.input.ops);
   return Response.json(body.input.ops.map(o=>({id:o.client_event_id,status:200,revision:1})));
  }
  return Response.json(snapshot);
 };
 const ctl=new VisitController(null,identity.consult_id);
 ctl.store=store;Object.assign(ctl.state,{identity,device,enrolled:true});
 t.after(()=>{ctl.lock();if(ctl.timer)clearTimeout(ctl.timer);store.close();});
 await ctl.unlock('123456');assert.equal(ctl.getState().phase,'visit');
 assert.equal(ctl.getState().lastSendFailure.code,'no_signal');
 online=true;await ctl.drain(true);
 assert.deepEqual(posts,[[op]]);assert.equal(ctl.getState().local.queue.entries[0].status,'accepted');
 assert.equal(ctl.getState().lastSendFailure,null);assert.ok(ctl.getState().local.last_send);
 // A rejected head must be explained, never silently stop all following operations.
 await ctl.engine.capture({...op,client_event_id:crypto.randomUUID(),seq:2},{});
 await ctl.engine.epochs(2,1,0);
 await ctl.drain(true);assert.equal(ctl.getState().lastSendFailure.code,'rebase_required');assert.equal(posts.length,1);
});

test('Send now explains missing engine, concurrent send and disposed controller',async()=>{
 const c=new VisitController(null,'visit');await c.drain(true);assert.equal(c.getState().lastSendFailure.code,'not_prepared');
 c.engine={};c.draining=true;await c.drain(true);assert.equal(c.getState().lastSendFailure.code,'send_in_progress');
 c.disposed=true;await c.drain(true);assert.equal(c.getState().lastSendFailure.code,'controller_disposed');
});

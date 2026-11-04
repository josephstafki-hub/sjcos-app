import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withTestDb} from './_harness/testdb.mjs';
import {fixture} from './_harness/consult.mjs';
import {snapshot} from '../lib/consult/protocol.ts';
import {OfflineEngine} from '../lib/consult/offline-engine.ts';
import {emptyQueue} from '../lib/consult/queue.ts';
import {VisitController} from '../lib/consult/ui/controller.ts';

for(const scenario of ['boot','unsent edit','Reload','changed evidence'])test(`same device reopen refresh: ${scenario}`,async(t)=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);await f.send([f.op()]);
 const original=await snapshot(c,f.context('read'),f.consult);
 await f.save();
 const identity={user_id:f.staff,session_epoch:1,build:'test',consult_id:f.consult};
 let saved=null,version=0;
 const store={load:async()=>saved,save:async(_i,_l,_k,_v,value)=>{saved={revision:++version,value:structuredClone(value)};return version;},preflight:async()=>{}};
 const engine=new OfflineEngine(identity,store);
 const lease={...identity,device_id:f.device,issued_at:Date.now(),expires_at:Date.now()+3600000};
 await engine.unlock({},lease);
 const seq=Number((await c.query('SELECT last_ack_seq FROM consult_devices WHERE consult_id=$1 AND device_id=$2',[f.consult,f.device])).rows[0].last_ack_seq);
 await engine.prepare({snapshot:original,queue:{...emptyQueue(1,1),next_seq:seq+1},blobs:[],last_send:null});
 const first=await f.close();assert.equal(first.complete,true);
 await f.run('reopen',{expected_revision:await f.revision(),reason:'Review'},f.owner);
 if(scenario==='changed evidence')await engine.saveCloseIntent(f.evidence);
 const fresh=await snapshot(c,f.context('read'),f.consult);
 if(scenario==='unsent edit'){
  const op=f.op('answer',{status:'answered',value:144,unit:'in'},0);
  await engine.capture(op,{draft:{local:'keep'}});
 }
 const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),oldFetch=globalThis.fetch;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
 t.after(()=>{if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;globalThis.fetch=oldFetch;});
 globalThis.fetch=async(_url,init)=>{
  if(!init?.method)return Response.json(await snapshot(c,f.context('read'),f.consult));
  const {command,input}=JSON.parse(init.body);
  try{return Response.json(await f.run(command,input));}catch(e){return Response.json({error_code:e.message},{status:409});}
 };
 const ctl=new VisitController(null,f.consult);ctl.engine=engine;ctl.ensureRequiredInstances=async()=>{};
 Object.assign(ctl.state,{device:f.device,local:engine.read()});
 t.after(()=>{if(ctl.timer)clearTimeout(ctl.timer);if(ctl.closeTimer)clearTimeout(ctl.closeTimer);engine.lock();});
 if(scenario==='Reload'){
  await assert.rejects(f.run('evidence',{device:f.device,epoch:1,expected_revision:await f.revision(),generation:2,baseline_hash:original.close_evidence_hash,evidence:{}}),/stale_snapshot/);
  await ctl.abandonClose();
 }
 await ctl.refresh();
 assert.equal(engine.read().snapshot.close_evidence_hash,fresh.close_evidence_hash);
 assert.equal(engine.read().queue.generation,2);
 if(scenario==='unsent edit'){
  const v=engine.read();assert.equal(v.queue.entries[0].status,'conflict');assert.equal(v.queue.entries[0].error_code,'rebase_required');assert.equal(v.queue.entries[0].op.payload.value,144);assert.deepEqual(v.queue.projection,{draft:{local:'keep'}});return;
 }
 if(scenario==='changed evidence'){
  await ctl.close(f.evidence);assert.equal(ctl.state.closing.code,'evidence_conflict');
  assert.deepEqual((await snapshot(c,f.context('read'),f.consult)).close_evidence,fresh.close_evidence);return;
 }
 // Failed online refresh keeps the durable copy and generation intact.
 const copy=engine.read();const request=globalThis.fetch;globalThis.fetch=async()=>{throw new TypeError('Failed to fetch');};
 await ctl.refresh();assert.deepEqual(engine.read(),copy);globalThis.fetch=request;
 await ctl.close(fresh.close_evidence);
 assert.equal(ctl.state.closing.step,'done',JSON.stringify(ctl.state.closing));
 assert.equal(ctl.state.closing.result.complete,true);
 assert.deepEqual(ctl.state.closing.result.checks,first.checks);
 assert.deepEqual(ctl.state.closing.result.price_critical,first.price_critical);
 assert.deepEqual(ctl.state.closing.result.record,first.record);
 // The new baseline is durable across a cold engine unlock.
 engine.lock();await engine.unlock({},lease);assert.equal(engine.read().queue.generation,2);
},{fresh:true}));

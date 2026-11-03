import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VisitController} from '../lib/consult/ui/controller.ts';
import {OfflineEngine} from '../lib/consult/offline-engine.ts';
import {ConsultOfflineStore,createDeviceKey} from '../lib/consult/offline.ts';
import {emptyQueue} from '../lib/consult/queue.ts';
import {createInstanceOp,startOp} from '../lib/consult/ui/ops.ts';
import {seedModules,templates as seedTemplates} from '../lib/consult/forms/seed.ts';
import {buildModel,emptyDraft,summaryInput} from '../lib/consult/ui/model.ts';
import {rrpFacts} from '../lib/consult/rrp.ts';
import {compileCondition} from '../lib/consult/forms/conditions.ts';
import {memoryIndexedDB} from './_harness/consult-idb.mjs';
const identity={user_id:'visitor',session_epoch:1,build:'v1',consult_id:'visit'};
const snapshot=()=>({consult:{status:'scheduled',revision:0,completion_generation:1},pins:[...seedModules.map(definition=>({kind:'module',definition})),...seedTemplates.filter(t=>['bath','kitchen'].includes(t.key)).map(definition=>({kind:'template',definition}))],instances:[],heads:[],conflicts:[]});
async function setup(t,request,initial=snapshot()){
 const store=await ConsultOfflineStore.open(memoryIndexedDB()),key=await createDeviceKey(),lease={...identity,expires_at:Date.now()+3600000};
 const engine=new OfflineEngine(identity,store,request);await engine.unlock(key,lease);await engine.prepare({queue:emptyQueue(1,1),snapshot:initial,blobs:[],last_send:null});
 const controller=()=>{const c=new VisitController(null,'visit');c.engine=engine;c.lease=lease;c.state.local=engine.read();c.state.device='device';c.schedule=()=>{};t.after(()=>{clearTimeout(c.expiryTimer);clearTimeout(c.closeTimer);});return c;};
 t.after(()=>store.close());return {store,key,lease,engine,controller};
}
test('Bath + Kitchen interrupted legacy start recovers on cold load exactly once; new initialization is atomic',async t=>{
 const fresh=await setup(t);await fresh.controller().start();
 const {engine,controller,key,lease}=await setup(t);let c=controller();
 await c.commit((q,b)=>startOp(q,'device',b),'Start');
 // Reproduce the old partial loop, including a preset create with no answer.
 for(const key of ['house','selections','selections','selections'])await c.addInstance(key,key);
 const prior=engine.read().queue.entries.map(e=>e.op);
 engine.lock();await engine.unlock(key,lease);c=controller();
 Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
 await c.afterUnlock();await Promise.all([c.ensureRequiredInstances(),c.ensureRequiredInstances()]);
 const m=c.model();
 for(const [key,count] of [['closing',1],['kitchen_scope',1],['kitchen_wall',2]])assert.equal(m.sections.filter(s=>s.module.key===key).length,count,key);
 assert.ok(m.sections.some(s=>s.module.key==='kitchen_appliance'));
 assert.equal(m.slots.at(-1).module.key,'closing');
 assert.equal(m.sections.at(-1).module.key,'closing');
 assert.equal(m.sections.find(s=>s.module.key==='closing').fields.filter(f=>f.required&&f.def.tier==='price_critical').length,4);
 assert.ok(m.sections.filter(s=>s.module.key==='selections').every(s=>s.pc.done===0&&s.mark==='open'&&s.fields.find(f=>f.key==='decision').answer));
 assert.deepEqual(engine.read().queue.entries.slice(0,prior.length).map(e=>e.op),prior);
 const entries=engine.read().queue.entries.length;await c.ensureRequiredInstances();assert.equal(engine.read().queue.entries.length,entries);
 assert.equal(await c.ensureClosing(),m.sections.find(s=>s.module.key==='closing').instance.id);
 // No queued initialization operations are visible if the one durable commit fails.
 const second=await setup(t),d=second.controller();await d.commit((q,b)=>startOp(q,'device',b),'Start');
 const save=second.store.save.bind(second.store);second.store.save=async()=>{throw Error('storage_full');};
 await assert.rejects(d.ensureRequiredInstances(),/storage_full/);assert.equal(d.model().sections.length,0);
 second.store.save=save;await d.ensureRequiredInstances();assert.equal(d.model().sections.filter(s=>s.module.key==='closing').length,1);
});
test('unknown year, unanswered/skipped before-1978 keeps RRP and older-house questions required',()=>{
 const known=new Set(seedModules.flatMap(m=>m.fields.flatMap(f=>[f.key,`${m.key}.${f.key}`]))),era=seedModules.find(m=>m.key==='era');
 for(const values of [{},{'era.before_1978':undefined}]){
  assert.equal(rrpFacts(values,false,'2026-11-03').applies,true);
  for(const key of ['pamphlet_given','asbestos','knob_tube'])assert.equal(compileCondition(era.fields.find(f=>f.key===key).required,known)(values),true,key);
 }
 const s=snapshot();s.instances=[{id:'house',module_key:'house'},{id:'era',module_key:'era'}];
 s.heads=[['house','year_built'],['era','before_1978']].map(([instance_id,field_key])=>({id:field_key,instance_id,field_key,status:'skipped',skip_reason:'No access',server_revision:1}));
 const m=buildModel(s,[],[],emptyDraft());assert.equal(m.rrpApplies,true);
 for(const key of ['pamphlet_given','asbestos','knob_tube'])assert.equal(m.sections.find(s=>s.module.key==='era').fields.find(f=>f.key===key).required,true);
 assert.equal(rrpFacts({'era.before_1978':false},false,'2026-11-03').applies,false);
});
test('scope coverage and a different measured room never hide an unmeasured room',()=>{
 const s=snapshot();s.instances=[{id:'r1',module_key:'room',label:'Room 1 — Bath'},{id:'r2',module_key:'room',label:'Room 2 — Bath'},{id:'bath',module_key:'bath_scope'}];
 s.heads=[{instance_id:'bath',field_key:'existing_tub_material',value:'Cast iron'}, {instance_id:'r2',field_key:'length',value:120}].map(h=>({...h,id:h.field_key,status:'answered',server_revision:1}));
 const summary=summaryInput(buildModel(s,[],[],emptyDraft()),undefined,'2026-11-03','');
 assert.ok(summary.come_back.some(x=>/bathroom/i.test(x)));assert.ok(summary.rooms.some(x=>x.work.includes('Measured')));
});
test('Close joins a background send and reaches result; concurrent sends never record a failure',async t=>{
 const {engine,controller}=await setup(t);const c=controller();
 let release;const gate=new Promise(r=>release=r);let replayCount=0;
 engine.replay=async()=>{replayCount++;await gate;};c.refresh=async()=>{};
 Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
 const old=globalThis.fetch;t.after(()=>{globalThis.fetch=old;clearTimeout(c.closeTimer);});
 globalThis.fetch=async()=>Response.json({complete:true,checks:[],revision:1});
 const background=c.drain();assert.equal(c.drain(true),background);
 const sending=new Promise(resolve=>{const unsub=c.subscribe(()=>{if(c.state.closing){unsub();resolve();}});});
 const close=c.close(null);await sending;assert.equal(c.state.closing.step,'sending');
 const timeout=c.closeTimer._onTimeout;clearTimeout(c.closeTimer);timeout();assert.equal(c.state.closing.step,'error');assert.equal(c.state.closing.code,'close_timeout');
 release();await Promise.all([background,close]);
 assert.equal(replayCount,1);assert.equal(c.state.lastSendFailure,null);assert.equal(c.state.closing.step,'done');clearTimeout(c.closeTimer);
});
test('photo-only transient failures retry the actual multipart engine without an online event',async t=>{
 for(const failAt of ['init','part','commit']){
  let failed=false,committed=false,commits=0;
  const receipt={file_id:'file',media_id:'media'};
  const request=async(url,init)=>{
   const stage=url.endsWith('/commit')?'commit':url.includes('/parts/')?'part':'init';
   if(stage===failAt&&!failed){failed=true;if(stage==='commit'){committed=true;commits++;}throw new TypeError('Failed to fetch');}
   if(stage==='commit'){committed=true;commits++;return Response.json(receipt);}
   if(stage==='part')return Response.json({n:0});
   return Response.json({upload_id:'upload',part_bytes:1000,received_parts:[],receipt:committed?receipt:null});
  };
  const {engine,controller}=await setup(t,request),c=controller();
  const op=await createInstanceOp(engine.read().queue,'device',{rev:0,fields:{}},'room','Room');await engine.capture(op,{});
  // Accepted answers/instances, no answer work left to trigger retries.
  await engine.receipts([{id:op.client_event_id,status:200,revision:1}]);
  const blob=new Blob(['photo']),hash=Buffer.from(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())).toString('hex');
  await engine.captureBlob(blob,{hash,event_id:crypto.randomUUID(),mime:'image/jpeg',kind:'photo',instance_id:op.target.instance_id});c.state.local=engine.read();
  c.schedule=VisitController.prototype.schedule;c.refresh=async()=>{};
  t.after(()=>{if(c.timer)clearTimeout(c.timer);});
  await c.drain();assert.equal(engine.read().blobs.filter(b=>!b.receipt).length,1);assert.ok(c.timer);
  let retried;const drain=c.drain.bind(c);c.drain=(...args)=>(retried=drain(...args));const fire=c.timer._onTimeout;clearTimeout(c.timer);fire();await retried;
  assert.equal(engine.read().blobs.filter(b=>!b.receipt).length,0);assert.ok(engine.read().last_send);assert.equal(commits,1);assert.equal(c.state.lastSendFailure,null);
 }
});
test('flag triggers: dry watershed answer is not near-water and 12¼-inch toilet is normal',()=>{
 const known=new Set(seedModules.flatMap(m=>m.fields.flatMap(f=>[f.key,`${m.key}.${f.key}`])));
 const flag=(module,key)=>seedModules.find(m=>m.key===module).fields.find(f=>f.key===key).flag;
 assert.equal(compileCondition(flag('addition_scope','lot_shoreland').when,known)({lot_watershed:'Dry district',lot_shoreland:'No',lot_floodplain:'No'}),false);
 assert.equal(compileCondition(flag('addition_scope','lot_watershed').when,known)({lot_watershed:'Dry district'}),true);
 for(const [rough_in,expected] of [[12.25,false],[11.5,false],[12.5,false],[10,true],[14,true]])assert.equal(compileCondition(flag('plumb_fixture','rough_in').when,known)({rough_in}),expected);
});

test('footing initialization requires an explicit county zone and leaves city depth unanswered',async t=>{
 const s=snapshot();s.pins=s.pins.filter(p=>p.kind==='module').concat(seedTemplates.filter(t=>t.key==='deck').map(definition=>({kind:'template',definition})));
 const {controller}=await setup(t,undefined,s),c=controller();await c.start();
 const foot=c.model().sections.find(s=>s.module.key==='footing');assert.ok(foot);
 for(const key of ['frost_zone','required_depth']){const f=foot.fields.find(f=>f.key===key);assert.equal(f.required,true);assert.equal(f.answer,undefined);}
});
test('photo-only authorization loss cancels automatic retry and clears decrypted state',async t=>{
 const {engine,controller}=await setup(t,async()=>Response.json({error_code:'access_denied'},{status:403})),c=controller();
 const op=await createInstanceOp(engine.read().queue,'device',{rev:0,fields:{}},'room','Room');await engine.capture(op,{});await engine.receipts([{id:op.client_event_id,status:200,revision:1}]);
 const blob=new Blob(['private photo']),hash=Buffer.from(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())).toString('hex');
 await engine.captureBlob(blob,{hash,event_id:crypto.randomUUID(),mime:'image/jpeg',kind:'photo',instance_id:op.target.instance_id});c.state.local=engine.read();
 Object.defineProperty(navigator,'onLine',{value:true,configurable:true});c.refresh=async()=>{};
 await c.drain();assert.equal(c.state.local,null);assert.equal(c.state.phase,'blocked');assert.equal(c.timer,null);assert.throws(()=>engine.read(),/offline_locked/);
});

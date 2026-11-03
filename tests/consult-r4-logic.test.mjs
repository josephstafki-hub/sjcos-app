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
 assert.equal(m.sections.find(s=>s.module.key==='closing').fields.filter(f=>f.required&&f.def.tier==='price_critical').length,3);
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
 assert.equal(c.closeTimer,null); // R7: the transport deadline is the sole timeout source.
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

test('R5 catalog ordering is independent of template selection order',async()=>{
 const {mergeTemplateModules}=await import('../lib/consult/template-merge.ts');
 const bath=seedTemplates.find(t=>t.key==='bath'),kitchen=seedTemplates.find(t=>t.key==='kitchen');
 const a=mergeTemplateModules([bath,kitchen]).map(m=>m.module);
 assert.deepEqual(a,mergeTemplateModules([kitchen,bath]).map(m=>m.module));
 assert.ok(a.indexOf('house')<a.indexOf('bath_scope'));
 assert.ok(a.indexOf('kitchen_scope')<a.indexOf('selections'));
 assert.deepEqual(a.slice(-2),['selections','closing']);
});
test('R5 No with unknown year requires a written reason; sixteenths parse',async()=>{
 const {rrpYearConflict}=await import('../lib/consult/rrp.ts');
 const {parseLength}=await import('../lib/consult/length.ts');
 assert.equal(compileCondition(rrpYearConflict,new Set(['era.before_1978','house.year_built']))({'era.before_1978':false}),true);
 assert.equal(parseLength('13/16',{precision:1/16}).inches,13/16);
 assert.equal(parseLength('24 13/16',{precision:1/16}).inches,24+13/16);
});
test('R5 offline answers create required vented appliance children',async t=>{
 const {controller}=await setup(t); const c=controller(); await c.start();
 const hvac=c.model().sections.find(s=>s.module.key==='hvac');
 await c.answer(hvac.instance.id,'fuel_appliances','Fuel appliances',{status:'answered',value:true});
 assert.ok(c.model().sections.some(s=>s.module.key==='hvac_vent'&&s.instance.parent_id===hvac.instance.id));
});
test('R5 header-only stalled body expires, retry succeeds and late body is ignored',async t=>{
 const {deadlineFetch}=await import('../lib/consult/transport.ts');
 const timer=globalThis.setTimeout;
 globalThis.setTimeout=(f,ms,...args)=>timer(f,ms===15000?10:ms,...args);
 t.after(()=>{globalThis.setTimeout=timer;});
 let old;
 const stalled=new Response(new ReadableStream({start(c){old=c;}}));
 await assert.rejects(deadlineFetch(async()=>stalled,'https://example.test'),/http_408/);
 const fresh=await deadlineFetch(async()=>Response.json({attempt:2}),'https://example.test');
 assert.deepEqual(await fresh.json(),{attempt:2});
 old.enqueue(new TextEncoder().encode('{"attempt":1}'));old.close();
});
test('R5 Close retries the saved request after a stalled body, direct and drain-owned',async t=>{
 for(const drainOwned of [false,true]){
  const {engine,controller}=await setup(t),c=controller();c.refresh=async()=>{};
  await engine.saveCloseIntent(null);
  const request={expected_revision:0,manifest:{devices:[]}};await engine.saveCloseRequest(request);
  const original=globalThis.fetch,timer=globalThis.setTimeout;let calls=0,old;const inputs=[];
  globalThis.setTimeout=(f,ms,...args)=>timer(f,ms===15000?10:ms,...args);
  globalThis.fetch=async(_url,init)=>{inputs.push(JSON.parse(init.body).input);calls++;return calls===1?new Response(new ReadableStream({start(x){old=x;}})):Response.json({complete:false,checks:[],price_critical:{total:0,done:0,skipped:0},record:{total:0,done:0,skipped:0},revision:1});};
  try{
   if(drainOwned)await c.drain(true);else await c.resumeClose();
   assert.equal(c.state.closing.code,'close_timeout');assert.equal(c.closing,false);
   await c.close(null);assert.equal(c.state.closing.step,'done');
   assert.deepEqual(inputs,[request,request]);
   old.enqueue(new TextEncoder().encode('{"complete":true}'));old.close();
   await new Promise(resolve=>timer(resolve,0));
   assert.equal(c.state.closing.result.complete,false);
  }finally{globalThis.fetch=original;globalThis.setTimeout=timer;clearTimeout(c.closeTimer);}
 }
});
test('R5 device flags include derived fields with the same shared evaluation as close',async()=>{
 const {pinnedDerivations}=await import('../lib/consult/derive.ts');
 const {evaluatedFlags}=await import('../lib/consult/flags.ts');
 const s=snapshot();s.instances=[{id:'house',module_key:'house'},{id:'era',module_key:'era'}];
 s.heads=[{id:'alarm',instance_id:'house',field_key:'alarms_missing',status:'answered',value:['Missing'],server_revision:1},{id:'year',instance_id:'house',field_key:'year_built',status:'answered',value:1950,server_revision:1}];
 const house=s.pins.find(p=>p.kind==='module'&&p.definition.key==='house');
 house.definition={...house.definition,fields:[...house.definition.fields,{key:'derived_year',label:'Derived year',type:'number',required:false,tier:'price_critical',derive:'year_built',flag:{when:{field:'derived_year',op:'gt',value:1900},issue:'Derived flag'}}]};
 const m=buildModel(s,[],[],emptyDraft()),mods=s.pins.filter(p=>p.kind==='module').map(p=>p.definition);
 const projection=pinnedDerivations(mods,seedTemplates.filter(t=>['bath','kitchen'].includes(t.key)),s.instances,s.heads);
 const global={};for(const mod of mods)for(const field of mod.fields){const vals=s.instances.filter(i=>i.module_key===mod.key).map(i=>projection.scalar(i,field.key)).filter(v=>v!==undefined);if(vals.length)global[mod.key+'.'+field.key]=vals.length===1?vals[0]:vals;}
 const serverKeys=s.instances.flatMap(i=>{const mod=mods.find(m=>m.key===i.module_key);const values={...global};for(const f of mod.fields){const v=projection.scalar(i,f.key);if(v!==undefined)values[f.key]=v;}return mod.fields.flatMap(f=>evaluatedFlags(f,i.id+':'+f.key,values).map(f=>f.key));});
 assert.deepEqual(m.flags.map(f=>f.key).sort(),serverKeys.sort());
 assert.ok(m.flags.some(f=>f.key==='house:derived_year'));
});
test('R5 acknowledgment saves rendered summary with initials and summary is not visitor-required',async t=>{
 const {controller,engine}=await setup(t),c=controller();await c.start();
 const closing=c.model().sections.find(s=>s.module.key==='closing');
 const text='What we went over\nBathroom\nMeasured\nNext\nJoe sends your formal estimate.';
 await c.photo(new Blob(['png'],{type:'image/png'}),{instance_id:closing.instance.id,field_key:'client_initials',kind:'initials'},'Initials',text);
 const m=c.model(),section=m.sections.find(s=>s.instance.id===closing.instance.id);
 assert.equal(section.fields.find(f=>f.key==='summary').answer.value,text);
 assert.equal(section.fields.find(f=>f.key==='summary').required,false);
 assert.ok(engine.read().blobs.some(b=>b.kind==='initials'&&b.instance_id===closing.instance.id));
 assert.ok(section.fields.findIndex(f=>f.key==='estimate_promised')<section.fields.findIndex(f=>f.key==='client_initials'));
});
test('R5 section and wrap count the same required fields across tiers; unknown-year Say is conservative',async()=>{
 const {sectionCounts,openItemCount,closeAction}=await import('../lib/consult/completeness.ts');
 const s=snapshot();s.instances=[{id:'bath',module_key:'bath_scope'},{id:'era',module_key:'era'}];
 const m=buildModel(s,[],[],emptyDraft());
 for(const sec of m.sections){const n=sectionCounts(sec);assert.equal(n.total-n.done,m.open.filter(o=>o.section===sec&&!o.partly).length);}
 assert.equal(openItemCount({price_critical:m.pc,record:m.record}),m.open.filter(o=>!o.partly).length);
 assert.equal(closeAction('flag_decisions'),'review_flags');
 assert.match(m.sections.find(s=>s.module.key==='era').fields.find(f=>f.key==='pamphlet_given').def.say,/We’re not sure the house was built in 1978 or later/);
});

for (const fails of [false,true]) test('R6 held Close cannot touch replacement engine after lock/unlock: '+(fails?'failure':'success'),async t=>{
 const {controller,engine}=await setup(t),c=controller();
 Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
 await engine.saveCloseIntent(null);c.refresh=async()=>{};
 let release,entered;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async()=>{entered();await held;if(fails)throw new Error('no_signal');return new Response(JSON.stringify({complete:true}),{status:200});};
 const old=c.resumeClose();await started;c.lock();
 let clears=0;const intent={evidence:{new:true}};
 c.engine={read:()=>({close_intent:intent}),clearCloseIntent:async()=>{clears++;}};
 c.state.local={close_intent:intent};c.state.closing={step:'sending'};
 const newToken={};c.closeToken=newToken;c.closing=true;
 release();await old;
 assert.equal(clears,0);assert.equal(c.engine.read().close_intent,intent);
 assert.equal(c.state.closing.step,'sending');assert.equal(c.closeToken,newToken);assert.equal(c.closing,true);
});
test('R6 year prefill is selected, sourced and covered in every device tally',()=>{
 const s=snapshot();s.instances=[{id:'house',module_key:'house',removed_at:null},{id:'era',module_key:'era',removed_at:null}];
 s.heads=[{id:'year',instance_id:'house',field_key:'year_built',status:'answered',value:1985,server_revision:1}];
 const model=buildModel(s,[],[],emptyDraft()),section=model.sections.find(s=>s.module.key==='era'),f=section.fields.find(f=>f.key==='before_1978');
 assert.equal(f.answer.value,false);assert.equal(f.mark,'covered');assert.equal(f.prefilledFrom.label,'From Year built (1985)');
 assert.ok(!model.open.some(o=>o.item.addr===f.addr));assert.equal(section.pc.done,section.pc.total);
});
test('R6 exactly the explicitly specified cabinet/cutout/floor fields use sixteenths',()=>{
 const fields=seedModules.flatMap(m=>m.fields.filter(f=>f.precision===1/16).map(f=>m.key+'.'+f.key)).sort();
 assert.deepEqual(fields,['flooring.worst_dip','kitchen_appliance.cutout_depth','kitchen_appliance.cutout_height','kitchen_appliance.cutout_width','kitchen_scope.island_depth','kitchen_scope.island_length','kitchen_scope.sink_base_width','kitchen_wall.base_run','kitchen_wall.length_counter','kitchen_wall.length_ceiling','kitchen_wall.upper_run'].sort());
});

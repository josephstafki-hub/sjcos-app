import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VisitController} from '../lib/consult/ui/controller.ts';
import {emptyQueue,enqueue,payloadHash} from '../lib/consult/queue.ts';
import {decisionPatches} from '../lib/consult/ui/ops.ts';
import {mergeDecisions} from '../lib/consult/protocol.ts';

for(const status of [409,503])test('close refusal '+status+' pauses or retries until visitor acts',async(t)=>{
 const old=globalThis.fetch,nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
 let calls=0,reports=0,success=false;
 globalThis.fetch=async(_url,init)=>{
  const {command}=JSON.parse(init.body);
  if(command==='report_close_failure'){reports++;return Response.json({});}
  calls++;return success?Response.json({complete:true}):Response.json({error_code:'stale_snapshot'},{status});
 };
 const local={snapshot:{consult:{revision:1}},queue:emptyQueue(1,1),blobs:[],close_intent:{evidence:null,started_at:Date.now()}};
 const ctl=new VisitController(null,'test');
 ctl.engine={read:()=>structuredClone(local),saveCloseRequest:async(request)=>{local.close_intent.request=request;},
 pauseClose:async(paused,notified)=>{Object.assign(local.close_intent,{paused,notified});},
 clearCloseRequest:async()=>{delete local.close_intent.request;delete local.close_intent.paused;},
 clearCloseIntent:async()=>{delete local.close_intent;}};
 ctl.refresh=async()=>{};Object.assign(ctl.state,{local,device:'device'});
 t.after(()=>{if(ctl.closeTimer)clearTimeout(ctl.closeTimer);globalThis.fetch=old;if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;});
 await ctl.resumeClose();
 if(status===409){
  await ctl.resumeClose();await ctl.resumeClose();assert.equal(calls,1);assert.equal(reports,1);assert.equal(local.close_intent.paused,'stale_snapshot');
 }else{assert.ok(ctl.closeTimer);clearTimeout(ctl.closeTimer);assert.equal(calls,1);}
 success=true;await ctl.engine.clearCloseRequest();await ctl.resumeClose();
 assert.equal(calls,2);assert.equal(ctl.state.closing.result.complete,true);assert.equal(local.close_intent,undefined);
});

test('decision patches preserve clears and reject oversize before queue insertion',async()=>{
 const draft={skips:{a:{reason:'Other',note:'valid'}},flags:{},trade_walks:[],no_trades_confirmed:false,rrp:{receipt:false,firm_current:false,renovator_current:false,redelivery_required:false},ack_reason:null};
 let result=null;for(const patch of decisionPatches({},draft))result=mergeDecisions(result,patch);
 assert.deepEqual(result,draft);
 for(const patch of decisionPatches(draft,{...draft,skips:{}}))result=mergeDecisions(result,patch);
 assert.deepEqual(result.skips,{});
 const payload='x'.repeat(262144),q=emptyQueue(1,1);
 assert.throws(()=>enqueue(q,{seq:1,generation:1,device_epoch:1,protocol_version:1,payload,payload_sha256:'0'.repeat(64)},{}),/batch_too_large/);
 assert.equal(q.entries.length,0);
});

test('603-field transport size probe for skipped and answered visits',async()=>{
 const {decisionsOp,answerOp}=await import('../lib/consult/ui/ops.ts');
 const {nextBatch,applyReceipt}=await import('../lib/consult/queue.ts');
 for(const mode of ['skipped','answered']){
  let q=emptyQueue(1,1),base={rev:1,fields:{},instances:{}};
  const device='11111111-1111-4111-8111-111111111111',instance='22222222-2222-4222-8222-222222222222';
  if(mode==='skipped'){
   const draft={skips:Object.fromEntries(Array.from({length:603},(_,i)=>[instance+':field_'+i,{reason:'Other',note:'x'.repeat(500)}]))};
   for(const patch of decisionPatches({},draft)){q=enqueue(q,await decisionsOp(q,device,base,patch),{});base.rev++;}
  }else for(let i=0;i<603;i++)q=enqueue(q,await answerOp(q,device,base,instance,'field_'+i,{status:'answered',value:'x'.repeat(500)}),{});
  let largest=0;
  while(nextBatch(q,Date.now()).length){
   const ops=nextBatch(q,Date.now());
   largest=Math.max(largest,Buffer.byteLength(JSON.stringify({command:'ops',input:{nonce:device,ops}})));
   for(const op of ops)q=applyReceipt(q,{id:op.client_event_id,status:200},Date.now());
  }
  console.log('R11 603-field '+mode+' largest request bytes='+largest);assert.ok(largest<262144);
 }
});

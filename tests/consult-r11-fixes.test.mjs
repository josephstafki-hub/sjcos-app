import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {withTestDb} from './_harness/testdb.mjs';
import {fixture} from './_harness/consult.mjs';
import * as protocol from '../lib/consult/protocol.ts';
import {parseConsultRequest} from '../lib/consult/transport.ts';
import {evidencePatches,mergeEvidence} from '../lib/consult/evidence-chunks.ts';
import {officeCloseFailure,CLOSE_ERROR_ACTIONS} from '../lib/consult/close-errors.ts';
import {redeliveryWindow} from '../lib/consult/rrp.ts';
import {approvedFormContent} from '../lib/consult/forms/approved-content.ts';

test('QA walk first evidence preserves required nulls through real POST then closes',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);await f.send([f.op()]);await f.save();
 const require=createRequire(import.meta.url),exports={};
 const source=ts.transpileModule(readFileSync('app/api/consult/[id]/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','exports',source)((name)=>name==='@/lib/db'?{pool:{connect:async()=>new Proxy(c,{get(t,k){return k==='release'?()=>{}:typeof t[k]==='function'?t[k].bind(t):t[k];}})}}:name==='@/lib/session'?{readSession:async()=>({authAt:Date.now()/1000})}:name==='@/lib/dal'?{getCurrentUser:async()=>({id:f.staff,role:'staff',permissions:['projects']}),can:()=>true}:name==='@/lib/consult/protocol'?protocol:name==='@/lib/consult/transport'?{parseConsultRequest}:require(name),exports);
 const post=async(command,input)=>exports.POST(new Request(`http://consult.test/api/consult/${f.consult}`,{method:'POST',headers:{origin:'http://consult.test','content-type':'application/json','x-consult-csrf':'1'},body:JSON.stringify({command,input})}),{params:Promise.resolve({id:f.consult})});
 await c.query('DELETE FROM consult_close_evidence WHERE consult_id=$1',[f.consult]);
 const walk={...f.evidence,ack_reason:null,promised_date:null,touched_trades:['Plumber','Electrician','HVAC'],no_trades_confirmed:false,rrp:{receipt:false,firm_current:false,renovator_current:true,redelivery_required:false}};
 let baseline=null;
 for(const patch of evidencePatches(baseline,walk)){
  const r=await post('evidence',{map_patch:true,device:f.device,epoch:1,expected_revision:await f.revision(),baseline_hash:protocol.hash(baseline),evidence:patch});assert.equal(r.status,200,await r.clone().text());baseline=mergeEvidence(baseline,patch);
 }
 const closed=await f.close();assert.equal(typeof closed.complete,'boolean');
 const bad=await post('evidence',{device:f.device,epoch:1,expected_revision:await f.revision(),evidence:{rrp:{}}});assert.equal(bad.status,422);assert.ok((await bad.json()).details.some(x=>x.field.startsWith('evidence.rrp.')));
}));
test('office titles never expose codes and counsel records six lines',()=>{
 for(const code of [...Object.keys(CLOSE_ERROR_ACTIONS),'http_503','unknown_code'])assert.doesNotMatch(officeCloseFailure(code),/_|http_/);
 assert.equal((approvedFormContent.match(/Changed after counsel’s approval/g)??[]).length,6);
 assert.deepEqual(redeliveryWindow('2027-02-01'),{min:'2026-12-03',max:'2027-01-25'});
});
test('large evidence chunks merge exactly, including deletion and retry prefixes',()=>{
 const after={photos_ok:false,manual_confirmed:true,handed_back:true,ack_reason:null,promised_date:null,no_trades_confirmed:false,touched_trades:[],trade_walks:[],rrp:{receipt:false,firm_current:false,renovator_current:true,redelivery_required:false},skips:Object.fromEntries(Array.from({length:3000},(_,i)=>['field'+i,{reason:'Other',note:'x'.repeat(500)}])),flags:{}};
 let value=null,largest=0;
 for(const patch of evidencePatches(value,after)){largest=Math.max(largest,Buffer.byteLength(JSON.stringify({command:'evidence',input:{device:'x'.repeat(36),epoch:1,expected_revision:999999,generation:1,baseline_hash:'x'.repeat(64),evidence:patch}})));value=mergeEvidence(value,patch);protocol.evidenceSchema.parse(value);}
 assert.deepEqual(value,after);assert.ok(largest<=65536);console.log('R11 evidence largest request bytes='+largest);
 assert.deepEqual(evidencePatches(value,after).reduce(mergeEvidence,value),after);
});

test('every template with all add-ons: fully answered and fully skipped 500-character transport',async()=>{
 const {templates,addOns,seedModules}=await import('../lib/consult/forms/seed.ts');
 const {emptyQueue,enqueue,nextBatch,applyReceipt}=await import('../lib/consult/queue.ts');
 const {answerOp,decisionsOp,decisionPatches}=await import('../lib/consult/ui/ops.ts');
 const device='11111111-1111-4111-8111-111111111111',instance='22222222-2222-4222-8222-222222222222';
 let largest=0;
 for(const template of templates)for(const mode of ['answered','skipped']){
  // Include optional and conditional modules too, plus all child modules. Repeated
  // rows use at least the template minimum, so the probe exceeds the default visit.
  const slots=[...template.modules,...addOns.flatMap(t=>t.modules)];
  const counts=new Map(slots.map(s=>[s.module,Math.max(1,s.min??1)]));
  const modules=seedModules.filter(m=>counts.has(m.key)||m.parent_module);
  const fields=modules.flatMap(m=>Array.from({length:counts.get(m.key)??1},(_,n)=>[...m.fields.map(f=>`${m.key}_${n}_${f.key}`),...m.shots.map(f=>`${m.key}_${n}_${f.key}`)]).flat());
  let q=emptyQueue(1,1);const base={rev:1,fields:{},instances:{}};
  const skips=Object.fromEntries(fields.map(key=>[instance+':'+key,{reason:'Other',note:'x'.repeat(500)}]));
  if(mode==='skipped')for(const patch of decisionPatches({}, {skips}))q=enqueue(q,await decisionsOp(q,device,base,patch),{});
  else for(const key of fields)q=enqueue(q,await answerOp(q,device,base,instance,key,{status:'answered',value:'x'.repeat(500)}),{});
  while(nextBatch(q,Date.now()).length){const ops=nextBatch(q,Date.now());largest=Math.max(largest,Buffer.byteLength(JSON.stringify({command:'ops',input:{nonce:device,ops}})));for(const op of ops)q=applyReceipt(q,{id:op.client_event_id,status:200},Date.now());}
  assert.ok(q.entries.every(e=>e.status==='accepted'));
  const evidence={photos_ok:false,manual_confirmed:true,handed_back:true,ack_reason:null,promised_date:null,no_trades_confirmed:true,touched_trades:[],trade_walks:[],rrp:{receipt:false,firm_current:false,renovator_current:false,redelivery_required:false},skips:mode==='skipped'?skips:{},flags:{}};
  for(const patch of evidencePatches(null,evidence))largest=Math.max(largest,Buffer.byteLength(JSON.stringify({command:'evidence',input:{device,epoch:1,expected_revision:999999,generation:1,baseline_hash:'a'.repeat(64),evidence:patch}})));
  console.log(`R11 template=${template.key} mode=${mode} fields=${fields.length}`);
 }
 console.log('R11 exhaustive largest single request bytes='+largest);assert.ok(largest<=65536);
});

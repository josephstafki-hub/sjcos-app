import {OfflineEngine} from '../lib/consult/offline-engine.ts';
import {VisitController} from '../lib/consult/ui/controller.ts';
import {emptyDraft} from '../lib/consult/ui/model.ts';
import {decisionPatches,decisionsOp} from '../lib/consult/ui/ops.ts';
import {emptyQueue,enqueue,nextBatch,applyReceipt} from '../lib/consult/queue.ts';
import {baselineOf} from '../lib/consult/ui/model.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {withTestDb} from './_harness/testdb.mjs';
import {fixture} from './_harness/consult.mjs';
import * as protocol from '../lib/consult/protocol.ts';
import {parseConsultRequest} from '../lib/consult/transport.ts';
import {CLOSE_ERROR_ACTIONS} from '../lib/consult/close-errors.ts';
import {sectionCounts,openItemCount} from '../lib/consult/completeness.ts';
import {certificationWarnings} from '../lib/consult/rrp.ts';

test('every explicit close and device-gate refusal has a UI action',()=>{
 const src=readFileSync('lib/consult/protocol.ts','utf8');
 for(const part of [src.slice(src.indexOf('async function deviceGate'),src.indexOf('async function deviceGate')+650),src.slice(src.indexOf('export async function close('),src.indexOf('export async function close(')+4500)])
 for(const [,code] of part.matchAll(/throw new Error\('([^']+)'\)/g))assert.ok(CLOSE_ERROR_ACTIONS[code],code);
 assert.equal(CLOSE_ERROR_ACTIONS.evidence_too_large,'keep_working'); // r11 R11-1: only shortening notes helps — Keep working alone
});
test('shared section and wrap counts include record and close checks',()=>{
 const section={pc:{done:0,total:26},record:{done:0,total:1}};
 assert.deepEqual(sectionCounts(section),{done:0,total:27});
 assert.equal(openItemCount({price_critical:{done:27,total:27},record:{done:1,total:1}},1),1);
});
test('warnings carry who, dates and field address only when RRP applies',()=>{
 const v={'era.before_1978':true,'era.disturbs_paint':true,'era.renovator_name':'Dana','era.renovator_expiry':'2027-03-01'};
 const [w]=certificationWarnings(v,'2027-06-30');assert.equal(w.who,'Dana');assert.equal(w.field_address,'era.renovator_expiry');assert.equal(w.planned_finish,'2027-06-30');assert.match(w.message,/Mar 1, 2027/);
 assert.deepEqual(certificationWarnings({...v,'era.disturbs_paint':false},'2027-06-30'),[]);
});
test('real POST handler accepts production sized reopened evidence and closes Complete',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);await f.send([f.op()]);
 const skips=Object.fromEntries(Array.from({length:603},(_,i)=>[`${f.instance}:seed_${i}`,{reason:'Other',note:'Seed-sized retained exclusion '+i,assumption:{text:'Retained full visit allowance with documented scope and verification',responsible_trade:'Carpenter',verification_point:'Before ordering materials and starting this work',adjustment_route:'precon_change',quantity:1,unit:'ea',exclusion:null}}]));
 const evidence={...f.evidence,skips};await f.save(evidence);assert.equal((await f.close()).complete,true);
 await f.run('reopen',{expected_revision:await f.revision(),reason:'Client additions'},f.owner);
 await c.query('UPDATE consult_devices SET revoked_at=now() WHERE consult_id=$1',[f.consult]);
 await c.query("INSERT INTO consult_events(consult_id,event_id,actor,source,type,payload,payload_hash,server_revision,generation) SELECT $1,$2,$3,'office','missing_device_exception',jsonb_build_object('devices',(SELECT jsonb_agg(jsonb_build_object('device_id',device_id,'epoch',epoch)) FROM consult_devices WHERE consult_id=$1)),$4,0,1",[f.consult,randomUUID(),f.owner,'0'.repeat(64)]);
 const device=randomUUID();await c.query('INSERT INTO consult_devices(consult_id,device_id,user_id,epoch) VALUES($1,$2,$3,1)',[f.consult,device,f.staff]);
 const s=await protocol.snapshot(c,f.context('read'),f.consult);
 // Execute the production route with authenticated harness dependencies; no server or live DB.
 const require=createRequire(import.meta.url),exports={};
 const source=ts.transpileModule(readFileSync('app/api/consult/[id]/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','exports',source)((name)=>name==='@/lib/db'?{pool:{connect:async()=>new Proxy(c,{get(t,k){return k==='release'?()=>{}:typeof t[k]==='function'?t[k].bind(t):t[k];}})}}:name==='@/lib/session'?{readSession:async()=>({authAt:Date.now()/1000})}:name==='@/lib/dal'?{getCurrentUser:async()=>({id:f.staff,role:'staff',permissions:['projects']}),can:()=>true}:name==='@/lib/consult/protocol'?protocol:name==='@/lib/consult/transport'?{parseConsultRequest}:require(name),exports);
 const post=async(command,input)=>exports.POST(new Request(`http://consult.test/api/consult/${f.consult}`,{method:'POST',headers:{origin:'http://consult.test','content-type':'application/json','x-consult-csrf':'1'},body:JSON.stringify({command,input})}),{params:Promise.resolve({id:f.consult})});
 // Real queue transport for the retained 603-decision draft, including 500-character notes.
 const draft=Object.fromEntries(Object.entries(evidence).filter(([key])=>key in protocol.decisionSchema.shape));
 draft.skips=Object.fromEntries(Object.entries(skips).map(([key,value])=>[key,{...value,note:'x'.repeat(500)}]));
 const identity={user_id:f.staff,session_epoch:1,build:'test',consult_id:f.consult};
 let durable=null,version=0;
 const store={load:async()=>durable,save:async(_i,_l,_k,_v,value)=>{durable={revision:++version,value:structuredClone(value)};return version;},preflight:async()=>{}};
 const engine=new OfflineEngine(identity,store);
 await engine.unlock({},{...identity,device_id:device,issued_at:Date.now(),expires_at:Date.now()+3600000});
 await engine.prepare({snapshot:s,queue:emptyQueue(Number(s.consult.completion_generation),1),blobs:[],last_send:null});
 const ctl=new VisitController(null,f.consult);ctl.engine=engine;
 Object.assign(ctl.state,{device,local:engine.read(),draft:emptyDraft()});
 assert.equal(await ctl.setDraft(draft),true);
 clearTimeout(ctl.timer);engine.lock();await engine.unlock({},{...identity,device_id:device,issued_at:Date.now(),expires_at:Date.now()+3600000});
 let queue=engine.read().queue;
 let largest=0;
 while(nextBatch(queue,Date.now()).length){
  const ops=nextBatch(queue,Date.now()),input={nonce:randomUUID(),ops};
  largest=Math.max(largest,Buffer.byteLength(JSON.stringify({command:'ops',input})));
  const response=await post('ops',input);assert.equal(response.status,200,await response.clone().text());
  const body=await response.json();
  for(const receipt of body)queue=applyReceipt(queue,receipt,Date.now());
 }
 console.log('R11 largest 603-skip ops request='+largest);assert.ok(largest<262144);
 assert.deepEqual((await protocol.snapshot(c,f.context('read'),f.consult)).decisions,draft);
 s.consult.revision=await f.revision();
 const input={device,epoch:1,expected_revision:Number(s.consult.revision),generation:Number(s.consult.completion_generation),baseline_hash:s.close_evidence_hash,evidence:{}};
 const before=Buffer.byteLength(JSON.stringify({command:'evidence',input:{...input,baseline:evidence,evidence}})),after=Buffer.byteLength(JSON.stringify({command:'evidence',input}));
 console.log(`R10 payload before=${before} after=${after} evidence=${Buffer.byteLength(JSON.stringify(evidence))}`);assert.ok(before>262144);
 let response=await post('evidence',input);assert.equal(response.status,200,await response.clone().text());
 response=await post('evidence',{...input,baseline_hash:'0'.repeat(64),evidence:{skips:{}}});assert.equal((await response.json()).error_code,'stale_snapshot');
 const patch={...input,evidence:{skips:{...skips,[f.instance+':seed_0']:{...skips[f.instance+':seed_0'],note:'Changed on fresh device'}}}};
 console.log(`R10 changed evidence payload=${Buffer.byteLength(JSON.stringify({command:'evidence',input:patch}))}`);
 response=await post('evidence',patch);assert.equal(response.status,200,await response.clone().text());
 response=await post('close',{expected_revision:await f.revision(),manifest:{device,epoch:1,last_seq:queue.next_seq-1,required_blob_hashes:[],initials_hash:null,local_pending:0}});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).complete,true);
 response=await post('evidence',{...input,evidence:{skips:{huge:'x'.repeat(2*1024*1024)}}});assert.equal(response.status,413);assert.equal((await response.json()).error_code,'evidence_too_large');
},{fresh:true}));

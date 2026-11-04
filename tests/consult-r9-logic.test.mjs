import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withTestDb} from './_harness/testdb.mjs';
import {fixture} from './_harness/consult.mjs';
import {snapshot,completion,publish} from '../lib/consult/protocol.ts';
import {conflictSideLabel} from '../lib/consult/ui/words.ts';
import {buildModel,emptyDraft} from '../lib/consult/ui/model.ts';
import {rrpFacts} from '../lib/consult/rrp.ts';

test('equal and submillisecond conflict times use revision or neutral labels',()=>{
 for(const at of ['2026-11-03T21:52:01Z','2026-11-03T21:52:01.000001Z']){
 const a={person:'Abigail',actor:'a',device_id:'a',created_at:at,server_revision:'2'},b={...a,device_id:'b',server_revision:'3'};
 assert.match(conflictSideLabel(a,b),/earlier/);assert.match(conflictSideLabel(b,a),/later/);
 assert.doesNotMatch(conflictSideLabel({...a,server_revision:undefined},{...b,server_revision:undefined}),/earlier|later/);
 }
});

test('seeded evidence survives completion, repeated reopen and fresh-device handoff; stale close refused',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);
 const assumption={text:'Allowance',responsible_trade:'Carpenter',verification_point:'Before order',adjustment_route:'precon_change',quantity:1,unit:'ea',exclusion:null};
 await f.send([f.op('answer',{status:'skipped',unit:'in',skip_reason:'No access',skip_note:'Locked room'})]);
 const evidence={...f.evidence,skips:{[f.instance+':length']:{reason:'No access',note:'Locked room',assumption},[f.instance+':shot:room']:{reason:'Client declined'}}};
 await f.save(evidence);const before=(await completion(c,f.context('read'),f.consult)).result;
 const initial=await f.close();assert.equal(initial.complete,true);
 const original=(await c.query('SELECT * FROM consult_close_evidence WHERE consult_id=$1',[f.consult])).rows[0];
 for(let n=0;n<2;n++){
 await f.run('reopen',{expected_revision:await f.revision(),reason:'Review'},f.owner);
 const s=await snapshot(c,f.context('read'),f.consult);
 assert.deepEqual(s.decisions.skips,evidence.skips);
 await assert.rejects(f.run('evidence',{device:f.device,epoch:1,expected_revision:await f.revision(),generation:1,baseline:evidence,evidence}),n===0?/rebase_required/:/device_access_denied/);assert.deepEqual(s.close_evidence,evidence);
 await c.query('UPDATE consult_devices SET revoked_at=now() WHERE consult_id=$1',[f.consult]);
 await c.query("INSERT INTO consult_events(consult_id,event_id,actor,source,type,payload,payload_hash,server_revision,generation) SELECT $1,$2,$3,'office','missing_device_exception',jsonb_build_object('devices',(SELECT jsonb_agg(jsonb_build_object('device_id',device_id,'epoch',epoch)) FROM consult_devices WHERE consult_id=$1)),$4,0,1",[f.consult,randomUUID(),f.owner,'0'.repeat(64)]);
 const device=randomUUID();await c.query('INSERT INTO consult_devices(consult_id,device_id,user_id,epoch) VALUES($1,$2,$3,1)',[f.consult,device,f.staff]);
 await assert.rejects(f.run('evidence',{device,epoch:1,expected_revision:await f.revision(),evidence:{...evidence,skips:{}}}),/evidence_conflict/);
 await f.run('evidence',{device,epoch:1,expected_revision:await f.revision(),baseline:s.close_evidence,evidence:s.close_evidence});
 const closed=await f.run('close',{expected_revision:await f.revision(),manifest:{device,epoch:1,last_seq:0,required_blob_hashes:[],initials_hash:null,local_pending:0}});
 assert.equal(closed.complete,true);assert.deepEqual(closed.checks,initial.checks);
 assert.deepEqual((await c.query('SELECT * FROM consult_close_evidence WHERE consult_id=$1',[f.consult])).rows[0],original);
 }
 await f.run('reopen',{expected_revision:await f.revision(),reason:'Edit'},f.owner);
 await c.query('UPDATE consult_devices SET revoked_at=now() WHERE consult_id=$1',[f.consult]);
 await c.query('UPDATE consult_devices SET revoked_at=NULL WHERE consult_id=$1 AND device_id=$2',[f.consult,f.device]);
 const current=await snapshot(c,f.context('read'),f.consult);
 const head=current.heads.find(h=>h.instance_id===f.instance&&h.field_key==='length');
 const cleared=await f.send([f.op('clear',{status:'cleared',unit:'in'},Number(head.server_revision),{instance_id:f.instance,field_key:'length'},Number(current.consult.completion_generation))]);
 assert.equal(cleared[0].status,200);
 await f.save({...evidence,skips:{}});
 assert.equal((await snapshot(c,f.context('read'),f.consult)).heads.find(h=>h.instance_id===f.instance&&h.field_key==='length').status,'cleared');
 await assert.rejects(f.run('evidence',{device:f.device,epoch:1,expected_revision:await f.revision(),baseline:evidence,evidence}),/evidence_conflict/);
},{fresh:true}));

test('offline model evaluates certifications against refreshed project start like server',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);await f.send([f.op()]);await f.save();
 const definition={key:'era',version:1,title:'Era',repeatable:false,say:[],fields:[...['firm_cert_expiry','renovator_expiry'].map(key=>({key,label:key,type:'date',required:false,tier:'record'})),...['before_1978','pamphlet_given'].map(key=>({key,label:key,type:'yesno',required:false,tier:'record'}))],shots:[],coverage:[]};
 const form=(await c.query("INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES('module','era',1,$1,'',$2) RETURNING id",[definition,f.owner])).rows[0].id;
 await publish(c,f.context('publish_form',f.owner,null),{form_id:form,registry_id:f.registry});
 await c.query('INSERT INTO consult_form_pins SELECT $1,id,kind,key,version,checksum FROM consult_form_versions WHERE id=$2',[f.consult,form]);
 const era=randomUUID();await f.send([f.op('create_instance',{},await f.revision(),{instance_id:era,module_key:'era',label:'Era'})]);
 for(const field_key of ['firm_cert_expiry','renovator_expiry'])await f.send([f.op('answer',{status:'answered',value:'2027-03-07'},0,{instance_id:era,field_key})]);
 await f.send([f.op('answer',{status:'answered',value:true},0,{instance_id:era,field_key:'before_1978'})]);
 await f.send([f.op('answer',{status:'skipped',skip_reason:'Client declined',skip_note:'Client declined receipt'},0,{instance_id:era,field_key:'pamphlet_given'})]);
 await f.save({...f.evidence,skips:{[era+':pamphlet_given']:{reason:'Client declined',note:'Client declined receipt'}}});
 for(const start of [null,'2027-03-10']){
 await c.query('UPDATE projects SET start_date=$2 WHERE id=$1',[f.project,start]);
 const s=await snapshot(c,f.context('read'),f.consult);
 assert.equal(s.prefill.start_date,start);
 const model=buildModel(s,[],[],s.decisions);
 assert.equal(model.rrp.firm_current,start===null);assert.equal(model.rrp.renovator_current,start===null);
 assert.deepEqual({...model.rrp,receipt:false},rrpFacts(model.values,false,String(s.consult.scheduled_at),start));
 assert.equal((await completion(c,f.context('read'),f.consult)).result.checks.find(x=>x.check===8).open.length,start===null?0:1);
 assert.equal((await completion(c,f.context('read'),f.consult)).result.complete,false); // no device manifest
 }
},{fresh:true}));

test('same-generation decisions reject stale concurrent device baselines',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c); const revision=await f.revision();const draft=emptyDraft();
 assert.equal((await f.send([f.op('decisions',draft,revision,null)]))[0].status,200);
 assert.equal((await f.send([f.op('decisions',{...draft,ack_reason:'Stale'},revision,null)]))[0].error_code,'conflict');
 assert.deepEqual((await snapshot(c,f.context('read'),f.consult)).decisions,draft);
},{fresh:true}));

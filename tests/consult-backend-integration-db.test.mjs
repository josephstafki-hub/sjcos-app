import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withTestDb,assertNotProduction} from './_harness/testdb.mjs';
import {fixture} from './_harness/consult.mjs';
import {snapshot,schedule,publish} from '../lib/consult/protocol.ts';
import {emptyQueue} from '../lib/consult/queue.ts';

test('prepared device resumes server sequence; decisions have durable idempotent receipts without an answer',async()=>withTestDb(async(url,c)=>{
 assertNotProduction(url);const f=await fixture(c);
 const draft={skips:{[`${f.instance}:shot:room`]:{reason:'Client declined'}},flags:{[`${f.instance}:length`]:{disposition:'price_it',note:'Include repair'}},trade_walks:[{trade:'HVAC',needed:true,reason:'Check vent'}],no_trades_confirmed:false,rrp:{receipt:true,firm_current:false,renovator_current:false,redelivery_required:false},ack_reason:null};
 const prepared=await f.run('prepare_device',{device:f.device,expected_revision:await f.revision()});assert.equal(prepared.last_ack_seq,1);
 const q=emptyQueue(prepared.generation,prepared.epoch,0,prepared.last_ack_seq);
 const op={...f.op('decisions',draft,await f.revision(),null),seq:q.next_seq};
 const receipts=await f.send([op]);assert.equal(receipts[0].status,200);assert.deepEqual(await f.send([op]),receipts);
 assert.equal((await c.query('SELECT count(*)::int n FROM consult_answers')).rows[0].n,0);
 assert.deepEqual((await snapshot(c,f.context('read'),f.consult)).decisions,draft);
 assert.equal((await f.run('prepare_device',{device:f.device,expected_revision:await f.revision()})).last_ack_seq,2);
 await assert.rejects(f.run('prepare_device',{device:f.device,expected_revision:await f.revision()},f.other),/access denied/);
},{fresh:true}));

test('schedule notes and refreshed prefill are assignment scoped with rough prices hidden',async()=>withTestDb(async(url,c)=>{
 assertNotProduction(url);const f=await fixture(c),lead=randomUUID();
 await c.query("INSERT INTO leads(id,slug,name,phone,address) VALUES($1,$2,'Client','555-1234','Job address')",[lead,lead]);
 await c.query('UPDATE projects SET lead_id=$2 WHERE id=$1',[f.project,lead]);
 await c.query("INSERT INTO lead_intake(lead_id,question,answer) VALUES($1,'Year built','1960')",[lead]);
 await c.query("INSERT INTO lead_estimates(lead_id,line_items) VALUES($1,$2)",[lead,JSON.stringify([{label:'Cabinets',value:'$10,000',secret:'never'}])]);
 await c.query("INSERT INTO scope_items(project_id,key,title,quantities) VALUES($1,'room','Room',$2)",[f.project,JSON.stringify([{label:'Area',qty:null,unit:'sf',cost_cents:10000}])]);
 await c.query("INSERT INTO calls(direction,counterparty_number,business_number,project_id,notes,notes_status,transcript) VALUES('inbound','555','555',$1,$2,'done','private transcript')",[f.project,{summary:'Discussed cabinets',private:'never'}]);
 const {id}=await schedule(c,f.context('schedule',f.owner,null),{project:f.project,visitor:f.staff,visit_time:'2026-12-01T09:00:00Z',forms:f.forms,visitor_notes:'Use side door'});
 const read=()=>snapshot(c,f.context('read',f.staff,id),id);const s=await read();
 assert.equal(s.visitor_notes,'Use side door');assert.equal(s.display.client,'Client');assert.equal(s.display.address,'Job address');assert.equal(s.display.phone,'555-1234');assert.equal(s.prefill.year_built,'1960');assert.deepEqual(s.prefill.rough_estimate,[{label:'Cabinets'}]);assert.deepEqual(s.prefill.scope_items[0].quantities,[{label:'Area',qty:null,unit:'sf'}]);assert.deepEqual(s.prefill.discovery_notes,[{summary:'Discussed cabinets'}]);assert.ok(!JSON.stringify(s).includes('private transcript'));
 assert.deepEqual((await snapshot(c,f.context('read',f.owner,id),id)).prefill.rough_estimate,[{label:'Cabinets',value:'$10,000'}]);
 await c.query("UPDATE lead_intake SET answer='1950' WHERE lead_id=$1",[lead]);assert.equal((await read()).prefill.year_built,'1950');
 await assert.rejects(snapshot(c,f.context('read',f.other,id),id),/access denied/);
 await f.run('assign',{visitor:f.other,expected_revision:await f.revision(),missing_device_reason:'Original device unavailable; Joe accepts missing work'},f.owner);
 await assert.rejects(snapshot(c,f.context('read'),f.consult),/access denied/);
},{fresh:true}));

test('exact signature fields require committed media; pamphlet initials cannot acknowledge walk-through; close covers both',async()=>withTestDb(async(url,c)=>{
 assertNotProduction(url);const f=await fixture(c);await f.send([f.op()]);
 const instances={};
 for(const [key,field] of [['closing','client_initials'],['era','pamphlet_initials']]){
  const def={key,version:1,title:key,repeatable:false,say:[],fields:[{key:field,label:field,type:'signature',required:true,tier:'record'}],shots:[],coverage:[{key:'signed',text:'Signed',satisfied_by:[field]}]};
  const form=(await c.query("INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES('module',$1,1,$2,'',$3) RETURNING id",[key,def,f.owner])).rows[0].id;
  await publish(c,f.context('publish_form',f.owner,null),{form_id:form,registry_id:f.registry});
  await c.query('INSERT INTO consult_form_pins SELECT $1,id,kind,key,version,checksum FROM consult_form_versions WHERE id=$2',[f.consult,form]);
  instances[key]=randomUUID();await f.send([f.op('create_instance',{},await f.revision(),{instance_id:instances[key],module_key:key,label:key})]);
 }
 const addMedia=async(key,field,hash)=>{const event=randomUUID(),file=randomUUID();
  await c.query("INSERT INTO consult_events(consult_id,event_id,actor,source,type,payload,payload_hash,server_revision,generation) VALUES($1,$2,$3,'typed','media','{}',$4,0,1)",[f.consult,event,f.staff,'0'.repeat(64)]);
  await c.query("INSERT INTO files(id,name,type) VALUES($1,'Initials','img')",[file]);
  await c.query("INSERT INTO consult_uploads(id,consult_id,actor,device_id,device_epoch,event_id,kind,mime,size_bytes,sha256,epoch,expires_at,status,file_id,commit_receipt,instance_id,field_key,generation) VALUES($1,$2,$3,$4,1,$5,'initials','image/png',1,$6,1,now()+interval '1 day','committed',$7,$8,$9,$10,1)",[randomUUID(),f.consult,f.staff,f.device,event,hash,file,{file_id:file},instances[key],field]);
  await c.query("INSERT INTO consult_media(id,consult_id,instance_id,field_key,kind,file_id,sha256,taken_at,actor,event_id) VALUES($1,$2,$3,$4,'initials',$5,$6,now(),$7,$8)",[randomUUID(),f.consult,instances[key],field,file,hash,f.staff,event]);};
 await addMedia('era','pamphlet_initials','a'.repeat(64));await f.save({...f.evidence,ack_reason:null});
 const missing=await f.close({initials_hash:'a'.repeat(64)});assert.equal(missing.complete,false);assert.ok(missing.checks.some(x=>x.check===5&&x.open.length));
 await addMedia('closing','client_initials','b'.repeat(64));
 await assert.rejects(f.close({initials_hash:'b'.repeat(64)}),/manifest_blob_missing/);
 const manifest={initials_hash:null,initials_hashes:['a'.repeat(64),'b'.repeat(64)]};
 const closed=await f.close(manifest);assert.equal(closed.complete,true);assert.deepEqual(await f.close(manifest),closed);
},{fresh:true}));

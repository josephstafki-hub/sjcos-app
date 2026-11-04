import {randomUUID,createHmac} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {withTestDb} from './_harness/testdb.mjs';
import {seedQaConsult} from '../scripts/qa-seed-consult.mjs';
import {completion,snapshot,command,hash} from '../lib/consult/protocol.ts';
import {buildModel,emptyDraft} from '../lib/consult/ui/model.ts';
import {seedModules} from '../lib/consult/forms/seed.ts';
import {evaluatedFlags} from '../lib/consult/flags.ts';
test('flags require every input, including negated and OR inputs',()=>{
 const f={key:'x',required:true,flags:[{when:{not:{field:'x',op:'eq',value:12}},issue:'test'}]};
 assert.equal(evaluatedFlags(f,'i:x',{}).length,0);
 assert.equal(evaluatedFlags(f,'i:x',{x:20}).length,1);
});
test('QA seed closes Complete and creates a real two-device conflict; blank/20 inch flags agree',async()=>withTestDb(async(url,c)=>{
 const owner=randomUUID(),staff=randomUUID(),project=randomUUID();
 await c.query("INSERT INTO users(id,email,password_hash,name,role,permissions) VALUES($1,$3,'x','Owner','owner','{}'),($2,$4,'x','Staff','staff','{projects}')",[owner,staff,`${owner}@test`,`${staff}@test`]);
 await c.query("INSERT INTO projects(id,slug,name) VALUES($1,$2,'QA')",[project,project]);
 await c.query("UPDATE app_settings SET value='true' WHERE key='consult_capture'");
 const f={project,staff,context:()=>{throw Error('replace context');}};const root=await mkdtemp(`${tmpdir()}/consult-r6-`);
 try {
 
 const index=await seedQaConsult(c,f.project,{uploadRoot:root,skipEstimateDate:true});
 assert.equal(index.visits[0].result.complete,true);
 const promise=(await c.query("SELECT title,due_at FROM work_items WHERE source_id=$1",[`${index.visits[0].id}:promise:estimate`])).rows[0];assert.match(promise.title,/Set the formal estimate date/);assert.equal(promise.due_at,null);
 assert.equal(index.visits[1].devices.length,2);
 const id=index.visits[1].id;
 const key=(await c.query('SELECT * FROM consult_context_keys WHERE revoked_at IS NULL LIMIT 1')).rows[0];
 f.context=(operation,sub,id)=>{const payload=JSON.stringify({kind:'in_home_consult',sub,role:'staff',areas:['projects'],mode:'person',operation,consult_id:id,iat:Date.now()/1000,exp:Date.now()/1000+120,run_id:randomUUID(),nonce:randomUUID()});return {key_id:key.key_id,payload,signature:createHmac('sha256',key.secret).update(payload).digest('hex')};};
 const s=await snapshot(c,f.context('read',f.staff,id),id);
 assert.ok(s.conflicts.length);
 assert.ok(s.conflicts[0].current.source_label);assert.ok(s.conflicts[0].proposed.value!==undefined);
 const repeated=await seedQaConsult(c,f.project,{uploadRoot:root,skipEstimateDate:true});
 assert.deepEqual(repeated.visits.map(v=>v.id),index.visits.map(v=>v.id));
 const closing=s.instances.find(i=>i.module_key==='closing');
 await c.query('SAVEPOINT summary_guard');
 await assert.rejects(c.query('SELECT consult_capture_answer($1,$2,$3,1,$4,$5)',[f.context('capture_answer',staff,id),id,index.visits[1].devices[1],randomUUID(),{instance_id:closing.id,field_key:'summary',status:'answered',value:'bypass',generation:1}]),/summary_read_only/);
 await c.query('ROLLBACK TO SAVEPOINT summary_guard');

 // Same pinned Bath + Kitchen definitions, evaluated through both production paths.
 const blank={...s,heads:s.heads.filter(h=>h.field_key==='templates'),conflicts:[]};
 assert.equal(buildModel(blank,[],[],emptyDraft()).flags.length,0);
 // Clear seed answers via test isolation only; evaluation remains the server completion function.
 await c.query('DELETE FROM consult_field_heads WHERE consult_id=$1',[id]);
 let server=await completion(c,f.context('read',f.staff,id),id);
 assert.equal(server.result.checks.find(x=>x.code==='flag_decisions').open.length,0);
 const device=index.visits[1].devices[1];
 const bath=s.instances.find(i=>i.module_key==='bath_scope');
 const def=seedModules.find(m=>m.key==='bath_scope').fields.find(f=>f.key==='toilet_plan');
 for(const [n,field_key,value,unit] of [[2,'toilet_plan',def.options[0],undefined],[3,'toilet_front_clearance',20,'in']]){
 const payload={status:'answered',value,...(unit?{unit}:{})},nonce=randomUUID(),context=f.context('ops',staff,id);
 const claims=JSON.parse(context.payload);claims.nonce=nonce;context.payload=JSON.stringify(claims);context.signature=createHmac('sha256',key.secret).update(context.payload).digest('hex');
 await command(c,context,id,'ops',{nonce,ops:[{protocol_version:1,client_event_id:randomUUID(),device_id:device,device_epoch:1,seq:n,base_revision:0,generation:1,type:'answer',target:{instance_id:bath.id,field_key},payload,payload_sha256:hash(payload)}]});
 }
 const measured=await snapshot(c,f.context('read',staff,id),id);
 const deviceFlags=buildModel(measured,[],[],emptyDraft()).flags;
 assert.equal(deviceFlags.length,1);assert.equal(deviceFlags[0].measured[0].value,20);assert.equal(deviceFlags[0].measured[0].unit,'″');assert.equal(deviceFlags[0].address,`${bath.id}:toilet_front_clearance`);
 server=await completion(c,f.context('read',staff,id),id);
 assert.equal(server.result.checks.find(x=>x.code==='flag_decisions').open.length,1);
 assert.equal(server.flags[0].measured[0].value,20);
 assert.equal(server.result.checks.find(x=>x.code==='flag_decisions').open_phrase,'Flags: 1 need a decision');

 }finally{await rm(root,{recursive:true,force:true});}
},{fresh:true}));

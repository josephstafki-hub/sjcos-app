import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withTestDb} from './_harness/testdb.mjs';
import {fixture} from './_harness/consult.mjs';
test('server refuses out-of-range lengths with field path and leaves answer unchanged',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);
 const rows=await f.send([f.op('answer',{status:'answered',value:99999,unit:'in'})]);
 assert.equal(rows[0].status,422);assert.deepEqual(rows[0].details.fields,['room.length']);
 assert.equal((await c.query('SELECT count(*)::int n FROM consult_answers WHERE consult_id=$1',[f.consult])).rows[0].n,0);
},{fresh:true}));
test('staff cannot apply findings',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);
 await assert.rejects(f.run('apply_findings',{expected_generation:1,operation_id:crypto.randomUUID()}),/owner_required/);
},{fresh:true}));

test('realistic QA fixture still closes Complete',async()=>withTestDb(async(_url,c)=>{
 const {seedQaConsult}=await import('../scripts/qa-seed-consult.mjs');
 const {randomUUID}=await import('node:crypto');
 const id=randomUUID();await c.query("INSERT INTO users(email,password_hash,name,role) VALUES($1,'x','Owner','owner')",[id+'@test']);
 await c.query("INSERT INTO projects(id,slug,name) VALUES($1::uuid,$1::text,'QA')",[id]);
 await c.query("UPDATE app_settings SET value='true' WHERE key='consult_capture'");
 const result=await seedQaConsult(c,id,{uploadRoot:'/tmp/consult-r13-blobs',fixtureKey:id});
 assert.equal(result.visits[0].result.complete,true);
 const labels=(await c.query("SELECT label FROM consult_instances WHERE consult_id=$1 AND module_key='selections' ORDER BY label",[result.visits[0].id])).rows.map(r=>r.label);
 assert.equal(labels.length,30);assert.ok(labels.includes('Heated floor thermostat'));assert.ok(labels.includes('Cabinets'));await c.query('ROLLBACK');
},{fresh:true}));

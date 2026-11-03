import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {hash} from '../lib/consult/protocol.ts';
import {withTestDb} from './_harness/testdb.mjs';import {fixture} from './_harness/consult.mjs';
test('batch receipt replay, hash/nonce binding, stale clear/remove, manifest, Complete and generation fence',async()=>{
 await withTestDb(async(_url,c)=>{
  const f=await fixture(c);const a=f.op(),nonce=randomUUID();const accepted=await f.send([a],nonce);
  assert.equal(accepted[0].status,200);
  assert.deepEqual(await f.send([a],nonce),accepted); // lost ack, same batch
  assert.deepEqual(await f.send([a]),accepted); // lost ack, new transport nonce
  await assert.rejects(f.send([{...a,payload:{...a.payload,value:121}}]),/idempotency_mismatch/);
  await assert.rejects(f.send([{...a,seq:10}],nonce),/idempotency_mismatch/);
  const clear=f.op('clear',{status:'cleared',unit:'in'},0);const stale=await f.send([clear]);assert.equal(stale[0].error_code,'conflict');
  const pair=stale[0].conflict;
  const resolve=f.op('resolve',{current_answer_id:pair.current_answer_id,proposed_answer_id:pair.proposed_answer_id,reason:'Measured again; keep measured value',answer:{status:'answered',value:120,unit:'in'}},Number(pair.current.server_revision));
  assert.equal((await f.send([resolve]))[0].status,200);
  const remove=f.op('remove_instance',{},0,{instance_id:f.instance});assert.equal((await f.send([remove]))[0].status,409);
  // Separate fixture for successful close: stale instance removal is a visible,
  // unresolved rejection and deliberately cannot be hidden by a close request.
  await f.save();await assert.rejects(f.close(),/unresolved_rejections/);
  await f.send([f.op('discard_rejection',{event_id:remove.client_event_id,hash:hash(remove),reason:'Keep this room'},0,null)]);
  assert.equal((await f.close()).complete,true);
 },{fresh:true});
 await withTestDb(async(_url,c)=>{
  const f=await fixture(c);await f.send([f.op()]);await f.save();
  await assert.rejects(f.close({last_seq:99}),/manifest_sequence_gap/);
  await assert.rejects(f.close({required_blob_hashes:['0'.repeat(64)]}),/manifest_blob_missing/);
  const closed=await f.close();assert.equal(closed.complete,true);assert.match(closed.digest,/^[a-f0-9]{64}$/);
  assert.deepEqual(await f.close(),closed);
  const locked=f.op('answer',{status:'answered',value:121,unit:'in'},3);await assert.rejects(f.send([locked]),/complete_locked/);
  await f.run('reopen',{expected_revision:await f.revision(),reason:'Correction'});
  const old={...f.op(),seq:locked.seq};assert.equal((await f.send([old]))[0].error_code,'rebase_required');
  assert.equal((await c.query("SELECT count(*) n FROM consult_answers WHERE field_key='length'")).rows[0].n,'1');
 },{fresh:true});
});

test('transaction crash rolls back sequence and receipt; invalid per-op receipt is durable and consciously discarded',async()=>{
 await withTestDb(async(_url,c)=>{
  const f=await fixture(c);const op=f.op(),nonce=randomUUID();
  const {command}=await import('../lib/consult/protocol.ts');
  await c.query('BEGIN');await command(c,f.context('ops',f.staff,f.consult,nonce),f.consult,'ops',{nonce,ops:[op]});await c.query('ROLLBACK');
  assert.equal((await c.query('SELECT count(*) n FROM consult_answers')).rows[0].n,'0');
  assert.equal((await f.send([op],nonce))[0].status,200);
  const invalid=f.op('answer',{status:'answered',value:'bad',unit:'in'},3);
  const rejected=await f.send([invalid]);assert.equal(rejected[0].status,422);assert.deepEqual(await f.send([invalid]),rejected);
  await f.send([f.op('discard_rejection',{event_id:invalid.client_event_id,hash:hash(invalid),reason:'Typo; keep the measured value'},0,null)]);
  await f.save();assert.equal((await f.close()).complete,true);
 },{fresh:true});
});

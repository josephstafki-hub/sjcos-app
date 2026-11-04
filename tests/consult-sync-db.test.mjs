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
  await f.run('reopen',{expected_revision:await f.revision(),reason:'Correction'},f.owner);
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

test('R6 summary is protected and reason + displayed recap commit atomically',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);
 const definition={key:'closing',version:1,title:'Closing',repeatable:false,say:[],fields:[
 {key:'summary',label:'Summary',type:'text',required:false,tier:'record'},
 {key:'client_initials',label:'Initials',type:'signature',required:true,tier:'record'}],shots:[],coverage:[]};
 const form=(await c.query("INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES('module','closing',1,$1,'',$2) RETURNING id",[definition,f.owner])).rows[0].id;
 const {publish}=await import('../lib/consult/protocol.ts');
 const registry=(await c.query('SELECT id FROM consult_mapping_registries LIMIT 1')).rows[0].id;
 await publish(c,f.context('publish_form',f.owner,null),{form_id:form,registry_id:registry});
 await c.query('INSERT INTO consult_form_pins SELECT $1,id,kind,key,version,checksum FROM consult_form_versions WHERE id=$2',[f.consult,form]);
 const id=randomUUID();await f.send([f.op('create_instance',{},await f.revision(),{instance_id:id,module_key:'closing',label:'Closing'})]);
 const denied=await f.send([f.op('answer',{status:'answered',value:'tamper'},0,{instance_id:id,field_key:'summary'})]);
 assert.equal(denied[0].status,422);
 const recap='What we went over\nBathroom measured';
 const r=await f.send([f.op('answer',{status:'skipped',skip_reason:'Client absent',skip_note:'Away today',summary_text:recap},0,{instance_id:id,field_key:'client_initials'})]);assert.equal(r[0].status,200);
 const rows=(await c.query("SELECT field_key,value,skip_reason FROM consult_answers WHERE instance_id=$1 ORDER BY field_key",[id])).rows;
 assert.deepEqual(rows.map(r=>r.field_key),['client_initials','summary']);assert.equal(rows[1].value,recap);assert.equal(rows[0].skip_reason,'Client absent');
 const {initConsultUpload,putConsultPart,commitConsultBlob}=await import('../lib/consult/uploads.ts');
 const sharp=(await import('sharp')).default;
 const {createHash}=await import('node:crypto');
 const {mkdtemp,rm}=await import('node:fs/promises');
 const root=await mkdtemp('/tmp/consult-r6-upload-');
 try{
  const bytes=await sharp({create:{width:4,height:4,channels:4,background:'#000'}}).png().toBuffer();
  const sha=createHash('sha256').update(bytes).digest('hex'),event=randomUUID();
  const u=await initConsultUpload(c,f.context('upload'),f.consult,{event_id:event,device_id:f.device,device_epoch:1,kind:'initials',mime:'image/png',size:bytes.length,sha256:sha,instance_id:id,field_key:'client_initials'});
  await putConsultPart(c,f.context('upload'),f.consult,u.upload_id,0,bytes,sha);
  const input={event_id:event,sha256:sha,summary_text:'Exact text shown with initials'};
  await c.query('BEGIN');
  await commitConsultBlob(c,f.context('upload'),f.consult,u.upload_id,input,root);
  await c.query('ROLLBACK');
  assert.equal((await c.query("SELECT count(*)::int n FROM consult_media WHERE instance_id=$1",[id])).rows[0].n,0);
  await c.query('BEGIN');
  const receipt=await commitConsultBlob(c,f.context('upload'),f.consult,u.upload_id,input,root);await c.query('COMMIT');
  assert.deepEqual(await commitConsultBlob(c,f.context('upload'),f.consult,u.upload_id,input,root),receipt);
  await assert.rejects(commitConsultBlob(c,f.context('upload'),f.consult,u.upload_id,{...input,summary_text:'tamper'},root),/idempotency_mismatch/);
  assert.equal((await c.query("SELECT a.value FROM consult_field_heads h JOIN consult_answers a ON a.id=h.current_answer_id WHERE h.instance_id=$1 AND h.field_key='summary'",[id])).rows[0].value,input.summary_text);
 }finally{await rm(root,{recursive:true,force:true});}

},{fresh:true}));

test('R6 server Close counts year-derived pre-1978 as answered',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);await f.send([f.op()]);await f.save();
 const {seedModules}=await import('../lib/consult/forms/seed.ts');
 const {publish}=await import('../lib/consult/protocol.ts');
 const definition=seedModules.find(m=>m.key==='era');
 const registry=(await c.query('SELECT id FROM consult_mapping_registries LIMIT 1')).rows[0].id;
 const form=(await c.query("INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES('module','era',1,$1,'',$2) RETURNING id",[definition,f.owner])).rows[0].id;
 await publish(c,f.context('publish_form',f.owner,null),{form_id:form,registry_id:registry});
 await c.query('INSERT INTO consult_form_pins SELECT $1,id,kind,key,version,checksum FROM consult_form_versions WHERE id=$2',[f.consult,form]);
 await f.send([f.op('create_instance',{},await f.revision(),{instance_id:randomUUID(),module_key:'era',label:'Era hazards'})]);
 assert.equal((await f.close()).complete,true);
},{fresh:true}));

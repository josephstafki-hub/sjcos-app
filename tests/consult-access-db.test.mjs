import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { publish, command } from '../lib/consult/protocol.ts';
import { fixture } from './_harness/consult.mjs';
import { withTestDb } from './_harness/testdb.mjs';

test('consult boundary: signed claims, assignment scope, revoked users, immutable publication and narrow DML denial', async () => {
 await withTestDb(async (_url,c) => {
  const owner=randomUUID(),staff=randomUUID(),other=randomUUID(),project=randomUUID(),consult=randomUUID();
  const secret=Buffer.alloc(32,7);
  await c.query(`INSERT INTO users(id,email,password_hash,name,role,permissions) VALUES
   ($1,'zz-consult-owner@test','unused','Owner','owner','{}'),
   ($2,'zz-consult-staff@test','unused','Staff','staff','{projects}'),
   ($3,'zz-consult-other@test','unused','Other','staff','{projects}')`,[owner,staff,other]);
  await c.query(`INSERT INTO projects(id,slug,name) VALUES($1,'zz-consult','Consult')`,[project]);
  await c.query(`INSERT INTO consult_context_keys(key_id,secret) VALUES('test',$1)`,[secret]);
  await c.query(`INSERT INTO consults(id,project_id,conducted_by,scheduled_at,scheduled_by,policy_version) VALUES($1,$2,$3,now(),$4,'v1')`,[consult,project,staff,owner]);
  await c.query(`INSERT INTO consult_assignments(consult_id,user_id,assigned_by) VALUES($1,$2,$3)`,[consult,staff,owner]);
  const context=(sub=staff,operation='read',target=consult,extra={})=>{
   const payload=JSON.stringify({kind:'in_home_consult',sub,role:sub===owner?'owner':'staff',areas:['projects'],operation,consult_id:target,mode:'person',iat:Date.now()/1000,exp:Date.now()/1000+120,run_id:randomUUID(),nonce:randomUUID(),...extra});
   return {key_id:'test',payload,signature:createHmac('sha256',secret).update(payload).digest('hex')};
  };
  async function denied(sql,args=[],pattern=/permission denied|access denied|context|session|owner|immutable/i){await assert.rejects(c.query(sql,args),pattern);}
  for(const role of ['sjcos_agent','sjcos_worker','sjcos_readonly']) {
   await c.query(`SET ROLE ${role}`);
   await denied('SELECT * FROM consults');
   await denied(`INSERT INTO consults(project_id) VALUES($1)`,[project]);
   await denied(`UPDATE consults SET status='complete' WHERE id=$1`,[consult]);
   await denied(`INSERT INTO consult_assignments(consult_id,user_id,assigned_by) VALUES($1,$2,$3)`,[consult,other,owner]);
   await denied(`SELECT consult_mint_context('{}','test')`);
   await denied(`SELECT consult_publish_form('{}',$1)`,[randomUUID()]);
   await c.query('RESET ROLE');
  }
  await c.query('SET ROLE sjcos_agent');
  const read=await c.query('SELECT consult_read($1,$2) AS snapshot',[context(),consult]);
  assert.equal(read.rows[0].snapshot.consult.id,consult);
  await denied('SELECT consult_read($1,$2)',[context(other),consult]);
  await denied('SELECT consult_read($1,$2)',[context(staff,'read',randomUUID()),consult]);
  await denied('SELECT consult_read($1,$2)',[context(staff,'read',consult,{exp:0}),consult]);
  await denied('SELECT consult_read($1,$2)',[{...context(),signature:'0'.repeat(64)},consult]);
  await c.query('RESET ROLE');
  // Real person capture: revisions, server digest receipts and conflict history.
  await c.query(`UPDATE app_settings SET value='true' WHERE key='consult_capture'`);
  const definitionCapture={key:'room',version:1,title:'Room',repeatable:true,say:[],fields:[{key:'length',label:'Length',type:'length',unit:'in',range:[24,600],required:true,tier:'price_critical'}],shots:[],coverage:[]};
  const captureForm=(await c.query(`INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES('module','room',1,$1,'',$2) RETURNING id`,[definitionCapture,owner])).rows[0].id;
  const registry=(await c.query("INSERT INTO consult_mapping_registries(version,mappings,author) VALUES(1,'{}',$1) RETURNING id",[owner])).rows[0].id;
  await denied('SELECT consult_publish_form($1,$2)',[context(owner,'publish_form',null),captureForm],/typed publication validation required/);
  await publish(c,context(owner,'publish_form',null),{form_id:captureForm,registry_id:registry});
  await c.query(`INSERT INTO consult_form_pins SELECT $1,id,kind,key,version,checksum FROM consult_form_versions WHERE id=$2`,[consult,captureForm]);
  const device=randomUUID(),instance=randomUUID();
  const epoch=(await c.query('SELECT consult_start($1,$2,$3,0) AS epoch',[context(staff,'start'),consult,device])).rows[0].epoch;
  await c.query("SELECT consult_create_instance($1,$2,$3,'room','Bath',NULL,1)",[context(staff,'create_instance'),consult,instance]);
  const operation={instance_id:instance,field_key:'length',generation:1,base_revision:0,status:'answered',value:120,unit:'in'};
  const event=randomUUID();
  const capture=async(op,id=event)=> (await c.query('SELECT consult_capture_answer($1,$2,$3,$4,$5,$6) AS result',[context(staff,'capture_answer'),consult,device,epoch,id,op])).rows[0].result;
  const accepted=await capture(operation);assert.equal(accepted.code,'accepted');
  assert.deepEqual(await capture(operation),accepted);
  await denied('SELECT consult_capture_answer($1,$2,$3,$4,$5,$6)',[context(staff,'capture_answer'),consult,device,epoch,event,{...operation,value:121}],/idempotency_mismatch/);
  const conflict=await capture({...operation,value:122},randomUUID());assert.equal(conflict.code,'conflict');
  const heads=await c.query('SELECT current_answer_id FROM consult_field_heads WHERE consult_id=$1',[consult]);assert.equal(heads.rows[0].current_answer_id,accepted.answer_id);
  await denied("UPDATE consult_answers SET value='0' WHERE id=$1",[accepted.answer_id],/append only/);
  await c.query(`UPDATE consults SET status='complete' WHERE id=$1`,[consult]);
  await denied('SELECT consult_capture_answer($1,$2,$3,$4,$5,$6)',[context(staff,'capture_answer'),consult,device,epoch,randomUUID(),{...operation,base_revision:accepted.revision}],/complete_locked/);
  await denied('DELETE FROM consult_field_heads WHERE consult_id=$1',[consult],/complete_locked/);
  const rev=(await c.query('SELECT revision FROM consults WHERE id=$1',[consult])).rows[0].revision;
  await denied("SELECT consult_reopen($1,$2,$3,'Correction')",[context(staff,'reopen'),consult,rev],/owner_required/);
  await assert.rejects(command(c,context(staff,'reopen'),consult,'reopen',{expected_revision:Number(rev),reason:'Correction'}),/owner_required/);
  assert.equal((await c.query('SELECT status FROM consults WHERE id=$1',[consult])).rows[0].status,'complete');
  await denied("SELECT consult_reopen($1,$2,$3,'Correction')",[context(owner,'reopen'),consult,Number(rev)-1],/revision or lifecycle conflict/);
  assert.equal((await c.query("SELECT consult_reopen($1,$2,$3,'Correction') AS generation",[context(owner,'reopen'),consult,rev])).rows[0].generation,'2');
  await c.query('UPDATE consult_assignments SET revoked_at=now() WHERE consult_id=$1',[consult]);
  await c.query('SET ROLE sjcos_agent');
  await denied('SELECT consult_read($1,$2)',[context(),consult]);
  await c.query('RESET ROLE');
  await c.query('UPDATE consult_assignments SET revoked_at=NULL WHERE consult_id=$1',[consult]);
  await c.query('UPDATE users SET active=false WHERE id=$1',[staff]);
  await c.query('SET ROLE sjcos_agent');
  await denied('SELECT consult_read($1,$2)',[context(),consult]);
  await c.query('RESET ROLE');
  const definition={key:'test',version:1,title:'Test',repeatable:false,say:[],fields:[],shots:[],coverage:[]};
  const form=(await c.query(`INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES('module','test',1,$1,'ignored',$2) RETURNING id,checksum`,[definition,owner])).rows[0];
  const checksum=(await publish(c,context(owner,'publish_form',null),{form_id:form.id,registry_id:registry})).checksum;
  assert.equal(checksum,form.checksum);
  await denied(`UPDATE consult_form_versions SET definition=definition||'{"title":"Mutated"}'::jsonb WHERE id=$1`,[form.id]);
  await c.query(`UPDATE consult_form_versions SET status='retired' WHERE id=$1`,[form.id]);
  await denied('DELETE FROM consult_form_versions WHERE id=$1',[form.id]);
  await denied(`UPDATE consult_form_versions SET status='draft' WHERE id=$1`,[form.id]);
  await denied(`UPDATE consult_form_versions SET definition=definition||'{"title":"Mutated"}'::jsonb WHERE id=$1`,[form.id]);
 },{fresh:true});
});


test('new website commands deny other staff, agent claims and raw narrow access; owner assignment revokes device',async()=>{
 await withTestDb(async(_url,c)=>{
  const f=await fixture(c);
  for(const name of ['ops','evidence','close','reopen','assign','start','resolve_conflict']) {
   await assert.rejects(command(c,f.context(name,f.other),f.consult,name,{}),/access denied/);
   const ctx=f.context(name);const claims={...JSON.parse(ctx.payload),mode:'agent'};ctx.payload=JSON.stringify(claims);
   ctx.signature=createHmac('sha256',Buffer.alloc(32,17)).update(ctx.payload).digest('hex');
   await assert.rejects(command(c,ctx,f.consult,name,{}),/person_required/);
  }
  await assert.rejects(f.run('assign',{visitor:f.other,expected_revision:await f.revision()}),/owner_required/);
  for(const role of ['sjcos_agent','sjcos_worker','sjcos_readonly']){
   await c.query(`SET ROLE ${role}`);
   for(const table of ['consult_batches','consult_sync_receipts','consult_close_evidence','consult_mapping_registries','consult_publication_validations'])await assert.rejects(c.query(`SELECT * FROM ${table}`),/permission denied/);
   await c.query('RESET ROLE');
  }
  await f.send([f.op()]);
  const stale=await f.send([f.op('answer',{status:'answered',value:122,unit:'in'})]);
  const pair=stale[0].conflict;
  const picked=await f.run('resolve_conflict',{instance_id:f.instance,field_key:'length',current_answer_id:pair.current_answer_id,proposed_answer_id:pair.proposed_answer_id,expected_revision:await f.revision(),generation:1,reason:'Joe checked the measurement',choice:'proposed'},f.owner);
  assert.ok(picked.answer_id);
  await assert.rejects(f.run('assign',{visitor:f.other,expected_revision:await f.revision()},f.owner),/missing_device_manifest_required/);
  await f.run('assign',{visitor:f.other,expected_revision:await f.revision(),missing_device_reason:'Original device unavailable; Joe accepts missing work'},f.owner);
  await assert.rejects(f.send([f.op()]),/access denied/);
  await assert.rejects(f.run('reopen',{expected_revision:await f.revision(),reason:'Old visitor'}),/access denied/);
 },{fresh:true});
});

test('restricted image transaction: bounds, photo permission, hash retries, rename rollback and stable commit',async()=>{
 const {initConsultUpload,putConsultPart,commitConsultBlob}=await import('../lib/consult/uploads.ts');
 const {mkdtemp,rm,readdir}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {createHash}=await import('node:crypto');const sharp=(await import('sharp')).default;
 const root=await mkdtemp(join(tmpdir(),'consult-blobs-'));
 try{await withTestDb(async(_url,c)=>{
  const f=await fixture(c);const ctx=()=>f.context('upload');
  const bytes=await sharp({create:{width:5,height:5,channels:3,background:'white'}}).png().toBuffer();
  const hash=createHash('sha256').update(bytes).digest('hex');
  const input={event_id:randomUUID(),device_id:f.device,device_epoch:1,kind:'photo',mime:'image/png',size:bytes.length,sha256:hash,instance_id:f.instance};
  await assert.rejects(initConsultUpload(c,ctx(),f.consult,input),/photo_permission_required/);
  await c.query('UPDATE consults SET photos_ok=true WHERE id=$1',[f.consult]);
  const u=await initConsultUpload(c,ctx(),f.consult,input);
  await assert.rejects(putConsultPart(c,ctx(),f.consult,u.upload_id,0,bytes,'0'.repeat(64)),/invalid_part/);
  await putConsultPart(c,ctx(),f.consult,u.upload_id,0,bytes,hash);
  await putConsultPart(c,ctx(),f.consult,u.upload_id,0,bytes,hash);
  await c.query('UPDATE consults SET photos_ok=false WHERE id=$1',[f.consult]);
  await assert.rejects(commitConsultBlob(c,ctx(),f.consult,u.upload_id,{event_id:input.event_id,sha256:hash},root),/photo_permission_required/);
  await c.query('UPDATE consults SET photos_ok=true WHERE id=$1',[f.consult]);
  await c.query('BEGIN');const first=await commitConsultBlob(c,ctx(),f.consult,u.upload_id,{event_id:input.event_id,sha256:hash},root);await c.query('ROLLBACK');
  assert.equal((await readdir(root)).length,1);assert.equal((await c.query('SELECT * FROM files WHERE id=$1',[first.file_id])).rowCount,0);
  await c.query('BEGIN');const second=await commitConsultBlob(c,ctx(),f.consult,u.upload_id,{event_id:input.event_id,sha256:hash},root);await c.query('COMMIT');
  assert.deepEqual(first,second);
  assert.deepEqual(await commitConsultBlob(c,ctx(),f.consult,u.upload_id,{event_id:input.event_id,sha256:hash},root),second);
  assert.equal((await c.query('SELECT classification FROM files WHERE id=$1',[second.file_id])).rows[0].classification,'consult_photo');
  for(const role of ['sjcos_agent','sjcos_worker','sjcos_readonly']){
   await c.query(`SET ROLE ${role}`);assert.equal((await c.query('SELECT * FROM files WHERE id=$1',[second.file_id])).rowCount,0);await c.query('RESET ROLE');
  }
  await assert.rejects(c.query("UPDATE files SET classification='attachment' WHERE id=$1",[second.file_id]),/immutable|attachment/);
  const {readConsultMedia,readConsultPhotoForExport}=await import('../lib/consult/media.ts');
  assert.ok((await readConsultMedia(c,f.context('read_media'),f.consult,second.file_id,root)).bytes.length);
  await assert.rejects(readConsultMedia(c,f.context('read_media',f.other),f.consult,second.file_id,root),/access denied/);
  await assert.rejects(readConsultPhotoForExport(c,f.context('read_media'),second.file_id,root),/owner_required/);
  await assert.rejects(readConsultPhotoForExport(c,f.context('read_media',f.owner),second.file_id,root),/consult_not_complete/);
  await c.query('UPDATE consults SET photos_ok=false WHERE id=$1',[f.consult]);
  await assert.rejects(readConsultMedia(c,f.context('read_media'),f.consult,second.file_id,root),/photo_permission_required/);
  await c.query('UPDATE consults SET photos_ok=true WHERE id=$1',[f.consult]);
  await assert.rejects(initConsultUpload(c,ctx(),f.consult,{...input,sha256:'0'.repeat(64)}),/idempotency_mismatch/);
  await assert.rejects(initConsultUpload(c,ctx(),f.consult,{...input,event_id:randomUUID(),size:26*1048576}));
  await assert.rejects(initConsultUpload(c,f.context('upload',f.other),f.consult,input),/access denied/);
 },{fresh:true});}finally{await rm(root,{recursive:true,force:true});}
});

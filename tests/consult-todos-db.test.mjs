import {test} from 'node:test';import assert from 'node:assert/strict';
import {withTestDb} from './_harness/testdb.mjs';import {fixture} from './_harness/consult.mjs';import {schedule} from '../lib/consult/protocol.ts';
test('incomplete return visits dedupe, visitor finish, owner promise and Central midnight; no review or promotion',async()=>{
 await withTestDb(async(_url,c)=>{
  const f=await fixture(c);
  await f.send([f.op('answer',{status:'skipped',skip_reason:'Get on return visit',unit:'in'})]);
  await f.save({...f.evidence,skips:{[`${f.instance}:length`]:{reason:'Get on return visit'}}});
  assert.equal((await f.close()).complete,false);await f.close();
  const rows=(await c.query("SELECT *, (due_at AT TIME ZONE 'America/Chicago')::time::text central FROM work_items WHERE source_kind='consult'")).rows;
  assert.equal(rows.length,3);assert.equal(rows.find(r=>r.source_id.includes(':finish:')).assignee_key,f.staff);
  assert.equal(rows.find(r=>r.source_id.includes(':return:')).assignee_key,f.owner);
  assert.equal(rows.find(r=>r.source_id.includes(':return:')).due_at,null);
  assert.equal(rows.find(r=>r.source_id.includes(':promise:')).central,'00:00:00');
  assert.ok(rows.every(r=>r.promoted_at===null&&!/review/i.test(r.title)));
  const scheduled=await schedule(c,f.context('schedule',f.owner,null),{project:f.project,visitor:f.staff,visit_time:'2026-12-20T02:00:00Z',forms:f.forms});
  const r=(await c.query("SELECT due_at,snoozed_until,assignee_key FROM work_items WHERE source_id=$1",[`${scheduled.id}:schedule:visit`])).rows[0];
  assert.equal(r.due_at.toISOString(),'2026-12-19T06:00:00.000Z');assert.equal(+r.due_at,+r.snoozed_until);assert.equal(r.assignee_key,f.staff);
 },{fresh:true});
});

test('maintenance recovers forgotten Close and return tasks idempotently at Central midnight',async()=>{
 const {maintainConsults}=await import('../lib/worker/consult.ts');
 await withTestDb(async(_url,c)=>{
  const f=await fixture(c);await f.send([f.op()]);
  await c.query("UPDATE consults SET scheduled_at='2026-10-30T15:00:00Z' WHERE id=$1",[f.consult]);
  await f.save({...f.evidence,skips:{[`${f.instance}:length`]:{reason:'Get on return visit'}}});
  await c.query("UPDATE consult_close_evidence SET evidence=jsonb_set(evidence,'{return_day}','\"2026-12-20\"') WHERE consult_id=$1",[f.consult]);
  await maintainConsults(c,'/tmp/nonexistent-consult-uploads');await maintainConsults(c,'/tmp/nonexistent-consult-uploads');
  const rows=(await c.query("SELECT source_id,due_at,assignee_key FROM work_items WHERE source_kind='consult'")).rows;
  const finish=rows.filter(r=>r.source_id.includes(':finish:'));assert.equal(finish.length,1);assert.equal(finish[0].assignee_key,f.staff);assert.equal(finish[0].due_at.toISOString(),'2026-11-02T06:00:00.000Z');
  const returns=rows.filter(r=>r.source_id.includes(':return:'));assert.equal(returns.length,1);assert.equal(returns[0].due_at.toISOString(),'2026-12-20T06:00:00.000Z');
 },{fresh:true});
});

test('maintenance expires partial uploads and removes only old recognizable disk orphans',async()=>{
 const {maintainConsults}=await import('../lib/worker/consult.ts');const fs=await import('node:fs/promises');const {randomUUID}=await import('node:crypto');
 const root=await fs.mkdtemp('/tmp/consult-cleanup-');
 try{await withTestDb(async(_url,c)=>{
  const f=await fixture(c),id=randomUUID(),hash='a'.repeat(64);
  await c.query(`INSERT INTO consult_uploads(id,consult_id,actor,device_id,device_epoch,event_id,kind,mime,size_bytes,sha256,epoch,expires_at,status,generation) VALUES($1,$2,$3,$4,1,$5,'photo','image/png',1,$6,1,now()-interval '1 hour','uploading',1)`,[id,f.consult,f.staff,f.device,randomUUID(),hash]);
  await c.query('INSERT INTO consult_upload_parts VALUES($1,0,$2,$3)',[id,hash,Buffer.from('a')]);
  const orphan=`${root}/consult-${randomUUID()}.blob`,fresh=`${root}/consult-${randomUUID()}.blob`,other=`${root}/attachment.blob`;
  for(const name of [orphan,fresh,other])await fs.writeFile(name,'test');
  const old=new Date(Date.now()-72*3600000);await fs.utimes(orphan,old,old);await fs.utimes(other,old,old);
  await maintainConsults(c,root);
  assert.equal((await c.query('SELECT count(*)::int n FROM consult_upload_parts')).rows[0].n,0);assert.equal((await c.query('SELECT status FROM consult_uploads WHERE id=$1',[id])).rows[0].status,'expired');
  await assert.rejects(fs.stat(orphan),{code:'ENOENT'});await fs.stat(fresh);await fs.stat(other);
 },{fresh:true});}finally{await fs.rm(root,{recursive:true,force:true});}
});

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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { editWorkItem } from '../lib/work-item-edit.ts';
const url = process.env.FIN_TEST_DATABASE_URL;
test('invalid edits are rejected before a write', async () => {
  let writes = 0; const run = async () => { writes++; return []; };
  for (const patch of [{title:' '},{priority:'oops'},{due_at:'not a date'},{due_at:'2026-02-30'}]) {
    assert.equal((await editWorkItem(run, '00000000-0000-4000-8000-000000000001', patch)).ok, false);
  }
  assert.equal(writes,0);
});
test('edit, clear, missing job refusal and future scheduling use the same service', {skip:!url}, async () => {
  const db = new pg.Client({connectionString:url}); await db.connect();
  const run = async (sql, args) => (await db.query(sql,args)).rows;
  try {
    await db.query('BEGIN');
    const [item] = await run("INSERT INTO work_items(title,body,status) VALUES ('ZZ QA edit','before','queued') RETURNING id");
    const [project] = await run('SELECT slug FROM projects LIMIT 1');
    let result = await editWorkItem(run,item.id,{title:'ZZ QA corrected',body:'Details',priority:'high',due_at:'2099-01-02',project_slug:project.slug});
    assert.equal(result.ok,true);
    const [changed] = await run('SELECT title,body,priority,due_at,snoozed_until,project_id FROM work_items WHERE id=$1',[item.id]);
    assert.equal(changed.title,'ZZ QA corrected'); assert.equal(changed.body,'Details'); assert.equal(changed.priority,'high');
    assert.ok(changed.project_id); assert.ok(changed.snoozed_until, 'future work remains snoozed');
    assert.equal((await run("SELECT to_char(due_at AT TIME ZONE 'America/Chicago','YYYY-MM-DD') AS day FROM work_items WHERE id=$1",[item.id]))[0].day, '2099-01-02');
    assert.equal((await editWorkItem(run,item.id,{title:'Do not persist',project_slug:'missing-zz-qa'})).ok,false);
    assert.equal((await run('SELECT title FROM work_items WHERE id=$1',[item.id]))[0].title,'ZZ QA corrected');
    assert.equal((await editWorkItem(run,item.id,{due_at:null,project_slug:null})).ok,true);
    const [cleared] = await run('SELECT due_at,snoozed_until,project_id FROM work_items WHERE id=$1',[item.id]);
    assert.equal(cleared.due_at,null); assert.equal(cleared.snoozed_until,null); assert.equal(cleared.project_id,null);
  } finally { await db.query('ROLLBACK'); await db.end(); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { listRecoverableWork, recoverWorkItem } from '../lib/today-recovery.mjs';
const url = process.env.FIN_TEST_DATABASE_URL;
test('Today recovery is scoped, reversible, and respects scheduled dates', { skip: !url }, async () => {
  assert.equal(new URL(url).port, '5499', 'QA database only');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const run = async (sql, params) => (await c.query(sql, params)).rows;
  try {
    await c.query('BEGIN');
    const [owner] = await run("SELECT id, name, role FROM users WHERE role='owner' AND active LIMIT 1");
    const [staff] = await run("INSERT INTO users (email,password_hash,name,role,initials) VALUES ('zz-qa-recovery@example.test','x','ZZ QA recovery','staff','ZZ') RETURNING id,name,role");
    const [done] = await run("INSERT INTO work_items (title,status,completed_at) VALUES ('ZZ QA recovery done','done',now()) RETURNING id");
    const [scheduled] = await run("INSERT INTO work_items (title,status,due_at) VALUES ('ZZ QA recovery snoozed','queued',now()+interval '5 days') RETURNING id");
    assert.ok((await listRecoverableWork(run, owner, 'done')).some(x => x.id === done.id));
    assert.ok((await listRecoverableWork(run, owner, 'snoozed')).some(x => x.id === scheduled.id));
    assert.equal((await listRecoverableWork(run, staff, 'done')).some(x => x.id === done.id), false);
    assert.equal(await recoverWorkItem(run, done.id, 'done', staff), false);
    assert.equal(await recoverWorkItem(run, done.id, 'done', owner), true);
    const [reopened] = await run('SELECT status,completed_at FROM work_items WHERE id=$1', [done.id]);
    assert.equal(reopened.status, 'queued'); assert.equal(reopened.completed_at, null);
    // Reopening a completed task with a future due day must leave it scheduled.
    await run("UPDATE work_items SET status='done',due_at=now()+interval '6 days' WHERE id=$1", [done.id]);
    await recoverWorkItem(run, done.id, 'done', owner);
    assert.ok((await run('SELECT snoozed_until > now() AS future FROM work_items WHERE id=$1', [done.id]))[0].future);
    // Only the explicit Bring back today action reschedules future work to today.
    assert.equal(await recoverWorkItem(run, scheduled.id, 'snoozed', owner), true);
    const [awake] = await run('SELECT snoozed_until, due_at <= now() AS due FROM work_items WHERE id=$1', [scheduled.id]);
    assert.equal(awake.snoozed_until, null); assert.equal(awake.due, true);
    assert.equal(await recoverWorkItem(run, scheduled.id, 'snoozed', owner), false);
    await assert.rejects(() => recoverWorkItem(run, scheduled.id, 'invalid', owner));
  } finally { await c.query('ROLLBACK'); await c.end(); }
});

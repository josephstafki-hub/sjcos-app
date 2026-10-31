import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as labels from '../lib/owner-time/labels.ts';
import { startTimer, correctInterval } from '../lib/owner-time/intervals.ts';

test('short durations use minutes, including sub-minute work', () => {
  assert.equal(labels.durationLabel(12 * 60_000), '12 min');
  assert.equal(labels.durationLabel(3_000), '<1 min');
  assert.equal(labels.durationLabel(90 * 60_000), '1.50 h');
});
test('starting site time without a job fails before recording an event', async () => {
  await assert.rejects(startTimer(async () => { throw new Error('Unexpected write'); }, { userId: 'u', clientEventId: 'e', projectId: null, category: 'site' }), /Choose a job for Site time/);
});
test('corrections cannot confirm site time without a job', async () => {
  const before = { id: 'i', project_id: null, category: 'site', state: 'review', start_at: '2026-10-30T12:00:00Z', end_at: '2026-10-30T13:00:00Z' };
  const run = async (sql) => {
    if (sql.includes('INSERT INTO time_events')) return [{ client_event_id: 'e' }];
    if (sql.includes('FROM time_intervals')) return [before];
    throw new Error('Unexpected write');
  };
  await assert.rejects(correctInterval(run, { userId: 'u', clientEventId: 'e', intervalId: 'i', by: 'Joe', state: 'confirmed' }), /Choose a job for Site time/);
});

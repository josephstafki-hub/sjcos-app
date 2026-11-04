import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as time from '../lib/schedule-time.ts';

test('schedule display normalizes clocks and never echoes unknown labels', () => {
  assert.equal(typeof time.formatScheduleTime, 'function');
  for (const value of ['garbage', 'AM', '25:00', null, undefined, ''])
    assert.equal(time.formatScheduleTime(value), 'Time needs review');
  assert.equal(time.formatScheduleTime('8:30 AM'), '08:30');
  assert.equal(time.formatScheduleTime('5pm'), '17:00');
  assert.equal(time.formatScheduleTime('00:00'), '00:00');
  assert.equal(time.formatScheduleTime('all'), 'All day');
  assert.equal(time.formatScheduleTime('START'), 'Start date');
  assert.equal(time.formatScheduleTime('END'), 'Target completion');
  for (const [key, label] of Object.entries({ DUE: 'Due date', WTY: 'Warranty ends', ACK: 'Acknowledge by', FIX: 'Resolve by' })) {
    assert.equal(time.formatScheduleTime(key), label);
    assert.equal(time.formatScheduleTime(label), label);
  }
  assert.equal(time.formatScheduleTime('Time needs review'), 'Time needs review');
});

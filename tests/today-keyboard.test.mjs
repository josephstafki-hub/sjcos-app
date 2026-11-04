import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayShortcut } from '../lib/today-keyboard.ts';

test('Today keyboard moves through rows and exposes done/snooze shortcuts', () => {
  assert.equal(todayShortcut({ key: 'j' }), 'next');
  assert.equal(todayShortcut({ key: 'k' }), 'previous');
  assert.equal(todayShortcut({ key: 'e' }), 'done');
  assert.equal(todayShortcut({ key: 's' }), 'snooze');
  assert.equal(todayShortcut({ key: 'Enter' }), null);
});
test('Today shortcuts never intercept typing, modified keys, or composition', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(todayShortcut({ key: 'e', tagName }), null);
  }
  for (const flag of ['isContentEditable', 'metaKey', 'ctrlKey', 'altKey', 'shiftKey', 'isComposing', 'repeat']) {
    assert.equal(todayShortcut({ key: 's', [flag]: true }), null);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
const { notificationStatusCopy, queueScopeMatches, laneLabel } = await import('../lib/daily-work-presentation.ts');

test('settled asks replace pending wording without claiming a send', () => {
  assert.equal(notificationStatusCopy({ title: 'Request', subline: 'awaiting your OK — nothing has been sent', resolution: 'approved' }).subline, 'Approved · Open the record for delivery status.');
  assert.match(notificationStatusCopy({ title: 'Request', subline: 'awaiting your OK', resolution: 'rejected' }).subline, /Declined/);
});
test('legacy sub-invite announcements describe history, not a current approval', () => {
  const copy = notificationStatusCopy({ title: 'Portal invite queued — Pat', subline: 'Kitchen · awaiting your OK — nothing has been sent', resolution: null });
  assert.doesNotMatch(copy.subline, /awaiting your OK|nothing has been sent/);
  assert.match(copy.subline, /Kitchen.*current status/);
});
test('queue scopes separate client/sub waiting from owner action and closed records', () => {
  for (const status of ['waiting_on_client', 'waiting_on_sub']) {
    assert.equal(queueScopeMatches(status, false, 'others'), true);
    assert.equal(queueScopeMatches(status, false, 'mine'), false);
  }
  assert.equal(queueScopeMatches('blocked', true, 'mine'), true);
  assert.equal(queueScopeMatches('done', false, 'others'), false);
  assert.equal(queueScopeMatches('done', false, 'all'), true);
});
test('lanes use recognizable names', () => {
  assert.equal(laneLabel('qbo'), 'QuickBooks');
  assert.equal(laneLabel('all'), 'All lanes');
});

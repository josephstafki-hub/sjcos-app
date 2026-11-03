import { test } from 'node:test';
import assert from 'node:assert/strict';
import { W, plainWords, readyReason, spokenDuration, visitTiming, componentDuration } from '../lib/consult/ui/words.ts';

test('spoken duration is words only, never the office hint', () => {
  assert.equal(spokenDuration(['bath', 'kitchen']), 'three and a half to four hours');
  assert.equal(spokenDuration(['bath']), 'an hour and a half to two hours');
  assert.equal(spokenDuration(['kitchen']), 'two hours');
  assert.equal(spokenDuration(['deck']), 'an hour');
  assert.equal(spokenDuration(['general']), 'forty-five minutes');
  assert.equal(spokenDuration(['whole']), 'three to four hours, or two scheduled visits');
  assert.equal(spokenDuration([]), '');
  for (const k of [['bath', 'kitchen'], ['whole'], ['addition', 'basement']]) assert.doesNotMatch(spokenDuration(k), /offer|separate|\d/);
});

test('office duration sums in hours with a correct unit', () => {
  assert.equal(visitTiming(['bath', 'kitchen']).duration, '3½–4 hours');
  assert.equal(visitTiming(['deck']).duration, '1 hour');
  assert.equal(visitTiming(['general']).duration, '1 hour');
  assert.equal(componentDuration([90, 120]), '1½–2 h');
  assert.equal(componentDuration([120, 120]), '2 h');
  assert.equal(visitTiming([]).duration, '');
});

test('Get ready reasons: other device has its own words; only sign-in codes say sign in', () => {
  assert.equal(readyReason('offline_lease', 'device_access_denied'), 'This visit is set up on another device. Use that one, or ask Joe to move it here.');
  assert.equal(readyReason('saving_on_device', 'device_access_denied'), 'This visit is set up on another device. Use that one, or ask Joe to move it here.');
  assert.equal(readyReason('offline_lease', 'pin_invalid'), W.pinShort);
  assert.equal(W.pinShort, 'Use 6 to 12 digits.');
  assert.match(W.pinChooseHelp, /6 to 12 digits/);
  for (const c of ['signed_out', 'lease_expired', 'unauthorized']) assert.equal(readyReason('offline_lease', c), 'sign-in for offline use failed — sign in again');
  for (const c of ['weird_new_code', 'not_ready', 'send_failed']) assert.doesNotMatch(readyReason('offline_lease', c), /sign in/i, c);
  assert.equal(readyReason('offline_lease', 'weird_new_code'), plainWords('weird_new_code'));
});

test('mid-visit other device is not worded as access removed', () => {
  const w = plainWords('device_access_denied');
  assert.equal(w, 'This visit is being filled in on another device. Use that device, or ask Joe to move it here.');
  assert.doesNotMatch(w, /removed|recover|sign in/i);
  assert.match(plainWords('revoked'), /removed/);
});

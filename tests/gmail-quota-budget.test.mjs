// The per-minute Gmail budget: sends first, people next, timers last.
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.GMAIL_UNITS_PER_MINUTE = '1000';
const q = await import('../lib/gmail-quota.ts');
const KEY = q.mailboxQuotaKey('token');

beforeEach(() => { q.resetGmailQuotaForTests(); mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 }); });
afterEach(() => mock.timers.reset());

/** Resolve-state of a promise without awaiting it. */
const settled = (p) => { const s = { done: false }; p.then(() => { s.done = true; }); return s; };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('costs follow Google’s 2026 table (a full thread read is 120, a send 100, a change check 2)', () => {
  assert.equal(q.gmailCallCost('threads.get'), 120);
  assert.equal(q.gmailCallCost('threads.get(metadata)'), 40);
  assert.equal(q.gmailCallCost('messages.send'), 100);
  assert.equal(q.gmailCallCost('history.list'), 2);
});

test('background work stops at half the minute and resumes as spend ages out', async () => {
  for (let i = 0; i < 4; i++) await q.acquireGmailUnits(KEY, 'messages.send', 'background'); // 400 of 500
  const fifth = settled(q.acquireGmailUnits(KEY, 'messages.send', 'background'));
  await flush();
  assert.equal(fifth.done, true, '500 fits exactly');
  const sixth = settled(q.acquireGmailUnits(KEY, 'threads.list', 'background'));
  await flush();
  assert.equal(sixth.done, false, 'over half: waits');
  mock.timers.tick(60_000);
  await flush();
  assert.equal(sixth.done, true, 'room again once the minute rolls');
});

test('a person can still read, and a send always goes, when timers have used their half', async () => {
  for (let i = 0; i < 5; i++) await q.acquireGmailUnits(KEY, 'messages.send', 'background');
  const read = settled(q.acquireGmailUnits(KEY, 'threads.get', 'interactive'));
  const send = settled(q.acquireGmailUnits(KEY, 'messages.send', 'send'));
  await flush();
  assert.equal(read.done, true);
  assert.equal(send.done, true);
  assert.equal(q.gmailUnitsSpent(KEY), 720);
});

test('timers stand aside while a send is in progress', async () => {
  let release;
  const slot = q.withGmailSendSlot(KEY, () => new Promise((r) => { release = r; }));
  const bg = settled(q.acquireGmailUnits(KEY, 'history.list', 'background'));
  await flush();
  mock.timers.tick(2_000); await flush();
  assert.equal(bg.done, false, 'waiting on the send');
  release(); await slot;
  mock.timers.tick(2_000); await flush();
  assert.equal(bg.done, true);
});

test('after Google refuses a call, timers cool down; a person reads on unless a send is waiting; a send never waits', async () => {
  q.noteGmailRateLimited(KEY);
  const timer = settled(q.acquireGmailUnits(KEY, 'threads.list', 'background'));
  const read = settled(q.acquireGmailUnits(KEY, 'threads.list', 'interactive'));
  const send = settled(q.acquireGmailUnits(KEY, 'messages.send', 'send'));
  await flush();
  assert.equal(send.done, true);
  assert.equal(read.done, true, 'no send in flight: the inbox keeps loading');
  assert.equal(timer.done, false);
  let release;
  const slot = q.withGmailSendSlot(KEY, () => new Promise((r) => { release = r; }));
  const readDuringSend = settled(q.acquireGmailUnits(KEY, 'threads.list', 'interactive'));
  await flush();
  assert.equal(readDuringSend.done, false, 'a send is trying to land: reads hold off');
  mock.timers.tick(3_000); await flush();
  assert.equal(readDuringSend.done, true, 'but never more than 3 s');
  release(); await slot;
});

test('a send stuck for over two minutes stops holding timers back', async () => {
  q.withGmailSendSlot(KEY, () => new Promise(() => {})); // never settles
  const bg = settled(q.acquireGmailUnits(KEY, 'history.list', 'background'));
  await flush();
  assert.equal(bg.done, false);
  for (let i = 0; i < 70; i++) { mock.timers.tick(2_000); await flush(); }
  assert.equal(bg.done, true);
});

test('shared work speeds up when a person joins a timer\'s wait', async () => {
  for (let i = 0; i < 5; i++) await q.acquireGmailUnits(KEY, 'messages.send', 'background'); // timers' half used
  const rank = q.sharedGmailPriority('background');
  const shared = settled(q.acquireGmailUnits(KEY, 'threads.list', rank.get));
  await flush();
  assert.equal(shared.done, false);
  rank.raise('interactive');
  mock.timers.tick(2_000); await flush();
  assert.equal(shared.done, true);
  rank.raise('background');
  assert.equal(rank.get(), 'interactive', 'never lowered');
});

test('timer code runs at background priority; everything else is interactive', async () => {
  assert.equal(q.currentGmailPriority(), 'interactive');
  await q.runAsGmailBackground(async () => { assert.equal(q.currentGmailPriority(), 'background'); });
});

test('a patient retry spans a full quota minute', () => {
  const { attempts, baseMs, maxMs } = q.retrySchedule('patient');
  let total = 0;
  for (let a = 1; a < attempts; a++) total += Math.min(maxMs, baseMs * 2 ** (a - 1));
  assert.ok(total >= 60_000, `waits ${total} ms in all`);
});

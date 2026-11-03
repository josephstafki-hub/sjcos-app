// Pure UI layer for the in-home consultation field app (no DB, no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seedModules, templates } from '../lib/consult/forms/seed.ts';
import { buildModel, buildEvidence, emptyDraft, predictRevisions, baselineOf, leaveList, nextOpen, unsentCount, refusedEntries, openConflicts } from '../lib/consult/ui/model.ts';
import { answerOp, createInstanceOp, startOp } from '../lib/consult/ui/ops.ts';
import { payloadHash, emptyQueue, enqueue } from '../lib/consult/queue.ts';
import { plainWords, readyReason, CHECK_WORDS, SKIP_REASONS, statusLabel, W } from '../lib/consult/ui/words.ts';
import { evidenceSchema } from '../lib/consult/protocol.ts';

const bath = templates.find((t) => t.key === 'bath');
const consultId = randomUUID();
function snapshot(instances = [], heads = []) {
  return {
    consult: { id: consultId, project_id: randomUUID(), status: 'in_progress', revision: '4', completion_generation: '1', conducted_by: randomUUID(), scheduled_at: '2026-11-06T15:00:00Z' },
    pins: [...seedModules.map((d) => ({ kind: 'module', definition: d })), { kind: 'template', definition: bath }],
    instances: [{ id: consultId, module_key: 'visit', parent_id: null, removed_at: null }, ...instances],
    heads: [{ id: consultId, instance_id: consultId, field_key: 'templates', status: 'answered', value: ['bath'], skip_reason: null, skip_note: null, server_revision: '4' }, ...heads],
    conflicts: [],
  };
}
const entry = (op, status = 'pending', extra = {}) => ({ op, status, attempts: 0, next_at: 0, ...extra });

test('real bath seed: slots, hidden context module, open required items, Next and leave list', () => {
  const house = randomUUID(), room = randomUUID();
  const s = snapshot([{ id: house, module_key: 'house', parent_id: null, removed_at: null, label: 'House & household' }, { id: room, module_key: 'room', parent_id: null, removed_at: null, label: 'Room 1' }]);
  const m = buildModel(s, [], [], emptyDraft());
  assert.ok(!m.sections.some((x) => x.module.key === 'visit'), 'visit context never shown');
  assert.equal(m.sections[0].module.key, 'house', 'House first, template order');
  assert.ok(m.slots.find((x) => x.module.key === 'plumb_fixture').minimum >= 2);
  assert.ok(m.pc.total > 0 && m.pc.done === 0);
  const roomSec = m.sections.find((x) => x.instance.id === room);
  assert.equal(roomSec.mark, 'open');
  assert.ok(roomSec.fields.every((f) => !f.def.derive), 'derived fields are not asked');
  const n = nextOpen(m, room);
  assert.ok(n && n.addr.startsWith(room));
  assert.ok(leaveList(m, room).open.length > 0);
  assert.equal(m.rrpApplies, true, 'Unknown year and unanswered pre-1978/disturbance conservatively apply RRP');
});

test('local queue overlay: pending answer covers the field; return-visit skip stays Open with ⤳', async () => {
  const room = randomUUID(), device = randomUUID();
  const s = snapshot([{ id: room, module_key: 'room', parent_id: null, removed_at: null, label: 'Room 1' }]);
  let q = emptyQueue(1, 1);
  const base = baselineOf(s);
  const op1 = await answerOp(q, device, base, room, 'length', { status: 'answered', value: 160.5, unit: 'in' });
  assert.equal(op1.payload_sha256, await payloadHash(op1.payload));
  assert.equal(op1.base_revision, 0, 'new field head base is 0');
  q = enqueue(q, op1, {});
  const op2 = await answerOp(q, device, base, room, 'width', { status: 'skipped', skip_reason: 'Get on return visit', unit: 'in' });
  q = enqueue(q, op2, {});
  const m = buildModel(s, q.entries, [], emptyDraft());
  const sec = m.sections.find((x) => x.instance.id === room);
  const length = sec.fields.find((f) => f.key === 'length'), width = sec.fields.find((f) => f.key === 'width');
  assert.equal(length.mark, 'covered');
  assert.equal(length.answer.local, 'pending');
  assert.equal(width.mark, 'open');
  assert.equal(width.returnVisit, true);
  assert.equal(sec.returnVisit, true);
  assert.equal(unsentCount(q.entries), 2);
});

test('revision prediction: one bump per op; receipts win; refused ops never bump', async () => {
  const s = snapshot(); const device = randomUUID();
  let q = emptyQueue(1, 1);
  const b0 = baselineOf(s);
  const start = await startOp(q, device, b0); assert.equal(start.base_revision, 4); q = enqueue(q, start, {});
  const b1 = predictRevisions(b0, q.entries); assert.equal(b1.rev, 5);
  const create = await createInstanceOp(q, device, b1, 'room', 'Room 1'); assert.equal(create.base_revision, 5); q = enqueue(q, create, {});
  const id = create.target.instance_id;
  const b2 = predictRevisions(b0, q.entries);
  const ans = await answerOp(q, device, b2, id, 'length', { status: 'answered', value: 96, unit: 'in' }); q = enqueue(q, ans, {});
  const b3 = predictRevisions(b0, q.entries);
  assert.equal(b3.rev, 7); assert.equal(b3.fields[`${id}:length`], 7);
  const again = await answerOp(q, device, b3, id, 'length', { status: 'answered', value: 97, unit: 'in' });
  assert.equal(again.base_revision, 7, 'second edit of a field bases on its predicted head');
  // Server refused the create (422): later predictions don't count it.
  const refused = q.entries.map((e, i) => (i === 1 ? { ...e, status: 'invalid', error_code: 'invalid_operation' } : i === 0 ? { ...e, status: 'accepted', revision: 5 } : e));
  assert.equal(predictRevisions(b0, refused).rev, 6);
  assert.equal(refusedEntries(refused).length, 1);
});

test('local conflict receipt shows ! Conflict with both values until a later resolve', async () => {
  const room = randomUUID(), device = randomUUID();
  const s = snapshot([{ id: room, module_key: 'room', parent_id: null, removed_at: null }]);
  const q = emptyQueue(1, 1);
  const op = await answerOp(q, device, baselineOf(s), room, 'length', { status: 'answered', value: 36.5, unit: 'in' });
  const conflict = { current: { id: randomUUID(), value: 36, status: 'answered', server_revision: 6 }, proposed: { id: randomUUID(), value: 36.5, status: 'answered' } };
  const entries = [entry(op, 'conflict', { error_code: 'conflict', revision: 7, conflict })];
  const c = openConflicts(s, entries);
  assert.equal(c.length, 1); assert.equal(c[0].current.value, 36); assert.equal(c[0].proposed.value, 36.5);
  const m = buildModel(s, entries, [], emptyDraft());
  assert.ok(m.sections.find((x) => x.instance.id === room).conflict);
});

test('evidence payload passes the server strict evidenceSchema; null without promised date', async () => {
  const closing = randomUUID(), house = randomUUID(), device = randomUUID();
  const s = snapshot([{ id: closing, module_key: 'closing', parent_id: null, removed_at: null }, { id: house, module_key: 'house', parent_id: null, removed_at: null }]);
  let q = emptyQueue(1, 1);
  assert.equal(buildEvidence(buildModel(s, [], [], emptyDraft()), emptyDraft(), false), null);
  for (const [inst, key, value] of [[closing, 'estimate_promised', '2026-11-16'], [house, 'photos_ok', true]]) {
    const op = await answerOp(q, device, predictRevisions(baselineOf(s), q.entries), inst, key, { status: 'answered', value }); q = enqueue(q, op, {});
  }
  const draft = { ...emptyDraft(), ack_reason: 'Client declined', no_trades_confirmed: true, rrp: { receipt: true, firm_current: true, renovator_current: true, redelivery_required: false } };
  const ev = buildEvidence(buildModel(s, q.entries, [], draft), draft, false);
  assert.equal(ev.promised_date, '2026-11-16'); assert.equal(ev.photos_ok, true);
  evidenceSchema.parse(ev);
  const withInitials = buildEvidence(buildModel(s, q.entries, [], draft), draft, true);
  assert.equal(withInitials.ack_reason, null);
});

test('every error code maps to plain words; no internal terms on screen', () => {
  const codes = ['no_signal', 'signed_out', 'offline_locked', 'revoked', 'device_access_denied', 'deleted', 'update_required', 'storage_full', 'storage_unavailable', 'invalid_pin', 'pin_retry_later', 'not_prepared', 'capture_disabled', 'conflict', 'rebase_required', 'complete_locked', 'manifest_sequence_gap', 'manifest_blob_missing', 'unresolved_rejections', 'invalid_operation', 'owner_required', 'csrf', 'missing_precache', 'checksum_mismatch', 'snapshot_unavailable', 'something_new'];
  for (const c of codes) { const w = plainWords(c, { name: 'Abigail', field: 'Ceiling' }); assert.ok(w.length > 10, c); assert.doesNotMatch(w, /\b(sync|lease|precache|token|manifest|rebase|CSRF|IDB|queue)\b/i, c); }
  assert.match(plainWords('signed_out', { name: 'Abigail' }), /Sign in as Abigail to send them/);
  assert.equal(readyReason('saving_on_device', 'storage_unavailable'), "this browser won't save here (private mode or storage off)");
  assert.equal(readyReason('saving_on_device', 'storage_full', 50), 'not enough space — free up 50 MB');
  assert.equal(readyReason('forms', 'checksum_mismatch'), "couldn't download the forms");
  assert.equal(readyReason('offline_pages', 'missing_precache'), "couldn't download the offline pages");
  assert.equal(readyReason('offline_lease', 'offline_locked'), 'sign-in for offline use failed — sign in again');
  assert.equal(Object.keys(CHECK_WORDS).length, 11);
  assert.deepEqual(SKIP_REASONS, ['Not on this job', 'No access', 'Not safe to measure', 'Client declined', 'Get on return visit', 'Sub/supplier will measure', 'Other']);
  assert.equal(statusLabel('captured'), 'Visit closed — sending');
  assert.equal(statusLabel('incomplete', 2), 'Needs finishing (2 open)');
  for (const w of Object.values(W)) assert.doesNotMatch(w, /\b(reviewed|approve|certify|sync|precache|lease)\b/i);
});

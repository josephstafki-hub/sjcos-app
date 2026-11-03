// Round-9 design judge fixes (docs/plans/reviews/build-consult-r9-design.md): conflict sides that
// tie on person and minute still read one "earlier" and one "later" (R9-1), the close blocked by a
// conflict says why (R9-2), a reopened visit says who, when and why (R9-3), and the client view
// doesn't count a work area's own unnamed room as one more place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seedModules, templates } from '../lib/consult/forms/seed.ts';
import { buildModel, emptyDraft, summaryInput } from '../lib/consult/ui/model.ts';
import { clientSummary, clientRecapText, sayList } from '../lib/consult/client-summary.ts';
import { W, conflictSideLabel, fill, reopenedHead } from '../lib/consult/ui/words.ts';

const consultId = randomUUID();
const tpl = (...keys) => keys.map((k) => templates.find((t) => t.key === k));
const snapshot = (tpls, instances = [], heads = []) => ({
  consult: { id: consultId, project_id: randomUUID(), status: 'in_progress', revision: '4', completion_generation: '1', conducted_by: randomUUID(), scheduled_at: '2026-11-06T15:00:00Z' },
  pins: [...seedModules.map((d) => ({ kind: 'module', definition: d })), ...tpls.map((t) => ({ kind: 'template', definition: t }))],
  instances: [{ id: consultId, module_key: 'visit', parent_id: null, removed_at: null }, ...instances],
  heads: [{ id: randomUUID(), instance_id: consultId, field_key: 'templates', status: 'answered', value: tpls.map((t) => t.key), skip_reason: null, skip_note: null, server_revision: '4' }, ...heads],
  conflicts: [],
});
const inst = (module_key, label) => ({ id: randomUUID(), module_key, parent_id: null, removed_at: null, label });

test('R9-1: two sides by the same person in the same minute, even with the same time and revision, read one earlier and one later', () => {
  const at = '2026-11-03T22:33:10.000Z';
  const a = { id: '0a', person: 'Abigail Stafki', actor: 'u1', device_id: 'd1', created_at: at, server_revision: '7' };
  const b = { id: '0b', person: 'Abigail Stafki', actor: 'u1', device_id: 'd2', created_at: at, server_revision: '7' };
  const la = conflictSideLabel(a, b), lb = conflictSideLabel(b, a);
  assert.notEqual(la, lb);
  assert.deepEqual([la, lb].map((l) => l.split(' · ').at(-1)).sort(), ['earlier', 'later']);
  assert.match(la, /^Abigail · 4:33\Wpm · earlier$/);
});

test('R9-2: the blocked close says why, singular for one conflict, and names "Section › Field"', () => {
  assert.equal(W.closeVisitPickConflict, 'Close visit — pick the conflict first');
  assert.equal(fill(W.conflictBeforeClose, { n: 1 }), '1 conflict to pick before you close');
  assert.equal(fill(W.conflictsBeforeClose, { n: 2 }), '2 conflicts to pick before you close');
  assert.equal(fill(W.conflictLine, { field: 'Access & logistics › Narrowest door or turn on that path' }), 'Conflict: Access & logistics › Narrowest door or turn on that path — changed on another device');
  const src = readFileSync(new URL('../components/consult/field/WrapClose.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('.join(" › ")'), 'wrap lines join section and field with ›');
  assert.ok(src.includes('W.closeVisitPickConflict'), 'the footer button says why it waits');
});

test('R9-3: "Reopened by {first name} · {time}" in job time', () => {
  assert.equal(reopenedHead({ who: 'Joseph Stafki', when: '2026-11-03T22:40:00Z' }), 'Reopened by Joseph · Nov 3, 4:40 pm');
  assert.equal(reopenedHead({ who: '', when: null }), 'Reopened by Joe');
});

test('client view: a work area\'s own unnamed room is said once; only leftover unnamed rooms are "more rooms"', () => {
  const bath = inst('bath_scope', 'Bath 1'), kitchen = inst('kitchen_scope', 'Kitchen');
  const r1 = inst('room', 'Room 1'), r2 = inst('room', 'Room 2');
  const two = summaryInput(buildModel(snapshot(tpl('bath', 'kitchen'), [bath, kitchen, r1, r2]), [], [], emptyDraft()), { client: 'C' }, '', '');
  assert.deepEqual(two.come_back, ['the bathroom', 'the kitchen'], 'not "the bathroom, the kitchen, two more rooms"');
  const r3 = inst('room', 'Room 3');
  const three = summaryInput(buildModel(snapshot(tpl('bath', 'kitchen'), [bath, kitchen, r1, r2, r3]), [], [], emptyDraft()), { client: 'C' }, '', '');
  assert.deepEqual(three.come_back, ['the bathroom', 'the kitchen', 'one more room']);
  assert.equal(sayList(three.come_back), 'the bathroom, the kitchen and one more room');
  assert.ok(clientRecapText(clientSummary({ ...three, rooms: [] })).includes('Not measured today: the bathroom, the kitchen and one more room'), 'the recap says it as the screen does');
});

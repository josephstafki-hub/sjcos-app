// r16 design (docs/plans/reviews/build-consult-r16-design.md): "This room is part of" on a visit with
// two jobs offers no Skip, because a skip there never counts (R16-1); the hint says tick, matching the
// checkboxes (O1); the measures a Backsplash height choice opens sit under it (O2); a disabled primary
// button's label stays readable (O3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seedModules, templates } from '../lib/consult/forms/seed.ts';
import { backsplashOrder, buildModel, emptyDraft, roomMustPickJob } from '../lib/consult/ui/model.ts';
import { W } from '../lib/consult/ui/words.ts';

const root = new URL('../', import.meta.url);
const src = (p) => readFileSync(new URL(p, root), 'utf8');
const consultId = randomUUID();
const tpl = (...keys) => keys.map((k) => templates.find((t) => t.key === k));
const head = (instance_id, field_key, value, extra = {}) => ({ id: randomUUID(), instance_id, field_key, status: 'answered', value, skip_reason: null, skip_note: null, server_revision: '4', ...extra });
const snapshot = (tpls, instances = [], heads = []) => ({
  consult: { id: consultId, project_id: randomUUID(), status: 'in_progress', revision: '4', completion_generation: '1', conducted_by: randomUUID(), scheduled_at: '2026-11-06T15:00:00Z' },
  pins: [...seedModules.map((d) => ({ kind: 'module', definition: d })), ...tpls.map((t) => ({ kind: 'template', definition: t }))],
  instances: [{ id: consultId, module_key: 'visit', parent_id: null, removed_at: null }, ...instances],
  heads: [head(consultId, 'templates', tpls.map((t) => t.key)), ...heads],
  conflicts: [],
});
const inst = (module_key, label) => ({ id: randomUUID(), module_key, parent_id: null, removed_at: null, label });
const sectionOf = (m, id) => m.sections.find((s) => s.instance.id === id);

test('R16-1: on a two-job visit "This room is part of" has no Skip; its hint says tick (O1)', () => {
  const room = inst('room', 'Bath');
  const m = buildModel(snapshot(tpl('bath', 'kitchen'), [room]), [], [], emptyDraft());
  const f = sectionOf(m, room.id).fields.find((v) => v.key === 'part_of');
  assert.ok(f, 'the field shows on a two-job visit');
  assert.equal(f.noSkip, true);
  assert.deepEqual(f.def.options, ['Bathroom', 'Kitchen']);
  assert.equal(f.def.hint, W.partOfHint);
  assert.match(W.partOfHint, /^Tick the job that prices this room’s floor — usually just one\./);
  // Every other room field still offers Skip.
  assert.ok(sectionOf(m, room.id).fields.filter((v) => v.key !== 'part_of').every((v) => !v.noSkip));
  assert.equal(roomMustPickJob('room', 'part_of', 2), true);
  assert.equal(roomMustPickJob('room', 'part_of', 1), false);
  assert.equal(roomMustPickJob('room', 'length', 2), false);
});

test('R16-1: on a one-job visit the field is hidden', () => {
  const room = inst('room', 'Bath');
  const s = sectionOf(buildModel(snapshot(tpl('bath'), [room]), [], [], emptyDraft()), room.id);
  assert.equal(s.fields.find((v) => v.key === 'part_of'), undefined);
  assert.ok(s.hidden.find((v) => v.key === 'part_of'));
});

test('R16-1: a skip saved earlier stays Open and still counts as open work', () => {
  const room = inst('room', 'Bath');
  const skipped = head(room.id, 'part_of', null, { status: 'skipped', skip_reason: 'Not on this job' });
  const m = buildModel(snapshot(tpl('bath', 'kitchen'), [room], [skipped]), [], [], emptyDraft());
  const f = sectionOf(m, room.id).fields.find((v) => v.key === 'part_of');
  assert.equal(f.answer.status, 'skipped');
  assert.equal(f.noSkip, true);
  assert.equal(f.mark, 'open');
  assert.equal(f.skipCounts, false);
  assert.ok(m.open.some((o) => o.item === f), 'listed in Before you wrap');
});

test('R16-1: FieldRow hides Skip / Change reason, keeps Undo skip, and says why the old skip did not take', () => {
  assert.equal(W.partOfNoSkip, 'Pick at least one — every room has to belong to a job.');
  const row = src('components/consult/field/FieldRow.tsx');
  assert.match(row, /\{!f\.noSkip && \(\(!answered && d\.type !== "signature"\)[^\n]*\{skipped \? W\.changeReason : W\.skip\}<\/Btn>\}/);
  assert.match(row, /\{skipped && !\(d\.type === "signature" && f\.initials\) && <Btn tone="quiet"[^\n]*\{W\.undoSkip\}<\/Btn>\}/, 'Undo skip is not gated on noSkip');
  assert.match(row, /\{skipped && <p [^>]*>\{f\.noSkip \? W\.partOfNoSkip : skipLine\(f\)\}<\/p>\}/);
  // The only field-level Skip in the visit is that one button.
  assert.equal(row.match(/actions\.skip\(\{ field: f/g)?.length, 1);
});

test('O2: the fields Backsplash height opens follow it, not Pantry', () => {
  const order = (keys) => backsplashOrder(keys.map((key) => ({ key }))).map((v) => v.key);
  assert.deepEqual(order(['island', 'backsplash_height', 'sink_stays', 'pantry', 'backsplash_measured_height', 'range_wall_tile']),
    ['island', 'backsplash_height', 'backsplash_measured_height', 'range_wall_tile', 'sink_stays', 'pantry']);
  assert.deepEqual(order(['backsplash_height', 'range_on_wall', 'sink_stays', 'backsplash_measured_height', 'range_wall_tile']),
    ['backsplash_height', 'backsplash_measured_height', 'range_on_wall', 'range_wall_tile', 'sink_stays']);
  assert.deepEqual(order(['sink_stays', 'range_wall_tile']), ['sink_stays', 'range_wall_tile'], 'no choice → order untouched');

  const k = inst('kitchen_scope', 'Kitchen');
  const m = buildModel(snapshot(tpl('kitchen'), [k], [head(k.id, 'backsplash_height', 'Full wall at range'), head(k.id, 'range_on_wall', true)]), [], [], emptyDraft());
  const keys = sectionOf(m, k.id).fields.map((v) => v.key);
  const at = keys.indexOf('backsplash_height');
  assert.ok(at >= 0);
  const opened = keys.filter((x) => ['backsplash_measured_height', 'range_on_wall', 'range_wall_tile'].includes(x));
  assert.ok(opened.includes('backsplash_measured_height') && opened.includes('range_wall_tile'));
  assert.deepEqual(keys.slice(at + 1, at + 1 + opened.length), opened);
});

test('O3: a disabled primary button reads ≥ 4.5:1 and drops the accent fill', () => {
  const prim = src('components/consult/field/primitives.tsx');
  const look = prim.match(/const DISABLED_PRIMARY = "([^"]+)"/)[1];
  assert.match(look, /\bbg-paper-3\b/);
  assert.match(look, /\btext-ink-2\b/);
  assert.doesNotMatch(look, /opacity|accent|dashed/);
  assert.match(prim, /rest\.disabled && tone === "primary" \? DISABLED_PRIMARY : `disabled:opacity-45 \$\{TONES\[tone\]\}`/);
  const css = src('app/globals.css');
  const hex = (name) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))[1];
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const [a, b] = [lum(hex('ink-2')), lum(hex('paper-3'))].sort((x, y) => y - x);
  assert.ok((a + 0.05) / (b + 0.05) >= 4.5, `contrast ${((a + 0.05) / (b + 0.05)).toFixed(2)}`);
  // The Close button that R16 O3 named is a primary Btn with disabled.
  assert.match(src('components/consult/field/WrapClose.tsx'), /<Btn tone="primary" className="max-md:w-full" onClick=\{onCloseVisit\} disabled=\{conflictN > 0 \|\| refused > 0\}>\{closeLabel\}<\/Btn>/);
});

// Round-4 design judge screen fixes (docs/plans/reviews/build-consult-r4-design.md): the leave check
// as a bottom sheet (R4-2), matching fraction keys that fit at 320×700 (C1), section names that tell
// sections apart (R4-8), curly punctuation in what the visitor and client read (R4-9), the neutral
// Open style in Before you wrap (R4-5), and the small copy items (R4-10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seedModules, templates, addOns } from '../lib/consult/forms/seed.ts';
import { buildModel, emptyDraft, moduleNoun } from '../lib/consult/ui/model.ts';
import { curly } from '../lib/consult/typography.ts';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const consultId = randomUUID();
const tpl = (...keys) => keys.map((k) => templates.find((t) => t.key === k));
const inst = (module_key, label, parent_id = null) => ({ id: randomUUID(), module_key, parent_id, removed_at: null, label });
function snapshot(tpls, instances = []) {
  return {
    consult: { id: consultId, project_id: randomUUID(), status: 'in_progress', revision: '4', completion_generation: '1', conducted_by: randomUUID(), scheduled_at: '2026-11-06T15:00:00Z' },
    pins: [...seedModules.map((d) => ({ kind: 'module', definition: d })), ...tpls.map((t) => ({ kind: 'template', definition: t }))],
    instances: [{ id: consultId, module_key: 'visit', parent_id: null, removed_at: null }, ...instances],
    heads: [{ id: randomUUID(), instance_id: consultId, field_key: 'templates', status: 'answered', value: tpls.map((t) => t.key), skip_reason: null, skip_note: null, server_revision: '4' }],
    conflicts: [],
  };
}

test('curly(): apostrophes, quotes and feet/inch marks', () => {
  assert.equal(curly("Hi, I'm Joe — we'll start"), 'Hi, I’m Joe — we’ll start');
  assert.equal(curly('Client\'s own list ("anything you want us to look at")'), 'Client’s own list (“anything you want us to look at”)');
  assert.equal(curly('reads as 6\' 9"'), 'reads as 6′ 9″');
  assert.equal(curly('Wall used as “Ahead”'), 'Wall used as “Ahead”');
});

test('every seed string the visitor or client reads is typeset: no straight \' or "', () => {
  const seen = [];
  for (const m of seedModules) {
    seen.push([`${m.key}.title`, m.title], ...m.say.map((l, i) => [`${m.key}.say${i}`, l]));
    for (const f of m.fields) {
      seen.push([`${m.key}.${f.key}.label`, f.label]);
      if (f.hint) seen.push([`${m.key}.${f.key}.hint`, f.hint]);
      if (f.say) seen.push([`${m.key}.${f.key}.say`, f.say]);
      for (const fl of [...(f.flag ? [f.flag] : []), ...(f.flags ?? [])]) if (fl.hint) seen.push([`${m.key}.${f.key}.flag`, fl.hint]);
      for (const s of f.shots ?? []) seen.push([`${m.key}.${f.key}.shot`, s.label]);
    }
    for (const s of m.shots) seen.push([`${m.key}.shot.${s.key}`, s.label]);
  }
  for (const t of [...templates, ...addOns]) for (const k of ['opening', 'closing', 'opening_staff', 'closing_staff']) for (const l of t[k] ?? []) seen.push([`${t.key}.${k}`, l]);
  const straight = seen.filter(([, s]) => /['"]/.test(s));
  assert.deepEqual(straight, []);
  assert.ok(seen.some(([, s]) => s.includes('I’m Joe')), 'the opening line is curly');
});

test('section names tell the visitor which is which; add buttons use the row noun', () => {
  const byKey = Object.fromEntries(seedModules.map((m) => [m.key, m]));
  assert.equal(moduleNoun(byKey.room), 'Room');
  assert.equal(moduleNoun(byKey.bath_scope), 'Bathroom work');
  assert.equal(moduleNoun(byKey.panel), 'Electrical panel');
  assert.equal(moduleNoun(byKey.kitchen_wall), 'Kitchen wall');
  assert.equal(byKey.kitchen_scope.title, 'Kitchen work');
  const room = inst('room', 'Room 1 — Bath'), bath = inst('bath_scope', 'Bathroom work 1'), panel = inst('panel', 'Panel 1 — Kitchen');
  const structure = inst('structure', 'Structure check 1 — Bath'), moisture = inst('moisture', 'Moisture check 1 — Bath'), vent = inst('hvac_vent', 'Appliance 1 — Bath');
  const m = buildModel(snapshot(tpl('bath', 'kitchen'), [room, bath, panel, structure, moisture, vent]), [], [], emptyDraft());
  const label = (i) => m.sections.find((x) => x.instance.id === i.id).label;
  assert.equal(label(room), 'Room 1 — Bath');
  assert.equal(label(bath), 'Bathroom work 1');
  assert.equal(label(panel), 'Electrical panel 1', 'the panel serves the house, never "— Kitchen"');
  assert.equal(label(structure), 'Structure check 1 — Bath', 'repeats carry their area alike');
  assert.equal(label(moisture), 'Moisture check 1 — Bath');
  assert.equal(label(vent), 'Vented appliance 1', 'never "Appliance 1" beside the kitchen appliances');
  const controller = src('lib/consult/ui/controller.ts');
  assert.match(controller, /HOUSE_WIDE\.has\(slot\.module\.key\)/);
  assert.doesNotMatch(controller, /model\.templates\[0\]\?\.title/, 'no fallback area past the templates’ minimums');
});

test('screens: leave check is a sheet, keypad fractions are one font, wrap lines are neutral Open, copy items', () => {
  const visit = src('components/consult/field/VisitScreen.tsx');
  assert.doesNotMatch(visit, /leave\.from === section\.instance\.id/, 'no banner at the top of the section');
  assert.match(visit, /<Sheet open dock (compact )?(noClose )?onClose=\{\(\) => setLeave\(null\)\}/);
  assert.match(visit, /xl:grid xl:grid-cols-2/); assert.doesNotMatch(visit, /md:grid md:grid-cols-2/);
  assert.match(visit, /view === "section" && section \? section\.module\.say : \[\]/, 'field Say lines are not repeated in the left pane');
  const keypad = src('components/consult/field/Keypad.tsx');
  assert.match(keypad, /FracGlyph/); assert.doesNotMatch(keypad, /GLYPH\[f\]/);
  assert.match(keypad, /max-height:700px/);
  const wrap = src('components/consult/field/WrapClose.tsx');
  assert.match(wrap, /state="open" \/><span className="min-w-0 break-words">\{text\}/);
  assert.match(wrap, /closing\.code === "close_timeout"/); assert.match(wrap, /W\.stillClosing/);
  assert.doesNotMatch(wrap, /warn=\{undecidedFlags/, 'undecided flags are not a Problem');
  const app = src('components/consult/field/ConsultApp.tsx');
  assert.match(app, /const busy = sending && unsent > 0/); assert.match(app, /W\.settingUp/); assert.match(app, /ensureRequiredInstances\(\)/);
  assert.match(src('components/consult/office/ScheduleDialog.tsx'), /Pick at least one template/);
});

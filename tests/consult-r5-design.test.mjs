// Round-5 design + domain judge screen fixes (docs/plans/reviews/build-consult-r5-design.md,
// build-consult-r5-domain.md): Go back moves only the section pane (R5-1), the calm office look-over
// (R5-4), 56 px keypad keys with words on ⌫ / ␣ and a 16ths row (R5-5, domain 4), the closing heading
// (R5-7), curly punctuation in every consult component (R5-8), the last names (R5-9), a way forward on
// every open close check, and the missing required child row (domain 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { seedModules, templates } from '../lib/consult/forms/seed.ts';
import { buildModel, emptyDraft, moduleNoun, selectionHint, selectionName } from '../lib/consult/ui/model.ts';
import { closeAction } from '../lib/consult/completeness.ts';
import { CHECK_ACTION_WORDS, OFFICE_CHECK_WORDS, W, checkCount } from '../lib/consult/ui/words.ts';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const consultId = randomUUID();
const tpl = (...keys) => keys.map((k) => templates.find((t) => t.key === k));
const inst = (module_key, label, parent_id = null) => ({ id: randomUUID(), module_key, parent_id, removed_at: null, label });
function snapshot(tpls, instances = [], heads = []) {
  return {
    consult: { id: consultId, project_id: randomUUID(), status: 'in_progress', revision: '4', completion_generation: '1', conducted_by: randomUUID(), scheduled_at: '2026-11-06T15:00:00Z' },
    pins: [...seedModules.map((d) => ({ kind: 'module', definition: d })), ...tpls.map((t) => ({ kind: 'template', definition: t }))],
    instances: [{ id: consultId, module_key: 'visit', parent_id: null, removed_at: null }, ...instances],
    heads: [{ id: randomUUID(), instance_id: consultId, field_key: 'templates', status: 'answered', value: tpls.map((t) => t.key), skip_reason: null, skip_note: null, server_revision: '4' }, ...heads],
    conflicts: [],
  };
}
const head = (instance_id, field_key, value) => ({ id: randomUUID(), instance_id, field_key, status: 'answered', value, skip_reason: null, skip_note: null, server_revision: '4' });

/** Source without comments, so a ' in a code comment is not "text the visitor reads". */
function code(text) {
  return text.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
}
function files(dir) {
  const out = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = `${d}/${f}`; if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) out.push(p); } };
  walk(new URL(`../${dir}`, import.meta.url).pathname);
  return out;
}

test('R5-8: no straight apostrophe or quote entity in consult components, the look-over or words.ts', () => {
  const hits = [];
  for (const f of [...files('components/consult'), new URL('../app/(os)/projects/[slug]/consult/[id]/page.tsx', import.meta.url).pathname]) {
    const body = code(readFileSync(f, 'utf8'));
    for (const m of body.matchAll(/&apos;|&quot;|&#39;|\b[A-Za-z]+'(?:s|t|ll|re|ve|m|d)\b/g)) hits.push(`${f.split('/').slice(-2).join('/')}: ${m[0]}`);
  }
  assert.deepEqual(hits, []);
  const straight = Object.entries(W).filter(([, v]) => typeof v === 'string' && /'/.test(v));
  assert.deepEqual(straight, [], 'every W string uses ’');
  assert.equal(W.pinWrongHandBack, 'That PIN doesn’t match. Try again, or hold Hand back.');
  assert.match(src('components/consult/field/ClientView.tsx'), /W\.pinWrongHandBack/);
});

test('R5-1: a jump scrolls only the section pane; the visitor screen is pinned to the viewport', () => {
  for (const f of ['FieldRow.tsx', 'VisitScreen.tsx']) assert.doesNotMatch(code(src(`components/consult/field/${f}`)), /scrollIntoView/, f);
  assert.match(src('components/consult/field/primitives.tsx'), /export function scrollInPane/);
  const css = src('app/consult/consult.css');
  assert.match(css, /\.consult-fixed \{ position: fixed; inset: 0; \}/);
  assert.match(css, /html:has\(\.consult-fixed\), html:has\(\.consult-fixed\) body \{ overflow: clip;/);
  assert.match(css, /\.consult-ring/);
  const app = src('components/consult/field/ConsultApp.tsx');
  assert.match(app, /consult-root consult-fixed flex flex-col/);
  assert.match(app, /<main data-scroll className="flex min-h-0 flex-1 flex-col overflow-y-auto/);
  const row = src('components/consult/field/FieldRow.tsx');
  assert.match(row, /setTimeout\(\(\) => setRing\(false\), 1500\)/);
  assert.match(row, /actions\.focusTick/, 'Go back to the same field scrolls and rings again');
});

test('R5-5 / domain 4: keypad keys and mode chips never under 56 px; words under ⌫ and ␣; a 16ths row', () => {
  const k = src('components/consult/field/Keypad.tsx');
  assert.doesNotMatch(k, /max-height:700px\)\]:min-h-1[12]\b/, 'no 44/48 px keys or chips on short screens');
  assert.doesNotMatch(k, /md:max-lg:min-h-12/, 'tablet-portrait mode chips are 56 px');
  assert.match(k, /title=\{label\} dock tall/, 'full-height sheet at ≤ 700 px tall');
  assert.match(src('components/consult/field/primitives.tsx'), /\[@media\(max-height:700px\)\]:h-dvh!/);
  assert.match(k, /worded\("⌫", W\.keyDelete\)/); assert.match(k, /worded\("␣", W\.keySpace\)/);
  assert.equal(W.keyDelete, 'Delete'); assert.equal(W.keySpace, 'Space');
  assert.match(k, /const SIXTEENTHS = \["1\/16", "3\/16", "5\/16", "7\/16", "9\/16", "11\/16", "13\/16", "15\/16"\]/);
  assert.match(k, /precisionOf\(def\) === 1 \/ 16/);
});

test('R5-7: the closing heading says what is happening; R5-9: names', () => {
  assert.equal(W.visitClosedChecking, 'Visit closed — checking with the office');
  assert.match(src('components/consult/field/WrapClose.tsx'), /unsent > 0 \? W\.visitClosedSending : W\.visitClosedChecking/);
  assert.doesNotMatch(W.closeChecking, /Checking/, 'the heading says it once');
  const byKey = Object.fromEntries(seedModules.map((m) => [m.key, m]));
  assert.equal(moduleNoun(byKey.selections), 'Selection');
  const kitchen = templates.find((t) => t.key === 'kitchen');
  assert.ok(kitchen.modules.find((m) => m.module === 'selections').presets.some((p) => p.decision === 'Appliances'));
  assert.equal(selectionName('Kitchen — Appliance package (each appliance)'), 'Kitchen — Appliances', 'visits made before the rename');
  assert.equal(selectionHint('Kitchen — Appliances'), 'One line per appliance.');
  const scope = inst('kitchen_scope', 'Kitchen work'); const appliance = inst('kitchen_appliance', 'Appliance 1 — Kitchen', scope.id);
  const sel = inst('selections', 'Kitchen — Appliance package (each appliance)'); const added = inst('selections', 'Selection 31');
  const m = buildModel(snapshot(tpl('kitchen'), [scope, appliance, sel, added]), [], [], emptyDraft());
  const label = (i) => m.sections.find((x) => x.instance.id === i.id).label;
  assert.equal(label(appliance), 'Appliance 1', 'a child row drops the area its parent already says');
  assert.equal(label(sel), 'Kitchen — Appliances');
  assert.equal(label(added), 'Selection 31');
});

test('domain 3: a required child that is missing is listed in its parent section', () => {
  const hvac = inst('hvac', 'Heating & cooling');
  const m = buildModel(snapshot(tpl('bath'), [hvac], [head(hvac.id, 'fuel_appliances', true)]), [], [], emptyDraft());
  const s = m.sections.find((x) => x.instance.id === hvac.id);
  const vent = s.missingRequiredChildren.find((c) => c.module_key === 'hvac_vent');
  assert.ok(vent, 'the vented-appliance slot is listed');
  assert.equal(vent.missing, 1); assert.equal(vent.live, 0);
  const screen = src('components/consult/field/VisitScreen.tsx');
  assert.match(screen, /section\.missingRequiredChildren\.filter\(\(c\) => c\.missing > 0\)/);
  assert.match(screen, /\{W\.addChild\}/); assert.equal(W.addChild, 'Add');
});

test('every open close check carries its way forward; counts show for one item too', () => {
  for (const code of ['required_fields', 'required_photos', 'module_requirements', 'permissions', 'client_acknowledgement', 'promised_date', 'close_manifests', 'rrp', 'flag_decisions', 'risk_assumptions', 'trade_walks']) {
    assert.ok(CHECK_ACTION_WORDS[closeAction(code)], `${code} has a button`);
  }
  assert.equal(CHECK_ACTION_WORDS.review_flags, W.reviewFlags); assert.equal(CHECK_ACTION_WORDS.pick_date, W.pickDate); assert.equal(CHECK_ACTION_WORDS.show_client, W.showToClient);
  assert.equal(checkCount('module_requirements', 1), ' · 1 left');
  const wrap = src('components/consult/field/WrapClose.tsx');
  assert.match(wrap, /const action = c\.action \?\? closeAction\(c\.code\)/);
  const screen = src('components/consult/field/VisitScreen.tsx');
  for (const a of ['review_flags', 'pick_date', 'show_client', 'review_trades', 'review_rrp', 'go_field', 'take_photo', 'add_instance']) assert.match(screen, new RegExp(`case "${a}"`));
});

test('R5-4: the office look-over is calm and speaks for the office, not "this device"', () => {
  const page = src('app/(os)/projects/[slug]/consult/[id]/page.tsx');
  assert.doesNotMatch(page, /border-flag bg-flag-soft px-4 py-3 text-body text-ink">\s*<p className="font-semibold"><span aria-hidden className="text-flag">⚠ <\/span>Needs finishing/);
  assert.match(page, /◐ <\/span>\{W\.needsFinishing\}/);
  assert.match(page, /OFFICE_CHECK_WORDS\[c\.code\]/);
  assert.doesNotMatch(OFFICE_CHECK_WORDS.close_manifests, /this device/);
  assert.equal(W.officeDevicesWaiting.replace('{n}', '8'), '8 devices haven’t sent yet');
  assert.match(page, /id="recover"/);
});

test('domain 1 / 2: the summary hint, the date before the client initials', () => {
  const closing = seedModules.find((m) => m.key === 'closing');
  assert.equal(closing.fields.find((f) => f.key === 'summary').hint, 'What the client initialed.');
  const keys = closing.fields.map((f) => f.key);
  assert.ok(keys.indexOf('estimate_promised') < keys.indexOf('client_initials'));
  assert.equal(W.pickDateBeforeClient, 'Pick the estimate date first, so the client sees it.');
  const screen = src('components/consult/field/VisitScreen.tsx');
  assert.match(screen, /const needDate = !model\.promised && dateField\?\.answer\?\.status !== "skipped"/, 'a skipped date frees Show to client');
  assert.match(src('components/consult/field/ConsultApp.tsx'), /onInitials=\{async \(png, summaryText\)/);
  assert.equal(W.moreForEstimate, 'and {n} more — listed on your estimate');
  assert.equal(W.handBackWithPin, 'Hand back with PIN'); assert.equal(W.noInitialsSay, 'No initials — say why');
});

// Round-6 design + domain judge screen fixes (docs/plans/reviews/build-consult-r6-design.md D2–D9,
// build-consult-r6-domain.md screen parts): stacked wrap rows below 600 px, the 1/16″ keypad at
// 320 × 700, flag cards that lead with the measured value, skip reasons by field type, close checks in
// open-state words, American spelling, one Say per opening card, the honest Built before 1978? answer,
// the read-only walk-through summary, and Hand back with PIN after a wrong PIN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { seedModules, templates } from '../lib/consult/forms/seed.ts';
import { buildModel, emptyDraft, YEAR_HINT_FILLED, YEAR_HINT_WAITING } from '../lib/consult/ui/model.ts';
import { flagLead } from '../lib/consult/ui/flag-lead.ts';
import { openCheckPhrase } from '../lib/consult/completeness.ts';
import { SKIP_REASONS, W, skipReasonsFor } from '../lib/consult/ui/words.ts';
import { FLAG_HINTS } from '../lib/consult/forms/seed/flag-hints.ts';
import { OfflineVault } from '../lib/consult/offline-vault.ts';
import { ConsultOfflineStore } from '../lib/consult/offline.ts';
import { signOfflineLease } from '../lib/consult/offline-lease.ts';
import { memoryIndexedDB } from './_harness/consult-idb.mjs';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const consultId = randomUUID();
const tpl = (...keys) => keys.map((k) => templates.find((t) => t.key === k));
const inst = (module_key, label, parent_id = null) => ({ id: randomUUID(), module_key, parent_id, removed_at: null, label });
const head = (instance_id, field_key, value) => ({ id: randomUUID(), instance_id, field_key, status: 'answered', value, skip_reason: null, skip_note: null, server_revision: '4' });
function snapshot(tpls, instances = [], heads = []) {
  return {
    consult: { id: consultId, project_id: randomUUID(), status: 'in_progress', revision: '4', completion_generation: '1', conducted_by: randomUUID(), scheduled_at: '2026-11-06T15:00:00Z' },
    pins: [...seedModules.map((d) => ({ kind: 'module', definition: d })), ...tpls.map((t) => ({ kind: 'template', definition: t }))],
    instances: [{ id: consultId, module_key: 'visit', parent_id: null, removed_at: null }, ...instances],
    heads: [head(consultId, 'templates', tpls.map((t) => t.key)), ...heads],
    conflicts: [],
  };
}
/** Source without comments, so a word in a code comment is not text anyone reads. */
const code = (text) => text.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
function files(dir) {
  const out = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = `${d}/${f}`; if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) out.push(p); } };
  walk(new URL(`../${dir}`, import.meta.url).pathname);
  return out;
}

test('D7: American spelling — initialed, center — in every visible consult string', () => {
  const paths = [...files('components/consult'), ...files('lib/consult/ui'),
    new URL('../app/(os)/projects/[slug]/consult/[id]/page.tsx', import.meta.url).pathname,
    new URL('../lib/consult/forms/seed/flag-hints.ts', import.meta.url).pathname,
    new URL('../lib/consult/forms/seed/template-modules.ts', import.meta.url).pathname,
    new URL('../lib/consult/forms/seed/shared.ts', import.meta.url).pathname];
  const hits = [];
  for (const p of paths) for (const m of code(readFileSync(p, 'utf8')).matchAll(/\binitiall\w*|\bcentr(?:e|ed|es)\b|centre-to-centre/gi)) hits.push(`${p.split('/').slice(-2).join('/')}: ${m[0]}`);
  assert.deepEqual(hits, []);
  assert.match(W.rrpReceipt, /initialed$/);
  assert.match(FLAG_HINTS['plumb_fixture.side_clearance'], /from its center/);
});

test('D2: wrap rows stack below 600 px — words, note, then full-width buttons', () => {
  const wrap = code(src('components/consult/field/WrapClose.tsx'));
  assert.match(wrap, /min-\[600px\]:grid-cols-\[minmax\(0,1fr\)_auto\]/, 'side by side only from 600 px');
  assert.match(wrap, /max-\[599px\]:\[&_button\]:w-full/, 'buttons full width below 600 px');
  assert.doesNotMatch(wrap, /action && !stack \? "grid-cols-\[minmax\(0,1fr\)_auto\]"/, 'no side-by-side row at every width');
});

test('D3: 1/16″ keypad — Show 16ths in the footer, title one line on short screens', () => {
  const k = code(src('components/consult/field/Keypad.tsx'));
  const footer = k.slice(k.indexOf('footer={<>'), k.indexOf('</>}>'));
  assert.match(footer, /W\.show16ths/, 'the switch is in the footer');
  assert.ok(footer.indexOf('W.show16ths') < footer.indexOf('W.save'), 'left of Save');
  assert.match(footer, /mr-auto/);
  assert.equal(k.match(/W\.show16ths/g).length, 1, 'not also in the readout');
  assert.match(k, /\[@media\(max-height:700px\)\]:line-clamp-1/);
});

test('D4: a flag card leads with the measured value and has Go to field', () => {
  const bath = inst('bath_scope', 'Bathroom work 1');
  const def = seedModules.find((m) => m.key === 'bath_scope').fields.find((f) => f.key === 'toilet_plan');
  const m = buildModel(snapshot(tpl('bath'), [bath], [head(bath.id, 'toilet_plan', def.options[0]), head(bath.id, 'toilet_front_clearance', 20)]), [], [], emptyDraft());
  const flag = m.flags.find((f) => f.key === `${bath.id}:toilet_front_clearance`);
  assert.ok(flag, 'the clearance flag fires on a measured 20″');
  // r7 domain 3: a kept toilet is advice for Joe; a new one gets the Minnesota code line.
  assert.equal(flag.kind, 'advisory');
  assert.equal(flagLead(flag, m), 'Measured 20″ — less than 24″ in front of the toilet. It’s staying where it is, so Joe decides whether it needs to change.');
  const fresh = buildModel(snapshot(tpl('bath'), [bath], [head(bath.id, 'toilet_plan', 'New standard'), head(bath.id, 'toilet_front_clearance', 20)]), [], [], emptyDraft()).flags.find((f) => f.key === `${bath.id}:toilet_front_clearance`);
  assert.equal(fresh.kind, 'code');
  assert.equal(flagLead(fresh, m), 'Measured 20″ — less than 24″ in front of the toilet — a new toilet needs at least 24″ (Minnesota plumbing code).');
  assert.equal(flagLead({ ...flag, measured: [{ ...flag.measured[0], value: 19.5 }] }, m).split(' — ')[0], 'Measured 19 1/2″');
  assert.equal(flagLead({ ...flag, measured: [] }, m), flag.hint, 'nothing measured: the hint alone');
  const wrap = code(src('components/consult/field/WrapClose.tsx'));
  assert.match(wrap, /flagLead\(f, model\)/);
  assert.match(wrap, /<Btn tone="quiet" onClick=\{\(\) => onGo\(f\.address\.split\(":"\)\[0\], f\.address\)\}>\{W\.goToField\}/);
  assert.match(code(src('components/consult/field/VisitScreen.tsx')), /<FlagSheet open onClose=\{\(\) => setSheet\("wrap"\)\} model=\{model\} draft=\{draft\} saveError=\{saveError\} onSave=\{api\.setDraft\} onGo=/);
  for (const [k, v] of Object.entries(FLAG_HINTS)) assert.doesNotMatch(v, /\d+ in\b/, `${k} writes ″, not "in"`);
});

test('D5: skip reasons fit the field — signature, estimate date, measurement', () => {
  assert.deepEqual(skipReasonsFor({ type: 'signature', key: 'client_initials' }), ['Client absent', 'Client declined', 'Other']);
  assert.deepEqual(skipReasonsFor({ type: 'date', key: 'estimate_promised' }), ['Joe sets the date', 'Other']);
  assert.deepEqual(skipReasonsFor({ type: 'length', key: 'length' }), SKIP_REASONS);
  const sheet = code(src('components/consult/field/SkipSheet.tsx'));
  assert.match(sheet, /skipReasonsFor\(field\)/); assert.doesNotMatch(sheet, /SKIP_REASONS\.filter/);
  assert.match(code(src('components/consult/field/VisitScreen.tsx')), /<SkipSheet field=\{skip\.field\?\.def\}/);
});

test('D6: open close checks say what is left, on the visit and the look-over', () => {
  assert.equal(openCheckPhrase('flag_decisions', ['a', 'b', 'c', 'd', 'e', 'f', 'g']), 'Flags: 7 need a decision');
  assert.equal(openCheckPhrase('client_acknowledgement', ['x']), 'Client initials — not yet');
  for (const f of ['components/consult/field/WrapClose.tsx', 'app/(os)/projects/[slug]/consult/[id]/page.tsx']) {
    const body = code(src(f));
    assert.match(body, /c\.open_phrase \?\? openCheckPhrase\(c\.code, c\.open\)/, f);
    assert.doesNotMatch(body, /CHECK_WORDS\[c\.code\]/, `${f}: no rule sentence on an open row`);
  }
});

test('D8: the opening cards drop the field’s own Say line', () => {
  const screen = code(src('components/consult/field/VisitScreen.tsx'));
  assert.match(screen, /photosField && <FieldRow f=\{hideSay\(photosField\)\}/);
  assert.match(screen, /clientList && <FieldRow f=\{hideSay\(clientList\)\}/);
});

test('D9: Built before 1978? shows where its answer came from, stays first and changeable', () => {
  const house = inst('house', 'House & household'), era = inst('era', 'Era hazards');
  const at = (heads) => buildModel(snapshot(tpl('bath'), [house, era], heads), [], [], emptyDraft()).sections.find((s) => s.instance.id === era.id);
  const before = (s) => s.fields.find((f) => f.key === 'before_1978');
  // Year built empty: no pick, and the hint says what it waits for.
  let s = at([]);
  assert.equal(before(s).answer, undefined); assert.equal(before(s).prefilledFrom, undefined);
  assert.equal(before(s).def.hint, YEAR_HINT_WAITING);
  assert.equal(YEAR_HINT_WAITING, 'Fills in once Year built is confirmed in House & household.');
  // 1985: No is picked, from Year built.
  s = at([head(house.id, 'year_built', 1985)]);
  assert.equal(before(s).answer.value, false); assert.equal(before(s).prefilledFrom.label, 'From Year built (1985)');
  assert.equal(before(s).def.hint, YEAR_HINT_FILLED); assert.equal(s.fields[0].key, 'before_1978');
  // The visitor's own Yes on 1985: the RRP rows open below it, and it stays first and visible.
  s = at([head(house.id, 'year_built', 1985), head(era.id, 'before_1978', true)]);
  assert.equal(before(s).answer.value, true); assert.equal(before(s).prefilledFrom, undefined); assert.equal(before(s).def.hint, undefined);
  assert.equal(s.fields[0].key, 'before_1978');
  assert.ok(s.fields.some((f) => f.key === 'window_door_replacement'), 'the RRP rows are open');
  // 1965 + No: the reason it asks for comes right under the answer.
  s = at([head(house.id, 'year_built', 1965), head(era.id, 'before_1978', false)]);
  assert.deepEqual(s.fields.slice(0, 2).map((f) => f.key), ['before_1978', 'year_override_reason']);
  const row = code(src('components/consult/field/FieldRow.tsx'));
  assert.match(row, /f\.prefilledFrom && answered && f\.answer!\.value === v \? ` · \$\{f\.prefilledFrom\.label\}`/, 'the source sits on the picked choice');
});

test('read-only walk-through summary: What the client initialed, no Save or Skip; curly quotes', () => {
  const closing = inst('closing', 'Closing');
  const m = buildModel(snapshot(tpl('bath'), [closing], [head(closing.id, 'summary', 'What we went over\nMichael Larson\nBath')]), [], [], emptyDraft());
  const f = m.sections.find((s) => s.instance.id === closing.id).fields.find((x) => x.key === 'summary');
  assert.equal(f.readOnly, true);
  const row = code(src('components/consult/field/FieldRow.tsx'));
  const ro = row.slice(row.indexOf('function ReadOnlyText'), row.indexOf('export function FieldRow'));
  assert.match(ro, /W\.clientInitialedTitle/); assert.doesNotMatch(ro, /W\.save|W\.skip|<textarea|<input/);
  assert.equal(W.clientInitialedTitle, 'What the client initialed');
  assert.match(row, /if \(f\.readOnly\) return <ReadOnlyText/);
  assert.doesNotMatch(row, /client's/);
});

test('extras: Tap to measure, offline close heading, nothing ever sent, the look-over ◐ and name', () => {
  assert.equal(W.tapToEnter, 'Tap to measure');
  assert.doesNotMatch(code(src('components/consult/field/FieldRow.tsx')), /\[ \{W\.tapToEnter\} \]/);
  assert.equal(W.visitClosedOffline, 'Visit closed — will send when signal returns');
  assert.match(code(src('components/consult/field/WrapClose.tsx')), /online \? W\.visitClosedSending : W\.visitClosedOffline/);
  assert.match(code(src('components/consult/field/ConsultApp.tsx')), /unsent === 0 \? \(lastSend \? W\.allSent : W\.nothingWaiting\)/);
  const page = code(src('app/(os)/projects/[slug]/consult/[id]/page.tsx'));
  assert.match(page, /<span aria-hidden className="font-mono">◐<\/span>\}\{headline\}/, 'the pill uses the same ◐ as the card');
  assert.match(page, /fill\(W\.officeNeedsFinishingLead, \{ name: head\.visitor_name \}\)/);
  assert.equal(W.officeNeedsFinishingLead.replace('{name}', 'Abigail Stafki'), 'Abigail Stafki has a Finish consultation to-do.');
  assert.match(code(src('components/consult/field/VisitScreen.tsx')), /<Sheet open dock compact noClose/);
});

test('item 11: after a wrong PIN, the right PIN hands back (the short back-off is waited out)', async () => {
  const id = { user_id: 'visitor', session_epoch: 2, build: 'v1', consult_id: 'visit' };
  const store = await ConsultOfflineStore.open(memoryIndexedDB()), vault = new OfflineVault(store), now = Date.now();
  const signed = signOfflineLease({ user_id: id.user_id, session_epoch: id.session_epoch, expires_at: now + 3600000, consult_id: id.consult_id, device_id: 'device', build: id.build, issued_at: now }, Buffer.alloc(32, 7));
  await vault.enroll(id, 'device', '123456', signed);
  assert.equal(await vault.checkPin(id, 'device', '654321'), 'invalid_pin');
  // Before r6 the right PIN typed now hit `pin_retry_later` and read as "That PIN doesn’t match".
  await assert.rejects(vault.unlock(id, 'device', '123456'), /pin_retry_later/);
  const waits = [];
  assert.equal(await vault.checkPin(id, 'device', '123456', { sleep: async (ms) => { waits.push(ms); await new Promise((r) => setTimeout(r, ms)); } }), true);
  assert.equal(waits.length, 1); assert.ok(waits[0] <= 1100);
  // A long back-off is not waited out: it says so, and the box keeps the PIN.
  assert.equal(await vault.checkPin(id, 'device', '000000'), 'invalid_pin');
  assert.equal(await vault.checkPin(id, 'device', '123456', { waitUpTo: 0 }), 'pin_retry_later');
  store.close();
  const view = code(src('components/consult/field/ClientView.tsx'));
  assert.match(view, /if \(result === true\) \{ if \(handBackAllowed\(0, true\)\) onHandBack/);
  assert.match(view, /if \(result === "invalid_pin"\) setPin\(""\)/, 'only a wrong PIN clears the box');
  assert.match(view, /pinErr === "invalid_pin" \? W\.pinWrongHandBack : plainWords\(pinErr\)/);
  assert.match(code(src('lib/consult/ui/controller.ts')), /new OfflineVault\(this\.store\)\.checkPin\(identity, device, pin\)/);
});

// Round-7 design + domain judge screen fixes (docs/plans/reviews/build-consult-r7-design.md R7-1–R7-5
// and extras, build-consult-r7-domain.md screen parts of items 1, 3, 4, 6): the calm Complete screen on a
// device, a slow close as "◐ Still closing…", conflict sides named by where they came from, the
// inches-or-feet question in the laser row's place, skipped-field words, and lengths under 48″ in inches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seedModules } from '../lib/consult/forms/seed.ts';
import { W, plainWords, skipHelp, skipLine } from '../lib/consult/ui/words.ts';
import { displayLength } from '../lib/consult/length.ts';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const field = (m, k) => seedModules.find((x) => x.key === m).fields.find((x) => x.key === k);

test('R7-1: a Complete visit opens to the calm read-only screen, never Get ready or a PIN', () => {
  const ctl = src('lib/consult/ui/controller.ts');
  assert.match(ctl, /boot\?\.status==='complete'\) \{ this\.set\(\{ device, phase: 'complete' \}\); return; \}/);
  const app = src('components/consult/field/ConsultApp.tsx');
  assert.match(app, /st\.phase === "complete"\) body = <CompleteCard/);
  const card = src('components/consult/field/GetReady.tsx');
  const body = card.slice(card.indexOf('export function CompleteCard'), card.indexOf('export function UnlockCard'));
  assert.match(body, /text-accent-2">✓ \{W\.complete\}/);
  assert.doesNotMatch(body, /PinChoice|usePaper|text-flag|notReady/);
  assert.equal(W.completeLocked, 'Answers are locked. Joe can reopen it from the office look-over.');
});

test('R7-2: 408 / 429 / 5xx during close read as the calm Still closing words', () => {
  for (const c of ['http_408', 'http_429', 'http_503']) assert.equal(plainWords(c), W.stillClosingBody, c);
  const wrap = src('components/consult/field/WrapClose.tsx');
  assert.match(wrap, /const slow = closing\.step === "error" && \(closing\.code === "close_timeout" \|\| \/\^http_\(408\|429\|5\\d\\d\)\$\//);
  assert.match(wrap, /closing\.step === "error" && !slow && /);
  // Offline close: no signal is said by the strip and the heading — no third banner.
  const waiting = wrap.slice(wrap.indexOf('closing.step === "waiting_signal" &&'), wrap.indexOf('{slow && <>'));
  assert.doesNotMatch(waiting, /Banner/);
});

test('R7-3: conflict sides say where they came from and a blank side is not offered', () => {
  const row = src('components/consult/field/FieldRow.tsx');
  // r8 R8-2: this device, or any side with a person, is named by conflictSideLabel (person · time).
  assert.match(row, /side\.device === actions\.device\) \|\| side\.person \? conflictSideLabel\(side, other, actions\.device\)/);
  assert.match(row, /side\.available !== false && !\(side\.status === "answered" && side\.value === undefined\)/);
  const office = src('components/consult/office/LookOverActions.tsx');
  assert.match(office, /\{current\.available && <Button/);
  assert.match(office, /fill\(W\.pick, \{ value: current\.text \}\)\} · \{current\.from\}/);
});

test('R7-4: the inches-or-feet question takes the laser-mode row’s place', () => {
  const pad = src('components/consult/field/Keypad.tsx');
  assert.match(pad, /\{!\(amb !== null && !unitPick\) && <div className="mb-3 grid grid-cols-3/);
});

test('R7-5: skipped fields read "Skipped · reason · note", assumption words only on a measurement', () => {
  const date = { def: { type: 'date', key: 'estimate_promised', tier: 'price_critical' }, answer: { skip_reason: 'Joe sets the date', skip_note: 'after the lumber quote comes back' }, skipCounts: true, returnVisit: false };
  assert.equal(skipLine(date), 'Skipped · Joe sets the date · after the lumber quote comes back');
  const initials = { def: { type: 'signature', key: 'client_initials', tier: 'price_critical' }, answer: { skip_reason: 'Client declined', skip_note: 'Client declined' }, skipCounts: true, returnVisit: false };
  assert.equal(skipLine(initials), 'Skipped · Client declined');
  const length = { def: { type: 'length', key: 'wall', tier: 'price_critical' }, answer: { skip_reason: 'No access', skip_note: 'boxes' }, skipCounts: true, returnVisit: false };
  assert.equal(skipLine(length), 'Skipped · No access — assumption written · boxes');
  const choice = { ...length, def: { type: 'choice', key: 'x', tier: 'price_critical' } };
  assert.equal(skipLine(choice), 'Skipped · No access · boxes');
  assert.equal(skipLine({ ...length, skipCounts: false }), 'Skipped · No access — needs a written assumption to count · boxes');
  assert.doesNotMatch(skipLine(date), /N\/A|assumption/);
  assert.equal(skipHelp({ type: 'signature' }, 'Client declined'), 'The client chose not to initial. Write what they said.');
  assert.equal(skipHelp({ type: 'signature' }, 'Client absent'), 'The client wasn’t here to initial.');
  assert.equal(skipHelp({ type: 'date', key: 'estimate_promised' }, 'Joe sets the date'), 'Joe gets a to-do to set the date and tell the client.');
  assert.match(skipHelp({ type: 'length' }, 'Client declined'), /assumption/);
  const page = src('app/(os)/projects/[slug]/consult/[id]/page.tsx');
  assert.match(page, /"Client initialed ✓"/);
  assert.doesNotMatch(page, /Client ack/);
  assert.match(page, /\? skipLine\(f\) :/);
});

test('domain 3: toilet front clearance says what to measure; lengths under 48″ read in inches', () => {
  const f = field('bath_scope', 'toilet_front_clearance');
  assert.equal(f.hint, 'From the front of the bowl to the nearest wall, vanity, tub or door swing in front of it.');
  assert.equal(f.flag.hint, 'Less than 24″ in front of the toilet — a new toilet needs at least 24″ (Minnesota plumbing code).');
  assert.equal(displayLength(18), '18″');
  assert.equal(displayLength(19.5), '19 1/2″');
  assert.match(src('components/consult/field/Keypad.tsx'), /typeof value === "number"\) return displayLength\(value, p\)/);
  assert.match(src('app/(os)/projects/[slug]/consult/[id]/page.tsx'), /return displayLength\(v, p\)/);
});

test('extras: still open, not on file, Go to photo, drawn rings, flag title inside, year hint', () => {
  const wrap = src('components/consult/field/WrapClose.tsx');
  assert.match(wrap, /\$\{W\.stillOpen\}/);
  assert.equal(W.stillOpen, 'still open');
  assert.equal(W.rrpShortFirmMissing, 'firm certification not on file');
  assert.doesNotMatch(wrap, /<legend className="px-1 font-semibold text-flag">⚑/);
  assert.match(src('app/(os)/projects/[slug]/consult/[id]/page.tsx'), /\{W\.goToPhoto\}<\/Button>/);
  const prim = src('components/consult/field/primitives.tsx');
  assert.match(prim, /<Ring on=\{on\} \/>/);
  assert.doesNotMatch(prim, /\? "●" : "○"/);
  assert.equal(field('era', 'year_override_reason').hint, 'If Year built is wrong, change Year built instead.');
});

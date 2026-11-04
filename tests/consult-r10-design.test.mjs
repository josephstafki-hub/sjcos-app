// r10 design: a refused close says "Not closed yet" with a line and a fix for its own code; the
// certification warning names who, both dates and what to do, only when Renovate Right applies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLOSE_ERROR_ACTIONS } from '../lib/consult/close-errors.ts';
import { CLOSE_REFUSED_FALLBACK, W, closeRefusal, plainWords } from '../lib/consult/ui/words.ts';
import { certificationWarnings, certWarningParts } from '../lib/consult/rrp.ts';
import { closeResultOpenCount } from '../lib/consult/completeness.ts';

const GENERIC = plainWords('__never_a_code__');

test('no close code falls through to the default line', () => {
  for (const code of Object.keys(CLOSE_ERROR_ACTIONS)) {
    const r = closeRefusal(code);
    assert.equal(r.known, true, code);
    assert.ok(r.line && r.line !== CLOSE_REFUSED_FALLBACK && r.line !== GENERIC, `${code} has its own line`);
    assert.equal(r.fix, CLOSE_ERROR_ACTIONS[code], `${code} keeps its fix`);
    assert.doesNotMatch(r.line, /Try again\.$/, `${code} does not repeat the button`);
  }
});

test('every refusal close() / deviceGate() / saveEvidence() can throw has its own line', () => {
  const src = readFileSync('lib/consult/protocol.ts', 'utf8');
  const body = (start) => { const i = src.indexOf(start); assert.ok(i >= 0, start); const j = src.indexOf('\n}', i); return src.slice(i, j); };
  const parts = [body('async function deviceGate'), body('export async function close('), body('export async function saveEvidence(')];
  const codes = new Set(parts.flatMap((p) => [...p.matchAll(/throw new Error\('([a-z_]+)'\)/g)].map((m) => m[1])));
  assert.ok(codes.size >= 8, [...codes].join());
  for (const code of codes) assert.notEqual(closeRefusal(code).line, CLOSE_REFUSED_FALLBACK, code);
});

test('an unknown code gets the fallback with Try again; the fixes are the named ones', () => {
  assert.deepEqual(closeRefusal('something_new'), { line: CLOSE_REFUSED_FALLBACK, fix: 'retry', known: false });
  assert.deepEqual(closeRefusal(undefined).fix, 'retry');
  assert.match(CLOSE_REFUSED_FALLBACK, /^The office didn’t take the close\. Nothing was lost — your answers are saved on this device\. Try again in a minute; if it says this again, tell Joe\.$/);
  // r11 R11-1: Before you wrap, Trade walks, Sign in and Keep working (alone) joined the named fixes.
  for (const fix of Object.values(CLOSE_ERROR_ACTIONS)) assert.ok(['reload', 'back_to_visits', 'send_now', 'go_to_field', 'before_you_wrap', 'trade_walks', 'sign_in', 'keep_working', 'retry'].includes(fix), fix);
  assert.equal(W.visitNotClosed, 'Not closed yet');
  assert.equal(W.ownerToldNotClosed, 'Joe has been told this visit hasn’t closed.');
  assert.equal(closeRefusal('conflict').fix, 'reload');
  assert.equal(closeRefusal('stale_snapshot').fix, 'reload');
  assert.equal(closeRefusal('complete_locked').fix, 'back_to_visits');
});

test('refused-close screen: heading is Not closed yet, never "Visit closed — sending"', () => {
  const src = readFileSync('components/consult/field/WrapClose.tsx', 'utf8');
  const branch = src.slice(src.indexOf('closing.step === "error" && !slow'), src.indexOf('closing.step === "done" && r'));
  assert.match(branch, /W\.visitNotClosed/);
  assert.doesNotMatch(branch, /W\.visitClosedSending/);
  assert.match(branch, /W\.ownerToldNotClosed/);
  assert.doesNotMatch(branch, /plainWords\(/, 'the refusal uses its own line, not the generic mapping');
});

const rrpOn = { 'house.year_built': 1985, 'era.before_1978': true, 'era.disturbs_paint': true, 'era.renovator_name': 'Dana Kowalski', 'era.renovator_expiry': '2027-03-01', 'era.firm_cert_expiry': '2027-03-01' };

test('certification warning names who, both dates (no ISO) and what to do', () => {
  const list = certificationWarnings(rrpOn, '2027-06-30');
  const firm = list.find((w) => w.field_address === 'era.firm_cert_expiry');
  const ren = list.find((w) => w.field_address === 'era.renovator_expiry');
  assert.equal(ren.message, 'Dana Kowalski’s renovator certification runs out Mar 1, 2027 — before the planned finish, Jun 30, 2027. Dana takes the refresher course before then, or Joe puts another certified renovator on the job.');
  assert.equal(firm.message, 'SJC’s firm certification runs out Mar 1, 2027 — before the planned finish, Jun 30, 2027. Joe renews it before then. Apply at least 90 days before it runs out so it doesn’t lapse.');
  for (const w of list) assert.doesNotMatch(w.message, /\d{4}-\d{2}-\d{2}/);
  const p = certWarningParts(ren);
  assert.equal(p.expiry, 'Mar 1, 2027'); assert.equal(p.finish, 'Jun 30, 2027');
  assert.match(certificationWarnings({ ...rrpOn, 'era.renovator_name': '' }, '2027-06-30').find((w) => w.field_address === 'era.renovator_expiry').message, /^The certified renovator’s certification runs out/);
});

test('certification warning: none when Renovate Right does not apply (1965 + No), or the cert outlasts the job', () => {
  assert.deepEqual(certificationWarnings({ ...rrpOn, 'house.year_built': 1965, 'era.disturbs_paint': false, 'era.window_door_replacement': false }, '2027-06-30'), []);
  assert.deepEqual(certificationWarnings({ ...rrpOn, 'era.renovator_expiry': '2027-07-01', 'era.firm_cert_expiry': '2027-06-30' }, '2027-06-30'), []);
  assert.deepEqual(certificationWarnings(rrpOn, null), []);
});

test('the warning keeps each date on one line and sits under its expiry field, on the RRP sheet, in Before you wrap and in the office', () => {
  const comp = readFileSync('components/consult/CertWarning.tsx', 'utf8');
  assert.equal((comp.match(/whitespace-nowrap/g) ?? []).length, 2);
  const row = readFileSync('components/consult/field/FieldRow.tsx', 'utf8');
  assert.match(row, /w\.field_address === `era\.\$\{f\.key\}`/);
  const wrap = readFileSync('components/consult/field/WrapClose.tsx', 'utf8');
  assert.equal((wrap.match(/<CertWarnings /g) ?? []).length, 2, 'Before you wrap + Renovate Right sheet');
  const office = readFileSync('app/(os)/projects/[slug]/consult/[id]/page.tsx', 'utf8');
  assert.match(office, /<CertWarningList list=\{certWarnings\}/);
  assert.match(office, /<CertWarningText w=\{w\} \/>/);
});

test('blocked-close footer: no dangling separator, Keep working steps aside during a conflict', () => {
  const src = readFileSync('components/consult/field/WrapClose.tsx', 'utf8');
  const footer = src.slice(src.indexOf('footer={<>'), src.indexOf('<ReopenedNote reopened={reopened}'));
  assert.doesNotMatch(footer, />·</);
  assert.match(footer, /justify-between/);
  assert.match(footer, /!firstConflict && <Btn[^>]*>\{W\.keepWorking\}/);
});

test('close result count = field items + each other open check row', () => {
  const r = { price_critical: { total: 10, done: 8 }, record: { total: 2, done: 2 }, checks: [{ code: 'required_fields', open: ['a', 'b'] }, { code: 'trade_walks', open: ['Plumber'] }, { code: 'promised_date', open: ['date'] }, { code: 'rrp', open: [] }] };
  assert.equal(closeResultOpenCount(r), 4);
});

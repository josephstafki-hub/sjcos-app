// r11 design (docs/plans/reviews/build-consult-r11-design.md) and domain extras: a refused close's button goes
// where its line says; the re-delivery day is limited with words saying why; the certification warning names
// Joe everywhere; the own ✓ Complete reads like the opened one; one Price-critical count; plain office flag
// sentences; the toilet clearance line in two sentences.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLOSE_ERROR_ACTIONS, refusalFocus } from '../lib/consult/close-errors.ts';
import { CLOSE_FIX_CUE, CLOSE_FIX_LABEL, CLOSE_REFUSED_FALLBACK, W, closeRefusal, closeRefusalCalm } from '../lib/consult/ui/words.ts';
import { certificationWarnings, clampDay, redeliveryWindow } from '../lib/consult/rrp.ts';
import { completeCountsLine, countedModule } from '../lib/consult/completeness.ts';
import { isHiddenModule, officeFlagText } from '../lib/consult/ui/model.ts';
import { FLAG_HINTS } from '../lib/consult/forms/seed/flag-hints.ts';
import { seedModules } from '../lib/consult/forms/seed.ts';
import { evaluatedFlags } from '../lib/consult/flags.ts';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const low = (s) => s.toLowerCase();

test('R11-1: every refused close button names a place or action its line names', () => {
  for (const code of Object.keys(CLOSE_ERROR_ACTIONS)) {
    const { line, fix } = closeRefusal(code);
    const label = CLOSE_FIX_LABEL[fix], cue = CLOSE_FIX_CUE[fix];
    assert.ok(label, `${code}: ${fix} has a label`);
    assert.ok(low(label).includes(low(cue)), `${code}: "${cue}" is in the button "${label}"`);
    assert.ok(low(line).includes(low(cue)), `${code}: the line names "${cue}" — ${line}`);
  }
  const unknown = closeRefusal('something_new');
  assert.ok(low(unknown.line).includes(low(CLOSE_FIX_CUE[unknown.fix])), 'the fallback line names Try again');
  assert.equal(unknown.line, CLOSE_REFUSED_FALLBACK);
});

test('R11-1: the judge’s code → button table', () => {
  const want = {
    invalid_command: ['before_you_wrap', W.beforeYouWrap],
    owner_required: ['trade_walks', 'Trade walks'],
    device_access_denied: ['keep_working', W.keepWorking],
    missing_device_manifest_required: ['keep_working', W.keepWorking],
    evidence_too_large: ['keep_working', W.keepWorking],
    batch_too_large: ['keep_working', W.keepWorking],
    signed_out: ['sign_in', W.signIn],
    rebase_required: ['go_to_field', W.goToField],
  };
  for (const [code, [fix, label]] of Object.entries(want)) {
    assert.equal(CLOSE_ERROR_ACTIONS[code], fix, code);
    assert.equal(CLOSE_FIX_LABEL[fix], label, code);
  }
  assert.match(closeRefusal('invalid_command').line, /Check Before you wrap, then close again\.$/);
  assert.match(closeRefusal('owner_required').line, /Take the day off in Trade walks, then close again\.$/);
});

test('R11-1: the close screen wires each fix to its place, and Keep working stands alone where only Joe can act', () => {
  const wrap = src('components/consult/field/WrapClose.tsx');
  const branch = wrap.slice(wrap.indexOf('closing.step === "error" && !slow'), wrap.indexOf('closing.step === "done" && r'));
  assert.match(branch, /CLOSE_FIX_LABEL\[refusal\.fix\]/, 'the button label comes from the one table');
  assert.match(branch, /const only = refusal\.fix === "keep_working"/);
  assert.match(branch, /!only && <Btn onClick=\{\(\) => refused\("keep_working"\)\}>/, 'no second Keep working beside a lone one');
  assert.match(branch, /refusal\.fix === "sign_in" && signInHref\s*\n?\s*\? <LinkBtn tone="primary" href=\{signInHref\}/);
  const app = src('components/consult/field/ConsultApp.tsx');
  assert.match(app, /const signInHref = `\/login\?next=\$\{encodeURIComponent\(`\/consult\/\$\{consultId\}`\)\}`;/);
  assert.match(app, /fix === "sign_in"\) location\.href = signInHref/);
  assert.match(app, /fix === "before_you_wrap"\) setAfter\(field \? `focus:\$\{field\}` : "before_you_wrap"\)/);
  assert.match(app, /fix === "go_to_field"\) setAfter\(field \? `focus:\$\{field\}` : "go_conflict"\)/);
  // r12 extra: Trade walks from this refusal scrolls to the trade that has the day.
  assert.match(app, /fix === "trade_walks"\) setAfter\("trade_walks_day"\)/);
  const visit = src('components/consult/field/VisitScreen.tsx');
  assert.match(visit, /case "before_you_wrap": setSheet\("wrap"\)/);
  assert.match(visit, /refusalFocus\(action\.slice\(6\)\)/);
  const dflt = visit.slice(visit.indexOf('default: {\n        // r11 R11-1'));
  assert.doesNotMatch(dflt.slice(0, dflt.indexOf('const ranAction')), /\bcase "/, 'the field-focus default is last, so nothing falls through into it');
  const ctl = src('lib/consult/ui/controller.ts');
  assert.match(ctl, /throw new ConsultRefusal\(/, 'the office’s details[] ride on the thrown refusal');
  assert.match(ctl, /const field = refusalField\(e\);/);
});

test('R11-1: details[].field focuses that field — in its wrap sheet or on the visit', () => {
  assert.deepEqual(refusalFocus('evidence.rrp.redelivery_day'), { sheet: 'rrp' });
  assert.deepEqual(refusalFocus('evidence.flags.abc:vanity_width.note'), { sheet: 'flags' });
  assert.deepEqual(refusalFocus('evidence.trade_walks.0.reason'), { sheet: 'trades' });
  assert.deepEqual(refusalFocus('evidence.ack_reason'), { sheet: 'ack' });
  assert.deepEqual(refusalFocus('evidence.promised_date'), { closing: 'estimate_promised' });
  assert.deepEqual(refusalFocus('evidence.photos_ok'), { house: 'photos_ok' });
  assert.deepEqual(refusalFocus('evidence.skips.1111-aaaa:toilet_front_clearance.note'), { addr: '1111-aaaa:toilet_front_clearance' });
  assert.equal(refusalFocus('manifest.device'), null);
  assert.equal(refusalFocus(undefined), null);
});

test('extra: a refusal one Reload fixes is the calm status banner', () => {
  assert.equal(closeRefusalCalm(closeRefusal('conflict').fix), true);
  assert.equal(closeRefusalCalm(closeRefusal('stale_snapshot').fix), true);
  assert.equal(closeRefusalCalm(closeRefusal('invalid_command').fix), false);
  assert.match(src('components/consult/field/WrapClose.tsx'), /<Banner kind=\{closeRefusalCalm\(refusal\.fix\) \? "status" : "action"\} role="status">\{refusal\.line\}<\/Banner>/);
});

test('re-delivery day: limited to start − 60 … start − 7, with the words saying why', () => {
  const w = redeliveryWindow('2027-02-01');
  assert.deepEqual(w, { min: '2026-12-03', max: '2027-01-25' });
  assert.equal(clampDay('2026-11-20', w), '2026-12-03');
  assert.equal(clampDay('2027-01-28', w), '2027-01-25');
  assert.equal(clampDay('2027-01-10', w), '2027-01-10');
  assert.equal(clampDay('2026-11-20', null), '2026-11-20', 'no start yet: the day stays open');
  assert.equal(W.rrpRedeliveryWindow, 'Between 60 and 7 days before the start, so the pamphlet still counts.');
  const wrap = src('components/consult/field/WrapClose.tsx');
  assert.match(wrap, /<input type="date" min=\{dayWindow\?\.min\} max=\{dayWindow\?\.max\} aria-describedby=/);
  assert.match(wrap, /\{W\.rrpRedeliveryWindow\}/);
  assert.match(wrap, /clampDay\(e\.target\.value, dayWindow\)/);
});

test('certification warning: the one shared copy names Joe, on every surface', () => {
  const rrpOn = { 'house.year_built': 1985, 'era.before_1978': true, 'era.disturbs_paint': true, 'era.renovator_name': 'Dana Kowalski', 'era.renovator_expiry': '2027-03-01', 'era.firm_cert_expiry': '2027-03-01' };
  for (const w of certificationWarnings(rrpOn, '2027-06-30')) assert.match(w.message, /\. Joe renews it /, w.field_address);
  // Field (under the expiry field, the Renovate Right sheet, Before you wrap) and the office look-over all
  // render CertWarningText / CertWarningList — none writes its own words.
  for (const p of ['components/consult/field/FieldRow.tsx', 'components/consult/field/WrapClose.tsx', 'app/(os)/projects/[slug]/consult/[id]/page.tsx']) {
    const s = src(p);
    assert.match(s, /CertWarningText|CertWarningList/, p);
    assert.doesNotMatch(s, /Renew it|another certified renovator/, `${p} has no copy of its own`);
  }
  assert.match(src('components/consult/CertWarning.tsx'), /certWarningParts\(w\)/);
});

test('extra: the own ✓ Complete reads like the opened Complete screen', () => {
  const wrap = src('components/consult/field/WrapClose.tsx');
  const done = wrap.slice(wrap.indexOf('closing.step === "done" && r'));
  assert.match(done, /✓ \{W\.complete\}.*closedWhen.*whitespace-nowrap.*closedWhen/, 'the close time stays together in the heading');
  // r12 extra: both close results (◐ Needs finishing too) go back with ‹ Back to visits.
  assert.match(done, /<LinkBtn href="\/consult\/">\{W\.backToVisits\}<\/LinkBtn>/);
  assert.equal(W.backToVisits, '‹ Back to visits');
  assert.match(done, /<p className="text-ink">\{W\.applyFindingsWhat\}<\/p><Btn tone="primary" onClick=\{onApply\}/, 'words beside Apply findings');
  assert.match(done, /: staff \? <p className="text-ink">\{W\.joeAppliesFindings\}<\/p>/, 'a staff visitor is told Joe applies them');
  assert.equal(W.joeAppliesFindings, 'Joe applies the findings in the office.');
  assert.equal(W.applyFindingsWhat, 'Puts today’s measurements and flags into the job’s scope.');
  const app = src('components/consult/field/ConsultApp.tsx');
  assert.equal((app.match(/closedAt=\{\(st\.fresh \?\? snap\)\?\.consult\.closed_at\}/g) ?? []).length, 2, 'both Complete renders get the close time');
});

test('extra: one Price-critical count — the server-filled visit context counts nowhere', () => {
  assert.equal(countedModule({ key: 'visit' }), false);
  assert.equal(countedModule({ key: 'house' }), true);
  for (const m of seedModules) assert.equal(isHiddenModule(m), !countedModule(m), m.key);
  const protocol = src('lib/consult/protocol.ts');
  const completion = protocol.slice(protocol.indexOf('const fields:CompletionItem[]=[]'), protocol.indexOf('const devices=(await c.query'));
  assert.match(completion, /if\(!countedModule\(m\)\)continue;/, 'the office completion skips what the device model skips');
  assert.equal(completeCountsLine({ price_critical: { done: 324, total: 324, skipped: 30 }, record: { done: 2, total: 2, skipped: 3 } }), 'Price-critical 324/324 · Record 2/2 · 33 skipped');
  assert.match(src('components/consult/field/WrapClose.tsx'), /\{completeCountsLine\(r\)\}/);
  assert.match(src('components/consult/field/GetReady.tsx'), /completeCountsLine\(\{ price_critical: c\.price_critical, record: c\.record \}\)/);
});

test('extra: office flag lines are plain sentences; office detail stays as Joe wrote it', () => {
  assert.equal(officeFlagText('> wall available', FLAG_HINTS['bath_scope.vanity_width']), 'The vanity they want is wider than the wall.');
  assert.equal(officeFlagText('cast iron: 2-person demo / break-up', FLAG_HINTS['bath_scope.existing_tub_material']), 'A cast-iron tub takes two people to remove or break up.');
  assert.equal(officeFlagText('tempered (IRC R308.4.3) unless exceptions apply', 'x'), 'Tempered (IRC R308.4.3) unless exceptions apply.');
  assert.match(officeFlagText('test before demo; abatement by an MDH-licensed contractor — confirm residential rules with MDH/counsel', 'Possible asbestos.'), /^Test before demo; abatement by an MDH-licensed contractor/);
  // r12 extra: the office list moved to OfficeFlags (decided flags carry the muted ⚐).
  assert.match(src('app/(os)/projects/[slug]/consult/[id]/page.tsx'), /<OfficeFlags flags=\{model\.flags\} decisions=\{draft\.flags\} \/>/);
  assert.match(src('components/consult/office/OfficeFlags.tsx'), /officeFlagText\(f\.issue, f\.hint\)/);
});

test('domain E1: the toilet clearance line is two sentences', async () => {
  const { flagLead } = await import('../lib/consult/ui/flag-lead.ts');
  const f = seedModules.find((m) => m.key === 'bath_scope').fields.find((x) => x.key === 'toilet_front_clearance');
  const hint = (plan) => evaluatedFlags(f, 'b:toilet_front_clearance', { toilet_plan: plan, toilet_front_clearance: 20, toilet_fixture_plans: [plan] })[0].hint;
  assert.equal(hint('New'), 'Less than 24″ in front of the toilet. A new toilet needs at least 24″ (Minnesota plumbing code).');
  assert.match(hint('Move'), /The toilet needs at least 24″ at its new spot \(Minnesota plumbing code\)\./);
  assert.match(hint('Replace'), /The replacement toilet needs at least 24″ \(Minnesota plumbing code\)\. Same spot\?/);
  const lead = flagLead({ hint: hint('New'), measured: [{ field: 'toilet_front_clearance', value: 20, unit: '″', address: 'b:toilet_front_clearance' }] }, { sections: [] });
  assert.equal(lead, 'Measured 20″ in front of the toilet. A new toilet needs at least 24″ (Minnesota plumbing code).');
});

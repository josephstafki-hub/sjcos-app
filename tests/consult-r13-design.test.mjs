// r13 design (docs/plans/reviews/build-consult-r13-design.md): no stranded "·" on the ✓ Complete screens;
// Before you wrap says why on every refusal path; the office radon flag names its subject; calmer extras.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { W, closeRefusalFocus, CHECK_ACTION_WORDS } from '../lib/consult/ui/words.ts';
import { completeCountsLine } from '../lib/consult/completeness.ts';
import { officeFlagText, buildModel, emptyDraft } from '../lib/consult/ui/model.ts';
import { seedModules } from '../lib/consult/forms/seed.ts';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const between = (s, a, b) => s.slice(s.indexOf(a), b ? s.indexOf(b, s.indexOf(a)) : undefined);

test('R13-1: "✓ Complete" alone, with a plain "Closed …" line under it, on both Complete screens', () => {
  assert.equal(W.closedOn, 'Closed');
  const done = between(src('components/consult/field/WrapClose.tsx'), 'closing.step === "done" && r');
  const card = between(src('components/consult/field/GetReady.tsx'), 'export function CompleteCard', 'export function UnlockCard');
  for (const [screen, when] of [[done, 'closedWhen'], [card, 'when']]) {
    assert.match(screen, /<h1 className="font-serif text-\[1\.8em\] font-semibold text-accent-2">✓ \{W\.complete\}<\/h1>/, 'no time and no "·" in the heading');
    assert.match(screen, new RegExp(`\\{${when} && <p className="mt-1 text-ink-2">\\{W\\.closedOn\\} <span className="whitespace-nowrap">\\{${when}\\}</span></p>\\}`));
    assert.doesNotMatch(screen, /\{W\.complete\}\{/, 'nothing glued onto the heading');
  }
});

test('R13-1: the counts line breaks only after a dot — each piece is nowrap and ends with its own "·"', () => {
  const prim = src('components/consult/field/primitives.tsx');
  const dot = between(prim, 'export function DotLine', 'export function Eyebrow');
  assert.match(dot, /line\.split\(" · "\)/);
  assert.match(dot, /\{i > 0 && " "\}<span className="whitespace-nowrap">\{p\}\{i < parts\.length - 1 && " ·"\}<\/span>/);
  // The same split, as plain text: the pieces the screen renders.
  const line = completeCountsLine({ price_critical: { done: 352, total: 352, skipped: 60 }, record: { done: 2, total: 2, skipped: 4 } });
  const parts = line.split(' · ');
  assert.deepEqual(parts.map((p, i) => (i < parts.length - 1 ? `${p} ·` : p)), ['Price-critical 352/352 ·', 'Record 2/2 ·', '64 skipped']);
  assert.match(src('components/consult/field/WrapClose.tsx'), /<DotLine className="mt-2 font-mono text-ink" line=\{completeCountsLine\(r\)\} \/>/);
  assert.match(src('components/consult/field/GetReady.tsx'), /<DotLine className="mt-2 font-mono text-ink" line=\{completeCountsLine\(\{ price_critical: c\.price_critical, record: c\.record \}\)\} \/>/);
});

test('R13-2: a closing field goes to the date; an unknown field is Before you wrap', () => {
  assert.deepEqual(closeRefusalFocus('closing.estimate_promised'), { closing: 'estimate_promised' });
  assert.deepEqual(closeRefusalFocus('evidence.closing.estimate_promised'), { closing: 'estimate_promised' });
  assert.deepEqual(closeRefusalFocus('promised_date'), { closing: 'estimate_promised' });
  for (const f of ['unknown.path', 'evidence.zzz', 'closing.summary', '', null]) assert.equal(closeRefusalFocus(f), null, String(f));
  assert.deepEqual(closeRefusalFocus('evidence.skips'), { sheet: 'wrap' });
  assert.deepEqual(closeRefusalFocus('evidence.rrp.redelivery_day'), { sheet: 'rrp' });
});

test('R13-2: runAction("focus:unknown.path") opens Before you wrap with the note — on every refusal path', () => {
  assert.equal(W.wrapRefusedNote, 'The office couldn’t read these answers — check them, then close again.');
  const visit = src('components/consult/field/VisitScreen.tsx');
  assert.match(visit, /const wrapRefused = \(\) => \{ setSheet\("wrap"\); setWrapWhy\(true\); \};/);
  assert.match(visit, /refusedNote=\{wrapWhy\}/);
  const branch = between(visit, '      default: {', '  const ranAction');
  assert.match(branch, /const target = refusal \? closeRefusalFocus\(action\.slice\(6\)\) : null;/);
  // focus:unknown.path → closeRefusalFocus is null → the note (checked above that it is null).
  assert.match(branch, /if \(!target \|\| \("sheet" in target && target\.sheet === "wrap"\)\) \{ if \(refusal\) wrapRefused\(\); else setSheet\("wrap"\); break; \}/);
  // A field the office named that isn't on this visit, or no photos field: still the note.
  assert.match(branch, /openSection\(inst, target\.addr\); else wrapRefused\(\); \}/);
  assert.match(branch, /runAction\("review_permissions"\); else wrapRefused\(\); \}/);
  assert.doesNotMatch(branch, /\{ setSheet\("wrap"\); break; \}/, 'no wrap without the note from a refusal');
  assert.match(branch, /else if \("closing" in target\) pickDate\(\);/);
});

test('R13-3: the office radon flag reads through officeFlagText and names radon and the level', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const s = { consult: { id, status: 'in_progress', revision: 1, completion_generation: 1 }, pins: seedModules.map((definition) => ({ kind: 'module', definition })), instances: [{ id, module_key: 'house', parent_id: null }], heads: [{ instance_id: id, field_key: 'radon_level', status: 'answered', value: 36, server_revision: 1 }], conflicts: [] };
  const flag = buildModel(s, [], [], emptyDraft()).flags.find((f) => f.kind === 'advisory' && /radon/i.test(f.issue));
  assert.ok(flag, 'a radon advisory at 36 pCi/L');
  const text = officeFlagText(flag.issue, flag.hint);
  assert.match(text, /^Radon\b/, 'the subject first');
  assert.match(text, /\b36 pCi\/L/, 'the level');
  assert.match(text, /\b4\b/, 'the action level');
  const flags = src('components/consult/office/OfficeFlags.tsx');
  assert.match(flags, /const text = beforeDash\(officeFlagText\(f\.issue, f\.hint\)\);/);
  assert.doesNotMatch(flags, /f\.kind === "advisory" \? f\.hint/);
});

test('extra: the office decision is its own muted line, not a third " — "', () => {
  const flags = src('components/consult/office/OfficeFlags.tsx');
  assert.doesNotMatch(flags, /\{" — "\}/);
  assert.match(flags, /<span className="block pl-\[1\.25em\] text-\[0\.95em\] text-ink-2">\{sentenceCase\(flagDecisionText\(d\)\)\}<\/span>/);
});

test('extra: "Joe applies the findings" is a plain line; trade walks say Review once decided; renovator row', () => {
  const done = between(src('components/consult/field/WrapClose.tsx'), 'closing.step === "done" && r');
  assert.match(done, /<div className=\{staff && !findings && !findingsCode \? "mt-3" : "mt-4 rounded-lg border-2 border-rule p-3"\}>/);
  assert.equal(W.joeAppliesFindings, 'Joe applies the findings in the office.');
  const sheet = between(src('components/consult/field/WrapClose.tsx'), 'export function WrapSheet', 'function Line(');
  assert.match(sheet, /action=\{<Btn onClick=\{onTrades\}>\{tradesOpen \? W\.decide : W\.review\}<\/Btn>\} done=\{!tradesOpen\}/);
  assert.equal(W.review, 'Review');
  assert.equal(CHECK_ACTION_WORDS.review_trades, W.decide, 'an open check on Needs finishing still says Decide');
  assert.equal(W.rrpRenovator, 'Certified renovator certification is current on the visit day');
});

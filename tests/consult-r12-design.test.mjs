// r12 design (docs/plans/reviews/build-consult-r12-design.md): the Renovate Right rows say where the visitor
// fixes them; the two ✓ Complete screens give one answer about reopening from one role check; Before you wrap
// says why a refused close opened it; Trade walks scrolls to the day; one back label; the close time on one
// line; decided office flags carry the muted ⚐.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { W } from '../lib/consult/ui/words.ts';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const between = (s, a, b) => s.slice(s.indexOf(a), b ? s.indexOf(b, s.indexOf(a)) : undefined);

test('R12-2: the Renovate Right rows send the visitor to Era hazards', () => {
  assert.equal(W.rrpFirmOpen, 'Firm certification expiry is missing or before the visit day. Enter it in Era hazards, or Joe adds it in Settings › Company.');
  assert.equal(W.rrpRenovatorOpen, 'Certified renovator expiry is missing or before the visit day. Enter it in Era hazards.');
  assert.doesNotMatch(W.rrpFirmOpen, /fills it in/);
  // The button under the rows is the place both lines name.
  assert.ok(W.rrpGoEra.endsWith('Era hazards'));
});

test('R12-3: both ✓ Complete screens say "Answers are locked." and agree on Reopen', () => {
  assert.equal(W.answersLocked, 'Answers are locked.');
  assert.equal(W.completeLocked, 'Answers are locked. Joe can reopen it from the office look-over.');
  assert.ok(W.completeLocked.startsWith(W.answersLocked));

  const wrap = src('components/consult/field/WrapClose.tsx');
  const done = between(wrap, 'closing.step === "done" && r');
  assert.match(done, /\{staff \? W\.completeLocked : W\.answersLocked\}/, 'own close: the lock line from the role check');
  assert.match(done, /r\.complete && !staff && !reopening && <Btn onClick=\{\(\) => setReopening\(true\)\}>\{W\.reopen\}<\/Btn>/, 'own close: no Reopen for staff');
  assert.match(done, /\{reopening && !staff && \(/, 'own close: no reopen form for staff');

  const card = between(src('components/consult/field/GetReady.tsx'), 'export function CompleteCard', 'export function UnlockCard');
  assert.match(card, /\{staff \? W\.completeLocked : W\.answersLocked\}/, 'opened Complete: the same lock line');
  assert.match(card, /const canReopen = !staff && !!consultId;/);
  assert.match(card, /canReopen && !reopening && <Btn wide onClick=\{\(\) => setReopening\(true\)\}>\{W\.reopen\}<\/Btn>/, 'opened Complete: Reopen for Joe');
  assert.match(src('components/consult/field/GetReady.tsx'), /command: "reopen"/, 'the look-over’s own reopen command');

  // One role check feeds both screens.
  const app = src('components/consult/field/ConsultApp.tsx');
  assert.match(app, /st\.phase === "complete"\) body = <CompleteCard staff=\{staffUser\}/);
  assert.equal((app.match(/staff=\{staffUser\}/g) ?? []).length, 3, 'CompleteCard and both ClosingScreen renders');
});

test('extra: Before you wrap says why a refused close opened it', () => {
  assert.equal(W.wrapRefusedNote, 'The office couldn’t read these answers — check them, then close again.');
  const wrap = src('components/consult/field/WrapClose.tsx');
  assert.match(between(wrap, 'export function WrapSheet', 'function Line('), /\{refusedNote && <div className="mb-3"><Banner kind="status">\{W\.wrapRefusedNote\}<\/Banner><\/div>\}/);
  const visit = src('components/consult/field/VisitScreen.tsx');
  assert.match(visit, /case "before_you_wrap": setSheet\("wrap"\); setWrapWhy\(true\); break;/);
  assert.match(visit, /refusedNote=\{wrapWhy\}/);
  assert.match(visit, /if \(sheet === null\) setWrapWhy\(false\);/, 'the note goes once the sheet is left');
  // A field the office named still focuses that field instead.
  assert.match(src('components/consult/field/ConsultApp.tsx'), /fix === "before_you_wrap"\) setAfter\(field \? `focus:\$\{field\}` : "before_you_wrap"\)/);
});

test('extra: Trade walks after the trade-walk-day refusal scrolls to the trade with the day', () => {
  const app = src('components/consult/field/ConsultApp.tsx');
  assert.match(app, /fix === "trade_walks"\) setAfter\("trade_walks_day"\)/);
  const visit = src('components/consult/field/VisitScreen.tsx');
  assert.match(visit, /case "trade_walks_day": setTradeDay\(true\); setSheet\("trades"\); break;/);
  assert.match(visit, /<TradeSheet .*toDay=\{tradeDay\} \/>/);
  const sheet = between(src('components/consult/field/WrapClose.tsx'), 'export function TradeSheet', 'export function RrpSheet');
  assert.match(sheet, /ref=\{i === firstDay \? dayRef : undefined\}/);
  assert.match(sheet, /if \(open && toDay\) dayRef\.current\?\.scrollIntoView/);
  // The day is said on its trade, with a word beside the mark and a 56 px way to take it off.
  assert.match(sheet, /fill\(W\.tradeWalkDay, \{ day: walkDayLabel\(w\.day\) \}\)/);
  assert.match(sheet, /<Btn className="max-sm:w-full" onClick=\{\(\) => set\(i, \{ day: undefined \}\)\}>\{W\.tradeWalkDayOff\}<\/Btn>/);
  assert.equal(W.tradeWalkDayOff, 'Take the day off');
  assert.match(W.tradeWalkDay, /only Joe sets it/);
});

test('extra: both close results go back with ‹ Back to visits; the close time stays on one line', () => {
  const wrap = src('components/consult/field/WrapClose.tsx');
  const done = between(wrap, 'closing.step === "done" && r');
  assert.doesNotMatch(done, /\{W\.back\}/, 'no "Back to SJC OS" on ◐ Needs finishing');
  assert.equal((done.match(/<LinkBtn href="\/consult\/">\{W\.backToVisits\}<\/LinkBtn>/g) ?? []).length, 1, 'one back link for both results');
  assert.match(done, /<span className="whitespace-nowrap">\{closedWhen\}<\/span>/);
  const card = between(src('components/consult/field/GetReady.tsx'), 'export function CompleteCard', 'export function UnlockCard');
  assert.match(card, /<span className="whitespace-nowrap">\{when\}<\/span>/);
});

test('extra: decided office flags carry the muted ⚐; only undecided ones the red ⚑', () => {
  const flags = src('components/consult/office/OfficeFlags.tsx');
  assert.match(flags, /const calm = f\.kind === "advisory" \|\| !!d;/);
  assert.match(flags, /calm\s*\? <span className="text-ink-2"><span aria-hidden className="font-semibold">⚐<\/span>/);
  assert.match(flags, /: <><span aria-hidden className="font-semibold text-flag">⚑<\/span>/);
  assert.match(flags, /replace\(\/\\\.\$\/, ""\)/, 'no "break up. — not an issue"');
  const page = src('app/(os)/projects/[slug]/consult/[id]/page.tsx');
  assert.match(page, /<OfficeFlags flags=\{model\.flags\} decisions=\{draft\.flags\} \/>/);
  assert.doesNotMatch(page, /text-flag">⚑/);
});

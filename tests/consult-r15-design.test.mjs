// r15 design (docs/plans/reviews/build-consult-r15-design.md): the trade-walk day is removed, not "taken off",
// and the line above the button says why the visitor may remove it; the Reason box takes a sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { W, closeRefusal } from '../lib/consult/ui/words.ts';

const root = new URL('../', import.meta.url);
const src = (p) => readFileSync(new URL(p, root), 'utf8');
const between = (s, a, b) => s.slice(s.indexOf(a), b ? s.indexOf(b, s.indexOf(a)) : undefined);

test('R15-1: the walk-day line, its button and the refusal all say "remove the day"', () => {
  assert.equal(W.tradeWalkDay, 'Walk day {day} — only Joe can set a walk day. Remove it and he’ll set it from the office.');
  assert.equal(W.tradeWalkDayOff, 'Remove the day');
  assert.equal(closeRefusal('owner_required').line, 'Only Joe can set a trade-walk day. Remove the day in Trade walks, then close again.');
  for (const s of [W.tradeWalkDay, W.tradeWalkDayOff, closeRefusal('owner_required').line]) {
    assert.doesNotMatch(s, /take the day off/i, 'not the idiom for a day off work');
    assert.doesNotMatch(s, /only Joe sets it/i, 'no "only Joe sets it" over a button that changes it');
  }
  // The layout stays: the line, then a full-width button under sm.
  const sheet = between(src('components/consult/field/WrapClose.tsx'), 'export function TradeSheet', 'export function RrpSheet');
  assert.match(sheet, /fill\(W\.tradeWalkDay, \{ day: walkDayLabel\(w\.day\) \}\)/);
  assert.match(sheet, /<Btn className="max-sm:w-full" onClick=\{\(\) => set\(i, \{ day: undefined \}\)\}>\{W\.tradeWalkDayOff\}<\/Btn>/);
});

test('extra: the Trade walks Reason box is multi-line, like the Flags note', () => {
  const wrap = src('components/consult/field/WrapClose.tsx');
  assert.match(between(wrap, 'export function TradeSheet', 'export function RrpSheet'), /<TextInput label=\{W\.reason\} value=\{w\.reason\} onChange=\{\(v\) => set\(i, \{ reason: v \}\)\} multiline \/>/);
  assert.match(between(wrap, 'export function FlagSheet', 'export function TradeSheet'), /<TextInput label=\{W\.flagNote\} .* multiline \/>/);
});

test('extra: no "e.g." in the field words or the consult screens', () => {
  const words = src('lib/consult/ui/words.ts');
  assert.doesNotMatch(words, /\be\.g\./i);
  for (const f of readdirSync(new URL('components/consult/field/', root)).filter((n) => n.endsWith('.tsx'))) {
    assert.doesNotMatch(src(`components/consult/field/${f}`), /\be\.g\./i, f);
  }
});

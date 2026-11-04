// r8 screen fixes (docs/plans/reviews/build-consult-r8-design.md R8-1..3 + extras,
// build-consult-r8-domain.md 2/3/E3/E4). Pure checks and source pins; no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { W, checkedAt, quantitiesLine, skippedNotNA } from '../lib/consult/ui/words.ts';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('R8-1: the office picker stacks, wraps, says Section › Field, and has no Enter another button', () => {
  const office = src('components/consult/office/LookOverActions.tsx');
  assert.doesNotMatch(office, /sm:grid-cols-2/);
  assert.match(office, /@container\/pick/);
  assert.match(office, /whitespace-normal!/);
  assert.match(office, /min-h-12/);
  assert.doesNotMatch(office, /W\.enterAnother/);
  assert.match(office, /\{W\.officeEnterAnother\}/);
  assert.match(src('app/(os)/projects/[slug]/consult/[id]/page.tsx'), /label=\{`\$\{section\.label\} › \$\{f\.def\.label\}`\}/);
});

test('R8-1 field: the device picker is one column with wrapping labels', () => {
  const row = src('components/consult/field/FieldRow.tsx');
  const picker = row.slice(row.indexOf('function ConflictPicker'), row.indexOf('const SHOWN_LINES'));
  assert.doesNotMatch(picker, /sm:grid-cols-2/);
  assert.match(picker, /whitespace-normal/);
});

test('a field in conflict shows only ! Conflict, on the device and in the office', () => {
  const row = src('components/consult/field/FieldRow.tsx');
  assert.match(row, /if \(f\.conflict\) return <span[^\n]*state="conflict" \/><\/span>;/);
  assert.match(src('app/(os)/projects/[slug]/consult/[id]/page.tsx'), /\{c \? <CoverageMark variant="coverage" state="conflict"/);
});

test('domain 3: a skip that needs no assumption reads – Skipped; Not on this job stays N/A', () => {
  const date = { def: { type: 'date', key: 'estimate_promised' }, answer: { status: 'skipped', skip_reason: 'Joe sets the date' } };
  assert.equal(skippedNotNA(date), true);
  assert.equal(skippedNotNA({ def: { type: 'signature', key: 'client_initials' }, answer: { status: 'skipped', skip_reason: 'Client absent' } }), true);
  assert.equal(skippedNotNA({ def: { type: 'length', key: 'w', tier: 'price_critical' }, answer: { status: 'skipped', skip_reason: 'No access' } }), false);
  assert.equal(skippedNotNA({ def: { type: 'length', key: 'w' }, answer: { status: 'skipped', skip_reason: 'Not on this job' } }), false);
  assert.equal(skippedNotNA({ def: { type: 'length', key: 'w' }, answer: { status: 'answered' } }), false);
  assert.equal(W.dateSkippedHint, 'Joe gets a to-do to set the date.');
  assert.match(src('components/consult/field/FieldRow.tsx'), /skipped && d\.key === "estimate_promised" \? W\.dateSkippedHint : d\.hint/);
});

test('extra: a skipped field offers Change reason… and Undo skip', () => {
  const row = src('components/consult/field/FieldRow.tsx');
  assert.match(row, /skipped \? W\.changeReason : W\.skip/);
  assert.match(row, /\{ status: "cleared", unit: d\.unit \}\)\}>\{W\.undoSkip\}/);
});

test('extra: checkboxes draw a box like the rings, no text glyph', () => {
  for (const f of ['components/consult/field/FieldRow.tsx', 'components/consult/field/WrapClose.tsx']) {
    assert.doesNotMatch(src(f), /[☐☑□]/, f);
    assert.match(src(f), /<Box on=\{/, f);
  }
});

test('D3: the kept-toilet field line names where the choices are; the card follows kind', () => {
  assert.match(src('components/consult/field/FieldRow.tsx'), /Flag · <MeasureText text=\{fl\.hint\} \/>\{fl\.hint\.includes\(W\.beforeYouWrap\) \? "" : ` \$\{W\.advisoryTail\}`\}/);
  assert.match(src('components/consult/field/WrapClose.tsx'), /f\.kind === "advisory" \? "border-rule-soft bg-paper" : "border-rule"/);
});

test('office: "checked before pricing"; Complete names unmeasured quantities', () => {
  assert.equal(checkedAt('Before pricing'), 'checked before pricing');
  assert.equal(checkedAt('Demo day'), 'checked at Demo day');
  assert.equal(quantitiesLine(0), '');
  assert.equal(quantitiesLine(1), '1 estimate quantity not measured');
  assert.equal(quantitiesLine(3), '3 estimate quantities not measured');
  assert.match(src('app/(os)/projects/[slug]/consult/[id]/page.tsx'), /`Complete · \$\{fmt\(extra\.completedAt\)\}\$\{unmeasured \? ` · \$\{unmeasured\}` : ""\}`/);
});
